import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  attributes?: Array<{ key: string; value: Record<string, unknown> }>
}

let collector: Server
const exportedSpans: OtlpSpan[] = []

function respondToOtlp(request: IncomingMessage, response: ServerResponse, chunks: Buffer[]): void {
  response.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>
    }
    for (const resource of payload.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) exportedSpans.push(...(scope.spans ?? []))
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  } catch {
    response.writeHead(400).end()
  }
}

test.beforeAll(async () => {
  collector = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => respondToOtlp(request, response, chunks))
  })
  await new Promise<void>((resolve) => collector.listen(4318, '0.0.0.0', resolve))
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => collector.close((error) => error ? reject(error) : resolve()))
})

test('one browser catalog request produces privacy-safe browser, Fastify, and PostgreSQL spans in one trace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Run the trace assertion once; responsive journey is covered in both projects')

  const catalogTraceparents: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/courses')) {
      const traceparent = request.headers()['traceparent']
      if (traceparent) catalogTraceparents.push(traceparent)
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make space for their next big idea.' })).toBeVisible()
  await expect.poll(() => catalogTraceparents.length).toBeGreaterThan(0)

  const [, traceId, browserSpanId] = catalogTraceparents[0]!.split('-')
  expect(traceId).toMatch(/^[0-9a-f]{32}$/)
  expect(browserSpanId).toMatch(/^[0-9a-f]{16}$/)

  await expect.poll(() => {
    const traceSpans = exportedSpans.filter((span) => span.traceId === traceId)
    const browserSpanPresent = traceSpans.some((span) => span.spanId === browserSpanId)
    const fastifySpanPresent = traceSpans.some((span) => span.parentSpanId === browserSpanId && span.attributes?.some(({ key, value }) => key === 'http.route' && value.stringValue === '/courses'))
    const databaseSpanPresent = traceSpans.some((span) => span.name.startsWith('pg.query:'))
    return browserSpanPresent && fastifySpanPresent && databaseSpanPresent
  }, { timeout: 20_000 }).toBe(true)
  const traceSpans = exportedSpans.filter((span) => span.traceId === traceId)
  const browserSpan = traceSpans.find((span) => span.spanId === browserSpanId)
  expect(browserSpan, 'the W3C parent from the browser request must be exported as a browser span').toBeDefined()

  const fastifySpan = traceSpans.find((span) => span.parentSpanId === browserSpanId)
  expect(fastifySpan, 'Fastify must continue the browser trace').toBeDefined()
  expect(fastifySpan!.attributes?.some(({ key, value }) => key === 'http.route' && value.stringValue === '/courses')).toBe(true)

  const databaseSpan = traceSpans.find((span) => span.name.startsWith('pg.query:'))
  expect(databaseSpan, 'the request must include a PostgreSQL query span').toBeDefined()
  expect(databaseSpan!.attributes?.some(({ key, value }) => key === 'db.system.name' && value.stringValue === 'postgresql')).toBe(true)
  const spansById = new Map(traceSpans.map((span) => [span.spanId, span]))
  let ancestorId = databaseSpan!.parentSpanId
  const databaseAncestors = new Set<string>()
  while (ancestorId && !databaseAncestors.has(ancestorId)) {
    databaseAncestors.add(ancestorId)
    ancestorId = spansById.get(ancestorId)?.parentSpanId
  }
  expect(databaseAncestors.has(fastifySpan!.spanId), 'the PostgreSQL span must descend from the Fastify request span').toBe(true)

  const serializedTrace = JSON.stringify(traceSpans)
  expect(serializedTrace).not.toMatch(/password|invitation|@example\.com|student[_ -]?id|request[_ -]?body|response[_ -]?body/i)
  for (const span of traceSpans) {
    expect(span.attributes?.some(({ key }) => /body|cookie|authorization|email|student/i.test(key))).not.toBe(true)
  }
  const statement = databaseSpan!.attributes?.find(({ key }) => key === 'db.statement' || key === 'db.query.text')?.value.stringValue
  if (statement) expect(statement).not.toMatch(/@example\.com|password|invitation/i)
})
