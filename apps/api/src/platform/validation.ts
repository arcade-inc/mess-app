import type { ZodType } from 'zod'
import { AppError } from './errors.js'

export function parseRequest<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new AppError('Request validation failed', 400, 'INVALID_REQUEST')
  return result.data
}
