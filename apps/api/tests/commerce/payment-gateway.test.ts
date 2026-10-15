import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockPaymentGateway } from '../../src/modules/commerce/payment-gateway.js'

test('mock gateway produces deterministic success results without charging externally', async () => {
  const gateway = createMockPaymentGateway('SUCCEEDED')
  const result = await gateway.charge({ orderId: 'order-1', amountMinor: 19900, currency: 'GBP' })
  assert.deepEqual(result, { provider: 'mock', providerRef: 'mock-order-1', status: 'SUCCEEDED', amountMinor: 19900 })
})

test('mock gateway can deterministically simulate payment failure', async () => {
  const result = await createMockPaymentGateway('FAILED').charge({ orderId: 'order-2', amountMinor: 19900, currency: 'GBP' })
  assert.equal(result.status, 'FAILED')
})
