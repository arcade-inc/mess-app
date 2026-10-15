import { clearAuthenticatedSessionHint, fetchApi, hasAuthenticatedSessionHint, setAuthenticatedSessionHint } from './auth-state.js'

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

export interface DeclinedCourse {
  id: string
  subject: string
}

export interface InvitationClaimResult {
  student: StudentSummary
  declinedCourses: DeclinedCourse[]
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
  const response = await fetchApi(new Request(new URL(`/api/invitations/${encodeURIComponent(token)}`, apiOrigin)), undefined, fetcher)
  if (!response.ok) return throwResponseError(response)
  return await response.json() as InvitationPreview
}

export async function redeemInvitation(
  apiOrigin: string,
  token: string,
  credentials: Credentials,
  fetcher: typeof fetch = fetch,
): Promise<StudentSummary> {
  const response = await fetchApi(new Request(new URL(`/api/invitations/${encodeURIComponent(token)}`, apiOrigin), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  }), undefined, fetcher)
  if (!response.ok) return throwResponseError(response)
  const result = await response.json() as { student: StudentSummary }
  setAuthenticatedSessionHint()
  return result.student
}

export async function claimInvitation(
  apiOrigin: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<InvitationClaimResult> {
  const response = await fetchApi(new URL(`/api/invitations/${encodeURIComponent(token)}/claim`, apiOrigin), {
    method: 'POST',
    credentials: 'include',
  }, fetcher)
  if (!response.ok) return throwResponseError(response)
  const result = await response.json() as { student: StudentSummary; declinedCourses?: DeclinedCourse[] }
  setAuthenticatedSessionHint()
  return { student: result.student, declinedCourses: result.declinedCourses ?? [] }
}

export async function login(apiOrigin: string, credentials: Credentials, fetcher: typeof fetch = fetch): Promise<StudentSummary> {
  const response = await fetchApi(new URL('/api/auth/login', apiOrigin), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  }, fetcher)
  if (!response.ok) return throwResponseError(response)
  const result = await response.json() as { student: StudentSummary }
  setAuthenticatedSessionHint()
  return result.student
}

export async function getCurrentStudent(
  apiOrigin: string,
  fetcher: typeof fetch = fetch,
  options: { forceServerCheck?: boolean } = {},
): Promise<StudentSummary | null> {
  if (!options.forceServerCheck && !hasAuthenticatedSessionHint()) return null
  const response = await fetchApi(new URL('/api/me', apiOrigin), { credentials: 'include' }, fetcher)
  if (response.status === 401) return null
  if (!response.ok) return throwResponseError(response)
  const student = await response.json() as StudentSummary
  setAuthenticatedSessionHint()
  return student
}

export async function logout(apiOrigin: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetchApi(new URL('/api/auth/logout', apiOrigin), { method: 'POST', credentials: 'include' }, fetcher)
  if (!response.ok) return throwResponseError(response)
  clearAuthenticatedSessionHint()
}
