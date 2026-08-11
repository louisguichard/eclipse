import { clampPitch, horizontalFieldOfView, normalizeHeading } from './geometry'
import type { LatLng, StreetViewCamera } from '../types'

const EMBED_ENDPOINT = 'https://www.google.com/maps/embed/v1/streetview'
const EMBED_SEARCH_RADIUS_METERS = 1_000

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} doit être un nombre fini`)
}

function formatNumber(value: number, precision = 6): string {
  const rounded = Number(value.toFixed(precision))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * Builds the free Maps Embed Street View URL without ever loading Maps JS.
 * The returned camera is an initial camera only: Embed exposes no parent-page
 * events after the visitor pans or zooms inside its cross-origin iframe.
 */
export function buildGoogleStreetViewEmbedUrl(
  apiKey: string,
  location: LatLng,
  camera: StreetViewCamera,
): string {
  const key = apiKey.trim()
  if (!key) throw new TypeError('La clé Maps Embed API est vide')

  assertFinite(location.lat, 'latitude')
  assertFinite(location.lng, 'longitude')
  assertFinite(camera.heading, 'heading')
  assertFinite(camera.pitch, 'pitch')
  assertFinite(camera.zoom, 'zoom')
  if (location.lat < -90 || location.lat > 90) {
    throw new RangeError('La latitude doit être comprise entre -90 et 90')
  }
  if (location.lng < -180 || location.lng > 180) {
    throw new RangeError('La longitude doit être comprise entre -180 et 180')
  }

  const fov = Math.max(10, Math.min(100, horizontalFieldOfView(camera.zoom)))
  const params = new URLSearchParams({
    key,
    location: `${formatNumber(location.lat)},${formatNumber(location.lng)}`,
    heading: formatNumber(normalizeHeading(camera.heading), 4),
    pitch: formatNumber(clampPitch(camera.pitch), 4),
    fov: formatNumber(fov, 4),
    radius: String(EMBED_SEARCH_RADIUS_METERS),
    source: 'outdoor',
  })

  return `${EMBED_ENDPOINT}?${params.toString()}`
}
