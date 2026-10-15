const AUTH_HINT_KEY = 'mes.authenticated'

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function hasAuthenticatedSessionHint(): boolean {
  try {
    return browserStorage()?.getItem(AUTH_HINT_KEY) === 'true'
  } catch {
    return false
  }
}

export function setAuthenticatedSessionHint(): void {
  try {
    browserStorage()?.setItem(AUTH_HINT_KEY, 'true')
  } catch {
    // Storage is only a UI hint; API authorization remains server-enforced.
  }
}

export function clearAuthenticatedSessionHint(): void {
  try {
    browserStorage()?.removeItem(AUTH_HINT_KEY)
  } catch {
    // Storage is only a UI hint; API authorization remains server-enforced.
  }
}

export async function fetchApi(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetcher(input, init)
  if (response.status === 401) clearAuthenticatedSessionHint()
  return response
}
