import assert from 'node:assert/strict'
import test from 'node:test'

const appModule = await import('../../src/app.js').catch(() => null)

test('denies routes without an explicit public allowlist entry and keeps health public', async (t) => {
  assert.ok(appModule, 'Fastify app builder must be implemented')
  const app = await appModule.buildApp({
    config: {
      environment: 'test',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'postgres://test:test@127.0.0.1:5432/test',
      jwtSecret: 'test-only-secret-with-at-least-32-characters',
      rateLimitMax: 100,
      rateLimitTimeWindowMs: 60_000,
      corsOrigins: [],
      trustedProxies: [],
    },
  })
  t.after(() => app.close())
  app.get('/private', async () => ({ secret: 'protected' }))

  assert.equal((await app.inject({ url: '/private' })).statusCode, 401)
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200)
})
