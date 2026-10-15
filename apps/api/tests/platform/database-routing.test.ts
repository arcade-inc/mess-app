import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectDatabasePool, type DatabasePools, type DatabaseOperation } from '../../src/platform/database.js'

const primary = {} as DatabasePools['primary']
const read = {} as DatabasePools['read']
const pools = { primary, read } satisfies DatabasePools

const primaryOperations: DatabaseOperation[] = [
  'mutation',
  'transaction',
  'checkout-consistency',
  'enrollment-authorization',
  'read-after-write',
]

test('routes every write and consistency-sensitive operation to primary', () => {
  for (const operation of primaryOperations) {
    assert.equal(selectDatabasePool(pools, operation), primary, `${operation} must use primary`)
  }
})

test('routes only explicitly lag-tolerant browse/content reads to the read pool', () => {
  assert.equal(selectDatabasePool(pools, 'catalog-browse'), read)
  assert.equal(selectDatabasePool(pools, 'lesson-content-lag-tolerant'), read)
})
