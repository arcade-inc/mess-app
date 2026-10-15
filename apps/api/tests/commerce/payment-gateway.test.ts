import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockPaymentGateway } from '../../src/modules/commerce/payment-gateway.js'

test('mock gateway produces deterministic success results without charging externally', async () => {
  const gateway = createMockPaymentGateway('SUCCEEDED')
  const result = await gateway.charge({ orderId: 'order-1', amountMinor: 19900, currency: 'GBP', paymentMethod: 'visa' })
  assert.deepEqual(result, { provider: 'mock_visa', providerRef: 'mock-order-1', status: 'SUCCEEDED', amountMinor: 19900 })
})

test('mock gateway can deterministically simulate payment failure', async () => {
  const result = await createMockPaymentGateway('FAILED').charge({ orderId: 'order-2', amountMinor: 19900, currency: 'GBP', paymentMethod: 'mastercard' })
  assert.equal(result.status, 'FAILED')
  assert.equal(result.provider, 'mock_mastercard')
})
