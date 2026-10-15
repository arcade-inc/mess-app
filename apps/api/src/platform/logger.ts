import { context, trace } from '@opentelemetry/api'
import type { AppConfig } from './config.js'

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.body.password',
  'req.body.email',
  'req.body.emailConfirm',
  'req.body.parent.email',
  'req.body.parent.emailConfirm',
  'req.body.students[*].name',
  'req.body.invitationToken',
  'res.headers.set-cookie',
]

export function createLoggerOptions(config: AppConfig) {
  return {
    level: config.environment === 'test' ? 'silent' : 'info',
    redact: { paths: redactedPaths, censor: '[REDACTED]' },
    mixin() {
      const spanContext = trace.getSpan(context.active())?.spanContext()
      return spanContext
        ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
        : {}
    },
    serializers: {
      req(request: { method: string; id: string; routeOptions?: { url?: string } }) {
        return {
          method: request.method,
          route: request.routeOptions?.url ?? 'unmatched',
          requestId: request.id,
        }
      },
    },
  }
}
