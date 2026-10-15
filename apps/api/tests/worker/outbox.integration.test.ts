import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Pool } from 'pg'
import { trace } from '@opentelemetry/api'
import { createPostgresFixture } from '../setup/postgres.js'
import { withTransaction } from '../../src/platform/database.js'
import {
  claimOutboxMessages,
  enqueueOutboxMessage,
  markOutboxSent,
  scheduleOutboxRetry,
} from '../../src/worker/outbox.repository.js'
import {
  extractOutboxTraceContext,
  linksForRetry,
  sanitizeOutboxTraceContext,
} from '../../src/worker/outbox.worker.js'
import { createOutboxWorker } from '../../src/worker/outbox.worker.js'

const validTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

test('checked enqueue is transactional and deduplicates on a stable message identity', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const dedupeKey = `outbox-enqueue-${randomUUID()}`
  fixture.trackOutbox(dedupeKey)
  const input = {
    messageType: 'purchase_confirmation' as const,
    payload: { orderId: randomUUID() },
    dedupeKey,
    traceContext: { traceparent: validTraceparent, tracestate: 'vendor=value' },
  }
  const first = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, input))
  const duplicate = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, input))
  assert.equal(first.id, duplicate.id)
  assert.equal(first.inserted, true)
  assert.equal(duplicate.inserted, false)

  const result = await fixture.pool.query('SELECT id, status, dedupe_key, trace_context FROM outbox_messages WHERE id = $1', [first.id])
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0].status, 'PENDING')
  assert.equal(result.rows[0].dedupe_key, dedupeKey)
  assert.deepEqual(result.rows[0].trace_context, input.traceContext)

  const invalidTraceKey = `outbox-invalid-trace-${randomUUID()}`
  fixture.trackOutbox(invalidTraceKey)
  const invalidTrace = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    ...input,
    dedupeKey: invalidTraceKey,
    traceContext: { traceparent: 'not-a-w3c-traceparent' },
  }))
  const invalidTraceRow = await fixture.pool.query<{ trace_context: unknown }>(
    'SELECT trace_context FROM outbox_messages WHERE id = $1', [invalidTrace.id],
  )
  assert.equal(invalidTraceRow.rows[0]?.trace_context, null, 'malformed trace context is not persisted')

  const rollbackKey = `outbox-rollback-${randomUUID()}`
  fixture.trackOutbox(rollbackKey)
  await assert.rejects(withTransaction(fixture.pool, async (client) => {
    await enqueueOutboxMessage(client, { ...input, dedupeKey: rollbackKey })
    throw new Error('rollback sentinel')
  }), /rollback sentinel/)
  const rolledBack = await fixture.pool.query('SELECT 1 FROM outbox_messages WHERE dedupe_key = $1', [rollbackKey])
  assert.equal(rolledBack.rowCount, 0)
})

test('concurrent claims are exclusive and expired leases are recoverable without changing message identity', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const dedupeKey = `outbox-claim-${randomUUID()}`
  fixture.trackOutbox(dedupeKey)
  const enqueued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'purchase_confirmation',
    payload: { orderId: randomUUID() },
    dedupeKey,
  }))
  const [left, right] = await Promise.all([
    claimOutboxMessages(fixture.pool, { limit: 1, leaseMs: 60_000 }),
    claimOutboxMessages(fixture.pool, { limit: 1, leaseMs: 60_000 }),
  ])
  const firstClaims = [...left, ...right].filter((message) => message.id === enqueued.id)
  assert.equal(firstClaims.length, 1, 'at most one worker owns a live lease')
  assert.equal(firstClaims[0]?.attemptCount, 1)

  await fixture.pool.query("UPDATE outbox_messages SET locked_until = now() - interval '1 second' WHERE id = $1", [enqueued.id])
  const recovered = await claimOutboxMessages(fixture.pool, { limit: 1, leaseMs: 60_000 })
  assert.equal(recovered.filter((message) => message.id === enqueued.id).length, 1)
  assert.equal(recovered.find((message) => message.id === enqueued.id)?.attemptCount, 2)
})

