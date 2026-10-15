import { randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import { sessionCookieOptions } from './modules/identity/session.js'
import type { AppConfig } from './platform/config.js'
import { registerAuthGuard } from './platform/auth-guard.js'
import { registerCors } from './platform/cors.js'
import { registerErrorHandler } from './platform/errors.js'
import { createLoggerOptions } from './platform/logger.js'
import { registerRateLimit } from './platform/rate-limit.js'
import { createTelemetry, type Telemetry } from './platform/telemetry.js'

interface BuildAppOptions {
  config: AppConfig
  database?: Pool
  readDatabase?: Pool
  telemetry?: Telemetry
  instrumentation?: FastifyOtelInstrumentation
}

export async function buildApp({ config, database, readDatabase, telemetry = createTelemetry(), instrumentation }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(config),
    trustProxy: config.trustedProxies.length > 0 ? config.trustedProxies : false,
    genReqId: () => randomUUID(),
  })
  const otelInstrumentation = instrumentation ?? new FastifyOtelInstrumentation()

  app.register(cookie)
  app.register(jwt, {
    secret: config.jwtSecret,
    cookie: sessionCookieOptions(),
  })
  app.register(otelInstrumentation.plugin())
  registerCors(app, config)

  const requestStartedAt = new WeakMap<FastifyRequest, bigint>()
  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint())
    if (!request.cookies.session) return
    try {
      await request.jwtVerify({ onlyCookie: true })
    } catch {
      // Invalid, expired, or malformed cookies are treated as anonymous requests.
    }
  })
  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request)
    if (startedAt === undefined) return
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    telemetry.recordHttpRequest(request.routeOptions.url ?? 'unmatched', request.method, reply.statusCode, durationMs)
  })

  registerRateLimit(app, config)
  registerErrorHandler(app)
  registerAuthGuard(app)

  app.get('/health', { config: { public: true } }, async () => ({ status: 'ok' }))
  app.get('/ready', { config: { public: true } }, async (_request, reply) => {
    if (!database) return reply.code(503).send({ status: 'not_ready' })
    try {
      await database.query('SELECT 1')
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  if (database || readDatabase) app.addHook('onClose', async () => {
    await Promise.all(Array.from(new Set([database, readDatabase].filter((pool): pool is Pool => pool !== undefined)), (pool) => pool.end()))
  })
  return app
}
