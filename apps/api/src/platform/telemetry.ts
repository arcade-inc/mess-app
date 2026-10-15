import { metrics, trace, type Meter } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import type { AppConfig } from './config.js'

export type BusinessEvent =
  | 'order.created'
  | 'order.paid'
  | 'invitation.issued'
  | 'invitation.redeemed'
  | 'activation.failed'
  | 'lesson_access.denied'

export interface Telemetry {
  recordHttpRequest(route: string, method: string, statusCode: number, durationMs: number): void
  recordBusinessEvent(event: BusinessEvent): void
}

const businessMetricNames: Record<BusinessEvent, string> = {
  'order.created': 'business.order.created',
  'order.paid': 'business.order.paid',
  'invitation.issued': 'business.invitation.issued',
  'invitation.redeemed': 'business.invitation.redeemed',
  'activation.failed': 'business.activation.failed',
  'lesson_access.denied': 'business.lesson_access.denied',
}

let activeSdk: NodeSDK | undefined

export function createTelemetry(meter: Meter = metrics.getMeter('mes-api')): Telemetry {
  const requestCount = meter.createCounter('http.server.request.count', { unit: '{request}' })
  const requestDuration = meter.createHistogram('http.server.request.duration', { unit: 'ms' })
  const requestErrors = meter.createCounter('http.server.request.errors', { unit: '{request}' })
  const businessCounters = new Map<BusinessEvent, ReturnType<Meter['createCounter']>>()
  for (const event of Object.keys(businessMetricNames) as BusinessEvent[]) {
    businessCounters.set(event, meter.createCounter(businessMetricNames[event], { unit: '{event}' }))
  }

  return {
    recordHttpRequest(route, method, statusCode, durationMs) {
      const attributes = {
        'http.route': route,
        'http.request.method': method,
        'http.response.status_class': `${Math.floor(statusCode / 100)}xx`,
      }
      requestCount.add(1, attributes)
      requestDuration.record(durationMs, attributes)
      if (statusCode >= 400) requestErrors.add(1, attributes)
    },
    recordBusinessEvent(event) {
      businessCounters.get(event)?.add(1)
    },
  }
}

export async function startTelemetry(config: AppConfig) {
  const endpoint = config.otelExporterOtlpEndpoint
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': config.otelServiceName }),
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [new PgInstrumentation()],
    traceExporter: endpoint
      ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      : new ConsoleSpanExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: endpoint
        ? new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` })
        : new ConsoleMetricExporter(),
    }),
  })
  await sdk.start()
  activeSdk = sdk

  const instrumentation = new FastifyOtelInstrumentation()
  instrumentation.setTracerProvider(trace.getTracerProvider())

  return { instrumentation, telemetry: createTelemetry() }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!activeSdk) return
  await activeSdk.shutdown()
  activeSdk = undefined
}
