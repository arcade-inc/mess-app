import assert from 'node:assert/strict'
import test from 'node:test'
import { getCourseLessons, getLesson, getMyEnrollments } from '../src/api/learning.js'

test('learning reads send cookie credentials and use server-owned identity routes', async () => {
  const urls: string[] = []
  const fetcher = (async (input, init) => {
    urls.push(String(input))
    assert.equal(init?.credentials, 'include')
    if (String(input).endsWith('/me/enrollments')) {
      return Response.json({ enrollments: [{ id: 'enrollment-1', status: 'ACTIVE', course: { id: 'course-1', subject: 'Maths' } }] })
    }
    if (String(input).endsWith('/courses/course-1/lessons')) {
      return Response.json({ lessons: [{ id: 'lesson-1', courseId: 'course-1', position: 1, title: 'Fractions' }] })
    }
    if (String(input).endsWith('/lessons/lesson-1')) {
      return Response.json({ id: 'lesson-1', courseId: 'course-1', position: 1, title: 'Fractions', body: 'A fraction is part of a whole.' })
    }
    throw new Error('Unexpected URL')
  }) as typeof fetch

  assert.equal((await getMyEnrollments('https://api.example', fetcher))[0]?.course.subject, 'Maths')
  assert.equal((await getCourseLessons('https://api.example', 'course-1', fetcher))[0]?.title, 'Fractions')
  assert.equal((await getLesson('https://api.example', 'lesson-1', fetcher)).body, 'A fraction is part of a whole.')
  assert.deepEqual(urls, [
    'https://api.example/api/me/enrollments',
    'https://api.example/api/courses/course-1/lessons',
    'https://api.example/api/lessons/lesson-1',
  ])
})
