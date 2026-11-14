import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { currentDevice } from './lib/install.ts'
import { trackKeyboardInset } from './lib/keyboardInset.ts'
import { startEventSync } from './lib/events.ts'
import { loadCatalog, refreshCatalog } from './lib/catalogSync.ts'

const root = document.getElementById('root')!

// (#359) /admin is the owner's tool page: loaded only here, so lifters never download it. It skips
// the worker, the keyboard lift and the event queue below.
if (/^\/admin\/?$/.test(location.pathname)) {
  import('./admin/main.tsx').then(
    ({ mountAdmin }) => mountAdmin(root),
    () => {
      root.textContent = 'Admin needs a connection. Reload when you are online.'
    },
  )
} else {
  // (#360) Published additions from the last open join the built-in list before anything reads it.
  void loadCatalog().then(startApp)
}

function startApp() {
  // (#256) Lift pinned bars above an on-screen keyboard that covers the page (iPhone).
  trackKeyboardInset()

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )

  // (#359) Usage events that waited offline go now, and again whenever the phone is back online.
  startEventSync()

  // (#360) Fetch the published additions for the next open.
  void refreshCatalog()

  // Offline shell: only in production builds. The service worker caches the app
  // shell and any assets that have actually been loaded, so reopening an active
  // workout without a network keeps the UI and its localStorage data available.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    // (#360) startApp runs after an await (the catalog cache read), so `load` may already have fired:
    // register now, so one online visit still precaches the app (lesson 13).
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }

  // All workout data lives in localStorage. Once the app runs from the home screen, ask the browser
  // to keep it under storage pressure. Only then: installed apps are granted silently, while a browser
  // tab may get a permission prompt (Firefox) (#214).
  if (currentDevice().standalone && navigator.storage?.persist) {
    void navigator.storage.persisted().then((kept) => (kept ? true : navigator.storage.persist())).catch(() => undefined)
  }
}