test('completion and retry transitions release leases and preserve at-least-once message identity', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const dedupeKey = `outbox-retry-${randomUUID()}`
  fixture.trackOutbox(dedupeKey)
  const enqueued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'invitation_reminder',
    payload: { slotId: randomUUID() },
    dedupeKey,
  }))
  await claimOutboxMessages(fixture.pool, { limit: 1, leaseMs: 60_000 })
  const retryAt = new Date(Date.now() + 60_000)
  await scheduleOutboxRetry(fixture.pool, enqueued.id, 1, retryAt, 5)
  const retried = await fixture.pool.query('SELECT id, status, attempt_count, scheduled_at, locked_until, last_error FROM outbox_messages WHERE id = $1', [enqueued.id])
  assert.equal(retried.rows[0].id, enqueued.id)
  assert.equal(retried.rows[0].status, 'PENDING')
  assert.equal(retried.rows[0].attempt_count, 1)
  assert.equal(retried.rows[0].locked_until, null)
  assert.match(retried.rows[0].scheduled_at.toISOString(), /^\d{4}-/)
  assert.equal(retried.rows[0].last_error, 'Email delivery failed')

  const claimed = await claimOutboxMessages(fixture.pool, { limit: 1, leaseMs: 60_000, now: retryAt })
  assert.ok(claimed.some((message) => message.id === enqueued.id))
  await markOutboxSent(fixture.pool, enqueued.id, 2)
  const sent = await fixture.pool.query('SELECT status, locked_until, sent_at FROM outbox_messages WHERE id = $1', [enqueued.id])
  assert.equal(sent.rows[0].status, 'SENT')
  assert.equal(sent.rows[0].locked_until, null)
  assert.ok(sent.rows[0].sent_at)
})

test('an expired lease at the attempt limit is failed rather than reclaimed forever', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const dedupeKey = `outbox-exhausted-${randomUUID()}`
  fixture.trackOutbox(dedupeKey)
  const enqueued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'purchase_confirmation',
    payload: { orderId: randomUUID() },
    dedupeKey,
  }))
  const [claimed] = await claimOutboxMessages(fixture.pool, { limit: 1, maxAttempts: 1 })
  assert.equal(claimed?.id, enqueued.id)
  await fixture.pool.query("UPDATE outbox_messages SET locked_until = now() - interval '1 second' WHERE id = $1", [enqueued.id])

  const recovered = await claimOutboxMessages(fixture.pool, { limit: 1, maxAttempts: 1 })
  assert.equal(recovered.some((message) => message.id === enqueued.id), false)
  const exhausted = await fixture.pool.query<{ status: string; locked_until: Date | null }>(
    'SELECT status, locked_until FROM outbox_messages WHERE id = $1', [enqueued.id],
  )
  assert.equal(exhausted.rows[0]?.status, 'FAILED')
  assert.equal(exhausted.rows[0]?.locked_until, null)
})

test('trace context persistence strips baggage and retry links point to the originating span', () => {
  const sanitized = sanitizeOutboxTraceContext({
    traceparent: validTraceparent,
    tracestate: 'vendor=value',
    baggage: 'email=child@example.com',
    ignored: 'not allowed',
  })
  assert.deepEqual(sanitized, { traceparent: validTraceparent, tracestate: 'vendor=value' })
  assert.equal(sanitizeOutboxTraceContext({ traceparent: 'invalid' }), null)

  const extracted = extractOutboxTraceContext(sanitized)
  const spanContext = trace.getSpanContext(extracted)
  assert.equal(spanContext?.traceId, '4bf92f3577b34da6a3ce929d0e0e4736')
  assert.equal(linksForRetry(sanitized)[0]?.context.spanId, '00f067aa0ba902b7')
  assert.equal(linksForRetry(null).length, 0)
})

