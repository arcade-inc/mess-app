import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startBrowserTelemetry } from './telemetry.js'
import './index.css'
import App from './App.tsx'

const apiOrigins = (import.meta.env.VITE_API_ORIGINS ?? 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean)
startBrowserTelemetry(apiOrigins, import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
