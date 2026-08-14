import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { FarewellGate } from './components/Farewell.tsx'
import { installCloudflareWebAnalytics } from './lib/cloudflareAnalytics.ts'
import { installSentry } from './lib/sentry.ts'
import { installServiceWorker } from './lib/serviceWorker.ts'

installSentry()
installCloudflareWebAnalytics()
installServiceWorker()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Application root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <FarewellGate>
        <App />
      </FarewellGate>
    </ErrorBoundary>
  </StrictMode>,
)

// A cheap production smoke-test signal that is only present once the entry
// bundle has loaded and React has been mounted.
rootElement.dataset.appMounted = 'true'