test('reminder rotation locks and replaces only a currently live invitation, persisting only its token hash', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const parentEmail = `outbox-reminder-${randomUUID()}@example.com`
  const idempotencyKey = `outbox-reminder-${randomUUID()}`
  fixture.trackOrder(idempotencyKey, parentEmail)
  const course = (await fixture.pool.query<{ id: string }>('SELECT id FROM courses ORDER BY subject LIMIT 1')).rows[0]!
  const parentId = (await fixture.pool.query<{ id: string }>('INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id', ['Reminder Parent', parentEmail])).rows[0]!.id
  const orderId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 100, 'GBP', $2, 'test') RETURNING id",
    [parentId, idempotencyKey],
  )).rows[0]!.id
  const slotId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO student_slots (order_id, name, year) VALUES ($1, $2, 8) RETURNING id',
    [orderId, 'Reminder Learner'],
  )).rows[0]!.id
  const itemId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 100) RETURNING id',
    [orderId, slotId, course.id],
  )).rows[0]!.id
  await fixture.pool.query("INSERT INTO enrollments (order_item_id, slot_id, course_id, status) VALUES ($1, $2, $3, 'PENDING')", [itemId, slotId, course.id])
  const originalHash = createHash('sha256').update(`original-${randomUUID()}`).digest('hex')
  const originalInvitationId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 second') RETURNING id",
    [slotId, originalHash],
  )).rows[0]!.id

  const reminderKey = `invitation-reminder:${slotId}:${randomUUID()}`
  fixture.trackOutbox(reminderKey)
  const reminder = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'invitation_reminder',
    payload: { slotId },
    dedupeKey: reminderKey,
  }))
  let reminderEmail: { to: string; text: string; idempotencyKey: string } | undefined
  const worker = createOutboxWorker({
    pool: fixture.pool,
    webOrigin: 'https://web.example',
    encryptionSecret: 'test-only-secret-with-at-least-32-characters',
    batchSize: 1,
    emailSender: { async send(email) { reminderEmail = email } },
  })
  await worker.runOnce()
  assert.ok(reminderEmail)
  assert.equal(reminderEmail.to, parentEmail)
  assert.match(reminderEmail.text, /https:\/\/web\.example\/invite\/[A-Za-z0-9_-]{43}/)
  assert.equal(reminderEmail.idempotencyKey, reminder.id)
  const rows = await fixture.pool.query<{ id: string; token_hash: string; superseded_at: Date | null; used_at: Date | null; expires_at: Date }>(
    'SELECT id, token_hash, superseded_at, used_at, expires_at FROM invitations WHERE slot_id = $1 ORDER BY created_at',
    [slotId],
  )
  assert.equal(rows.rowCount, 2)
  assert.equal(rows.rows[0]!.id, originalInvitationId)
  assert.ok(rows.rows[0]!.superseded_at)
  const emailedToken = new URL(reminderEmail.text.match(/https:\/\/\S+/)![0]).pathname.split('/').at(-1)!
  assert.equal(rows.rows[1]!.token_hash, createHash('sha256').update(emailedToken).digest('hex'))
  assert.notEqual(rows.rows[1]!.token_hash, emailedToken)
  assert.ok(Math.abs(rows.rows[1]!.expires_at.getTime() - (Date.now() + 7 * 24 * 60 * 60 * 1000)) < 2_000)

  await fixture.pool.query('UPDATE invitations SET used_at = now() WHERE slot_id = $1 AND superseded_at IS NULL', [slotId])
  const staleReminderKey = `invitation-reminder-stale:${slotId}:${randomUUID()}`
  fixture.trackOutbox(staleReminderKey)
  const staleReminder = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'invitation_reminder',
    payload: { slotId },
    dedupeKey: staleReminderKey,
  }))
  const previousEmail = reminderEmail
  await worker.runOnce()
  assert.equal(reminderEmail, previousEmail, 'redeemed invitations must not produce reminder delivery')
  const skipped = await fixture.pool.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [staleReminder.id])
  assert.equal(skipped.rows[0]?.status, 'SKIPPED')
})

