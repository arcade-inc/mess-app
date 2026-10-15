import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool, type PoolClient } from 'pg'
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

interface ObservedQuery {
  pool: 'primary' | 'read'
  sql: string
}

function observePool(pool: Pool, name: ObservedQuery['pool'], observed: ObservedQuery[], simulateStaleEnrollment = false): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'query') {
        return (...args: Parameters<Pool['query']>) => {
          const sql = String(args[0])
          observed.push({ pool: name, sql })
          if (simulateStaleEnrollment && /FROM enrollments/i.test(sql)) {
            return Promise.resolve({
              rows: [{ id: 'stale-enrollment', course_id: 'stale-course', subject: 'Stale course', position: 1, title: 'Stale lesson', body: 'Stale replica content' }],
              rowCount: 1,
              command: 'SELECT',
              oid: 0,
              fields: [],
            }) as ReturnType<Pool['query']>
          }
          return target.query(...args)
        }
      }
      if (property === 'connect') {
        return async () => observeClient(await target.connect(), name, observed)
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function observeClient(client: PoolClient, name: ObservedQuery['pool'], observed: ObservedQuery[]): PoolClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'query') {
        return (...args: Parameters<PoolClient['query']>) => {
          observed.push({ pool: name, sql: String(args[0]) })
          return target.query(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

test('routes catalog browsing to read pool and checkout, activation, and entitlement reads to primary', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const observed: ObservedQuery[] = []
  const primary = observePool(new Pool({ connectionString: databaseUrl }), 'primary', observed)
  const read = observePool(new Pool({ connectionString: databaseUrl }), 'read', observed, true)
  const app = await buildApp({ config, database: primary, readDatabase: read })
  t.after(() => app.close())

  await app.ready()
  observed.length = 0
  const catalog = await app.inject({ method: 'GET', url: '/courses' })
  assert.equal(catalog.statusCode, 200)
  assert.ok(observed.some((entry) => entry.pool === 'read' && /FROM courses/i.test(entry.sql)))
  assert.equal(observed.some((entry) => entry.pool === 'primary'), false, 'catalog browsing must not query primary')

  const course = catalog.json<{ courses: Array<{ id: string; yearMin: number }> }>().courses[0]
  assert.ok(course)
  const key = `routing-${randomUUID()}`
  const parentEmail = `routing-parent-${randomUUID()}@example.com`
  const studentEmail = `routing-student-${randomUUID()}@example.com`
  fixture.trackOrder(key, parentEmail)
  fixture.trackStudent(studentEmail)
  const checkoutPayload = {
    parent: { name: 'Routing Parent', email: parentEmail, emailConfirm: parentEmail },
    students: [{ name: 'Routing Student', year: course.yearMin, courseIds: [course.id] }],
  }

  observed.length = 0
  const checkout = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': key },
    payload: checkoutPayload,
  })
  assert.equal(checkout.statusCode, 201)
  assert.ok(observed.some((entry) => entry.pool === 'primary' && /INSERT INTO orders/i.test(entry.sql)))
  assert.ok(observed.every((entry) => entry.pool === 'primary'), 'checkout queries and transaction must stay on primary')

  const invitationUrl = checkout.json<{ invitations: Array<{ url: string }> }>().invitations[0]?.url
  assert.ok(invitationUrl)
  const token = new URL(invitationUrl).pathname.split('/').at(-1)
  assert.ok(token)

  const activated = await app.inject({
    method: 'POST',
    url: `/invitations/${encodeURIComponent(token)}`,
    payload: { email: studentEmail, password: 'routing-test-password-2026' },
  })
  assert.equal(activated.statusCode, 200)
  const studentId = activated.json<{ student: { id: string } }>().student.id
  const sessionCookie = activated.cookies.find((cookie) => cookie.name === 'session')
  assert.ok(sessionCookie)
  const headers = { cookie: `session=${sessionCookie.value}` }

  const outsiderEmail = `routing-outsider-${randomUUID()}@example.com`
  fixture.trackStudent(outsiderEmail)
  const outsiderId = (await fixture.pool.query<{ id: string }>(
    "INSERT INTO students (email, name, year, password_hash) VALUES ($1, 'Routing Outsider', 8, 'test-hash') RETURNING id",
    [outsiderEmail],
  )).rows[0]!.id
  const outsiderHeaders = { cookie: `session=${app.jwt.sign({ sub: outsiderId })}` }

  observed.length = 0
  const deniedStaleEnrollment = await app.inject({ method: 'GET', url: `/courses/${course.id}/lessons`, headers: outsiderHeaders })
  assert.equal(deniedStaleEnrollment.statusCode, 404, 'a stale read-pool enrollment must not grant access')
  assert.equal(observed.some((entry) => entry.pool === 'read' && /enrollments/i.test(entry.sql)), false)
  assert.equal(observed.some((entry) => entry.pool === 'read' && /FROM lessons/i.test(entry.sql)), false, 'denied requests must not fetch lesson content')

  observed.length = 0
  const enrollments = await app.inject({ method: 'GET', url: '/me/enrollments', headers })
  assert.equal(enrollments.statusCode, 200)
  assert.ok(observed.some((entry) => entry.pool === 'primary' && /FROM enrollments/i.test(entry.sql)))
  assert.equal(observed.some((entry) => entry.pool === 'read'), false, 'current entitlement state must come from primary')

  observed.length = 0
  const lessons = await app.inject({ method: 'GET', url: `/courses/${course.id}/lessons`, headers })
  assert.equal(lessons.statusCode, 200)
  assert.ok(observed.some((entry) => entry.pool === 'primary' && /FROM enrollments/i.test(entry.sql)))
  assert.ok(observed.some((entry) => entry.pool === 'read' && /FROM lessons/i.test(entry.sql)), 'lesson content may use the explicitly lag-tolerant read pool after primary authorization')
  assert.equal(observed.some((entry) => entry.pool === 'read' && /enrollments/i.test(entry.sql)), false)

  const lessonId = lessons.json<{ lessons: Array<{ id: string }> }>().lessons[0]?.id
  assert.ok(lessonId)
  observed.length = 0
  const lesson = await app.inject({ method: 'GET', url: `/lessons/${lessonId}`, headers })
  assert.equal(lesson.statusCode, 200)
  assert.ok(observed.some((entry) => entry.pool === 'primary' && /JOIN enrollments/i.test(entry.sql)))
  assert.ok(observed.some((entry) => entry.pool === 'read' && /FROM lessons/i.test(entry.sql)), 'lesson body may use the read pool only after primary entitlement check')
  assert.equal(observed.some((entry) => entry.pool === 'read' && /enrollments/i.test(entry.sql)), false)
  assert.ok(studentId)
})
