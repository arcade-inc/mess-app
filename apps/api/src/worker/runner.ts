import 'dotenv/config'
import { parseConfig } from '../platform/config.js'
import { shutdownTelemetry, startTelemetry } from '../platform/telemetry.js'

async function startWorker(): Promise<void> {
  const config = parseConfig()
  await startTelemetry(config)
  const [{ Pool }, { createMockEmailSender }, { createOutboxWorker }] = await Promise.all([
    import('pg'),
    import('./email-sender.js'),
    import('./outbox.worker.js'),
  ])
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5 })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  try {
    const worker = createOutboxWorker({
      pool,
      emailSender: createMockEmailSender(),
      webOrigin: config.webOrigin,
      encryptionSecret: config.jwtSecret,
    })
    await worker.run(controller.signal)
  } finally {
    await pool.end()
    await shutdownTelemetry()
  }
}

startWorker().catch((error: unknown) => {
  console.error('Outbox worker failed to start or stopped unexpectedly', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})