test('reminder retries reuse the same generated invitation URL after send succeeds but sent-state persistence fails', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const parentEmail = `outbox-retry-link-${randomUUID()}@example.com`
  const idempotencyKey = `outbox-retry-link-${randomUUID()}`
  const dedupeKey = `invitation-reminder:${randomUUID()}:7d`
  fixture.trackOrder(idempotencyKey, parentEmail)
  fixture.trackOutbox(dedupeKey)
  const course = (await fixture.pool.query<{ id: string }>('SELECT id FROM courses ORDER BY subject LIMIT 1')).rows[0]!
  const parentId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id', ['Retry Parent', parentEmail],
  )).rows[0]!.id
  const orderId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 100, 'GBP', $2, 'test') RETURNING id",
    [parentId, idempotencyKey],
  )).rows[0]!.id
  const slotId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO student_slots (order_id, name, year) VALUES ($1, $2, 8) RETURNING id', [orderId, 'Retry Learner'],
  )).rows[0]!.id
  const itemId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 100) RETURNING id',
    [orderId, slotId, course.id],
  )).rows[0]!.id
  await fixture.pool.query("INSERT INTO enrollments (order_item_id, slot_id, course_id, status) VALUES ($1, $2, $3, 'PENDING')", [itemId, slotId, course.id])
  const oldTokenHash = createHash('sha256').update(`old-${randomUUID()}`).digest('hex')
  await fixture.pool.query(
    "INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [slotId, oldTokenHash],
  )
  const queued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'invitation_reminder',
    payload: { slotId },
    dedupeKey,
  }))

  const emails: string[] = []
  let failSentTransition = true
  const interceptedPool = new Proxy(fixture.pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (query: string, ...args: unknown[]) => {
          if (failSentTransition && query.includes("SET status = 'SENT'")) {
            failSentTransition = false
            throw new Error('simulated completion write failure')
          }
          return target.query(query, ...args)
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Pool
  const worker = createOutboxWorker({
    pool: interceptedPool,
    webOrigin: 'https://web.example',
    encryptionSecret: 'test-only-secret-with-at-least-32-characters',
    batchSize: 1,
    baseRetryMs: 1,
    emailSender: { async send(email) { emails.push(email.text.match(/https:\/\/\S+/)![0]) } },
  })

  await worker.runOnce()
  const afterFirst = await fixture.pool.query<{ status: string; payload: Record<string, unknown> }>(
    'SELECT status, payload FROM outbox_messages WHERE id = $1', [queued.id],
  )
  assert.equal(afterFirst.rows[0]?.status, 'PENDING')
  assert.equal(JSON.stringify(afterFirst.rows[0]?.payload).includes(emails[0]!.split('/').at(-1)!), false, 'raw invitation token must not persist in outbox JSON')
  assert.ok(afterFirst.rows[0]?.payload.deliveryTokens, 'retry token is persisted encrypted so retries can reuse it')
  await fixture.pool.query('UPDATE outbox_messages SET scheduled_at = now() - interval \'1 second\' WHERE id = $1', [queued.id])
  await worker.runOnce()

  assert.equal(emails.length, 2)
  assert.equal(emails[1], emails[0], 'a retry must send the same invitation URL')
  const invitationRows = await fixture.pool.query<{ token_hash: string; superseded_at: Date | null }>(
    'SELECT token_hash, superseded_at FROM invitations WHERE slot_id = $1 ORDER BY created_at', [slotId],
  )
  assert.equal(invitationRows.rowCount, 2)
  assert.ok(invitationRows.rows[0]?.superseded_at)
  assert.equal(invitationRows.rows[1]?.token_hash, createHash('sha256').update(new URL(emails[0]!).pathname.split('/').at(-1)!).digest('hex'))
  const completed = await fixture.pool.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [queued.id])
  assert.equal(completed.rows[0]?.status, 'SENT')
  const sentPayload = await fixture.pool.query<{ payload: Record<string, unknown> }>('SELECT payload FROM outbox_messages WHERE id = $1', [queued.id])
  assert.equal(sentPayload.rows[0]?.payload.deliveryTokens, undefined, 'encrypted retry material is scrubbed after success')
})

