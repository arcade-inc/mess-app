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
import { selectDatabasePool } from './platform/database.js'
import { createTelemetry, type Telemetry } from './platform/telemetry.js'
import { registerCatalogRoutes } from './modules/catalog/catalog.routes.js'
import { registerCheckoutRoutes } from './modules/commerce/checkout.routes.js'
import type { PaymentGateway } from './modules/commerce/payment-gateway.js'
import { registerIdentityRoutes } from './modules/identity/identity.routes.js'
import { registerLearningRoutes } from './modules/learning/learning.routes.js'

interface BuildAppOptions {
  config: AppConfig
  database?: Pool
  readDatabase?: Pool
  telemetry?: Telemetry
  instrumentation?: FastifyOtelInstrumentation
  paymentGateway?: PaymentGateway
}

export async function buildApp({ config, database, readDatabase, telemetry = createTelemetry(), instrumentation, paymentGateway }: BuildAppOptions): Promise<FastifyInstance> {
  const readPool = readDatabase ?? database
  const pools = database ? { primary: database, read: readDatabase ?? database } : undefined
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
    if (!database || !pools) return reply.code(503).send({ status: 'not_ready' })
    try {
      await selectDatabasePool(pools, 'read-after-write').query('SELECT 1')
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  if (readPool) registerCatalogRoutes(app, pools ? selectDatabasePool(pools, 'catalog-browse') : readPool)
  if (pools) registerCheckoutRoutes(app, {
    primary: selectDatabasePool(pools, 'checkout-consistency'),
    webOrigin: config.webOrigin,
    telemetry,
    ...(paymentGateway ? { paymentGateway } : {}),
  })
  if (pools) {
    const primary = selectDatabasePool(pools, 'transaction')
    registerIdentityRoutes(app, { database: primary, config, telemetry })
    registerLearningRoutes(
      app,
      selectDatabasePool(pools, 'enrollment-authorization'),
      selectDatabasePool(pools, 'lesson-content-lag-tolerant'),
      telemetry,
    )
  }

  if (database || readDatabase) app.addHook('onClose', async () => {
    await Promise.all(Array.from(new Set([database, readDatabase].filter((pool): pool is Pool => pool !== undefined)), (pool) => pool.end()))
  })
  return app
}
