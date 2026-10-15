import assert from 'node:assert/strict'
import test from 'node:test'
import { getInvitation, redeemInvitation, claimInvitation, login, getCurrentStudent, logout, IdentityApiError } from '../src/api/identity.js'

async function withLocalStorage<T>(run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    return await run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

test('reads invitation preview without exposing its token in returned data', async () => {
  let url = ''
  const preview = await getInvitation('https://api.example', 'opaque-token', (async (input) => {
    url = input instanceof Request ? input.url : String(input)
    return Response.json({ valid: true, studentName: 'Learner', year: 8, courses: [{ id: 'course-1', subject: 'Maths' }] })
  }) as typeof fetch)
  assert.equal(url, 'https://api.example/api/invitations/opaque-token')
  assert.deepEqual(preview.courses.map((course) => course.subject), ['Maths'])
})

test('redeems invitations with credentials included and stores the authenticated-session hint', async () => withLocalStorage(async () => {
  let init: RequestInit | undefined
  const student = { id: 'student-1', name: 'Learner', email: 'learner@example.com', year: 8 }
  const result = await redeemInvitation('https://api.example', 'opaque-token', { email: student.email, password: 'secure password 123' }, (async (_input, request) => {
    const input = _input
    init = input instanceof Request
      ? { method: input.method, credentials: input.credentials, body: await input.clone().text() }
      : request
    return Response.json({ student }, { status: 200 })
  }) as typeof fetch)
  assert.equal(init?.credentials, 'include')
  assert.equal(init?.method, 'POST')
  assert.deepEqual(result, student)
  assert.equal(localStorage.getItem('mes.authenticated'), 'true')
}))

test('claims an invitation using the URL token and authenticated cookie credentials', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  const student = { id: 'student-1', name: 'Learner', email: 'learner@example.com', year: 8 }
  const declinedCourses = [{ id: 'course-1', subject: 'Maths' }]
  const result = await claimInvitation('https://api.example', 'opaque-token', (async (input, init) => {
    requestUrl = String(input)
    requestInit = init
    return Response.json({ student, declinedCourses })
  }) as typeof fetch)

  assert.equal(requestUrl, 'https://api.example/api/invitations/opaque-token/claim')
  assert.equal(requestInit?.method, 'POST')
  assert.equal(requestInit?.credentials, 'include')
  assert.deepEqual(result, { student, declinedCourses })
})

test('claim mismatch preserves the server message and error code', async () => {
  await assert.rejects(
    claimInvitation('https://api.example', 'opaque-token', (async () => Response.json({
      error: { code: 'INVITATION_LEARNER_MISMATCH', message: 'This course belongs to another learner.' },
    }, { status: 409 })) as typeof fetch),
    (error: unknown) => error instanceof IdentityApiError
      && error.statusCode === 409
      && error.code === 'INVITATION_LEARNER_MISMATCH'
      && error.message === 'This course belongs to another learner.',
  )
})

test('login, session lookup, and logout use cookie credentials without exposing them to JavaScript', async () => withLocalStorage(async () => {
  const student = { id: 'student-1', name: 'Learner', email: 'learner@example.com', year: 8 }
  let calls = 0
  const fetcher = (async (input, init) => {
    calls++
    assert.equal(init?.credentials, 'include')
    if (String(input).endsWith('/auth/login')) return Response.json({ student }, { status: 200 })
    if (String(input).endsWith('/me')) return Response.json(student)
    if (String(input).endsWith('/auth/logout')) return new Response(null, { status: 204 })
    throw new Error('Unexpected URL')
  }) as typeof fetch
  assert.deepEqual(await login('https://api.example', { email: student.email, password: 'secure password 123' }, fetcher), student)
  assert.deepEqual(await getCurrentStudent('https://api.example', fetcher), student)
  await logout('https://api.example', fetcher)
  assert.equal(calls, 3)
}))

test('skips the session API request when no authenticated-session hint is stored', async () => withLocalStorage(async () => {
  let calls = 0
  const student = await getCurrentStudent('https://api.example', (async () => {
    calls++
    return Response.json({ error: { message: 'Authentication is required' } }, { status: 401 })
  }) as typeof fetch)

  assert.equal(student, null)
  assert.equal(calls, 0)
}))

test('checks the server for a learner session when explicitly requested without a local hint', async () => withLocalStorage(async () => {
  const student = { id: 'student-1', name: 'Learner', email: 'learner@example.com', year: 8 }
  let requestUrl = ''
  let requestCredentials: RequestCredentials | undefined
  const result = await getCurrentStudent('https://api.example', (async (input, init) => {
    requestUrl = String(input)
    requestCredentials = init?.credentials
    return Response.json(student)
  }) as typeof fetch, { forceServerCheck: true })

  assert.equal(requestUrl, 'https://api.example/api/me')
  assert.equal(requestCredentials, 'include')
  assert.deepEqual(result, student)
  assert.equal(localStorage.getItem('mes.authenticated'), 'true')
}))

test('a forced learner session check returns null for an unauthenticated server response', async () => withLocalStorage(async () => {
  let calls = 0
  const result = await getCurrentStudent('https://api.example', (async () => {
    calls++
    return Response.json({ error: { message: 'Authentication is required' } }, { status: 401 })
  }) as typeof fetch, { forceServerCheck: true })

  assert.equal(calls, 1)
  assert.equal(result, null)
}))

test('a forced learner session check reports unexpected server errors', async () => withLocalStorage(async () => {
  await assert.rejects(
    getCurrentStudent('https://api.example', (async () => Response.json(
      { error: { message: 'Session service unavailable' } },
      { status: 503 },
    )) as typeof fetch, { forceServerCheck: true }),
    (error: unknown) => error instanceof IdentityApiError
      && error.statusCode === 503
      && error.message === 'Session service unavailable',
  )
}))

test('successful login stores an auth hint and a 401 clears it', async () => withLocalStorage(async () => {
  const student = { id: 'student-1', name: 'Learner', email: 'learner@example.com', year: 8 }
  const loginFetcher = (async () => Response.json({ student })) as typeof fetch
  await login('https://api.example', { email: student.email, password: 'secure password 123' }, loginFetcher)
  assert.equal(localStorage.getItem('mes.authenticated'), 'true')

  await getCurrentStudent('https://api.example', (async () => Response.json(
    { error: { message: 'Authentication is required' } },
    { status: 401 },
  )) as typeof fetch)
  assert.equal(localStorage.getItem('mes.authenticated'), null)
}))

test('successful logout removes the auth hint', async () => withLocalStorage(async () => {
  localStorage.setItem('mes.authenticated', 'true')
  await logout('https://api.example', (async () => new Response(null, { status: 204 })) as typeof fetch)
  assert.equal(localStorage.getItem('mes.authenticated'), null)
}))

test('login API error remains safe and carries the server error code', async () => {
  await assert.rejects(
    login('https://api.example', { email: 'bad@example.com', password: 'wrong password' }, (async () => Response.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, { status: 401 })) as typeof fetch),
    (error: unknown) => error instanceof Error && error.message === 'Email or password is incorrect' && 'code' in error && error.code === 'INVALID_CREDENTIALS',
  )
})
