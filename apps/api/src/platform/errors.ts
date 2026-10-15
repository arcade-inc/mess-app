import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Request validation failed', requestId: request.id } })
    }

    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500
    const code = error instanceof AppError
      ? error.code
      : statusCode === 429
        ? 'RATE_LIMITED'
        : statusCode >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR'
    const message = statusCode >= 500
      ? 'An unexpected error occurred'
      : statusCode === 429
        ? 'Too many requests; retry after the rate limit resets'
        : error instanceof AppError
          ? error.message
          : 'The request could not be processed'

    if (statusCode >= 500) request.log.error({ err: error }, 'Request failed')
    return reply.code(statusCode).send({ error: { code, message, requestId: request.id } })
  })
}
