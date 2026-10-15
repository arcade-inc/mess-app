import type { Pool } from 'pg'
import { AppError } from '../../platform/errors.js'
import type { Telemetry } from '../../platform/telemetry.js'
import { findEnrolledCourseLessons, findEnrolledLesson } from './learning.repository.js'

export async function authorizeCourseLessons(primary: Pool, read: Pool, telemetry: Telemetry, studentId: string, courseId: string) {
  const lessons = await findEnrolledCourseLessons(primary, read, studentId, courseId)
  if (lessons === undefined) {
    telemetry.recordBusinessEvent('lesson_access.denied')
    throw new AppError('Resource not found', 404, 'NOT_FOUND')
  }
  return lessons
}

export async function authorizeLesson(primary: Pool, read: Pool, telemetry: Telemetry, studentId: string, lessonId: string) {
  const lesson = await findEnrolledLesson(primary, read, studentId, lessonId)
  if (!lesson) {
    telemetry.recordBusinessEvent('lesson_access.denied')
    throw new AppError('Resource not found', 404, 'NOT_FOUND')
  }
  return lesson
}
