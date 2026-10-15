import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../../src/app.js'
import { parseConfig } from '../../src/platform/config.js'
import { listCourses } from '../../src/modules/catalog/catalog.repository.js'
import { createPostgresFixture } from '../setup/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL

test('catalog repository and public catalog route return seeded prices and eligibility', async (t) => {
  const fixture = createPostgresFixture(t)
  if (!fixture) return t.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
  const courses = await listCourses(fixture.pool)
  assert.ok(courses.length >= 3)
  const maths = courses.find((course) => course.subject === 'Maths')
  assert.ok(maths)
  assert.equal(maths.priceMinor, 19900)
  assert.equal(maths.currency, 'GBP')
  assert.equal(maths.yearMin, 5)
  assert.equal(maths.yearMax, 13)

  const app = await buildApp({
    config: parseConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl!,
      JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
      CORS_ORIGINS: 'https://web.example',
    }),
    readDatabase: new Pool({ connectionString: databaseUrl }),
  })
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/courses' })
  assert.equal(response.statusCode, 200)
  assert.ok(response.json<{ courses: unknown[] }>().courses.length >= 3)
})
