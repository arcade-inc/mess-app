import { isIP } from 'node:net'
import { z } from 'zod'

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url().refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), 'DATABASE_URL must use PostgreSQL'),
  DATABASE_READ_URL: z.union([z.literal(''), z.string().url().refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), 'DATABASE_READ_URL must use PostgreSQL')]).default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  OTEL_SERVICE_NAME: z.string().min(1).default('mes-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.union([z.literal(''), z.string().url()]).default(''),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000_000).default(100),
  RATE_LIMIT_TIME_WINDOW: z.coerce.number().int().min(100).max(86_400_000).default(60_000),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  TRUST_PROXY: z.string().default(''),
})

export interface AppConfig {
  environment: 'development' | 'test' | 'production'
  host: string
  port: number
  databaseUrl: string
  databaseReadUrl: string
  jwtSecret: string
  otelServiceName: string
  otelExporterOtlpEndpoint?: string
  rateLimitMax: number
  rateLimitTimeWindowMs: number
  corsOrigins: string[]
  trustedProxies: string[]
}

function parseTrustedProxies(value: string): string[] {
  const proxies = value.split(',').map((proxy) => proxy.trim()).filter(Boolean)
  for (const proxy of proxies) {
    const [address, prefix, ...rest] = proxy.split('/')
    const addressVersion = isIP(address)
    const prefixNumber = prefix === undefined ? undefined : Number(prefix)
    const maxPrefix = addressVersion === 4 ? 32 : 128
    if (
      addressVersion === 0 ||
      rest.length > 0 ||
      (prefix !== undefined && (!Number.isInteger(prefixNumber) || prefixNumber! < 0 || prefixNumber! > maxPrefix))
    ) {
      throw new Error(`TRUST_PROXY entries must be explicit IP addresses or CIDRs: ${proxy}`)
    }
  }
  return proxies
}

export function parseConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment)
  const corsOrigins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  for (const origin of corsOrigins) {
    const parsedOrigin = new URL(origin)
    if (parsedOrigin.origin !== origin || !['http:', 'https:'].includes(parsedOrigin.protocol)) {
      throw new Error(`CORS_ORIGINS entries must be explicit HTTP(S) origins: ${origin}`)
    }
  }

  return {
    environment: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    databaseReadUrl: parsed.DATABASE_READ_URL || parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    otelServiceName: parsed.OTEL_SERVICE_NAME,
    ...(parsed.OTEL_EXPORTER_OTLP_ENDPOINT ? { otelExporterOtlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '') } : {}),
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitTimeWindowMs: parsed.RATE_LIMIT_TIME_WINDOW,
    corsOrigins,
    trustedProxies: parseTrustedProxies(parsed.TRUST_PROXY),
  }
}
