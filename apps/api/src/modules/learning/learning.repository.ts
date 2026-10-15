import type { Pool } from 'pg'

export interface EnrollmentSummary {
  id: string
  status: 'ACTIVE'
  course: { id: string; subject: string }
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

export async function listActiveEnrollments(pool: Pool, studentId: string): Promise<EnrollmentSummary[]> {
  const result = await pool.query<{
    id: string
    course_id: string
    subject: string
  }>(
    `SELECT e.id, c.id AS course_id, c.subject
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.student_id = $1 AND e.status = 'ACTIVE'
     ORDER BY c.subject, e.id`,
    [studentId],
  )

  return result.rows.map((row) => ({
    id: row.id,
    status: 'ACTIVE',
    course: { id: row.course_id, subject: row.subject },
  }))
}

export async function findEnrolledCourseLessons(primary: Pool, read: Pool, studentId: string, courseId: string): Promise<LessonSummary[] | undefined> {
  const enrollment = await primary.query(
    `SELECT 1 FROM enrollments
     WHERE student_id = $1 AND course_id = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [studentId, courseId],
  )
  if (enrollment.rowCount === 0) return undefined

  const result = await read.query<{
    id: string
    course_id: string
    position: number
    title: string
  }>(
    `SELECT id, course_id, position, title
     FROM lessons
     WHERE course_id = $1
     ORDER BY position`,
    [courseId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    courseId: row.course_id,
    position: row.position,
    title: row.title,
  }))
}

export async function findEnrolledLesson(primary: Pool, read: Pool, studentId: string, lessonId: string): Promise<Lesson | undefined> {
  const entitlement = await primary.query<{ course_id: string }>(
    `SELECT l.course_id
     FROM lessons l
     JOIN enrollments e ON e.course_id = l.course_id
     WHERE l.id = $2 AND e.student_id = $1 AND e.status = 'ACTIVE'
     LIMIT 1`,
    [studentId, lessonId],
  )
  const courseId = entitlement.rows[0]?.course_id
  if (!courseId) return undefined

  const result = await read.query<{
    id: string
    course_id: string
    position: number
    title: string
    body: string
  }>(
    `SELECT id, course_id, position, title, body
     FROM lessons
     WHERE id = $1 AND course_id = $2
     LIMIT 1`,
    [lessonId, courseId],
  )
  const row = result.rows[0]
  if (!row) return undefined

  return {
    id: row.id,
    courseId: row.course_id,
    position: row.position,
    title: row.title,
    body: row.body,
  }
}
