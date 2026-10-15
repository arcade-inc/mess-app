import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { AppError } from '../../platform/errors.js'
import { findUsableInvitation } from './invitation.repository.js'

export const INVITATION_LIFETIME_DAYS = 7
export const INVITATION_REMINDER_DELAY_DAYS = 7

export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function getInvitation(token: string, pool: Pool) {
  const invitation = await findUsableInvitation(pool, hashInvitationToken(token))
  if (!invitation) throw new AppError('Invitation is unavailable', 404, 'NOT_FOUND')
  return {
    valid: true as const,
    studentName: invitation.studentName,
    year: invitation.year,
    courses: invitation.courses,
  }
}
