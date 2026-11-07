import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Offline shell: only in production builds. The service worker caches the app
// shell and any assets that have actually been loaded, so reopening an active
// workout without a network keeps the UI and its localStorage data available.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

// All workout data lives in localStorage. Ask the browser once to keep it under storage
// pressure; installed (home screen) apps are usually granted. No prompt, no UI (#214).
if (navigator.storage?.persist) {
  void navigator.storage.persisted().then((kept) => (kept ? true : navigator.storage.persist())).catch(() => undefined)
}
