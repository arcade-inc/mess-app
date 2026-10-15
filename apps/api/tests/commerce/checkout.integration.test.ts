import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { parseConfig } from '../../src/platform/config.js'
import { buildApp } from '../../src/app.js'
import { createPostgresFixture } from '../setup/postgres.js'
import { createMockEmailSender } from '../../src/worker/email-sender.js'
import { createOutboxWorker } from '../../src/worker/outbox.worker.js'

const databaseUrl = process.env.TEST_DATABASE_URL

const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl ?? 'postgres://test:test@127.0.0.1:5432/test',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  CORS_ORIGINS: 'https://web.example',
  RATE_LIMIT_MAX: '1000',
})

test('checkout uses database prices, validates year eligibility, and rolls back failed payment', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
  const pool = fixture.pool
  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())

  const { rows: [course] } = await pool.query<{ id: string; price_minor: number; year_min: number; year_max: number }>(
    "SELECT id, price_minor, year_min, year_max FROM courses WHERE subject = 'Science'",
  )
  assert.ok(course, 'seeded Science course is available')

  const makeRequest = (overrides: Record<string, unknown> = {}) => {
    const email = `parent-${randomUUID()}@example.com`
    return {
      parent: { name: 'Test Parent', email, emailConfirm: email },
      students: [{ name: 'Test Student', year: course.year_min, courseIds: [course.id] }],
      paymentMethod: 'visa',
      ...overrides,
    }
  }

  const validRequest = makeRequest()
  const successKey = `integration-${randomUUID()}`
  fixture.trackOrder(successKey, (validRequest as { parent: { email: string } }).parent.email)
  const success = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': successKey },
    payload: validRequest,
  })
  assert.equal(success.statusCode, 201)
  const receipt = success.json<{ orderId: string; status: string; totalMinor: number; invitations: Array<{ studentName: string; url: string }> }>()
  fixture.trackOutbox(`purchase-confirmation:${receipt.orderId}`)
  assert.equal(receipt.status, 'PAID')
  assert.equal(receipt.totalMinor, course.price_minor)
  assert.equal(receipt.invitations.length, 1)
  const paymentMethod = await pool.query<{ provider: string }>(
    'SELECT provider FROM payments WHERE order_id = $1', [receipt.orderId],
  )
  assert.equal(paymentMethod.rows[0]?.provider, 'mock_visa')

  const changedMethod = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': successKey },
    payload: { ...validRequest, paymentMethod: 'mastercard' },
  })
  assert.equal(changedMethod.statusCode, 422, 'a different mock method changes the checkout request identity')

  const unsupportedKey = `unsupported-method-${randomUUID()}`
  const unsupportedRequest = makeRequest({ paymentMethod: 'paypal' })
  fixture.trackOrder(unsupportedKey, (unsupportedRequest as { parent: { email: string } }).parent.email)
  const unsupportedMethod = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': unsupportedKey },
    payload: unsupportedRequest,
  })
  assert.equal(unsupportedMethod.statusCode, 400, 'unsupported mock methods are rejected before order creation')
  const confirmation = await pool.query<{ id: string; message_type: string; payload: { orderId: string }; status: string }>(
    "SELECT id, message_type, payload, status FROM outbox_messages WHERE dedupe_key = $1",
    [`purchase-confirmation:${receipt.orderId}`],
  )
  assert.equal(confirmation.rowCount, 1, 'the paid order and its email event commit together')
  assert.equal(confirmation.rows[0]?.message_type, 'purchase_confirmation')
  assert.equal(confirmation.rows[0]?.payload.orderId, receipt.orderId)
  assert.equal(confirmation.rows[0]?.status, 'PENDING')

  const purchasedSlot = await pool.query<{ id: string; created_at: Date }>(
    'SELECT id, created_at FROM student_slots WHERE order_id = $1', [receipt.orderId],
  )
  assert.equal(purchasedSlot.rowCount, 1)
  const reminderKey = `invitation-reminder:${purchasedSlot.rows[0]!.id}:7d`
  fixture.trackOutbox(reminderKey)
  const reminder = await pool.query<{ message_type: string; payload: { slotId: string }; scheduled_at: Date }>(
    'SELECT message_type, payload, scheduled_at FROM outbox_messages WHERE dedupe_key = $1', [reminderKey],
  )
  assert.equal(reminder.rowCount, 1, 'checkout schedules one reminder per student slot')
  assert.equal(reminder.rows[0]?.message_type, 'invitation_reminder')
  assert.equal(reminder.rows[0]?.payload.slotId, purchasedSlot.rows[0]!.id)
  const expectedReminderAt = purchasedSlot.rows[0]!.created_at.getTime() + 7 * 24 * 60 * 60 * 1000
  assert.ok(Math.abs(reminder.rows[0]!.scheduled_at.getTime() - expectedReminderAt) < 2_000)

  const localWorker = createOutboxWorker({
    pool,
    emailSender: createMockEmailSender(),
    webOrigin: config.webOrigin,
    encryptionSecret: config.jwtSecret,
    batchSize: 1,
  })
  assert.equal(await localWorker.runOnce(), 1)
  const skippedConfirmation = await pool.query<{ status: string }>(
    'SELECT status FROM outbox_messages WHERE id = $1', [confirmation.rows[0]!.id],
  )
  assert.equal(skippedConfirmation.rows[0]?.status, 'SKIPPED')
  const checkoutToken = new URL(receipt.invitations[0]!.url).pathname.split('/').at(-1)!
  const checkoutInvitation = await pool.query<{ token_hash: string; superseded_at: Date | null }>(
    'SELECT token_hash, superseded_at FROM invitations WHERE slot_id = $1 AND token_hash = $2',
    [purchasedSlot.rows[0]!.id, createHash('sha256').update(checkoutToken).digest('hex')],
  )
  assert.equal(checkoutInvitation.rowCount, 1, 'the local no-op sender must not invalidate the checkout link')
  assert.equal(checkoutInvitation.rows[0]?.superseded_at, null)

  const ineligibleKey = `ineligible-${randomUUID()}`
  const ineligible = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': ineligibleKey },
    payload: makeRequest({ students: [{ name: 'Test Student', year: course.year_max + 1, courseIds: [course.id] }] }),
  })
  assert.equal(ineligible.statusCode, 422)

  const failureKey = `payment-failure-${randomUUID()}`
  const failureRequest = makeRequest()
  fixture.trackOrder(failureKey, (failureRequest as { parent: { email: string } }).parent.email)
  const failedPaymentApp = await buildApp({
    config,
    database: new Pool({ connectionString: databaseUrl }),
    paymentGateway: { charge: async () => ({ provider: 'mock', providerRef: `mock-${failureKey}`, amountMinor: 19900, status: 'FAILED' }) },
  } as Parameters<typeof buildApp>[0])
  t.after(() => failedPaymentApp.close())
  const failure = await failedPaymentApp.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': failureKey },
    payload: failureRequest,
  })
  assert.equal(failure.statusCode, 402)

  const afterFailure = await pool.query<{ status: string; grants: string; invitations: string }>(
    `SELECT purchase.status,
            (SELECT count(*) FROM enrollments WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id = purchase.id)) AS grants,
            (SELECT count(*) FROM invitations WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id = purchase.id)) AS invitations
       FROM orders purchase WHERE purchase.idempotency_key = $1`,
    [failureKey],
  )
  assert.equal(afterFailure.rows[0]?.status, 'FAILED')
  assert.equal(Number(afterFailure.rows[0]?.grants), 0)
  assert.equal(Number(afterFailure.rows[0]?.invitations), 0)
  const failedOutbox = await pool.query(
    `SELECT 1 FROM outbox_messages message
      WHERE message.payload->>'orderId' = (SELECT id::text FROM orders WHERE idempotency_key = $1)
         OR message.payload->>'slotId' IN (SELECT id::text FROM student_slots WHERE order_id = (SELECT id FROM orders WHERE idempotency_key = $1))`,
    [failureKey],
  )
  assert.equal(failedOutbox.rowCount, 0, 'failed payments must not enqueue purchase email')

  const incorrectAmountKey = `wrong-amount-${randomUUID()}`
  const incorrectAmountRequest = makeRequest()
  fixture.trackOrder(incorrectAmountKey, (incorrectAmountRequest as { parent: { email: string } }).parent.email)
  const incorrectAmountApp = await buildApp({
    config,
    database: new Pool({ connectionString: databaseUrl }),
    paymentGateway: { charge: async () => ({ provider: 'mock', providerRef: `mock-${incorrectAmountKey}`, amountMinor: 1, status: 'SUCCEEDED' }) },
  })
  t.after(() => incorrectAmountApp.close())
  const incorrectAmount = await incorrectAmountApp.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': incorrectAmountKey },
    payload: incorrectAmountRequest,
  })
  assert.equal(incorrectAmount.statusCode, 402)
  const mismatchedPayment = await pool.query<{ count: string }>(
    'SELECT count(*) FROM enrollments WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = $1))',
    [incorrectAmountKey],
  )
  assert.equal(Number(mismatchedPayment.rows[0]?.count), 0)

  const unavailableKey = `payment-unavailable-${randomUUID()}`
  const unavailableRequest = makeRequest()
  fixture.trackOrder(unavailableKey, (unavailableRequest as { parent: { email: string } }).parent.email)
  const unavailableApp = await buildApp({
    config,
    database: new Pool({ connectionString: databaseUrl }),
    paymentGateway: { charge: async () => { throw new Error('provider diagnostic with sensitive detail') } },
  })
  t.after(() => unavailableApp.close())
  const unavailable = await unavailableApp.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': unavailableKey },
    payload: unavailableRequest,
  })
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.json<{ error: { code: string } }>().error.code, 'PAYMENT_UNAVAILABLE')
  const unavailableState = await pool.query<{ status: string; grants: string }>(
    `SELECT purchase.status,
            (SELECT count(*) FROM enrollments WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id = purchase.id)) AS grants
       FROM orders purchase WHERE purchase.idempotency_key = $1`,
    [unavailableKey],
  )
  assert.equal(unavailableState.rows[0]?.status, 'FAILED')
  assert.equal(Number(unavailableState.rows[0]?.grants), 0)
})
