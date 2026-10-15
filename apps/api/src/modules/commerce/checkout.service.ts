import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { AppError } from '../../platform/errors.js'
import { withTransaction } from '../../platform/database.js'
import { getEligibleCourses } from '../catalog/catalog.service.js'
import { hashCheckoutRequest, validateIdempotencyKey } from './idempotency.js'
import type { PaymentGateway } from './payment-gateway.js'
import { createInvitationToken, hashInvitationToken, INVITATION_LIFETIME_DAYS, INVITATION_REMINDER_DELAY_DAYS } from '../identity/invitation.service.js'
import { enqueueOutboxMessage } from '../../worker/outbox.repository.js'
import { currentOutboxTraceContext } from '../../worker/outbox.worker.js'

const checkoutSchema = z.object({
  parent: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    emailConfirm: z.string().trim().email().max(320),
  }).refine((parent) => parent.email.toLowerCase() === parent.emailConfirm.toLowerCase(), {
    path: ['emailConfirm'],
    message: 'Email addresses do not match',
  }),
  students: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    year: z.number().int().min(5).max(13),
    courseIds: z.array(z.string().uuid()).min(1),
  })).min(1).max(10),
})

export interface CheckoutRequest {
  parent: { name: string; email: string; emailConfirm: string }
  students: Array<{ name: string; year: number; courseIds: string[] }>
}

export interface CheckoutReceipt {
  orderId: string
  status: 'PAID'
  totalMinor: number
  currency: string
  invitations: Array<{ studentName: string; url: string }>
}

export interface CheckoutResult {
  receipt: Omit<CheckoutReceipt, 'invitations'>
  invitations: CheckoutReceipt['invitations']
  replayed: boolean
}

export interface CheckoutServiceOptions {
  primary: Pool
  paymentGateway: PaymentGateway
  webOrigin: string
}

interface PendingCheckout {
  orderId: string
  input: CheckoutRequest
  items: Array<{ slotIndex: number; courseId: string; priceMinor: number; currency: string }>
  totalMinor: number
  currency: string
}

