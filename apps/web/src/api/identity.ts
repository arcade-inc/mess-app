export interface StudentSummary {
  id: string
  name: string
  email: string
  year: number
}

export interface InvitationPreview {
  valid: true
  studentName: string
  year: number
  courses: Array<{ id: string; subject: string }>
}

export interface Credentials {
  email: string
  password: string
}

interface ErrorResponse {
  error?: { code?: string; message?: string }
}

export class IdentityApiError extends Error {
  readonly statusCode: number
  readonly code?: string

  constructor(message: string, statusCode: number, code?: string) {
    super(message)
    this.name = 'IdentityApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

async function throwResponseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => undefined) as ErrorResponse | undefined
  throw new IdentityApiError(body?.error?.message ?? 'The request could not be completed. Try again.', response.status, body?.error?.code)
}

export async function getInvitation(apiOrigin: string, token: string, fetcher: typeof fetch = fetch): Promise<InvitationPreview> {
  const response = await fetcher(new Request(new URL(`/api/invitations/${encodeURIComponent(token)}`, apiOrigin)))
  if (!response.ok) return throwResponseError(response)
  return await response.json() as InvitationPreview
}

export async function redeemInvitation(
  apiOrigin: string,
  token: string,
  credentials: Credentials,
  fetcher: typeof fetch = fetch,
): Promise<StudentSummary> {
  const response = await fetcher(new Request(new URL(`/api/invitations/${encodeURIComponent(token)}`, apiOrigin), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  }))
  if (!response.ok) return throwResponseError(response)
  const result = await response.json() as { student: StudentSummary }
  return result.student
}

export async function login(apiOrigin: string, credentials: Credentials, fetcher: typeof fetch = fetch): Promise<StudentSummary> {
  const response = await fetcher(new URL('/api/auth/login', apiOrigin), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  if (!response.ok) return throwResponseError(response)
  const result = await response.json() as { student: StudentSummary }
  return result.student
}

export async function getCurrentStudent(apiOrigin: string, fetcher: typeof fetch = fetch): Promise<StudentSummary | null> {
  const response = await fetcher(new URL('/api/me', apiOrigin), { credentials: 'include' })
  if (response.status === 401) return null
  if (!response.ok) return throwResponseError(response)
  return await response.json() as StudentSummary
}

export async function logout(apiOrigin: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(new URL('/api/auth/logout', apiOrigin), { method: 'POST', credentials: 'include' })
  if (!response.ok) return throwResponseError(response)
}
