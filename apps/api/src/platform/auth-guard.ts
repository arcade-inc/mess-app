import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getStudentIdFromRequest } from '../modules/identity/session.js'

const publicRoutes = new Set([
  'GET /health',
  'GET /ready',
  'GET /courses',
  'POST /checkout',
  'GET /invitations/:token',
  'POST /invitations/:token',
  'POST /auth/login',
])

function isPublicRoute(request: FastifyRequest): boolean {
  if (request.routeOptions.config.public === true) return true
  return publicRoutes.has(`${request.method} ${request.routeOptions.url ?? ''}`)
}

export function registerAuthGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    if (isPublicRoute(request)) return
  if (getStudentIdFromRequest(request)) return
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required', requestId: request.id },
    })
  })
}
