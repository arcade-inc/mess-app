import assert from 'node:assert/strict'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { test } from 'node:test'
import { attachTraceContextToErrorReport } from '../src/telemetry.js'

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())

test('attaches only the active trace identifier to a frontend error report', () => {
  const span = trace.wrapSpanContext({
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: 1,
  })
  const report = context.with(trace.setSpan(context.active(), span), () =>
    attachTraceContextToErrorReport({ kind: 'render-error' }),
  )
  assert.deepEqual(report, { kind: 'render-error', traceId: '0123456789abcdef0123456789abcdef' })
})

test('does not add an empty trace identifier when no span is active', () => {
  assert.deepEqual(attachTraceContextToErrorReport({ kind: 'startup-error' }), { kind: 'startup-error' })
})
