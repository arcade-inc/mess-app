import 'dotenv/config'
import { parseConfig } from './platform/config.js'
import { shutdownTelemetry, startTelemetry } from './platform/telemetry.js'

async function start(): Promise<void> {
  const config = parseConfig()
  const { instrumentation, telemetry } = await startTelemetry(config)
  const [{ buildApp }, { createDatabase }] = await Promise.all([
    import('./app.js'),
    import('./platform/database.js'),
  ])
  const database = createDatabase(config.databaseUrl)
  const readDatabase = createDatabase(config.databaseReadUrl)
  const app = await buildApp({ config, database, readDatabase, telemetry, instrumentation })

  app.addHook('onClose', async () => {
    await shutdownTelemetry()
  })

  await app.listen({ host: config.host, port: config.port })
  app.log.info({ host: config.host, port: config.port }, 'API listening')

  const shutdown = async () => {
    await app.close()
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

start().catch((error: unknown) => {
  console.error('API startup failed', error)
  process.exitCode = 1
})
