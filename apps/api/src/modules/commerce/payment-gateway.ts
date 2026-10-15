export interface ChargeRequest {
  orderId: string
  amountMinor: number
  currency: string
}

export interface ChargeResult {
  provider: string
  providerRef: string
  status: 'SUCCEEDED' | 'FAILED'
  amountMinor: number
}

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>
}

export function createMockPaymentGateway(outcome: ChargeResult['status'] = 'SUCCEEDED'): PaymentGateway {
  return {
    async charge({ orderId, amountMinor }): Promise<ChargeResult> {
      // A real provider call would be an asynchronous boundary and must remain outside DB transactions.
      return { provider: 'mock', providerRef: `mock-${orderId}`, status: outcome, amountMinor }
    },
  }
}
