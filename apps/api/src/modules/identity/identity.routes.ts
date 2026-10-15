import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getStudentIdFromRequest, issueStudentSession, clearStudentSession } from './session.js'
import { authenticateStudent, getStudentProfile, redeemInvitation } from './onboarding.service.js'
import { getInvitation } from './invitation.service.js'
import type { AppConfig } from '../../platform/config.js'
import type { Telemetry } from '../../platform/telemetry.js'
import { AppError } from '../../platform/errors.js'

export interface IdentityRouteOptions {
  database: Pool
  config: AppConfig
  telemetry: Telemetry
}

export function registerIdentityRoutes(app: FastifyInstance, { database, config, telemetry }: IdentityRouteOptions): void {
  app.get<{ Params: { token: string } }>('/invitations/:token', { config: { public: true } }, async (request) => {
    return getInvitation(request.params.token, database)
  })

  app.post<{ Params: { token: string } }>('/invitations/:token', { config: { public: true } }, async (request, reply) => {
    try {
      const student = await redeemInvitation(database, request.params.token, request.body)
      issueStudentSession(app, reply, student.id, config)
      telemetry.recordBusinessEvent('invitation.redeemed')
      return reply.code(200).send({ student })
    } catch (error) {
      telemetry.recordBusinessEvent('activation.failed')
      throw error
    }
  })

  app.post('/auth/login', { config: { public: true } }, async (request, reply) => {
    const student = await authenticateStudent(database, request.body)
    issueStudentSession(app, reply, student.id, config)
    return reply.code(200).send({ student })
  })

  app.post('/auth/logout', async (_request, reply) => {
    clearStudentSession(reply)
    return reply.code(204).send()
  })

  app.get('/me', async (request) => {
    const studentId = getStudentIdFromRequest(request)
    if (!studentId) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED')
    return getStudentProfile(database, studentId)
  })
}
