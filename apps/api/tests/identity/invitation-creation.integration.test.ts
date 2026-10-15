import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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

test('checkout invitations have high entropy, persist only token hashes, expire within bounds, and are unique per slot', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
  const pool = fixture.pool
  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: [course] } = await pool.query<{ id: string; year_min: number }>("SELECT id, year_min FROM courses WHERE subject = 'Maths'")
  assert.ok(course)
  const email = `invitation-${randomUUID()}@example.com`
  const key = `invitation-${randomUUID()}`
  fixture.trackOrder(key, email)
  const response = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': key },
    payload: {
      parent: { name: 'Test Parent', email, emailConfirm: email },
      students: [{ name: 'Test Student', year: course.year_min, courseIds: [course.id] }],
      paymentMethod: 'visa',
    },
  })
  assert.equal(response.statusCode, 201)
  const invitationUrl = response.json<{ invitations: Array<{ url: string }> }>().invitations[0]?.url
  assert.ok(invitationUrl)
  const token = new URL(invitationUrl).pathname.split('/').at(-1)
  assert.ok(token)
  const tokenBytes = Buffer.from(token, 'base64url')
  assert.ok(tokenBytes.length >= 32, 'invitation must contain at least 256 bits of random entropy')

  const { rows: [invitation] } = await pool.query<{ id: string; slot_id: string; token_hash: string; expires_at: Date }>(
    `SELECT invitation.id, invitation.slot_id, invitation.token_hash, invitation.expires_at
       FROM invitations invitation
       JOIN student_slots slot ON slot.id = invitation.slot_id
       JOIN orders purchase ON purchase.id = slot.order_id
      WHERE purchase.idempotency_key = $1`,
    [key],
  )
  assert.ok(invitation)
  assert.notEqual(invitation.token_hash, token)
  assert.equal(invitation.token_hash, createHash('sha256').update(token).digest('hex'))
  const remaining = invitation.expires_at.getTime() - Date.now()
  assert.ok(remaining > 0 && remaining <= 30 * 24 * 60 * 60 * 1000)
  await assert.rejects(
    pool.query('INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [invitation.slot_id, `duplicate-${randomUUID()}`]),
    (error: { code?: string }) => error.code === '23505',
  )
})
