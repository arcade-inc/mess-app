import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../../src/app.js'
import { parseConfig } from '../../src/platform/config.js'
import { createPostgresFixture } from '../setup/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl ?? 'postgres://test:test@127.0.0.1:5432/test',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  CORS_ORIGINS: 'https://web.example',
  RATE_LIMIT_MAX: '1000',
})

test('exactly one concurrent redemption claims the invitation and activates the slot', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: [course] } = await fixture.pool.query<{ id: string; year_min: number }>("SELECT id, year_min FROM courses WHERE subject = 'Maths'")
  assert.ok(course)
  const parentEmail = `parent-${randomUUID()}@example.com`
  const key = `concurrent-redemption-${randomUUID()}`
  fixture.trackOrder(key, parentEmail)
  const checkout = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': key },
    payload: {
      parent: { name: 'Parent', email: parentEmail, emailConfirm: parentEmail },
      students: [{ name: 'Concurrent Learner', year: course.year_min, courseIds: [course.id] }],
    },
  })
  assert.equal(checkout.statusCode, 201)
  const invitationUrl = checkout.json<{ invitations: Array<{ url: string }> }>().invitations[0]?.url
  assert.ok(invitationUrl)
  const token = new URL(invitationUrl).pathname.split('/').at(-1)
  assert.ok(token)
  const { rows: [slot] } = await fixture.pool.query<{ id: string }>(
    'SELECT id FROM student_slots WHERE order_id = (SELECT id FROM orders WHERE idempotency_key = $1)', [key],
  )
  assert.ok(slot)

  const winnerEmails = [`winner-a-${randomUUID()}@example.com`, `winner-b-${randomUUID()}@example.com`]
  winnerEmails.forEach((email) => fixture.trackStudent(email))
  const responses = await Promise.all(winnerEmails.map((email, index) => app.inject({
    method: 'POST',
    url: `/invitations/${token}`,
    payload: { email, password: `strong password ${index}23` },
  })))
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 404])
  const { rows: [state] } = await fixture.pool.query<{ students: string; active_enrollments: string; used_invitations: string }>(
    `SELECT (SELECT count(*) FROM students WHERE id = slot.student_id) AS students,
            (SELECT count(*) FROM enrollments WHERE slot_id = slot.id AND status = 'ACTIVE' AND student_id = slot.student_id) AS active_enrollments,
            (SELECT count(*) FROM invitations WHERE slot_id = slot.id AND used_at IS NOT NULL) AS used_invitations
       FROM student_slots slot WHERE slot.id = $1`,
    [slot.id],
  )
  assert.equal(state.students, '1')
  assert.equal(state.active_enrollments, '1')
  assert.equal(state.used_invitations, '1')
})
