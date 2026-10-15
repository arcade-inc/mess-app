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

test('login rejects invalid credentials without disclosing them and logout clears the session cookie', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')

  const app = await buildApp({ config, database: new Pool({ connectionString: databaseUrl }) })
  t.after(() => app.close())
  const { rows: [course] } = await fixture.pool.query<{ id: string; year_min: number }>("SELECT id, year_min FROM courses WHERE subject = 'Maths'")
  assert.ok(course)
  const parentEmail = `parent-${randomUUID()}@example.com`
  const key = `session-${randomUUID()}`
  fixture.trackOrder(key, parentEmail)
  const checkout = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'idempotency-key': key },
    payload: {
      parent: { name: 'Parent', email: parentEmail, emailConfirm: parentEmail },
      students: [{ name: 'Session Learner', year: course.year_min, courseIds: [course.id] }],
      paymentMethod: 'visa',
    },
  })
  const invitation = checkout.json<{ invitations: Array<{ url: string }> }>().invitations[0]?.url
  assert.ok(invitation)
  const token = new URL(invitation).pathname.split('/').at(-1)
  assert.ok(token)
  const email = `session-student-${randomUUID()}@example.com`
  fixture.trackStudent(email)
  const password = 'a secure password 123'
  const redeemed = await app.inject({ method: 'POST', url: `/invitations/${token}`, payload: { email, password } })
  assert.equal(redeemed.statusCode, 200)

  const invalid = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'incorrect password 123' } })
  assert.equal(invalid.statusCode, 401)
  assert.doesNotMatch(invalid.body, /incorrect password 123|password_hash/i)

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  assert.equal(login.statusCode, 200)
  assert.doesNotMatch(login.body, new RegExp(password))
  assert.doesNotMatch(login.body, /password_hash/i)
  const loginCookie = login.headers['set-cookie'] as string
  assert.match(loginCookie, /HttpOnly/i)
  assert.match(loginCookie, /SameSite=Lax/i)
  const cookie = loginCookie.split(';', 1)[0]
  assert.equal((await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).statusCode, 200)

  const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })
  assert.equal(logout.statusCode, 204)
  assert.match(logout.headers['set-cookie'] as string, /Max-Age=0/i)
  assert.equal((await app.inject({ method: 'GET', url: '/me' })).statusCode, 401)
})
