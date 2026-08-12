import * as Sentry from '@sentry/react'
import type { ErrorEvent } from '@sentry/react'

const OPERATIONAL_ERROR_SAMPLE_RATE = 0.05
const UNCLASSIFIED_ERROR_SAMPLE_RATE = 0.05
const MAPLIBRE_SHADER_COMPILATION_ERROR =
  /^(?:Could not compile (?:fragment|vertex) shader|Program failed to link):/

function isMapLibreFrame(filename?: string, absolutePath?: string): boolean {
  return [filename, absolutePath].some((value) => value?.includes('maplibre-gl') === true)
}

/** Detects a MapLibre shader failure thrown outside its public error events. */
export function isMapLibreShaderCompilationError(error: unknown): boolean {
  if (!(error instanceof Error) || !MAPLIBRE_SHADER_COMPILATION_ERROR.test(error.message)) {
    return false
  }
  return error.stack?.includes('maplibre-gl') === true
}

/** Detects the original unhandled event before it is recaptured as operational. */
export function isUnhandledMapLibreShaderCompilationError(event: ErrorEvent): boolean {
  if (event.tags?.failure_area) return false
  return (event.exception?.values ?? []).some(({ value, stacktrace }) =>
    MAPLIBRE_SHADER_COMPILATION_ERROR.test(value ?? '') &&
    stacktrace?.frames?.some(({ filename, abs_path: absolutePath }) =>
      isMapLibreFrame(filename, absolutePath),
    ) === true,
  )
}

/** Detects navigation trackers injected by Android WebViews serializing React DOM nodes. */
export function isInjectedAnchorSerializationError(event: ErrorEvent): boolean {
  const exceptions = event.exception?.values ?? []
  const messages = [event.message, ...exceptions.map(({ value }) => value)]
  const matchesInjectedAnchor = messages.some((message) =>
    message?.includes('Converting circular structure to JSON') === true &&
    message.includes("constructor 'HTMLAnchorElement'") &&
    message.includes('__reactFiber$') &&
    message.includes("property 'stateNode' closes the circle"),
  )
  const hasApplicationFrame = exceptions.some(({ stacktrace }) =>
    stacktrace?.frames?.some(({ in_app: inApplication }) => inApplication === true),
  )
  return matchesInjectedAnchor && !hasApplicationFrame
}

function withoutQuery(value: string): string {
  try {
    const url = new URL(value, window.location.origin)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.replace(/([?#]).*$/, '')
  }
}

function withoutUrlQueries(value: string): string {
  return value.replace(/https?:\/\/[^\s)\]}]+/g, (url) => withoutQuery(url))
}

function safeOperationalError(area: string, error: unknown): Error {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`${area}: ${name}: ${withoutUrlQueries(message)}`)
}

/** Installs production-only error monitoring without tracing, replay, logs or PII. */
export function installSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!import.meta.env.PROD || !dsn) return false

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    enableLogs: false,
    enableMetrics: false,
    maxBreadcrumbs: 20,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    beforeBreadcrumb(breadcrumb) {
      const url = breadcrumb.data?.url
      if (typeof url === 'string') breadcrumb.data!.url = withoutQuery(url)
      return breadcrumb
    },
    beforeSend(event) {
      delete event.user
      if (isInjectedAnchorSerializationError(event)) return null
      // MapLibre throws shader failures from requestAnimationFrame rather than
      // emitting them through map.on('error'). MapView catches the matching
      // window error and recaptures it with a failure_area tag; discard only
      // this original unhandled duplicate.
      if (isUnhandledMapLibreShaderCompilationError(event)) return null
      if (event.request) {
        if (event.request.url) event.request.url = withoutQuery(event.request.url)
        delete event.request.query_string
        delete event.request.cookies
        delete event.request.data
      }
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = withoutUrlQueries(exception.value)
        for (const frame of exception.stacktrace?.frames ?? []) {
          if (frame.filename) frame.filename = withoutQuery(frame.filename)
          if (frame.abs_path) frame.abs_path = withoutQuery(frame.abs_path)
        }
      }

      // A browser-wide regression must not consume the 5k free events before
      // an alert arrives. Explicitly classified app failures are kept above.
      if (!event.tags?.failure_area && Math.random() >= UNCLASSIFIED_ERROR_SAMPLE_RATE) {
        return null
      }
      return event
    },
  })
  return true
}

/** Captures user-visible provider failures while keeping a mass outage below the free quota. */
export function captureOperationalError(area: string, error: unknown): void {
  if (!Sentry.getClient()) return
  if (Math.random() >= OPERATIONAL_ERROR_SAMPLE_RATE) return
  const safeError = safeOperationalError(area, error)
  Sentry.withScope((scope) => {
    scope.setTag('failure_area', area)
    scope.setLevel('error')
    scope.setFingerprint(['operational', area, safeError.name, safeError.message])
    Sentry.captureException(safeError)
  })
}

/** Fatal failures are rare and are always kept. */
export function captureFatalError(area: string, error: unknown): void {
  if (!Sentry.getClient()) return
  Sentry.withScope((scope) => {
    scope.setTag('failure_area', area)
    scope.setLevel('fatal')
    Sentry.captureException(error)
  })
}
