import { hasValidCoordinates, textMatchRank } from './normalize'
import type { SearchFetcher, SearchRequestOptions, SearchResult } from './types'

export const GEOPLATEFORME_SEARCH_ENDPOINT = 'https://data.geopf.fr/geocodage/search'
export const CARTOCIUDAD_CANDIDATES_ENDPOINT =
  'https://www.cartociudad.es/geocoder/api/geocoder/candidates'
export const CARTOCIUDAD_FIND_ENDPOINT =
  'https://www.cartociudad.es/geocoder/api/geocoder/find'

const DEFAULT_FETCHER: SearchFetcher = (...args) => fetch(...args)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function responseJson(response: Response, provider: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${provider} a répondu ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

export async function searchFrance(
  query: string,
  { fetcher = DEFAULT_FETCHER, signal }: SearchRequestOptions = {},
): Promise<SearchResult[]> {
  const url = new URL(GEOPLATEFORME_SEARCH_ENDPOINT)
  url.search = new URLSearchParams({
    q: query,
    index: 'address',
    limit: '5',
    autocomplete: '1',
  }).toString()

  const payload = asRecord(await responseJson(
    await fetcher(url, { headers: { Accept: 'application/json' }, signal }),
    'Géoplateforme',
  ))
  const features = Array.isArray(payload?.features) ? payload.features : []

  return features.flatMap((rawFeature, index) => {
    const feature = asRecord(rawFeature)
    const geometry = asRecord(feature?.geometry)
    const properties = asRecord(feature?.properties)
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : []
    const lng = asNumber(coordinates[0])
    const lat = asNumber(coordinates[1])
    const label = asString(properties?.label)
    if (lat == null || lng == null || !label || !hasValidCoordinates(lat, lng)) return []

    const providerId = asString(properties?.banId) ?? asString(properties?.id) ?? `${lat},${lng}`
    const context = asString(properties?.context)
    const city = asString(properties?.city)
    const detailParts = [city, context]
      .filter((part, partIndex, parts): part is string => Boolean(part) && parts.indexOf(part) === partIndex)
      .filter((part) => !label.toLocaleLowerCase('fr').includes(part.toLocaleLowerCase('fr')))
    const providerScore = asNumber(properties?.score)

    return [{
      id: `fr:${providerId}`,
      label,
      detail: detailParts.length > 0
        ? `${detailParts.join(' · ')} · Géoplateforme`
        : 'France · Géoplateforme',
      provider: 'geoplateforme' as const,
      lat,
      lng,
      rank: textMatchRank(query, label) + index + (providerScore == null ? 4 : (1 - providerScore) * 8),
    }]
  })
}

type CartoCiudadCandidate = {
  address: string
  id: string
  lat: number | null
  lng: number | null
  municipality: string | null
  postalCode: string | null
  province: string | null
  type: string
}

function parseCartoCiudadCandidate(value: unknown): CartoCiudadCandidate | null {
  const candidate = asRecord(value)
  const id = asString(candidate?.id)
  const address = asString(candidate?.address)
  const type = asString(candidate?.type)
  if (!id || !address || !type) return null

  const rawLat = asNumber(candidate?.lat)
  const rawLng = asNumber(candidate?.lng)
  // CartoCiudad returns 0/0 for linear or areal candidates. Those coordinates
  // are resolved through /find only when the visitor selects the suggestion.
  const hasCoordinates = rawLat != null && rawLng != null && hasValidCoordinates(rawLat, rawLng)
    && !(rawLat === 0 && rawLng === 0)

  return {
    id,
    address,
    type,
    lat: hasCoordinates ? rawLat : null,
    lng: hasCoordinates ? rawLng : null,
    municipality: asString(candidate?.muni),
    postalCode: asString(candidate?.postalCode),
    province: asString(candidate?.province),
  }
}

export async function searchSpain(
  query: string,
  { fetcher = DEFAULT_FETCHER, signal }: SearchRequestOptions = {},
): Promise<SearchResult[]> {
  const url = new URL(CARTOCIUDAD_CANDIDATES_ENDPOINT)
  url.search = new URLSearchParams({ q: query, limit: '5' }).toString()
  const payload = await responseJson(
    await fetcher(url, { headers: { Accept: 'application/json' }, signal }),
    'CartoCiudad',
  )
  const candidates = Array.isArray(payload) ? payload : []

  return candidates.flatMap((rawCandidate, index) => {
    const candidate = parseCartoCiudadCandidate(rawCandidate)
    if (!candidate) return []
    const detailParts = [candidate.postalCode, candidate.municipality, candidate.province]
      .filter((part, partIndex, parts): part is string => Boolean(part) && parts.indexOf(part) === partIndex)
      .filter((part) => !candidate.address.toLocaleLowerCase('es').includes(part.toLocaleLowerCase('es')))

    return [{
      id: `es:${candidate.type}:${candidate.id}`,
      label: candidate.address,
      detail: detailParts.length > 0
        ? `${detailParts.join(' · ')} · CartoCiudad`
        : 'Espagne · CartoCiudad',
      provider: 'cartociudad' as const,
      lat: candidate.lat,
      lng: candidate.lng,
      rank: textMatchRank(query, candidate.address) + index * 1.5,
      resolver: candidate.lat == null || candidate.lng == null
        ? { id: candidate.id, type: candidate.type }
        : undefined,
    }]
  })
}

export async function resolveSpainResult(
  result: SearchResult,
  { fetcher = DEFAULT_FETCHER, signal }: SearchRequestOptions = {},
): Promise<{ lat: number; lng: number }> {
  if (result.lat != null && result.lng != null && hasValidCoordinates(result.lat, result.lng)) {
    return { lat: result.lat, lng: result.lng }
  }
  if (result.provider !== 'cartociudad' || !result.resolver) {
    throw new Error('Ce résultat ne contient pas de coordonnées')
  }

  const url = new URL(CARTOCIUDAD_FIND_ENDPOINT)
  url.search = new URLSearchParams({
    id: result.resolver.id,
    type: result.resolver.type,
  }).toString()
  const payload = asRecord(await responseJson(
    await fetcher(url, { headers: { Accept: 'application/json' }, signal }),
    'CartoCiudad',
  ))
  const lat = asNumber(payload?.lat)
  const lng = asNumber(payload?.lng)
  if (lat == null || lng == null || !hasValidCoordinates(lat, lng)) {
    throw new Error('CartoCiudad n’a pas renvoyé de coordonnées valides')
  }
  return { lat, lng }
}
