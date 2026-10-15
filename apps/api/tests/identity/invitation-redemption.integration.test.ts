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

test('invitation redemption validates state, prevents duplicate accounts, hashes passwords, and activates all slot enrollments atomically', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: courses } = await fixture.pool.query<{ id: string; subject: string; year_min: number }>(
    "SELECT id, subject, year_min FROM courses WHERE subject IN ('Maths', 'English') ORDER BY subject",
  )
  const course = courses.find((item) => item.subject === 'Maths')
  assert.ok(course)
  assert.equal(courses.length, 2)

  const createInvitation = async (email = `parent-${randomUUID()}@example.com`) => {
    const idempotencyKey = `onboarding-${randomUUID()}`
    fixture.trackOrder(idempotencyKey, email)
    const checkout = await app.inject({
      method: 'POST',
      url: '/checkout',
      headers: { 'idempotency-key': idempotencyKey },
      payload: {
        parent: { name: 'Test Parent', email, emailConfirm: email },
        students: [{ name: 'Learner One', year: course.year_min, courseIds: courses.map((item) => item.id) }],
        paymentMethod: 'visa',
      },
    })
    assert.equal(checkout.statusCode, 201)
    const url = checkout.json<{ invitations: Array<{ url: string }> }>().invitations[0]?.url
    assert.ok(url)
    const token = new URL(url).pathname.split('/').at(-1)
    assert.ok(token)
    const { rows: [slot] } = await fixture.pool.query<{ id: string }>(
      'SELECT slot.id FROM student_slots slot JOIN orders purchase ON purchase.id = slot.order_id WHERE purchase.idempotency_key = $1',
      [idempotencyKey],
    )
    assert.ok(slot)
    return { token, slotId: slot.id }
  }

  const valid = await createInvitation()
  const preview = await app.inject({ method: 'GET', url: `/invitations/${valid.token}` })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.json<{ studentName: string; courses: unknown[] }>().studentName, 'Learner One')
  assert.equal(preview.json<{ courses: unknown[] }>().courses.length, 2)
  assert.doesNotMatch(preview.body, new RegExp(valid.token))
  const password = 'correct horse battery staple'
  const validEmail = `student-${randomUUID()}@example.com`
  fixture.trackStudent(validEmail)
  const redemption = await app.inject({
    method: 'POST',
    url: `/invitations/${valid.token}`,
    payload: { email: validEmail, password },
  })
  assert.equal(redemption.statusCode, 200)
  assert.match(redemption.headers['set-cookie'] as string, /HttpOnly/i)
  assert.match(redemption.headers['set-cookie'] as string, /SameSite=Lax/i)
  const student = redemption.json<{ student: { id: string; name: string; email: string; year: number } }>().student
  assert.equal(student.name, 'Learner One')
  assert.equal(student.year, course.year_min)
  const { rows: activationRows } = await fixture.pool.query<{ student_id: string; password_hash: string; slot_student_id: string; enrollment_status: string; enrollment_student_id: string }>(
    `SELECT learner.id AS student_id, learner.password_hash, slot.student_id AS slot_student_id,
            enrollment.status AS enrollment_status, enrollment.student_id AS enrollment_student_id
       FROM students learner
       JOIN student_slots slot ON slot.student_id = learner.id
       JOIN enrollments enrollment ON enrollment.slot_id = slot.id
      WHERE slot.id = $1`,
    [valid.slotId],
  )
  const activated = activationRows[0]
  assert.ok(activated)
  assert.equal(activated.student_id, student.id)
  assert.equal(activated.slot_student_id, student.id)
  assert.equal(activated.enrollment_status, 'ACTIVE')
  assert.equal(activated.enrollment_student_id, student.id)
  assert.equal(activationRows.length, 2)
  assert.ok(activationRows.every((row) => row.enrollment_status === 'ACTIVE' && row.enrollment_student_id === student.id))
  assert.notEqual(activated.password_hash, password)
  assert.equal((await fixture.pool.query('SELECT 1 FROM invitations WHERE slot_id = $1 AND used_at IS NOT NULL', [valid.slotId])).rowCount, 1)
  assert.equal((await app.inject({ method: 'POST', url: `/invitations/${valid.token}`, payload: { email: student.email, password } })).statusCode, 404)

  for (const state of ['expired', 'used', 'superseded'] as const) {
    const invitation = await createInvitation()
    if (state === 'expired') await fixture.pool.query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE slot_id = $1", [invitation.slotId])
    if (state === 'used') await fixture.pool.query('UPDATE invitations SET used_at = now() WHERE slot_id = $1', [invitation.slotId])
    if (state === 'superseded') await fixture.pool.query('UPDATE invitations SET superseded_at = now() WHERE slot_id = $1', [invitation.slotId])
    const invalidEmail = `invalid-${state}-${randomUUID()}@example.com`
    const invalid = await app.inject({
      method: 'POST',
      url: `/invitations/${invitation.token}`,
      payload: { email: invalidEmail, password },
    })
    assert.equal(invalid.statusCode, 404, `${state} invitation is unavailable`)
    assert.equal((await app.inject({ method: 'GET', url: `/invitations/${invitation.token}` })).statusCode, 404)
    assert.equal((await fixture.pool.query('SELECT 1 FROM students WHERE email = $1', [invalidEmail])).rowCount, 0)
  }

  const duplicate = await createInvitation()
  const existingEmail = `existing-${randomUUID()}@example.com`
  fixture.trackStudent(existingEmail)
  await fixture.pool.query(
    "INSERT INTO students (email, name, year, password_hash) VALUES ($1, 'Existing Learner', $2, 'existing-hash')",
    [existingEmail, course.year_min],
  )
  const duplicateEmail = await app.inject({
    method: 'POST',
    url: `/invitations/${duplicate.token}`,
    payload: { email: existingEmail, password },
  })
  assert.equal(duplicateEmail.statusCode, 409)
  assert.equal((await fixture.pool.query('SELECT 1 FROM invitations WHERE slot_id = $1 AND used_at IS NOT NULL', [duplicate.slotId])).rowCount, 0)
  assert.equal((await fixture.pool.query("SELECT count(*) FROM enrollments WHERE slot_id = $1 AND status = 'ACTIVE'", [duplicate.slotId])).rows[0]?.count, '0')
})
