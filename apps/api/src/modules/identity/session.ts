import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from '../../platform/config.js'

const sessionCookieName = 'session'
const sessionLifetimeSeconds = 60 * 60

export function issueStudentSession(app: FastifyInstance, reply: FastifyReply, studentId: string, config: AppConfig): void {
  const token = app.jwt.sign({ sub: studentId }, { expiresIn: sessionLifetimeSeconds })
  reply.setCookie(sessionCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.environment === 'production',
    maxAge: sessionLifetimeSeconds,
  })
}

export function clearStudentSession(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: '/' })
}

export function getStudentIdFromRequest(request: FastifyRequest): string | undefined {
  const user: unknown = request.user
  if (typeof user !== 'object' || user === null || !('sub' in user)) return undefined
  return typeof user.sub === 'string' ? user.sub : undefined
}

export function sessionCookieOptions() {
  return {
    cookieName: sessionCookieName,
    signed: false,
  }
}