async function existingCheckout(primary: Pool, idempotencyKey: string, requestHash: string): Promise<CheckoutResult | undefined> {
  const existing = await primary.query<{ id: string; status: string; request_hash: string; total_minor: number; currency: string }>(
    'SELECT id, status, request_hash, total_minor, currency FROM orders WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  const order = existing.rows[0]
  if (!order) return undefined
  if (order.request_hash !== requestHash) throw new AppError('Idempotency key was used with different checkout details', 422, 'IDEMPOTENCY_CONFLICT')
  if (order.status === 'PENDING_PAYMENT') throw new AppError('Checkout is already processing; retry with the same key and request', 409, 'CHECKOUT_IN_PROGRESS')
  if (order.status === 'FAILED') throw new AppError('This checkout attempt failed; start a new attempt', 402, 'PAYMENT_FAILED')
  return { receipt: { orderId: order.id, status: 'PAID', totalMinor: order.total_minor, currency: order.currency.trim() }, invitations: [], replayed: true }
}

async function createPendingOrder(primary: Pool, idempotencyKey: string, requestHash: string, input: CheckoutRequest): Promise<PendingCheckout | CheckoutResult> {
  const preparedItems: PendingCheckout['items'] = []
  for (const [slotIndex, student] of input.students.entries()) {
    if (new Set(student.courseIds).size !== student.courseIds.length) {
      throw new AppError('A student cannot select the same course more than once', 422, 'DUPLICATE_COURSE')
    }
    const courses = await getEligibleCourses(primary, student.courseIds, student.year)
    for (const course of courses) preparedItems.push({ slotIndex, courseId: course.id, priceMinor: course.priceMinor, currency: course.currency })
  }
  const currencies = new Set(preparedItems.map((item) => item.currency))
  if (currencies.size !== 1) throw new AppError('Selected courses must use the same currency', 422, 'MIXED_CURRENCY')
  const totalMinor = preparedItems.reduce((sum, item) => sum + item.priceMinor, 0)
  const currency = preparedItems[0]!.currency

  try {
    return await withTransaction(primary, async (client) => {
      const parent = await client.query<{ id: string }>(
        'INSERT INTO parents (name, email) VALUES ($1, $2) RETURNING id',
        [input.parent.name, input.parent.email.toLowerCase()],
      )
      const order = await client.query<{ id: string }>(
        `INSERT INTO orders (parent_id, status, total_minor, currency, idempotency_key, request_hash)
         VALUES ($1, 'PENDING_PAYMENT', $2, $3, $4, $5) RETURNING id`,
        [parent.rows[0]!.id, totalMinor, currency, idempotencyKey, requestHash],
      )
      return { orderId: order.rows[0]!.id, input, items: preparedItems, totalMinor, currency }
    })
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505') throw error
    const existing = await existingCheckout(primary, idempotencyKey, requestHash)
    if (!existing) throw error
    return existing
  }
}

async function finishSuccessfulCheckout(primary: Pool, pending: PendingCheckout, provider: string, providerRef: string, webOrigin: string): Promise<CheckoutResult> {
  return withTransaction(primary, async (client) => {
    await client.query("UPDATE orders SET status = 'PAID' WHERE id = $1", [pending.orderId])
    await client.query(
      "INSERT INTO payments (order_id, provider, provider_ref, status, amount_minor) VALUES ($1, $2, $3, 'SUCCEEDED', $4)",
      [pending.orderId, provider, providerRef, pending.totalMinor],
    )
    const slots: string[] = []
    for (const student of pending.input.students) {
      const slot = await client.query<{ id: string }>(
        'INSERT INTO student_slots (order_id, name, year) VALUES ($1, $2, $3) RETURNING id',
        [pending.orderId, student.name, student.year],
      )
      slots.push(slot.rows[0]!.id)
    }

    const invitations: CheckoutReceipt['invitations'] = []
    for (let slotIndex = 0; slotIndex < pending.input.students.length; slotIndex++) {
      const student = pending.input.students[slotIndex]!
      const slotId = slots[slotIndex]!
      const studentItems = pending.items.filter((item) => item.slotIndex === slotIndex)
      for (const item of studentItems) {
        const orderItem = await client.query<{ id: string }>(
          'INSERT INTO order_items (order_id, slot_id, course_id, unit_price_minor) VALUES ($1, $2, $3, $4) RETURNING id',
          [pending.orderId, slotId, item.courseId, item.priceMinor],
        )
        await client.query(
          "INSERT INTO enrollments (order_item_id, slot_id, course_id, status) VALUES ($1, $2, $3, 'PENDING')",
          [orderItem.rows[0]!.id, slotId, item.courseId],
        )
      }

      const token = createInvitationToken()
      const tokenHash = hashInvitationToken(token)
      await client.query(
        'INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 day\'))',
        [slotId, tokenHash, INVITATION_LIFETIME_DAYS],
      )
      invitations.push({ studentName: student.name, url: new URL(`/invite/${token}`, webOrigin).toString() })
    }
    const confirmation = await enqueueOutboxMessage(client, {
      messageType: 'purchase_confirmation',
      payload: { orderId: pending.orderId },
      dedupeKey: `purchase-confirmation:${pending.orderId}`,
      traceContext: currentOutboxTraceContext(),
    })
    if (!confirmation.id) throw new Error('Purchase confirmation outbox insert was not confirmed')
    const reminderAt = new Date(Date.now() + INVITATION_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000)
    for (const slotId of slots) {
      const reminder = await enqueueOutboxMessage(client, {
        messageType: 'invitation_reminder',
        payload: { slotId },
        dedupeKey: `invitation-reminder:${slotId}:${INVITATION_REMINDER_DELAY_DAYS}d`,
        traceContext: currentOutboxTraceContext(),
        scheduledAt: reminderAt,
      })
      if (!reminder.id) throw new Error('Invitation reminder outbox insert was not confirmed')
    }
    return {
      receipt: { orderId: pending.orderId, status: 'PAID', totalMinor: pending.totalMinor, currency: pending.currency },
      invitations,
      replayed: false,
    }
  })
}

export function createCheckoutService({ primary, paymentGateway, webOrigin }: CheckoutServiceOptions) {
  return {
    async checkout(rawRequest: unknown, rawIdempotencyKey: unknown): Promise<CheckoutResult> {
      const input = checkoutSchema.parse(rawRequest)
      const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey)
      const requestHash = hashCheckoutRequest(input)
      const replay = await existingCheckout(primary, idempotencyKey, requestHash)
      if (replay) return replay
      const pending = await createPendingOrder(primary, idempotencyKey, requestHash, input)
      if ('replayed' in pending) return pending

      const providerRef = `mock-${pending.orderId}-${randomUUID()}`
      // Keep payment processing outside the DB transaction; replace this adapter for any future external provider.
      let payment
      try {
        payment = await paymentGateway.charge({ orderId: pending.orderId, amountMinor: pending.totalMinor, currency: pending.currency })
      } catch {
        await withTransaction(primary, async (client) => {
          await client.query("UPDATE orders SET status = 'FAILED' WHERE id = $1", [pending.orderId])
        })
        throw new AppError('Payment could not be confirmed. Start a new checkout attempt.', 503, 'PAYMENT_UNAVAILABLE')
      }
      if (payment.status !== 'SUCCEEDED' || payment.amountMinor !== pending.totalMinor) {
        await withTransaction(primary, async (client) => {
          await client.query("UPDATE orders SET status = 'FAILED' WHERE id = $1", [pending.orderId])
          await client.query(
            "INSERT INTO payments (order_id, provider, provider_ref, status, amount_minor) VALUES ($1, $2, $3, 'FAILED', $4)",
            [pending.orderId, payment.provider, payment.providerRef || providerRef, pending.totalMinor],
          )
        })
        throw new AppError('Mock payment was not successful; no access was granted', 402, 'PAYMENT_FAILED')
      }
      return finishSuccessfulCheckout(primary, pending, payment.provider, payment.providerRef || providerRef, webOrigin)
    },
  }
}
