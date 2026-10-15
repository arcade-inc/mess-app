import { context, trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

export function shouldPropagateTraceContext(url: string, apiOrigins: string[]): boolean {
  try {
    return apiOrigins.includes(new URL(url, globalThis.location?.origin ?? 'http://localhost').origin)
  } catch {
    return false
  }
}

export function startBrowserTelemetry(apiOrigins: string[], exporterEndpoint?: string): void {
  const spanProcessors = exporterEndpoint
    ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${exporterEndpoint.replace(/\/$/, '')}/v1/traces` }))]
    : []
  const provider = new WebTracerProvider({ spanProcessors })
  provider.register({ propagator: new W3CTraceContextPropagator() })
  const escapedOrigins = apiOrigins.map((origin) => origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  new FetchInstrumentation({ propagateTraceHeaderCorsUrls: escapedOrigins.map((origin) => new RegExp(`^${origin}(?:/|$)`)) }).enable()
}

export function activeTraceCorrelation(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getSpan(context.active())?.spanContext()
  return spanContext ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}
}

export function attachTraceContextToErrorReport<T extends Record<string, unknown>>(report: T): T & { traceId?: string } {
  const { traceId } = activeTraceCorrelation()
  return traceId ? { ...report, traceId } : report
}
