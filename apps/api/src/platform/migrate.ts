import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { parseConfig } from './config.js'

const migrationsDirectory = fileURLToPath(new URL('../../../..//db/migrations/', import.meta.url))
const seedFile = fileURLToPath(new URL('../../../..//db/seed/catalog.sql', import.meta.url))

async function migrate(): Promise<void> {
  const config = parseConfig()
  const pool = new Pool({ connectionString: config.databaseUrl })
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort()

    for (const name of migrationFiles) {
      const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])
      if (existing.rowCount) continue

      const sql = await readFile(join(migrationsDirectory, name), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }

    await pool.query(await readFile(seedFile, 'utf8'))
  } finally {
    await pool.end()
  }
}

migrate().catch((error: unknown) => {
  console.error('Database migration failed', error)
  process.exitCode = 1
})
