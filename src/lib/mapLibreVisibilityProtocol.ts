import type { AddProtocolAction } from 'maplibre-gl'

type MapLibreModule = typeof import('maplibre-gl')
type FetchTile = (input: string, init: RequestInit) => Promise<Response>

export const VISIBILITY_PROTOCOL = 'eclipse-visibility'
const PROTOCOL_PREFIX = `${VISIBILITY_PROTOCOL}://`
const ZOOM_PLACEHOLDER = '/{z}'
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='

let transparentPng: ArrayBuffer | null = null
let registeredMapLibre: MapLibreModule | null = null

function transparentPngData(): ArrayBuffer {
  if (transparentPng) return transparentPng.slice(0)
  const binary = atob(TRANSPARENT_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  transparentPng = bytes.buffer
  return transparentPng.slice(0)
}

/** Keep XYZ placeholders visible while hiding the real URL behind our loader. */
export function visibilityProtocolUrl(tileUrl: string): string {
  const placeholderIndex = tileUrl.indexOf(ZOOM_PLACEHOLDER)
  if (placeholderIndex < 0) {
    throw new Error('Visibility tile URL must contain /{z}')
  }
  const baseUrl = tileUrl.slice(0, placeholderIndex)
  const xyzSuffix = tileUrl.slice(placeholderIndex)
  return `${PROTOCOL_PREFIX}${encodeURIComponent(baseUrl)}${xyzSuffix}`
}

export function resolveVisibilityProtocolUrl(protocolUrl: string): string {
  if (!protocolUrl.startsWith(PROTOCOL_PREFIX)) {
    throw new Error('Unsupported visibility tile protocol')
  }
  const payload = protocolUrl.slice(PROTOCOL_PREFIX.length)
  const pathIndex = payload.indexOf('/')
  if (pathIndex < 0) throw new Error('Malformed visibility tile URL')
  return `${decodeURIComponent(payload.slice(0, pathIndex))}${payload.slice(pathIndex)}`
}

export async function loadVisibilityTile(
  protocolUrl: string,
  signal: AbortSignal,
  fetchTile: FetchTile = fetch,
) {
  const sourceUrl = resolveVisibilityProtocolUrl(protocolUrl)
  const response = await fetchTile(sourceUrl, { signal })
  if (response.status === 404) {
    return {
      data: transparentPngData(),
      cacheControl: 'public, max-age=31536000, immutable',
    }
  }
  if (!response.ok) {
    throw new Error(`Visibility tile request failed (${response.status}): ${sourceUrl}`)
  }
  return {
    data: await response.arrayBuffer(),
    cacheControl: response.headers.get('Cache-Control') ?? undefined,
    expires: response.headers.get('Expires') ?? undefined,
    etag: response.headers.get('ETag') ?? undefined,
  }
}

const visibilityProtocolHandler: AddProtocolAction = (request, abortController) =>
  loadVisibilityTile(request.url, abortController.signal)

/** A missing sparse PNG is transparent data, never a request for its parent. */
export function ensureVisibilityTileProtocol(maplibre: MapLibreModule) {
  if (registeredMapLibre === maplibre) return
  maplibre.addProtocol(VISIBILITY_PROTOCOL, visibilityProtocolHandler)
  registeredMapLibre = maplibre
}
