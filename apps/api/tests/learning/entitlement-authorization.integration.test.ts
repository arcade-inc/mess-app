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

test('only the session student with an ACTIVE enrollment can read a course or lesson', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: courses } = await fixture.pool.query<{ id: string; subject: string }>(
    "SELECT id, subject FROM courses WHERE subject IN ('Maths', 'English', 'Science') ORDER BY subject",
  )
  const courseIds = new Map(courses.map((course) => [course.subject, course.id]))
  assert.equal(courses.length, 3)
  const { rows: lessons } = await fixture.pool.query<{ id: string; course_id: string }>(
    'SELECT id, course_id FROM lessons WHERE course_id = ANY($1::uuid[]) ORDER BY course_id, position',
    [[...courseIds.values()]],
  )
  const lessonByCourse = new Map(lessons.map((lesson) => [lesson.course_id, lesson.id]))
  const mathLesson = lessonByCourse.get(courseIds.get('Maths')!)
  const englishLesson = lessonByCourse.get(courseIds.get('English')!)
  const scienceLesson = lessonByCourse.get(courseIds.get('Science')!)
  assert.ok(mathLesson)
  assert.ok(englishLesson)
  assert.ok(scienceLesson)

  const studentAEmail = `learner-a-${randomUUID()}@example.com`
  const studentBEmail = `learner-b-${randomUUID()}@example.com`
  fixture.trackStudent(studentAEmail)
  fixture.trackStudent(studentBEmail)
  const studentA = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO students (email, name, year, password_hash) VALUES ($1, 'Learner A', 8, 'test-hash') RETURNING id",
    [studentAEmail],
  )).rows[0]!.id
  const studentB = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO students (email, name, year, password_hash) VALUES ($1, 'Learner B', 8, 'test-hash') RETURNING id",
    [studentBEmail],
  )).rows[0]!.id

  const addEnrollment = async (studentId: string, subject: string, status: 'ACTIVE' | 'PENDING' | 'REVOKED') => {
    const courseId = courseIds.get(subject)!
    const parentEmail = `parent-${randomUUID()}@example.com`
    const key = `entitlement-${randomUUID()}`
    fixture.trackOrder(key, parentEmail)
    const client = await fixture.pool.connect()
    await client.query('BEGIN')
    try {
      const parent = await client.query<{ id: string }>('INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id', ['Test Parent', parentEmail])
      const order = await client.query<{ id: string }>(
        "INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash) VALUES ($1, 'PAID', 19900, 'GBP', $2, 'test') RETURNING id",
        [parent.rows[0]!.id, key],
      )
      const slot = await client.query<{ id: string }>(
        'INSERT INTO student_slots (order_id, name, year, student_id) VALUES ($1, $2, 8, $3) RETURNING id',
        [order.rows[0]!.id, 'Test Learner', studentId],
      )
      const item = await client.query<{ id: string }>(
        'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, 19900) RETURNING id',
        [order.rows[0]!.id, slot.rows[0]!.id, courseId],
      )
      await client.query(
        'INSERT INTO enrollments (order_item_id, slot_id, course_id, student_id, status, activated_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = \'ACTIVE\' THEN now() ELSE NULL END)',
        [item.rows[0]!.id, slot.rows[0]!.id, courseId, studentId, status],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  await addEnrollment(studentA, 'Maths', 'ACTIVE')
  await addEnrollment(studentA, 'English', 'PENDING')
  await addEnrollment(studentA, 'Science', 'REVOKED')
  await addEnrollment(studentB, 'English', 'ACTIVE')

  await app.ready()
  const cookieFor = (studentId: string) => `session=${app.jwt.sign({ sub: studentId })}`
  const sessionA = { cookie: cookieFor(studentA) }
  const sessionB = { cookie: cookieFor(studentB) }
  const getCourseLessons = (courseId: string, headers: Record<string, string>) => app.inject({ method: 'GET', url: `/courses/${courseId}/lessons`, headers })
  const getLesson = (lessonId: string, headers: Record<string, string>) => app.inject({ method: 'GET', url: `/lessons/${lessonId}`, headers })
  const unknownId = randomUUID()

  assert.equal((await getCourseLessons(courseIds.get('Maths')!, sessionA)).statusCode, 200)
  assert.equal((await getLesson(mathLesson, sessionA)).statusCode, 200)
  assert.equal((await getCourseLessons(courseIds.get('English')!, sessionA)).statusCode, 404)
  assert.equal((await getCourseLessons(courseIds.get('Science')!, sessionA)).statusCode, 404)
  assert.equal((await getLesson(englishLesson, sessionA)).statusCode, 404)
  assert.equal((await getLesson(scienceLesson, sessionA)).statusCode, 404)
  assert.equal((await getCourseLessons(courseIds.get('Maths')!, sessionB)).statusCode, 404)
  assert.equal((await getLesson(mathLesson, sessionB)).statusCode, 404)
  assert.equal((await getCourseLessons(unknownId, sessionA)).statusCode, 404)
  assert.equal((await getLesson(unknownId, sessionA)).statusCode, 404)
})
