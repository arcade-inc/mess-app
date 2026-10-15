import type { Pool } from 'pg'
import { AppError } from '../../platform/errors.js'
import { findCoursesByIds, listCourses, type CourseRecord } from './catalog.repository.js'

export async function getCatalog(readPool: Pool): Promise<CourseRecord[]> {
  return listCourses(readPool)
}

export async function getEligibleCourses(pool: Pool, courseIds: string[], schoolYear: number): Promise<CourseRecord[]> {
  const courses = await findCoursesByIds(pool, courseIds)
  if (courses.length !== new Set(courseIds).size) {
    throw new AppError('One or more selected courses are unavailable', 422, 'COURSE_UNAVAILABLE')
  }
  const ineligible = courses.some((course) => schoolYear < course.yearMin || schoolYear > course.yearMax)
  if (ineligible) throw new AppError('One or more selected courses are not eligible for this school year', 422, 'COURSE_INELIGIBLE')
  return courses
}
