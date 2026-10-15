import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

const appModule = await import('../../src/app.js').catch(() => null)
const telemetryModule = await import('../../src/platform/telemetry.js').catch(() => null)

const createMetrics = () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })
  const provider = new MeterProvider({ readers: [reader] })
  const telemetry = telemetryModule?.createTelemetry(provider.getMeter('operations-test'))
  return { exporter, provider, telemetry }
}

const testConfig = (overrides: Record<string, unknown> = {}) => ({
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgres://test:test@127.0.0.1:5432/test',
  jwtSecret: 'test-only-secret-with-at-least-32-characters',
  rateLimitMax: 2,
  rateLimitTimeWindowMs: 100,
  corsOrigins: ['https://allowed.example'],
  trustedProxies: [],
  ...overrides,
})

const createApp = async (overrides: Record<string, unknown> = {}) => {
  assert.ok(appModule, 'Fastify app builder must be implemented')
  const metrics = createMetrics()
  assert.ok(metrics.telemetry, 'OpenTelemetry instruments must be implemented')
  const app = await appModule.buildApp({ config: testConfig(overrides), telemetry: metrics.telemetry }) as FastifyInstance
  return { app, ...metrics }
}

after(async () => {
  await appModule?.shutdownTelemetry?.()
})

test('emits HTTP and business metrics without sensitive request attributes', async (t) => {
  const { app, exporter, provider, telemetry } = await createApp()
  t.after(async () => {
    await app.close()
    await provider.shutdown()
  })
  app.get('/test/lesson', async () => ({ ok: true }))
  await app.inject({ method: 'GET', url: '/test/lesson', headers: { 'x-student-email': 'student@example.com' } })
  telemetry.recordBusinessEvent('order.created')
  telemetry.recordBusinessEvent('invitation.claimed')
  await provider.forceFlush()

  const exported = JSON.stringify(exporter.getMetrics())
  assert.match(exported, /http\.server\.request\.count/)
  assert.match(exported, /http\.server\.request\.duration/)
  assert.match(exported, /business\.order\.created/)
  assert.match(exported, /business\.invitation\.claimed/)
  assert.doesNotMatch(exported, /student@example\.com|x-student-email/)
})

test('creates an OpenTelemetry request context for registered routes', async (t) => {
  const { app } = await createApp()
  t.after(() => app.close())
  app.get('/test/traced', { config: { public: true } }, async (request) => ({
    instrumented: request.opentelemetry().instrumented,
  }))

  const response = await app.inject({ url: '/test/traced' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().instrumented, true)
})

test('a read-only pool cannot satisfy readiness or register write and identity routes', async (t) => {
  assert.ok(appModule)
  const queries: string[] = []
  const readOnlyPool = {
    query: async (sql: string) => {
      queries.push(sql)
      return { rows: [], rowCount: 0 }
    },
    end: async () => undefined,
  } as unknown as Pool
  const app = await appModule.buildApp({
    config: testConfig(),
    readDatabase: readOnlyPool,
  })
  t.after(() => app.close())

  const readiness = await app.inject({ method: 'GET', url: '/ready' })
  assert.equal(readiness.statusCode, 503)
  const catalog = await app.inject({ method: 'GET', url: '/courses' })
  assert.equal(catalog.statusCode, 200)
  assert.match(queries[0] ?? '', /FROM courses/i)
  assert.equal((await app.inject({ method: 'POST', url: '/checkout', payload: {} })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/me/enrollments' })).statusCode, 401)
})

test('limits requests independently by verified student and replenishes after the window', async (t) => {
  const { app } = await createApp({ rateLimitMax: 1, rateLimitTimeWindowMs: 60 })
  t.after(() => app.close())
  app.get('/private', async (request) => ({ student: request.user.sub }))
  await app.ready()

  const studentA = app.jwt.sign({ sub: 'student-a' })
  const studentB = app.jwt.sign({ sub: 'student-b' })
  assert.equal((await app.inject({ url: '/private', headers: { cookie: `session=${studentA}` } })).statusCode, 200)
  assert.equal((await app.inject({ url: '/private', headers: { cookie: `session=${studentA}` } })).statusCode, 429)
  assert.equal((await app.inject({ url: '/private', headers: { cookie: `session=${studentB}` } })).statusCode, 200)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal((await app.inject({ url: '/private', headers: { cookie: `session=${studentA}` } })).statusCode, 200)
})

test('uses the socket IP rather than spoofed forwarded headers on anonymous routes', async (t) => {
  const { app } = await createApp({ rateLimitMax: 1 })
  t.after(() => app.close())
  app.get('/public', { config: { public: true } }, async () => ({ ok: true }))

  assert.equal((await app.inject({ url: '/public', headers: { 'x-forwarded-for': '198.51.100.1' } })).statusCode, 200)
  assert.equal((await app.inject({ url: '/public', headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode, 429)
})

test('allows credentialed CORS only from configured origins', async (t) => {
  const { app } = await createApp()
  t.after(() => app.close())

  const allowed = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'https://allowed.example', 'access-control-request-method': 'GET' },
  })
  const denied = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'https://unlisted.example', 'access-control-request-method': 'GET' },
  })
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example')
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true')
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  assert.equal(denied.headers['access-control-allow-credentials'], undefined)
})
