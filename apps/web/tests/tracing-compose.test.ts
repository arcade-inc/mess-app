import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('tracing Compose profile uses a separate web image from the default app', async () => {
  const override = await readFile(new URL('../../../docker-compose.tracing.yml', import.meta.url), 'utf8')

  assert.match(override, /^ {2}web:\n {4}image: mess-app-web-tracing\n/m)
})
