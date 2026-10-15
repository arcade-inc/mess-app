import type { Pool } from 'pg'

export interface CourseRecord {
  id: string
  subject: string
  yearMin: number
  yearMax: number
  priceMinor: number
  currency: string
}

export interface LessonRecord {
  id: string
  courseId: string
  position: number
  title: string
  body?: string
}

export async function listCourses(pool: Pool): Promise<CourseRecord[]> {
  const result = await pool.query<{
    id: string
    subject: string
    year_min: number
    year_max: number
    price_minor: number
    currency: string
  }>(`SELECT id, subject, year_min, year_max, price_minor, currency
        FROM courses
       ORDER BY subject`)
  return result.rows.map((course) => ({
    id: course.id,
    subject: course.subject,
    yearMin: course.year_min,
    yearMax: course.year_max,
    priceMinor: course.price_minor,
    currency: course.currency.trim(),
  }))
}

export async function findCoursesByIds(pool: Pool, ids: string[]): Promise<CourseRecord[]> {
  if (ids.length === 0) return []
  const result = await pool.query<{
    id: string
    subject: string
    year_min: number
    year_max: number
    price_minor: number
    currency: string
  }>(`SELECT id, subject, year_min, year_max, price_minor, currency
        FROM courses
       WHERE id = ANY($1::uuid[])
       ORDER BY subject`, [ids])
  return result.rows.map((course) => ({
    id: course.id,
    subject: course.subject,
    yearMin: course.year_min,
    yearMax: course.year_max,
    priceMinor: course.price_minor,
    currency: course.currency.trim(),
  }))
}

export async function listLessons(pool: Pool, courseId: string): Promise<LessonRecord[]> {
  const result = await pool.query<{ id: string; course_id: string; position: number; title: string }>(
    `SELECT id, course_id, position, title
       FROM lessons
      WHERE course_id = $1
      ORDER BY position`,
    [courseId],
  )
  return result.rows.map((lesson) => ({
    id: lesson.id,
    courseId: lesson.course_id,
    position: lesson.position,
    title: lesson.title,
  }))
}

export async function getLesson(pool: Pool, lessonId: string): Promise<LessonRecord | undefined> {
  const result = await pool.query<{ id: string; course_id: string; position: number; title: string; body: string }>(
    'SELECT id, course_id, position, title, body FROM lessons WHERE id = $1',
    [lessonId],
  )
  const lesson = result.rows[0]
  return lesson ? {
    id: lesson.id,
    courseId: lesson.course_id,
    position: lesson.position,
    title: lesson.title,
    body: lesson.body,
  } : undefined
}
