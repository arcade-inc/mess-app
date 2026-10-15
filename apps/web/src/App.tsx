import { renderRoute } from './router.js'

export default function App() {
  return renderRoute(window.location.origin, window.location.pathname)
}
