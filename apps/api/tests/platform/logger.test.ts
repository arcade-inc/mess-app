import assert from 'node:assert/strict'
import { test } from 'node:test'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import pino from 'pino'
import { Writable } from 'node:stream'
import { createLoggerOptions } from '../../src/platform/logger.js'

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
const config = { environment: 'test' } as never

test('correlates structured logs with the active trace and span', () => {
  const options = createLoggerOptions(config)
  const spanContext = { traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', traceFlags: 1 }
  const span = trace.wrapSpanContext(spanContext)
  const fields = context.with(trace.setSpan(context.active(), span), () => options.mixin?.() ?? {})
  assert.equal(fields.traceId, spanContext.traceId)
  assert.equal(fields.spanId, spanContext.spanId)
})

test('redacts dummy credentials on successful and failed request log paths', async () => {
  const options = createLoggerOptions(config)
  assert.ok(options.redact.paths.includes('req.body.password'))
  assert.ok(options.redact.paths.includes('req.body.invitationToken'))
  assert.ok(options.redact.paths.includes('req.headers.cookie'))
  let output = ''
  const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback() } })
  const logger = pino({ ...options, level: 'info' }, stream)
  const req = { body: { password: 'dummy-secret', invitationToken: 'dummy-token' }, headers: { cookie: 'dummy-cookie' } }
  logger.info({ req }, 'success')
  logger.error({ req }, 'failure')
  logger.flush()
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(output, /success/)
  assert.match(output, /failure/)
  assert.doesNotMatch(output, /dummy-secret|dummy-token|dummy-cookie/)
  assert.doesNotMatch(output, /password|invitationToken|cookie/)
})
