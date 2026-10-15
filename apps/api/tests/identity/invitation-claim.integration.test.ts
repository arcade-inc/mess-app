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

test('authenticated learner claims a matching invitation regardless of year, while a name mismatch leaves it unused', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: courses } = await fixture.pool.query<{ id: string; subject: string; year_min: number }>(
    "SELECT id, subject, year_min FROM courses WHERE subject IN ('Maths', 'English') ORDER BY subject",
  )
  assert.equal(courses.length, 2)

  const createInvitation = async (name: string, courseIds = [courses[0]!.id]) => {
    const email = `parent-${randomUUID()}@example.com`
    const idempotencyKey = `claim-${randomUUID()}`
    fixture.trackOrder(idempotencyKey, email)
    const checkout = await app.inject({
      method: 'POST',
      url: '/checkout',
      headers: { 'idempotency-key': idempotencyKey },
      payload: {
        parent: { name: 'Test Parent', email, emailConfirm: email },
        students: [{ name, year: courses[0]!.year_min, courseIds }],
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

  const original = await createInvitation('Alice Learner')
  const email = `alice-${randomUUID()}@example.com`
  const password = 'correct horse battery staple'
  fixture.trackStudent(email)
  const activated = await app.inject({
    method: 'POST',
    url: `/invitations/${original.token}`,
    payload: { email, password },
  })
  assert.equal(activated.statusCode, 200)
  const studentId = activated.json<{ student: { id: string } }>().student.id
  const sessionCookie = (activated.headers['set-cookie'] as string).split(';', 1)[0]
  const { rows: [account] } = await fixture.pool.query<{ year: number }>('SELECT year FROM students WHERE id = $1', [studentId])
  assert.ok(account)
  await fixture.pool.query('UPDATE students SET year = $1 WHERE id = $2', [account.year + 1, studentId])
  const studentsBeforeClaim = await fixture.pool.query<{ count: string }>('SELECT count(*) FROM students')

  const matching = await createInvitation('  alice   learner  ', courses.map((course) => course.id))
  const unauthenticated = await app.inject({ method: 'POST', url: `/invitations/${matching.token}/claim` })
  assert.equal(unauthenticated.statusCode, 401)

  const claimed = await app.inject({
    method: 'POST',
    url: `/invitations/${matching.token}/claim`,
    headers: { cookie: sessionCookie },
  })
  assert.equal(claimed.statusCode, 200)
  const matchingResult = claimed.json<{ student: { id: string }; declinedCourses: Array<{ id: string; subject: string }> }>()
  assert.equal(matchingResult.student.id, studentId)
  assert.deepEqual(matchingResult.declinedCourses, [{ id: courses[0]!.id, subject: courses[0]!.subject }])
  const { rows: matchingRows } = await fixture.pool.query<{ student_id: string; course_id: string; status: string }>(
    'SELECT slot.student_id, enrollment.course_id, enrollment.status FROM student_slots slot JOIN enrollments enrollment ON enrollment.slot_id = slot.id WHERE slot.id = $1',
    [matching.slotId],
  )
  assert.equal(matchingRows.length, 2)
  assert.ok(matchingRows.every((row) => row.student_id === studentId))
  assert.equal(matchingRows.find((row) => row.course_id === courses[0]!.id)?.status, 'REVOKED')
  assert.equal(matchingRows.find((row) => row.course_id === courses[1]!.id)?.status, 'ACTIVE')
  assert.equal((await fixture.pool.query('SELECT 1 FROM invitations WHERE slot_id = $1 AND used_at IS NOT NULL', [matching.slotId])).rowCount, 1)
  assert.equal((await fixture.pool.query<{ count: string }>('SELECT count(*) FROM students')).rows[0]?.count, studentsBeforeClaim.rows[0]?.count)

  const allDuplicate = await createInvitation('Alice Learner', [courses[0]!.id])
  const allDuplicateClaim = await app.inject({
    method: 'POST',
    url: `/invitations/${allDuplicate.token}/claim`,
    headers: { cookie: sessionCookie },
  })
  assert.equal(allDuplicateClaim.statusCode, 200)
  assert.deepEqual(allDuplicateClaim.json<{ declinedCourses: Array<{ id: string; subject: string }> }>().declinedCourses, [
    { id: courses[0]!.id, subject: courses[0]!.subject },
  ])
  assert.equal((await fixture.pool.query("SELECT 1 FROM enrollments WHERE slot_id = $1 AND status = 'REVOKED'", [allDuplicate.slotId])).rowCount, 1)
  assert.equal((await fixture.pool.query("SELECT 1 FROM enrollments WHERE slot_id = $1 AND status = 'ACTIVE'", [allDuplicate.slotId])).rowCount, 0)
  assert.equal((await fixture.pool.query('SELECT 1 FROM invitations WHERE slot_id = $1 AND used_at IS NOT NULL', [allDuplicate.slotId])).rowCount, 1)

  const retried = await app.inject({
    method: 'POST',
    url: `/invitations/${matching.token}/claim`,
    headers: { cookie: sessionCookie },
  })
  assert.equal(retried.statusCode, 404)

  const mismatch = await createInvitation('Another Learner')
  const rejected = await app.inject({
    method: 'POST',
    url: `/invitations/${mismatch.token}/claim`,
    headers: { cookie: sessionCookie },
  })
  assert.equal(rejected.statusCode, 409)
  assert.equal(rejected.json<{ error: { message: string } }>().error.message, 'This course belongs to another learner.')
  assert.equal((await fixture.pool.query('SELECT 1 FROM invitations WHERE slot_id = $1 AND used_at IS NOT NULL', [mismatch.slotId])).rowCount, 0)
  assert.equal((await fixture.pool.query('SELECT student_id FROM student_slots WHERE id = $1', [mismatch.slotId])).rows[0]?.student_id, null)
  assert.equal((await fixture.pool.query("SELECT count(*) FROM enrollments WHERE slot_id = $1 AND status = 'PENDING'", [mismatch.slotId])).rows[0]?.count, '1')
})
