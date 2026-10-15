import { createHash } from 'node:crypto'
import { AppError } from '../../platform/errors.js'

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) {
    throw new AppError('Idempotency-Key must contain between 1 and 255 characters', 400, 'INVALID_IDEMPOTENCY_KEY')
  }
  return value
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function hashCheckoutRequest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value))
  return createHash('sha256').update(canonical).digest('hex')
}
