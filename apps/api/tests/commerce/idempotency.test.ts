import assert from 'node:assert/strict'
import test from 'node:test'
import { hashCheckoutRequest, validateIdempotencyKey } from '../../src/modules/commerce/idempotency.js'

test('validates idempotency keys from one through 255 characters', () => {
  assert.equal(validateIdempotencyKey('k'), 'k')
  assert.equal(validateIdempotencyKey('k'.repeat(255)), 'k'.repeat(255))
  assert.throws(() => validateIdempotencyKey(''))
  assert.throws(() => validateIdempotencyKey('k'.repeat(256)))
})

test('hashes equivalent JSON objects canonically and distinguishes changed checkout details', () => {
  const first = { parent: { name: 'A', email: 'a@example.com' }, students: [{ year: 8, courseIds: ['course-1'] }] }
  const reordered = { students: [{ courseIds: ['course-1'], year: 8 }], parent: { email: 'a@example.com', name: 'A' } }
  const changed = { ...first, students: [{ year: 9, courseIds: ['course-1'] }] }
  assert.equal(hashCheckoutRequest(first), hashCheckoutRequest(reordered))
  assert.notEqual(hashCheckoutRequest(first), hashCheckoutRequest(changed))
})
