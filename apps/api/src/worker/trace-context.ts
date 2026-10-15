import { context, propagation, ROOT_CONTEXT, trace, type Context, type Link, type TextMapGetter } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import type { OutboxTraceContext } from './outbox.repository.js'

const propagator = new W3CTraceContextPropagator()
const getter: TextMapGetter<Record<string, string>> = {
  get: (carrier, key) => carrier[key.toLowerCase()],
  keys: (carrier) => Object.keys(carrier),
}

export function sanitizeOutboxTraceContext(value: unknown): OutboxTraceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.traceparent !== 'string' || candidate.traceparent.length > 256) return null
  const carrier: Record<string, string> = { traceparent: candidate.traceparent }
  if (typeof candidate.tracestate === 'string' && candidate.tracestate.length <= 512 && !/[\r\n]/.test(candidate.tracestate)) {
    carrier.tracestate = candidate.tracestate
  }
  const extracted = propagator.extract(ROOT_CONTEXT, carrier, getter)
  const spanContext = trace.getSpanContext(extracted)
  if (!spanContext) return null
  const tracestate = spanContext.traceState?.serialize()
  return { traceparent: carrier.traceparent, ...(tracestate ? { tracestate } : {}) }
}

export function extractOutboxTraceContext(value: OutboxTraceContext | null): Context {
  const sanitized = sanitizeOutboxTraceContext(value)
  return sanitized ? propagator.extract(ROOT_CONTEXT, sanitized, getter) : ROOT_CONTEXT
}

export function linksForRetry(value: OutboxTraceContext | null): Link[] {
  const spanContext = trace.getSpanContext(extractOutboxTraceContext(value))
  return spanContext ? [{ context: spanContext, attributes: { 'outbox.retry': true } }] : []
}

export function currentOutboxTraceContext(): OutboxTraceContext | null {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return sanitizeOutboxTraceContext(carrier)
}
