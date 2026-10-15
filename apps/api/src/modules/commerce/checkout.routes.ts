import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { Telemetry } from '../../platform/telemetry.js'
import { createCheckoutService } from './checkout.service.js'
import { createMockPaymentGateway, type PaymentGateway } from './payment-gateway.js'

export interface CheckoutRouteOptions {
  primary: Pool
  webOrigin: string
  telemetry: Telemetry
  paymentGateway?: PaymentGateway
}

export function registerCheckoutRoutes(app: FastifyInstance, options: CheckoutRouteOptions): void {
  const service = createCheckoutService({
    primary: options.primary,
    paymentGateway: options.paymentGateway ?? createMockPaymentGateway(),
    webOrigin: options.webOrigin,
  })

  app.post<{ Headers: { 'idempotency-key'?: string } }>('/checkout', { config: { public: true } }, async (request, reply) => {
    const result = await service.checkout(request.body, request.headers['idempotency-key'])
    if (!result.replayed) {
      options.telemetry.recordBusinessEvent('order.created')
      options.telemetry.recordBusinessEvent('order.paid')
      for (let index = 0; index < result.invitations.length; index++) options.telemetry.recordBusinessEvent('invitation.issued')
    }
    return reply.code(result.replayed ? 200 : 201).send({
      ...result.receipt,
      invitations: result.invitations,
    })
  })
}
