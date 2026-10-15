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

test('learning routes require a session, ignore client student IDs, and recheck enrollment changes each request', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: courses } = await fixture.pool.query<{ id: string; subject: string }>(
    "SELECT id, subject FROM courses WHERE subject IN ('Maths', 'English') ORDER BY subject",
  )
  const courseBySubject = new Map(courses.map((course) => [course.subject, course.id]))
  const { rows: lessonRows } = await fixture.pool.query<{ id: string; course_id: string }>(
    'SELECT id, course_id FROM lessons WHERE course_id = ANY($1::uuid[]) ORDER BY position',
    [[...courseBySubject.values()]],
  )
  const mathLessonId = lessonRows.find((lesson) => lesson.course_id === courseBySubject.get('Maths'))?.id
  assert.ok(mathLessonId)

  const emailA = `protected-a-${randomUUID()}@example.com`
  const emailB = `protected-b-${randomUUID()}@example.com`
  fixture.trackStudent(emailA)
  fixture.trackStudent(emailB)
  const insertStudent = async (email: string, name: string) => (await fixture.pool.query<{ id: string }>(
    'INSERT INTO students (email, name, year, password_hash) VALUES ($1, $2, 8, \'test-hash\') RETURNING id',
    [email, name],
  )).rows[0]!.id
  const studentA = await insertStudent(emailA, 'Learner A')
  const studentB = await insertStudent(emailB, 'Learner B')

  const addActiveEnrollment = async (studentId: string, subject: string) => {
    const parentEmail = `protected-parent-${randomUUID()}@example.com`
    const key = `protected-${randomUUID()}`
    fixture.trackOrder(key, parentEmail)
    const parent = await fixture.pool.query<{ id: string }>('INSERT INTO parents (name, email) VALUES (\'Test Parent\', $1) RETURNING id', [parentEmail])
    const order = await fixture.pool.query<{ id: string }>(
      "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 19900, 'GBP', $2, 'test') RETURNING id",
      [parent.rows[0]!.id, key],
    )
    const slot = await fixture.pool.query<{ id: string }>(
      'INSERT INTO student_slots (order_id, name, year, student_id) VALUES ($1, $2, 8, $3) RETURNING id',
      [order.rows[0]!.id, 'Test Learner', studentId],
    )
    const item = await fixture.pool.query<{ id: string }>(
      'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 19900) RETURNING id',
      [order.rows[0]!.id, slot.rows[0]!.id, courseBySubject.get(subject)],
    )
    const enrollment = await fixture.pool.query<{ id: string }>(
      "INSERT INTO enrollments (order_item_id, slot_id, course_id, student_id, status, activated_at) VALUES ($1, $2, $3, $4, 'ACTIVE', now()) RETURNING id",
      [item.rows[0]!.id, slot.rows[0]!.id, courseBySubject.get(subject), studentId],
    )
    return enrollment.rows[0]!.id
  }

  const enrollmentA = await addActiveEnrollment(studentA, 'Maths')
  await addActiveEnrollment(studentB, 'English')
  await app.ready()
  const cookieA = `session=${app.jwt.sign({ sub: studentA })}`
  const mathCourseId = courseBySubject.get('Maths')!

  assert.equal((await app.inject({ method: 'GET', url: '/me/enrollments?studentId=' + studentA })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: `/courses/${mathCourseId}/lessons?studentId=${studentA}` })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: `/lessons/${mathLessonId}?studentId=${studentA}` })).statusCode, 401)

  const enrollments = await app.inject({ method: 'GET', url: `/me/enrollments?studentId=${studentB}`, headers: { cookie: cookieA } })
  assert.equal(enrollments.statusCode, 200)
  assert.deepEqual(enrollments.json<{ enrollments: Array<{ course: { id: string } }> }>().enrollments.map((item) => item.course.id), [mathCourseId])
  assert.equal((await app.inject({ method: 'GET', url: `/lessons/${mathLessonId}?studentId=${studentB}`, headers: { cookie: cookieA } })).statusCode, 200)

  await fixture.pool.query("UPDATE enrollments SET status = 'REVOKED' WHERE id = $1", [enrollmentA])
  assert.equal((await app.inject({ method: 'GET', url: `/courses/${mathCourseId}/lessons`, headers: { cookie: cookieA } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/lessons/${mathLessonId}`, headers: { cookie: cookieA } })).statusCode, 404)
})
