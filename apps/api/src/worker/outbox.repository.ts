import type { Pool, PoolClient } from 'pg'
import { sanitizeOutboxTraceContext } from './trace-context.js'

export type OutboxMessageType = 'purchase_confirmation' | 'invitation_reminder'

export interface OutboxTraceContext {
  traceparent: string
  tracestate?: string
}

export interface EnqueueOutboxInput {
  messageType: OutboxMessageType
  payload: Record<string, string>
  dedupeKey: string
  traceContext?: OutboxTraceContext | null
  scheduledAt?: Date
}

export interface OutboxMessage {
  id: string
  messageType: OutboxMessageType
  payload: Record<string, unknown>
  attemptCount: number
  traceContext: OutboxTraceContext | null
}

export async function enqueueOutboxMessage(client: PoolClient, input: EnqueueOutboxInput): Promise<{ id: string; inserted: boolean }> {
  const sanitizedTrace = sanitizeOutboxTraceContext(input.traceContext)
  const result = await client.query<{ id: string }>(
    `INSERT INTO outbox_messages (message_type, payload, dedupe_key, trace_context, scheduled_at)
     VALUES ($1, $2::jsonb, $3, $4::jsonb, COALESCE($5, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [input.messageType, JSON.stringify(input.payload), input.dedupeKey, sanitizedTrace ? JSON.stringify(sanitizedTrace) : null, input.scheduledAt ?? null],
  )
  const inserted = result.rows[0]
  if (inserted) return { id: inserted.id, inserted: true }

  const existing = await client.query<{ id: string }>('SELECT id FROM outbox_messages WHERE dedupe_key = $1', [input.dedupeKey])
  const row = existing.rows[0]
  if (!row) throw new Error('Outbox enqueue conflict was not recoverable')
  return { id: row.id, inserted: false }
}

interface ClaimedRow {
  id: string
  message_type: OutboxMessageType
  payload: Record<string, unknown>
  attempt_count: number
  trace_context: OutboxTraceContext | null
}

export async function claimOutboxMessages(
  pool: Pool,
  options: { limit: number; leaseMs?: number; now?: Date; maxAttempts?: number },
): Promise<OutboxMessage[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit)))
  const leaseMs = Math.max(1_000, Math.min(120_000, Math.trunc(options.leaseMs ?? 120_000)))
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 5))
  const now = options.now ?? new Date()
  await pool.query(
    `UPDATE outbox_messages
        SET status = 'FAILED', locked_until = NULL, last_error = 'Email delivery failed'
      WHERE status = 'PROCESSING' AND locked_until <= $1 AND attempt_count >= $2`,
    [now, maxAttempts],
  )
  const result = await pool.query<ClaimedRow>(
    `WITH candidates AS (
       SELECT id
         FROM outbox_messages
        WHERE ((status = 'PENDING' AND scheduled_at <= $1)
           OR (status = 'PROCESSING' AND locked_until <= $1))
          AND attempt_count < $4
        ORDER BY scheduled_at, created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE outbox_messages AS message
        SET status = 'PROCESSING',
            locked_until = $3,
            attempt_count = message.attempt_count + 1
       FROM candidates
      WHERE message.id = candidates.id
     RETURNING message.id, message.message_type, message.payload, message.attempt_count, message.trace_context`,
     [now, limit, new Date(now.getTime() + leaseMs), maxAttempts],
  )
  return result.rows.map((row) => ({
    id: row.id,
    messageType: row.message_type,
    payload: row.payload,
    attemptCount: row.attempt_count,
    traceContext: row.trace_context,
  }))
}

export async function markOutboxSent(pool: Pool, messageId: string, attemptCount: number): Promise<void> {
  const result = await pool.query(
    `UPDATE outbox_messages
        SET status = 'SENT', locked_until = NULL, sent_at = now(), last_error = NULL,
            payload = payload - 'deliveryTokens'
      WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $2`,
    [messageId, attemptCount],
  )
  if (result.rowCount !== 1) throw new Error('Outbox message is not leased by this worker')
}

export async function markOutboxSkipped(pool: Pool, messageId: string, attemptCount: number): Promise<void> {
  const result = await pool.query(
    `UPDATE outbox_messages
        SET status = 'SKIPPED', locked_until = NULL,
            payload = payload - 'deliveryTokens'
      WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $2`,
    [messageId, attemptCount],
  )
  if (result.rowCount !== 1) throw new Error('Outbox message is not leased by this worker')
}

export async function scheduleOutboxRetry(
  pool: Pool,
  messageId: string,
  attemptCount: number,
  scheduledAt: Date,
  maxAttempts: number,
): Promise<void> {
  // Provider diagnostics can contain addresses, invitation URLs, or credentials; persist no raw error.
  const safeError = 'Email delivery failed'
  const result = await pool.query(
    `UPDATE outbox_messages
        SET status = CASE WHEN attempt_count >= $5 THEN 'FAILED' ELSE 'PENDING' END,
            scheduled_at = $3,
            locked_until = NULL,
            last_error = $4,
            payload = CASE WHEN attempt_count >= $5 THEN payload - 'deliveryTokens' ELSE payload END
      WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $2`,
    [messageId, attemptCount, scheduledAt, safeError, maxAttempts],
  )
  if (result.rowCount !== 1) throw new Error('Outbox message is not leased by this worker')
}
