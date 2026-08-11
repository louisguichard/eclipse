import type { ObserverLocation } from '../../types'
import { abortError, hasValidCoordinates, normalizeSearchText } from './normalize'
import { resolveSpainResult, searchFrance, searchSpain } from './providers'
import type { SearchRequestOptions, SearchResult } from './types'
import { clearWorldCityCache, searchWorldCities } from './worldCities'

export type { SearchProvider, SearchResult } from './types'
export { isAbortError } from './normalize'

export const MIN_SEARCH_CHARACTERS = 3
export const SEARCH_DEBOUNCE_MS = 320
export const SEARCH_PROVIDER_TIMEOUT_MS = 2_500

const MAX_RESULT_CACHE_ENTRIES = 64
const resultCache = new Map<string, SearchResult[]>()
const resolvedLocationCache = new Map<string, ObserverLocation>()

function cacheResult(key: string, results: SearchResult[]): void {
  resultCache.set(key, results)
  if (resultCache.size <= MAX_RESULT_CACHE_ENTRIES) return
  const oldest = resultCache.keys().next().value
  if (typeof oldest === 'string') resultCache.delete(oldest)
}

function searchWithTimeout(
  search: (signal: AbortSignal) => Promise<SearchResult[]>,
  parentSignal?: AbortSignal,
): Promise<SearchResult[]> {
  if (parentSignal?.aborted) return Promise.reject(abortError())

  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', handleParentAbort)
      controller.signal.removeEventListener('abort', handleAbort)
      callback()
    }
    const handleAbort = () => finish(() => reject(abortError()))
    const handleParentAbort = () => controller.abort(abortError())
    const timeout = setTimeout(
      () => controller.abort(abortError()),
      SEARCH_PROVIDER_TIMEOUT_MS,
    )

    controller.signal.addEventListener('abort', handleAbort, { once: true })
    parentSignal?.addEventListener('abort', handleParentAbort, { once: true })
    void search(controller.signal).then(
      (results) => finish(() => resolve(results)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function deduplicateAndRank(groups: SearchResult[][]): SearchResult[] {
  const accepted: SearchResult[] = []
  return groups
    .flat()
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'fr'))
    .filter((result) => {
      const primaryName = normalizeSearchText(result.label.split(',')[0] ?? result.label)
      const duplicate = accepted.some((existing) => {
        const existingName = normalizeSearchText(existing.label.split(',')[0] ?? existing.label)
        if (existingName !== primaryName) return false
        const officialWithWorldFallback = existing.provider !== result.provider
          && (existing.provider === 'geonames' || result.provider === 'geonames')
        if (
          result.lat == null
          || result.lng == null
          || existing.lat == null
          || existing.lng == null
          || !hasValidCoordinates(result.lat, result.lng)
          || !hasValidCoordinates(existing.lat, existing.lng)
        ) return officialWithWorldFallback || existing.id === result.id
        return Math.abs(existing.lat - result.lat) < 0.12
          && Math.abs(existing.lng - result.lng) < 0.12
      })
      if (duplicate) return false
      accepted.push(result)
      return true
    })
    .slice(0, 8)
}

export async function searchLocations(
  query: string,
  options: SearchRequestOptions = {},
): Promise<SearchResult[]> {
  const normalized = normalizeSearchText(query)
  if (normalized.length < MIN_SEARCH_CHARACTERS) return []
  if (options.signal?.aborted) throw abortError()

  const cached = resultCache.get(normalized)
  if (cached) return cached

  const searches = await Promise.allSettled([
    searchWithTimeout(
      (signal) => searchFrance(query, { fetcher: options.fetcher, signal }),
      options.signal,
    ),
    searchWithTimeout(
      (signal) => searchSpain(query, { fetcher: options.fetcher, signal }),
      options.signal,
    ),
    searchWithTimeout(
      (signal) => searchWorldCities(query, { fetcher: options.fetcher, signal }),
      options.signal,
    ),
  ])
  if (options.signal?.aborted) throw abortError()

  const fulfilled = searches.flatMap((search) => search.status === 'fulfilled' ? [search.value] : [])
  if (fulfilled.length === 0) {
    throw new Error('Les services de recherche ne répondent pas')
  }

  const results = deduplicateAndRank(fulfilled)
  // A transient provider outage must not poison the session cache with an
  // incomplete answer. Partial results remain useful for the current query.
  if (searches.every((search) => search.status === 'fulfilled')) {
    cacheResult(normalized, results)
  }
  return results
}

export async function resolveSearchResult(
  result: SearchResult,
  options: SearchRequestOptions = {},
): Promise<ObserverLocation> {
  if (options.signal?.aborted) throw abortError()
  const cached = resolvedLocationCache.get(result.id)
  if (cached) return cached

  const coordinates = result.lat != null
    && result.lng != null
    && hasValidCoordinates(result.lat, result.lng)
    ? { lat: result.lat, lng: result.lng }
    : await resolveSpainResult(result, options)
  const location: ObserverLocation = {
    ...coordinates,
    label: result.label,
    source: 'search',
  }
  resolvedLocationCache.set(result.id, location)
  return location
}

/** Test-only reset; production caches intentionally last for the tab. */
export function clearSearchCaches(): void {
  resultCache.clear()
  resolvedLocationCache.clear()
  clearWorldCityCache()
}
