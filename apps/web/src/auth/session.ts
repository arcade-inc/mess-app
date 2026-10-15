import { getCurrentStudent, logout, type StudentSummary } from '../api/identity.js'

export async function readSession(apiOrigin: string): Promise<StudentSummary | null> {
  return getCurrentStudent(apiOrigin)
}

export async function endSession(apiOrigin: string): Promise<void> {
  await logout(apiOrigin)
}
