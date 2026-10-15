export interface CatalogCourse {
  id: string
  subject: string
  yearMin: number
  yearMax: number
  priceMinor: number
  currency: string
}

export interface CheckoutStudentInput {
  name: string
  year: number
  courseIds: string[]
}

export interface CheckoutPayload {
  parent: { name: string; email: string; emailConfirm: string }
  students: CheckoutStudentInput[]
}

export interface CheckoutResponse {
  orderId: string
  status: 'PAID'
  totalMinor: number
  currency: string
  invitations: Array<{ studentName: string; url: string }>
}

interface ErrorResponse {
  error?: { code?: string; message?: string }
}

export class CheckoutApiError extends Error {
  readonly statusCode: number
  readonly code?: string

  constructor(message: string, statusCode: number, code?: string) {
    super(message)
    this.name = 'CheckoutApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

async function readError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => undefined) as ErrorResponse | undefined
  return new CheckoutApiError(
    body?.error?.message ?? 'The request could not be completed. Try again.',
    response.status,
    body?.error?.code,
  )
}

export async function loadCourses(apiOrigin: string, fetcher: typeof fetch = fetch): Promise<CatalogCourse[]> {
  const response = await fetcher(new URL('/api/courses', apiOrigin))
  if (!response.ok) throw await readError(response)
  const body = await response.json() as { courses: CatalogCourse[] }
  return body.courses
}

export function createCheckoutIdempotencyKey(): string {
  return globalThis.crypto.randomUUID()
}

export async function submitCheckout(
  apiOrigin: string,
  payload: CheckoutPayload,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CheckoutResponse> {
  const response = await fetcher(new URL('/api/checkout', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await readError(response)
  return await response.json() as CheckoutResponse
}
