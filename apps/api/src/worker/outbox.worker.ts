import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import type { Pool } from 'pg'
import { prepareInvitationDelivery } from '../modules/identity/invitation-rotation.repository.js'
import type { EmailSender } from './email-sender.js'
import { extractOutboxTraceContext, linksForRetry } from './trace-context.js'
import {
  claimOutboxMessages,
  markOutboxSent,
  markOutboxSkipped,
  scheduleOutboxRetry,
  type OutboxMessage,
} from './outbox.repository.js'

export { currentOutboxTraceContext, extractOutboxTraceContext, linksForRetry, sanitizeOutboxTraceContext } from './trace-context.js'

async function sendPurchaseConfirmation(pool: Pool, sender: EmailSender, message: OutboxMessage, webOrigin: string, encryptionSecret: string): Promise<boolean> {
  const orderId = message.payload.orderId
  if (typeof orderId !== 'string') return false
  const result = await pool.query<{ email: string }>(
    `SELECT parent.email
       FROM orders purchase
       JOIN parents parent ON parent.id = purchase.parent_id
      WHERE purchase.id = $1 AND purchase.status = 'PAID'`,
    [orderId],
  )
  const email = result.rows[0]?.email
  if (!email) return false
  const invitations = await prepareInvitationDelivery(pool, message, encryptionSecret)
  if (invitations.length === 0) return false
  await sender.send({
    to: email,
    subject: 'Your MES purchase is confirmed',
    text: `Your MES mock checkout is confirmed. Use the invitation link(s) below to complete learner setup:\n\n${invitations
      .map(({ studentName, token }) => `${studentName}: ${new URL(`/invite/${token}`, webOrigin).toString()}`)
      .join('\n')}`,
    idempotencyKey: message.id,
  })
  return true
}

async function sendInvitationReminder(pool: Pool, sender: EmailSender, webOrigin: string, message: OutboxMessage, encryptionSecret: string): Promise<boolean> {
  const invitations = await prepareInvitationDelivery(pool, message, encryptionSecret)
  const invitation = invitations[0]
  if (!invitation) return false
  const url = new URL(`/invite/${invitation.token}`, webOrigin).toString()
  await sender.send({
    to: invitation.email,
    subject: `Reminder: invitation for ${invitation.studentName}`,
    text: `Complete learner setup using your new invitation: ${url}`,
    idempotencyKey: message.id,
  })
  return true
}

export interface OutboxWorkerOptions {
  pool: Pool
  emailSender: EmailSender
  webOrigin: string
  encryptionSecret: string
  batchSize?: number
  maxAttempts?: number
  baseRetryMs?: number
}

export function createOutboxWorker({ pool, emailSender, webOrigin, encryptionSecret, batchSize = 10, maxAttempts = 5, baseRetryMs = 1_000 }: OutboxWorkerOptions) {
  const tracer = trace.getTracer('mes-outbox-worker')

  async function process(message: OutboxMessage): Promise<void> {
    const parentContext = extractOutboxTraceContext(message.traceContext)
    const spanOptions = message.attemptCount > 1 ? { links: linksForRetry(message.traceContext) } : {}
    const activeContext = message.attemptCount > 1 ? ROOT_CONTEXT : parentContext
    await context.with(activeContext, () => tracer.startActiveSpan(`outbox.${message.messageType}`, spanOptions, async (span) => {
      try {
        if (emailSender.enabled === false) {
          await markOutboxSkipped(pool, message.id, message.attemptCount)
          return
        }
        const delivered = message.messageType === 'purchase_confirmation'
          ? await sendPurchaseConfirmation(pool, emailSender, message, webOrigin, encryptionSecret)
          : await sendInvitationReminder(pool, emailSender, webOrigin, message, encryptionSecret)
        if (delivered) await markOutboxSent(pool, message.id, message.attemptCount)
        else await markOutboxSkipped(pool, message.id, message.attemptCount)
      } catch {
        const retryDelay = Math.min(15 * 60_000, baseRetryMs * (2 ** Math.max(0, message.attemptCount - 1)))
        await scheduleOutboxRetry(pool, message.id, message.attemptCount, new Date(Date.now() + retryDelay), maxAttempts)
        span.recordException(new Error('Email delivery failed'))
      } finally {
        span.end()
      }
    }))
  }

  async function runOnce(): Promise<number> {
      const messages = await claimOutboxMessages(pool, { limit: batchSize, maxAttempts })
    for (const message of messages) await process(message)
    return messages.length
  }

  async function sleepOrAbort(signal: AbortSignal, pollIntervalMs: number): Promise<void> {
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, pollIntervalMs)
      signal.addEventListener('abort', finish, { once: true })
    })
  }

  return {
    runOnce,
    async run(signal: AbortSignal, pollIntervalMs = 1_000): Promise<void> {
      while (!signal.aborted) {
        const count = await runOnce()
        if (count === 0) await sleepOrAbort(signal, pollIntervalMs)
      }
    },
  }
}
