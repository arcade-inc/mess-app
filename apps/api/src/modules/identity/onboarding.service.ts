import type { Pool } from 'pg'
import { z } from 'zod'
import { withTransaction } from '../../platform/database.js'
import { AppError } from '../../platform/errors.js'
import { claimInvitation, lockInvitationForRedemption } from './invitation.repository.js'
import { hashInvitationToken } from './invitation.service.js'
import { hashPassword, verifyPassword } from './password.js'

const redemptionSchema = z.object({
  email: z.string().trim().email().max(320).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
})

export interface StudentProfile {
  id: string
  name: string
  email: string
  year: number
}

export async function redeemInvitation(pool: Pool, token: string, rawInput: unknown): Promise<StudentProfile> {
  const { email, password } = redemptionSchema.parse(rawInput)
  const passwordHash = await hashPassword(password)

  try {
    return await withTransaction(pool, async (client) => {
      const invitation = await lockInvitationForRedemption(client, hashInvitationToken(token))
      if (!invitation) throw new AppError('Invitation is unavailable', 404, 'NOT_FOUND')

      const existing = await client.query('SELECT 1 FROM students WHERE lower(email) = $1', [email])
      if (existing.rowCount) throw new AppError('An account with this email already exists. Sign in instead.', 409, 'ACCOUNT_EXISTS')
      if (!await claimInvitation(client, invitation.id)) throw new AppError('Invitation is unavailable', 404, 'NOT_FOUND')

      const created = await client.query<StudentProfile>(
        'INSERT INTO students (email, name, year, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, year',
        [email, invitation.studentName, invitation.year, passwordHash],
      )
      const student = created.rows[0]!
      const linked = await client.query('UPDATE student_slots SET student_id = $1 WHERE id = $2 AND student_id IS NULL', [student.id, invitation.slotId])
      if (linked.rowCount !== 1) throw new AppError('Invitation is unavailable', 404, 'NOT_FOUND')
      const activated = await client.query(
        `UPDATE enrollments
            SET status = 'ACTIVE', student_id = $1, activated_at = now()
          WHERE slot_id = $2 AND status = 'PENDING'`,
        [student.id, invitation.slotId],
      )
      if (activated.rowCount !== invitation.courses.length) throw new AppError('Purchased access could not be activated', 409, 'ACTIVATION_CONFLICT')
      return student
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new AppError('An account with this email already exists. Sign in instead.', 409, 'ACCOUNT_EXISTS')
    }
    throw error
  }
}

const loginSchema = z.object({
  email: z.string().trim().email().max(320).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
})

export async function authenticateStudent(pool: Pool, rawInput: unknown): Promise<StudentProfile> {
  const { email, password } = loginSchema.parse(rawInput)
  const result = await pool.query<StudentProfile & { password_hash: string }>(
    'SELECT id, name, email, year, password_hash FROM students WHERE lower(email) = $1',
    [email],
  )
  const student = result.rows[0]
  if (!student || !await verifyPassword(password, student.password_hash)) {
    throw new AppError('Email or password is incorrect', 401, 'INVALID_CREDENTIALS')
  }
  return { id: student.id, name: student.name, email: student.email, year: student.year }
}

export async function getStudentProfile(pool: Pool, studentId: string): Promise<StudentProfile> {
  const result = await pool.query<StudentProfile>('SELECT id, name, email, year FROM students WHERE id = $1', [studentId])
  const student = result.rows[0]
  if (!student) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED')
  return student
}
