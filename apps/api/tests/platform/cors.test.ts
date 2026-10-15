import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import { registerCors } from '../../src/platform/cors.js'

test('allows W3C trace headers on configured-origin preflight only', async (t) => {
  const app = Fastify()
  registerCors(app, { corsOrigins: ['https://allowed.example'] } as never)
  app.get('/resource', async () => ({ ok: true }))
  t.after(() => app.close())

  const allowed = await app.inject({ method: 'OPTIONS', url: '/resource', headers: {
    origin: 'https://allowed.example',
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'traceparent,tracestate',
  } })
  const denied = await app.inject({ method: 'OPTIONS', url: '/resource', headers: {
    origin: 'https://unapproved.example',
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'traceparent,tracestate',
  } })
  assert.match(allowed.headers['access-control-allow-headers'] ?? '', /traceparent/i)
  assert.match(allowed.headers['access-control-allow-headers'] ?? '', /tracestate/i)
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
})
