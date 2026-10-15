import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { withTransaction } from '../../platform/database.js'
import { createInvitationToken, INVITATION_LIFETIME_DAYS } from './invitation.service.js'
import type { OutboxMessage } from '../../worker/outbox.repository.js'
import { decryptInvitationToken, encryptInvitationToken } from '../../worker/invitation-token-vault.js'

export interface InvitationDelivery {
  slotId: string
  studentName: string
  email: string
  token: string
}

type OutboxPayload = Record<string, unknown>

export async function prepareInvitationDelivery(
  pool: Pool,
  message: OutboxMessage,
  encryptionSecret: string,
): Promise<InvitationDelivery[]> {
  return withTransaction(pool, async (client) => {
    const outboxResult = await client.query<{ payload: OutboxPayload }>(
      `SELECT payload FROM outbox_messages
        WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $2
        FOR UPDATE`,
      [message.id, message.attemptCount],
    )
    const outbox = outboxResult.rows[0]
    if (!outbox) throw new Error('Outbox message is not leased by this worker')

    const storedTokens = outbox.payload.deliveryTokens
    if (storedTokens && typeof storedTokens === 'object' && !Array.isArray(storedTokens)) {
      const encryptedTokens = storedTokens as Record<string, unknown>
      const slotIds = Object.keys(encryptedTokens)
      if (slotIds.length === 0) return []
      const result = await client.query<{ id: string; student_name: string; email: string }>(
        `SELECT slot.id, slot.name AS student_name, parent.email
           FROM student_slots slot
           JOIN orders purchase ON purchase.id = slot.order_id
           JOIN parents parent ON parent.id = purchase.parent_id
          WHERE slot.id = ANY($1::uuid[]) AND purchase.status = 'PAID'
          ORDER BY slot.created_at`,
        [slotIds],
      )
      return result.rows.flatMap((row) => {
        const encryptedToken = encryptedTokens[row.id]
        if (typeof encryptedToken !== 'string') return []
        return [{
          slotId: row.id,
          studentName: row.student_name,
          email: row.email,
          token: decryptInvitationToken(encryptedToken, encryptionSecret),
        }]
      })
    }

    const candidates = message.messageType === 'purchase_confirmation'
      ? await client.query<{ slot_id: string; student_name: string; email: string }>(
        `SELECT slot.id AS slot_id, slot.name AS student_name, parent.email
           FROM student_slots slot
           JOIN orders purchase ON purchase.id = slot.order_id AND purchase.status = 'PAID'
           JOIN parents parent ON parent.id = purchase.parent_id
           JOIN invitations invitation ON invitation.slot_id = slot.id
          WHERE purchase.id = $1
            AND slot.student_id IS NULL
            AND invitation.used_at IS NULL
            AND invitation.superseded_at IS NULL
            AND EXISTS (SELECT 1 FROM enrollments WHERE slot_id = slot.id AND status = 'PENDING')
          ORDER BY slot.created_at
          FOR UPDATE OF slot, invitation`,
        [typeof message.payload.orderId === 'string' ? message.payload.orderId : ''],
      )
      : await client.query<{ slot_id: string; student_name: string; email: string }>(
        `SELECT slot.id AS slot_id, slot.name AS student_name, parent.email
           FROM student_slots slot
           JOIN orders purchase ON purchase.id = slot.order_id AND purchase.status = 'PAID'
           JOIN parents parent ON parent.id = purchase.parent_id
           JOIN invitations invitation ON invitation.slot_id = slot.id
          WHERE slot.id = $1
            AND slot.student_id IS NULL
            AND invitation.used_at IS NULL
            AND invitation.superseded_at IS NULL
            AND EXISTS (SELECT 1 FROM enrollments WHERE slot_id = slot.id AND status = 'PENDING')
          FOR UPDATE OF slot, invitation`,
        [typeof message.payload.slotId === 'string' ? message.payload.slotId : ''],
      )

    const deliveries: InvitationDelivery[] = []
    const encryptedTokens: Record<string, string> = {}
    for (const candidate of candidates.rows) {
      const token = createInvitationToken()
      const tokenHash = createHash('sha256').update(token).digest('hex')
      await client.query(
        'UPDATE invitations SET superseded_at = now() WHERE slot_id = $1 AND used_at IS NULL AND superseded_at IS NULL',
        [candidate.slot_id],
      )
      await client.query(
        "INSERT INTO invitations (slot_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 day'))",
        [candidate.slot_id, tokenHash, INVITATION_LIFETIME_DAYS],
      )
      encryptedTokens[candidate.slot_id] = encryptInvitationToken(token, encryptionSecret)
      deliveries.push({ slotId: candidate.slot_id, studentName: candidate.student_name, email: candidate.email, token })
    }

    if (deliveries.length > 0) {
      const nextPayload = { ...outbox.payload, deliveryTokens: encryptedTokens }
      await client.query('UPDATE outbox_messages SET payload = $2::jsonb WHERE id = $1 AND status = \'PROCESSING\' AND attempt_count = $3', [
        message.id,
        JSON.stringify(nextPayload),
        message.attemptCount,
      ])
    }
    return deliveries
  })
}
