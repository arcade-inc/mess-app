import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getCatalog } from './catalog.service.js'

export function registerCatalogRoutes(app: FastifyInstance, readPool: Pool): void {
  app.get('/courses', { config: { public: true } }, async () => ({ courses: await getCatalog(readPool) }))
}
