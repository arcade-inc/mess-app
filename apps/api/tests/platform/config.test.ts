import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../../src/platform/config.js'

const baseEnvironment = {
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  CORS_ORIGINS: 'https://web.example',
}

test('trusts forwarded client IPs only through explicitly configured proxy addresses', () => {
  const config = parseConfig({
    ...baseEnvironment,
    TRUST_PROXY: '10.0.0.2, 192.168.0.0/24',
  })

  assert.deepEqual(config.trustedProxies, ['10.0.0.2', '192.168.0.0/24'])
})

test('does not allow a boolean wildcard to enable trust for arbitrary proxies', () => {
  assert.throws(() => parseConfig({
    ...baseEnvironment,
    TRUST_PROXY: 'true',
  }))
})

test('defaults the read database target to the primary database', () => {
  const config = parseConfig(baseEnvironment)
  assert.equal(config.databaseReadUrl, config.databaseUrl)
})

test('accepts a separately configured PostgreSQL read target', () => {
  const config = parseConfig({
    ...baseEnvironment,
    DATABASE_READ_URL: 'postgres://reader:secret@replica.example:5432/mes',
  })
  assert.equal(config.databaseReadUrl, 'postgres://reader:secret@replica.example:5432/mes')
})

test('defaults invitation links to the first explicitly configured web origin', () => {
  const config = parseConfig({ ...baseEnvironment, CORS_ORIGINS: 'https://web.example,https://admin.example' })
  assert.equal(config.webOrigin, 'https://web.example')
})

test('accepts only an explicit HTTP(S) web origin for checkout invitation links', () => {
  const config = parseConfig({ ...baseEnvironment, CORS_ORIGINS: 'https://learn.example', WEB_ORIGIN: 'https://learn.example' })
  assert.equal(config.webOrigin, 'https://learn.example')
  assert.throws(() => parseConfig({ ...baseEnvironment, WEB_ORIGIN: 'https://learn.example/path' }))
  assert.throws(() => parseConfig({ ...baseEnvironment, WEB_ORIGIN: 'https://other.example' }))
})
