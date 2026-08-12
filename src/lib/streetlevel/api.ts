import { protoDouble, protoEnum, toProtobufUrl } from './protobuf'
import { parsePanoramaSearchPayload } from './parse'
import { isAbortError, waitForRetry } from './retry'
import type { ProtoMessage } from './protobuf'
import type { StreetLevelPanorama } from './types'

const SEARCH_ENDPOINT = 'https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch'
const JSONP_REGISTRY = '__eclipseStreetlevelJsonp'
const DEFAULT_TIMEOUT_MS = 8_000
const SEARCH_MAX_ATTEMPTS = 2
const SEARCH_RETRY_DELAY_MS = 300
let jsonpSequence = 0

const panoramaCache = new Map<string, StreetLevelPanorama | null>()

function cacheKey(lat: number, lng: number, radius: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${radius}`
}

export function buildFindPanoramaUrl(
  lat: number,
  lng: number,
  radius: number,
  callback: string,
): string {
  const request: ProtoMessage = {
    1: { 1: 'apiv3', 5: 'US', 11: { 1: { 1: false } } },
    2: { 1: { 3: protoDouble(lat), 4: protoDouble(lng) }, 2: protoDouble(radius) },
    3: {
      2: { 1: 'fr', 2: 'FR' },
      9: { 1: protoEnum(2) },
      // Official Google outdoor coverage only. Third-party Photospheres are
      // deliberately excluded because their projection and licensing vary.
      11: { 1: { 1: protoEnum(2), 2: true, 3: protoEnum(2) } },
    },
    4: {
      1: [1, 2, 3, 4, 6, 8, 12].map(protoEnum),
      5: {},
      6: {},
    },
  }
  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('pb', toProtobufUrl(request))
  url.searchParams.set('callback', callback)
  return url.toString()
}

type JsonpRegistry = Record<string, ((payload: unknown) => void) | undefined>

function registry(): JsonpRegistry {
  const browserWindow = window as unknown as Record<string, unknown>
  const existing = browserWindow[JSONP_REGISTRY]
  if (existing && typeof existing === 'object') return existing as JsonpRegistry
  const created: JsonpRegistry = {}
  browserWindow[JSONP_REGISTRY] = created
  return created
}

function requestPanoramaJsonpOnce(
  lat: number,
  lng: number,
  radius: number,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Streetlevel nécessite un navigateur'))
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return Promise.reject(new Error('Coordonnées Streetlevel invalides'))
  }
  const safeRadius = Math.max(1, Math.min(1_000, Math.round(radius)))
  const id = `c${Date.now().toString(36)}${(jsonpSequence += 1).toString(36)}`
  const callback = `${JSONP_REGISTRY}.${id}`

  return new Promise((resolve, reject) => {
    const callbacks = registry()
    const script = document.createElement('script')
    let settled = false
    const finish = (error?: Error, payload?: unknown) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      delete callbacks[id]
      script.remove()
      if (error) reject(error)
      else resolve(payload)
    }
    const abort = () => finish(new DOMException('Requête Streetlevel annulée', 'AbortError'))
    const timeout = window.setTimeout(
      () => finish(new Error('Délai Streetlevel dépassé')),
      timeoutMs,
    )

    callbacks[id] = (payload) => finish(undefined, payload)
    script.async = true
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.src = buildFindPanoramaUrl(lat, lng, safeRadius, callback)
    script.onerror = () => finish(new Error('Recherche Streetlevel indisponible'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    else document.head.append(script)
  })
}

function retryableSearchError(error: unknown): boolean {
  if (isAbortError(error)) return false
  return error instanceof Error && (
    error.message === 'Délai Streetlevel dépassé' ||
    error.message === 'Recherche Streetlevel indisponible'
  )
}

export async function requestPanoramaJsonp(
  lat: number,
  lng: number,
  radius: number,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  for (let attempt = 0; attempt < SEARCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestPanoramaJsonpOnce(lat, lng, radius, signal, timeoutMs)
    } catch (error) {
      const finalAttempt = attempt === SEARCH_MAX_ATTEMPTS - 1
      if (finalAttempt || !retryableSearchError(error)) throw error
      await waitForRetry(attempt, SEARCH_RETRY_DELAY_MS, signal)
    }
  }

  throw new Error('Recherche Streetlevel indisponible')
}

export async function findNearestPanorama(
  lat: number,
  lng: number,
  radius = 1_000,
  signal?: AbortSignal,
): Promise<StreetLevelPanorama | null> {
  const safeRadius = Math.max(1, Math.min(1_000, Math.round(radius)))
  const key = cacheKey(lat, lng, safeRadius)
  if (panoramaCache.has(key)) return panoramaCache.get(key) ?? null
  const payload = await requestPanoramaJsonp(lat, lng, safeRadius, signal)
  const panorama = parsePanoramaSearchPayload(payload)
  panoramaCache.set(key, panorama)
  return panorama
}

export function clearStreetLevelMetadataCache(): void {
  panoramaCache.clear()
}
