import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'

export function registerCors(app: FastifyInstance, config: AppConfig): void {
  app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'traceparent', 'tracestate'],
    exposedHeaders: ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
  })
  app.addHook('onSend', async (request, reply, payload) => {
    const origin = request.headers.origin
    if (origin && config.corsOrigins.includes(origin)) {
      reply.header('access-control-allow-credentials', 'true')
    }
    return payload
  })
}
