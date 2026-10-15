import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getStudentIdFromRequest } from '../identity/session.js'
import { AppError } from '../../platform/errors.js'
import type { Telemetry } from '../../platform/telemetry.js'
import { authorizeCourseLessons, authorizeLesson } from './authorization.service.js'
import { listActiveEnrollments } from './learning.repository.js'

export function registerLearningRoutes(app: FastifyInstance, primary: Pool, read: Pool, telemetry: Telemetry): void {
  app.get('/me/enrollments', async (request) => {
    const studentId = getStudentIdFromRequest(request)
    if (!studentId) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED')
    return { enrollments: await listActiveEnrollments(primary, studentId) }
  })

  app.get<{ Params: { courseId: string } }>('/courses/:courseId/lessons', async (request) => {
    const studentId = getStudentIdFromRequest(request)
    if (!studentId) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED')
    return { lessons: await authorizeCourseLessons(primary, read, telemetry, studentId, request.params.courseId) }
  })

  app.get<{ Params: { lessonId: string } }>('/lessons/:lessonId', async (request) => {
    const studentId = getStudentIdFromRequest(request)
    if (!studentId) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED')
    return authorizeLesson(primary, read, telemetry, studentId, request.params.lessonId)
  })
}
