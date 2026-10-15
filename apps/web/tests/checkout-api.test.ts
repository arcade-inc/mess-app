import assert from 'node:assert/strict'
import test from 'node:test'
import { createCheckoutIdempotencyKey, loadCourses, submitCheckout } from '../src/api/checkout.js'

test('loads the catalog from the configured API origin', async () => {
  let requestedUrl = ''
  const courses = [{ id: 'course-1', subject: 'Maths', yearMin: 5, yearMax: 13, priceMinor: 19900, currency: 'GBP' }]
  const result = await loadCourses('https://api.example', (async (input) => {
    requestedUrl = String(input)
    return Response.json({ courses })
  }) as typeof fetch)
  assert.equal(requestedUrl, 'https://api.example/api/courses')
  assert.deepEqual(result, courses)
})

test('submits the checkout body with the same idempotency key and returns invitation paths', async () => {
  const key = createCheckoutIdempotencyKey()
  let requestInit: RequestInit | undefined
  const payload = { parent: { name: 'Parent', email: 'p@example.com', emailConfirm: 'p@example.com' }, students: [] }
  const result = await submitCheckout('https://api.example', payload, key, (async (_input, init) => {
    requestInit = init
    return Response.json({ orderId: 'order-1', status: 'PAID', totalMinor: 19900, currency: 'GBP', invitations: [{ studentName: 'Learner', url: 'https://web.example/invite/token' }] }, { status: 201 })
  }) as typeof fetch)
  assert.equal(new Headers(requestInit?.headers).get('idempotency-key'), key)
  assert.deepEqual(JSON.parse(String(requestInit?.body)), payload)
  assert.equal(result.invitations[0]?.url, 'https://web.example/invite/token')
  assert.notEqual(createCheckoutIdempotencyKey(), key)
})

test('surfaces safe API error messages when checkout is rejected', async () => {
  await assert.rejects(
    submitCheckout('https://api.example', {}, 'key', (async () => Response.json({ error: { code: 'COURSE_INELIGIBLE', message: 'Choose an eligible school year' } }, { status: 422 })) as typeof fetch),
    (error: unknown) => error instanceof Error && error.message === 'Choose an eligible school year' && 'code' in error && error.code === 'COURSE_INELIGIBLE' && 'statusCode' in error && error.statusCode === 422,
  )
})
