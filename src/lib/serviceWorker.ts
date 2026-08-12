import { registerSW } from 'virtual:pwa-register'
import { captureOperationalError } from './sentry'

type ServiceWorkerRegistrar = typeof registerSW

export function isServiceWorkerPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; message?: unknown }
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return (name === 'NotSupportedError' || name === 'SecurityError') &&
    /denied|permission|not allowed/i.test(message)
}

function handleRegistrationError(error: unknown): void {
  if (isServiceWorkerPermissionError(error)) {
    // Offline support is optional. A browser or user policy refusing it must
    // not become an unhandled application error.
    console.info('Service Worker non autorisé par le navigateur.')
    return
  }

  console.warn('Service Worker indisponible.', error)
  captureOperationalError('service-worker', error)
}

/** Registers the PWA explicitly so every failure has a handled code path. */
export function installServiceWorker(
  enabled = import.meta.env.PROD,
  registrar: ServiceWorkerRegistrar = registerSW,
): boolean {
  if (!enabled || !('serviceWorker' in navigator)) return false

  try {
    registrar({ onRegisterError: handleRegistrationError })
  } catch (error) {
    handleRegistrationError(error)
  }
  return true
}
