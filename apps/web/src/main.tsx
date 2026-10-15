import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startBrowserTelemetry } from './telemetry.js'
import './index.css'
import App from './App.tsx'

startBrowserTelemetry([window.location.origin], import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
