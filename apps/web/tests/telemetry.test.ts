import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldPropagateTraceContext } from '../src/telemetry.js'

test('propagates trace context only to explicitly configured API origins', () => {
  const allowed = ['https://api.example']
  assert.equal(shouldPropagateTraceContext('https://api.example/v1/catalog', allowed), true)
  assert.equal(shouldPropagateTraceContext('https://api.example.evil.test/v1', allowed), false)
  assert.equal(shouldPropagateTraceContext('https://third-party.test/collect', allowed), false)
})
