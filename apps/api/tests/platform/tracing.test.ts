import assert from 'node:assert/strict'
import { test } from 'node:test'
import { context, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())

const validTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const getter = {
  get: (carrier: Record<string, string>, key: string) => carrier[key],
  keys: (carrier: Record<string, string>) => Object.keys(carrier),
}

test('extracts a valid W3C traceparent as the parent context', () => {
  const extracted = new W3CTraceContextPropagator().extract(context.active(), { traceparent: validTraceparent }, getter)
  const spanContext = trace.getSpanContext(extracted)
  assert.equal(spanContext?.traceId, '4bf92f3577b34da6a3ce929d0e0e4736')
  assert.equal(spanContext?.spanId, '00f067aa0ba902b7')
})

test('missing and malformed trace context do not create a remote parent', () => {
  for (const carrier of [{}, { traceparent: 'not-a-traceparent' }]) {
    const extracted = new W3CTraceContextPropagator().extract(context.active(), carrier, getter)
    assert.equal(trace.getSpanContext(extracted), undefined)
  }
})
