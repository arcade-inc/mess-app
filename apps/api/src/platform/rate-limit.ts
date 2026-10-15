import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getStudentIdFromRequest } from '../modules/identity/session.js'
import type { AppConfig } from './config.js'

function rateLimitKey(request: FastifyRequest): string {
  const subject = getStudentIdFromRequest(request)
  return typeof subject === 'string' && subject.length > 0
    ? `student:${subject}`
    : `ip:${request.ip}`
}

export function registerRateLimit(app: FastifyInstance, config: AppConfig): void {
  app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: config.rateLimitMax,
    timeWindow: config.rateLimitTimeWindowMs,
    keyGenerator: rateLimitKey,
    allowList: (request) => ['/health', '/ready'].includes(request.routeOptions.url ?? ''),
    errorResponseBuilder: (_request, context) => Object.assign(
      new Error(`Too many requests; retry in ${context.after}`),
      { statusCode: context.statusCode, code: 'RATE_LIMITED' },
    ),
  })
}
