export interface CourseSummary {
  id: string
  subject: string
}

export interface EnrollmentSummary {
  id: string
  status: 'ACTIVE'
  course: CourseSummary
}

export interface LessonSummary {
  id: string
  courseId: string
  position: number
  title: string
}

export interface Lesson extends LessonSummary {
  body: string
}

interface ErrorResponse {
  error?: { message?: string }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as ErrorResponse | undefined
    throw new Error(body?.error?.message ?? 'The request could not be completed. Try again.')
  }
  return await response.json() as T
}

export async function getMyEnrollments(apiOrigin: string, fetcher: typeof fetch = fetch): Promise<EnrollmentSummary[]> {
  const response = await fetcher(new URL('/api/me/enrollments', apiOrigin), { credentials: 'include' })
  return (await readJson<{ enrollments: EnrollmentSummary[] }>(response)).enrollments
}

export async function getCourseLessons(apiOrigin: string, courseId: string, fetcher: typeof fetch = fetch): Promise<LessonSummary[]> {
  const response = await fetcher(new URL(`/api/courses/${encodeURIComponent(courseId)}/lessons`, apiOrigin), { credentials: 'include' })
  return (await readJson<{ lessons: LessonSummary[] }>(response)).lessons
}

export async function getLesson(apiOrigin: string, lessonId: string, fetcher: typeof fetch = fetch): Promise<Lesson> {
  const response = await fetcher(new URL(`/api/lessons/${encodeURIComponent(lessonId)}`, apiOrigin), { credentials: 'include' })
  return readJson<Lesson>(response)
}
