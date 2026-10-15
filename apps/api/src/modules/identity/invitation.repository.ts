import type { Pool, PoolClient } from 'pg'

export interface InvitationDetails {
  id: string
  slotId: string
  studentName: string
  year: number
  expiresAt: Date
  courses: Array<{ id: string; subject: string }>
}

export async function findUsableInvitation(pool: Pool, tokenHash: string): Promise<InvitationDetails | undefined> {
  const result = await pool.query<{
    invitation_id: string
    slot_id: string
    student_name: string
    year: number
    expires_at: Date
    course_id: string
    subject: string
  }>(
    `SELECT invitation.id AS invitation_id, slot.id AS slot_id, slot.name AS student_name,
            slot.year, invitation.expires_at, course.id AS course_id, course.subject
       FROM invitations invitation
       JOIN student_slots slot ON slot.id = invitation.slot_id
       JOIN orders purchase ON purchase.id = slot.order_id AND purchase.status = 'PAID'
       JOIN enrollments enrollment ON enrollment.slot_id = slot.id AND enrollment.status = 'PENDING'
       JOIN courses course ON course.id = enrollment.course_id
      WHERE invitation.token_hash = $1
        AND invitation.used_at IS NULL
        AND invitation.superseded_at IS NULL
        AND invitation.expires_at > now()
        AND slot.student_id IS NULL
      ORDER BY course.subject`,
    [tokenHash],
  )
  const first = result.rows[0]
  if (!first) return undefined
  return {
    id: first.invitation_id,
    slotId: first.slot_id,
    studentName: first.student_name,
    year: first.year,
    expiresAt: first.expires_at,
    courses: result.rows.map((row) => ({ id: row.course_id, subject: row.subject })),
  }
}

export async function lockInvitationForRedemption(client: PoolClient, tokenHash: string): Promise<InvitationDetails | undefined> {
  const result = await client.query<{
    id: string
    slot_id: string
    student_name: string
    year: number
    expires_at: Date
  }>(
    `SELECT invitation.id, slot.id AS slot_id, slot.name AS student_name, slot.year, invitation.expires_at
       FROM invitations invitation
       JOIN student_slots slot ON slot.id = invitation.slot_id
       JOIN orders purchase ON purchase.id = slot.order_id AND purchase.status = 'PAID'
      WHERE invitation.token_hash = $1
        AND invitation.used_at IS NULL
        AND invitation.superseded_at IS NULL
        AND invitation.expires_at > now()
        AND slot.student_id IS NULL
      FOR UPDATE OF invitation, slot`,
    [tokenHash],
  )
  const invitation = result.rows[0]
  if (!invitation) return undefined
  const courses = await client.query<{ id: string; subject: string }>(
    `SELECT course.id, course.subject
       FROM enrollments enrollment
       JOIN courses course ON course.id = enrollment.course_id
      WHERE enrollment.slot_id = $1 AND enrollment.status = 'PENDING'
      ORDER BY course.subject`,
    [invitation.slot_id],
  )
  if (courses.rowCount === 0) return undefined
  return {
    id: invitation.id,
    slotId: invitation.slot_id,
    studentName: invitation.student_name,
    year: invitation.year,
    expiresAt: invitation.expires_at,
    courses: courses.rows,
  }
}

export async function claimInvitation(client: PoolClient, invitationId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE invitations
        SET used_at = now()
      WHERE id = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now()`,
    [invitationId],
  )
  return result.rowCount === 1
}
