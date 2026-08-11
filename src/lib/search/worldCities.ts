import { abortError, hasValidCoordinates, normalizeSearchText, textMatchRank } from './normalize'
import type { SearchFetcher, SearchRequestOptions, SearchResult } from './types'

/**
 * GeoNames cities15000, generated on 2026-08-11 and kept out of the JavaScript
 * bundle. It is fetched only after the visitor starts a search.
 * Data © GeoNames, CC BY 4.0: https://www.geonames.org/
 */
export const WORLD_CITIES_URL =
  `${import.meta.env.BASE_URL}search/world-cities-geonames-20260811.min.json`

type WorldCityTuple = [
  id: number,
  name: string,
  asciiName: string,
  countryCode: string,
  adminCode: string,
  lat: number,
  lng: number,
  population: number,
]

type WorldCity = {
  id: number
  name: string
  asciiName: string
  countryCode: string
  adminCode: string
  lat: number
  lng: number
  population: number
  searchable: string
}

let cityIndex: WorldCity[] | null = null
let cityIndexPromise: Promise<WorldCity[]> | null = null

const DEFAULT_FETCHER: SearchFetcher = (...args) => fetch(...args)
const countryNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['fr'], { type: 'region' })
  : null

function isWorldCityTuple(value: unknown): value is WorldCityTuple {
  if (!Array.isArray(value) || value.length < 8) return false
  const [id, name, asciiName, countryCode, adminCode, lat, lng, population] = value
  return typeof id === 'number'
    && typeof name === 'string'
    && typeof asciiName === 'string'
    && typeof countryCode === 'string'
    && typeof adminCode === 'string'
    && typeof population === 'number'
    && typeof lat === 'number'
    && typeof lng === 'number'
    && hasValidCoordinates(lat, lng)
}

function parseTuple(value: unknown): WorldCity | null {
  if (!isWorldCityTuple(value)) return null
  const [id, name, asciiName, countryCode, adminCode, lat, lng, population] = value

  return {
    id,
    name,
    asciiName,
    countryCode,
    adminCode,
    lat,
    lng,
    population,
    searchable: normalizeSearchText(`${name} ${asciiName}`),
  }
}

async function loadWorldCities(
  fetcher: SearchFetcher,
  signal?: AbortSignal,
): Promise<WorldCity[]> {
  if (signal?.aborted) throw abortError()
  if (cityIndex) return cityIndex

  // The 2.3 MB source file is shared across successive queries. Cancelling a
  // stale autocomplete consumer must not restart the same Edge Request on the
  // next keystroke; the HTTP download therefore lives independently of the
  // per-query AbortSignal.
  cityIndexPromise ??= fetcher(WORLD_CITIES_URL, {
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Index mondial indisponible (${response.status})`)
      const payload = await response.json() as unknown
      if (!Array.isArray(payload)) throw new Error('Format de l’index mondial invalide')

      const parsed = payload.flatMap((tuple) => {
        const city = parseTuple(tuple)
        return city ? [city] : []
      })
      if (parsed.length === 0) throw new Error('Index mondial vide')
      cityIndex = parsed
      return parsed
    })
    .catch((error: unknown) => {
      cityIndexPromise = null
      throw error
    })

  if (!signal) return cityIndexPromise
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    void cityIndexPromise!.then(
      (cities) => {
        signal.removeEventListener('abort', handleAbort)
        if (signal.aborted) reject(abortError())
        else resolve(cities)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort)
        reject(error)
      },
    )
  })
}

function populationBonus(population: number): number {
  if (population <= 0) return 8
  return Math.max(0, 8 - Math.log10(population + 1))
}

export async function searchWorldCities(
  query: string,
  { fetcher = DEFAULT_FETCHER, signal }: SearchRequestOptions = {},
): Promise<SearchResult[]> {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length < 3) return []
  const cities = await loadWorldCities(fetcher, signal)
  if (signal?.aborted) throw abortError()

  return cities
    .flatMap((city) => {
      if (!normalizedQuery.split(' ').every((token) => city.searchable.includes(token))) return []
      const country = countryNames?.of(city.countryCode) ?? city.countryCode
      const label = `${city.name}, ${country}`
      return [{
        id: `world:${city.id}`,
        label,
        detail: 'Ville · GeoNames',
        provider: 'geonames' as const,
        lat: city.lat,
        lng: city.lng,
        rank: textMatchRank(query, `${city.name} ${city.asciiName}`)
          + populationBonus(city.population)
          + 3,
      }]
    })
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'fr'))
    .slice(0, 6)
}

/** Test-only reset; the production cache intentionally lasts for the tab. */
export function clearWorldCityCache(): void {
  cityIndex = null
  cityIndexPromise = null
}