test('worker delivers paid-order confirmation with outbox identity and marks sent only after provider success', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const parentEmail = `outbox-worker-${randomUUID()}@example.com`
  const idempotencyKey = `outbox-worker-${randomUUID()}`
  const dedupeKey = `purchase-confirmation:${randomUUID()}`
  fixture.trackOrder(idempotencyKey, parentEmail)
  fixture.trackOutbox(dedupeKey)
  const parentId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id', ['Worker Parent', parentEmail],
  )).rows[0]!.id
  const orderId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 100, 'GBP', $2, 'test') RETURNING id",
    [parentId, idempotencyKey],
  )).rows[0]!.id
  const course = (await fixture.pool.query<{ id: string }>('SELECT id FROM courses ORDER BY subject LIMIT 1')).rows[0]!
  const slotId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO student_slots (order_id, name, year) VALUES ($1, $2, 8) RETURNING id', [orderId, 'Worker Learner'],
  )).rows[0]!.id
  const itemId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 100) RETURNING id',
    [orderId, slotId, course.id],
  )).rows[0]!.id
  await fixture.pool.query("INSERT INTO enrollments (order_item_id, slot_id, course_id, status) VALUES ($1, $2, $3, 'PENDING')", [itemId, slotId, course.id])
  const initialTokenHash = createHash('sha256').update(`initial-${randomUUID()}`).digest('hex')
  await fixture.pool.query(
    "INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [slotId, initialTokenHash],
  )
  const queued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'purchase_confirmation',
    payload: { orderId },
    dedupeKey,
  }))
  let delivered: { to: string; text: string; idempotencyKey: string } | undefined
  const worker = createOutboxWorker({
    pool: fixture.pool,
    webOrigin: 'https://web.example',
    encryptionSecret: 'test-only-secret-with-at-least-32-characters',
    batchSize: 1,
    emailSender: {
      async send(email) {
        delivered = { to: email.to, text: email.text, idempotencyKey: email.idempotencyKey }
      },
    },
  })
  assert.equal(await worker.runOnce(), 1)
  assert.equal(delivered?.to, parentEmail)
  assert.equal(delivered?.idempotencyKey, queued.id)
  assert.match(delivered?.text ?? '', /https:\/\/web\.example\/invite\/[A-Za-z0-9_-]{43}/)
  const invitationRows = await fixture.pool.query<{ token_hash: string; superseded_at: Date | null }>(
    'SELECT token_hash, superseded_at FROM invitations WHERE slot_id = $1 ORDER BY created_at', [slotId],
  )
  assert.equal(invitationRows.rowCount, 2)
  assert.ok(invitationRows.rows[0]?.superseded_at)
  const sentToken = new URL(delivered!.text.match(/https:\/\/\S+/)![0]).pathname.split('/').at(-1)!
  assert.equal(invitationRows.rows[1]?.token_hash, createHash('sha256').update(sentToken).digest('hex'))
  const message = await fixture.pool.query<{ status: string; locked_until: Date | null }>(
    'SELECT status, locked_until FROM outbox_messages WHERE id = $1', [queued.id],
  )
  assert.equal(message.rows[0]?.status, 'SENT')
  assert.equal(message.rows[0]?.locked_until, null)
})

test('worker bounds retries and does not persist provider diagnostics', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const parentEmail = `outbox-failure-${randomUUID()}@example.com`
  const idempotencyKey = `outbox-failure-${randomUUID()}`
  const dedupeKey = `purchase-confirmation:${randomUUID()}`
  fixture.trackOrder(idempotencyKey, parentEmail)
  fixture.trackOutbox(dedupeKey)
  const parentId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id', ['Failure Parent', parentEmail],
  )).rows[0]!.id
  const orderId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 100, 'GBP', $2, 'test') RETURNING id",
    [parentId, idempotencyKey],
  )).rows[0]!.id
  const course = (await fixture.pool.query<{ id: string }>('SELECT id FROM courses ORDER BY subject LIMIT 1')).rows[0]!
  const slotId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO student_slots (order_id, name, year) VALUES ($1, $2, 8) RETURNING id', [orderId, 'Failure Learner'],
  )).rows[0]!.id
  const itemId = (await fixture.pool.query<{ id: string }>(
    'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 100) RETURNING id',
    [orderId, slotId, course.id],
  )).rows[0]!.id
  await fixture.pool.query("INSERT INTO enrollments (order_item_id, slot_id, course_id, status) VALUES ($1, $2, $3, 'PENDING')", [itemId, slotId, course.id])
  await fixture.pool.query(
    "INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [slotId, createHash('sha256').update(`failure-${randomUUID()}`).digest('hex')],
  )
  const queued = await withTransaction(fixture.pool, (client) => enqueueOutboxMessage(client, {
    messageType: 'purchase_confirmation',
    payload: { orderId },
    dedupeKey,
  }))
  const worker = createOutboxWorker({
    pool: fixture.pool,
    webOrigin: 'https://web.example',
    encryptionSecret: 'test-only-secret-with-at-least-32-characters',
    batchSize: 1,
    maxAttempts: 1,
    emailSender: { async send() { throw new Error('provider included raw invitation token secret') } },
  })
  await worker.runOnce()
  const failed = await fixture.pool.query<{ status: string; attempt_count: number; last_error: string }>(
    'SELECT status, attempt_count, last_error FROM outbox_messages WHERE id = $1', [queued.id],
  )
  assert.equal(failed.rows[0]?.status, 'FAILED')
  assert.equal(failed.rows[0]?.attempt_count, 1)
  assert.equal(failed.rows[0]?.last_error, 'Email delivery failed')
  assert.doesNotMatch(failed.rows[0]?.last_error ?? '', /secret|token/i)
})
