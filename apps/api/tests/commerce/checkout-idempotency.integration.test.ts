import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { parseConfig } from '../../src/platform/config.js'
import { buildApp } from '../../src/app.js'
import { createPostgresFixture } from '../setup/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl ?? 'postgres://test:test@127.0.0.1:5432/test',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  CORS_ORIGINS: 'https://web.example',
  RATE_LIMIT_MAX: '1000',
})

test('checkout idempotency validates before claiming keys and handles replay, conflict, progress, and key length', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
  const pool = fixture.pool
  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: [course] } = await pool.query<{ id: string; year_min: number }>(
    "INSERT INTO courses (subject, year_min, year_max, price_minor, currency) VALUES ($1, 5, 13, 19900, 'GBP') RETURNING id, year_min",
    [`idempotency-${randomUUID()}`],
  )
  assert.ok(course)
  fixture.trackCourse(course.id)
  const body = () => {
    const email = `idempotency-${randomUUID()}@example.com`
    return { parent: { name: 'Test Parent', email, emailConfirm: email }, students: [{ name: 'Test Student', year: course.year_min, courseIds: [course.id] }], paymentMethod: 'visa' }
  }
  const send = (key: string, payload: unknown) => app.inject({ method: 'POST', url: '/checkout', headers: { 'idempotency-key': key }, payload })

  const invalidKey = `malformed-${randomUUID()}`
  assert.equal((await send(invalidKey, { parent: {}, students: [] })).statusCode, 400)
  const afterMalformed = body()
  fixture.trackOrder(invalidKey, afterMalformed.parent.email)
  assert.equal((await send(invalidKey, afterMalformed)).statusCode, 201, 'malformed input must not reserve its key')

  const replayKey = `replay-${randomUUID()}`
  const originalBody = body()
  fixture.trackOrder(replayKey, originalBody.parent.email)
  const first = await send(replayKey, originalBody)
  assert.equal(first.statusCode, 201)
  const replay = await send(replayKey, originalBody)
  assert.equal(replay.statusCode, 200)
  assert.equal(replay.json<{ orderId: string }>().orderId, first.json<{ orderId: string }>().orderId)
  assert.equal((await send(replayKey, body())).statusCode, 422)

  await pool.query("UPDATE courses SET year_min = 10 WHERE id = $1", [course.id])
  try {
    assert.equal((await send(replayKey, originalBody)).statusCode, 200, 'a stored result must replay even if catalog eligibility later changes')
  } finally {
    await pool.query("UPDATE courses SET year_min = 5 WHERE id = $1", [course.id])
  }

  const longKey = 'k'.repeat(255)
  const longKeyBody = body()
  fixture.trackOrder(longKey, longKeyBody.parent.email)
  assert.equal((await send(longKey, longKeyBody)).statusCode, 201)
  const oversizedKey = `${longKey}x`
  assert.equal((await send(oversizedKey, body())).statusCode, 400)

  const processingKey = `processing-${randomUUID()}`
  let releasePayment!: () => void
  let signalPaymentStarted!: () => void
  const paymentStarted = new Promise<void>((resolve) => { signalPaymentStarted = resolve })
  const delayedApp = await buildApp({
    config,
    database: new Pool({ connectionString: databaseUrl }),
    paymentGateway: { charge: async () => {
      signalPaymentStarted()
      await new Promise<void>((release) => { releasePayment = release })
      return { provider: 'mock', providerRef: `mock-${processingKey}`, amountMinor: 19900, status: 'SUCCEEDED' }
    } },
  } as Parameters<typeof buildApp>[0])
  t.after(() => delayedApp.close())
  const processingBody = body()
  fixture.trackOrder(processingKey, processingBody.parent.email)
  const pendingRequest = delayedApp.inject({
    method: 'POST', url: '/checkout',
    headers: { 'idempotency-key': processingKey }, payload: processingBody,
  })
  await paymentStarted
  const inProgress = await delayedApp.inject({
    method: 'POST', url: '/checkout',
    headers: { 'idempotency-key': processingKey }, payload: processingBody,
  })
  assert.equal(inProgress.statusCode, 409)
  releasePayment()
  assert.equal((await pendingRequest).statusCode, 201)
})
