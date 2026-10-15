import { Pool, type PoolClient, type PoolConfig } from 'pg'

export function createDatabase(connectionString: string, options: Omit<PoolConfig, 'connectionString'> = {}): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, ...options })
}

export interface DatabasePools {
  primary: Pool
  read: Pool
}

export type DatabaseOperation =
  | 'mutation'
  | 'transaction'
  | 'checkout-consistency'
  | 'enrollment-authorization'
  | 'read-after-write'
  | 'catalog-browse'
  | 'lesson-content-lag-tolerant'

export function createDatabasePools(primaryUrl: string, readUrl = primaryUrl): DatabasePools {
  return { primary: createDatabase(primaryUrl), read: createDatabase(readUrl) }
}

export function selectDatabasePool(pools: DatabasePools, operation: DatabaseOperation): Pool {
  switch (operation) {
    case 'catalog-browse':
    case 'lesson-content-lag-tolerant':
      return pools.read
    case 'mutation':
    case 'transaction':
    case 'checkout-consistency':
    case 'enrollment-authorization':
    case 'read-after-write':
      return pools.primary
  }
}

export async function closeDatabasePools(pools: DatabasePools): Promise<void> {
  await Promise.all(Array.from(new Set([pools.primary, pools.read]), (pool) => pool.end()))
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original failure; the pool will discard a broken connection if needed.
      // TODO: add it to log
    }
    throw error
  } finally {
    client.release()
  }
}

export async function closeDatabase(pool: Pool): Promise<void> {
  await pool.end()
}
