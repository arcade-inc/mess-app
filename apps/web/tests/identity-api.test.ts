import assert from 'node:assert/strict'
import test from 'node:test'
import { getInvitation, redeemInvitation, login, getCurrentStudent, logout } from '../src/api/identity.js'

test('reads invitation preview without exposing its token in returned data', async () => {
  let url = ''
  const preview = await getInvitation('https://api.example', 'opaque-token', (async (input) => {
    url = input instanceof Request ? input.url : String(input)
    return Response.json({ valid: true, studentName: 'Learner', year: 8, courses: [{ id: 'course-1', subject: 'Maths' }] })
  }) as typeof fetch)
  assert.equal(url, 'https://api.example/api/invitations/opaque-token')
  assert.deepEqual(preview.courses.map((course) => course.subject), ['Maths'])
})

test('redeems invitations with credentials included and returns only the student summary', async () => {
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
})

test('login, session lookup, and logout use cookie credentials without exposing them to JavaScript', async () => {
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
})

test('login API error remains safe and carries the server error code', async () => {
  await assert.rejects(
    login('https://api.example', { email: 'bad@example.com', password: 'wrong password' }, (async () => Response.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, { status: 401 })) as typeof fetch),
    (error: unknown) => error instanceof Error && error.message === 'Email or password is incorrect' && 'code' in error && error.code === 'INVALID_CREDENTIALS',
  )
})
