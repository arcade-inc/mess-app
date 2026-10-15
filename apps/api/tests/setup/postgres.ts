import { Pool } from 'pg'
import type { TestContext } from 'node:test'

export interface PostgresFixture {
  pool: Pool
  trackOrder(idempotencyKey: string, parentEmail?: string): void
  trackOutbox(dedupeKey: string): void
  trackCourse(courseId: string): void
  trackStudent(email: string): void
}

export function createPostgresFixture(testContext: TestContext): PostgresFixture | undefined {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) return undefined

  const pool = new Pool({ connectionString })
  const orderKeys: string[] = []
  const parentEmails: string[] = []
  const studentEmails: string[] = []
  const courseIds: string[] = []
  const outboxKeys: string[] = []
  testContext.after(async () => {
    if (outboxKeys.length > 0) await pool.query('DELETE FROM outbox_messages WHERE dedupe_key = ANY($1)', [outboxKeys])
    if (orderKeys.length > 0) {
      await pool.query("DELETE FROM outbox_messages WHERE payload->>'orderId' IN (SELECT id::text FROM orders WHERE idempotency_key = ANY($1))", [orderKeys])
      await pool.query('DELETE FROM invitations WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1)))', [orderKeys])
      await pool.query('DELETE FROM enrollments WHERE slot_id IN (SELECT id FROM student_slots WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1)))', [orderKeys])
      await pool.query('UPDATE student_slots SET student_id = NULL WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1))', [orderKeys])
      if (studentEmails.length > 0) await pool.query('DELETE FROM students WHERE email = ANY($1)', [studentEmails])
      await pool.query('DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1))', [orderKeys])
      await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1))', [orderKeys])
      await pool.query('DELETE FROM student_slots WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key = ANY($1))', [orderKeys])
      await pool.query('DELETE FROM orders WHERE idempotency_key = ANY($1)', [orderKeys])
      await pool.query('DELETE FROM parents WHERE email = ANY($1) AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.parent_id = parents.id)', [parentEmails])
    }
    if (courseIds.length > 0) await pool.query('DELETE FROM courses WHERE id = ANY($1::uuid[])', [courseIds])
    await pool.end()
  })

  return {
    pool,
    trackOrder(idempotencyKey, parentEmail) {
      orderKeys.push(idempotencyKey)
      if (parentEmail) parentEmails.push(parentEmail)
    },
    trackOutbox(dedupeKey) {
      outboxKeys.push(dedupeKey)
    },
    trackCourse(courseId) {
      courseIds.push(courseId)
    },
    trackStudent(email) {
      studentEmails.push(email)
    },
  }
}
