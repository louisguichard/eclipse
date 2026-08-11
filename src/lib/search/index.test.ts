import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSearchCaches,
  resolveSearchResult,
  SEARCH_PROVIDER_TIMEOUT_MS,
  searchLocations,
} from './index'
import type { SearchFetcher, SearchResult } from './types'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('hybrid location search', () => {
  beforeEach(() => clearSearchCaches())

  it('combines providers and caches a completed query', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('data.geopf.fr')) {
        return jsonResponse({
          features: [{
            geometry: { coordinates: [2.347, 48.859] },
            properties: { id: '75100', label: 'Paris', score: 1 },
          }],
        })
      }
      if (url.includes('cartociudad.es')) return jsonResponse([])
      return jsonResponse([
        [2643743, 'London', 'London', 'GB', 'ENG', 51.50853, -0.12574, 8961989],
        [2988507, 'Paris', 'Paris', 'FR', '11', 48.85341, 2.3488, 2138551],
      ])
    }) as unknown as SearchFetcher

    const first = await searchLocations('Paris', { fetcher })
    const second = await searchLocations(' paris ', { fetcher })
    expect(first[0]).toMatchObject({ label: 'Paris', provider: 'geoplateforme' })
    expect(first.filter((result) => result.label.startsWith('Paris'))).toHaveLength(1)
    expect(second).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('fails immediately with an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(searchLocations('London', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('keeps GeoNames as the fallback when both national providers are down', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/search/world-cities-')) {
        return jsonResponse([
          [2988507, 'Paris', 'Paris', 'FR', '11', 48.85341, 2.3488, 2138551],
        ])
      }
      throw new TypeError('network unavailable')
    }) as unknown as SearchFetcher

    await expect(searchLocations('Paris', { fetcher })).resolves.toMatchObject([{
      id: 'world:2988507',
      provider: 'geonames',
    }])
  })

  it('returns partial results when one provider stalls', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('cartociudad.es')) return new Promise<Response>(() => {})
        if (url.includes('data.geopf.fr')) {
          return jsonResponse({
            features: [{
              geometry: { coordinates: [2.347, 48.859] },
              properties: { id: '75100', label: 'Paris', score: 1 },
            }],
          })
        }
        return jsonResponse([])
      }) as unknown as SearchFetcher

      const pending = searchLocations('Paris', { fetcher })
      await vi.advanceTimersByTimeAsync(SEARCH_PROVIDER_TIMEOUT_MS)
      await expect(pending).resolves.toMatchObject([{
        label: 'Paris',
        provider: 'geoplateforme',
      }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns a direct result into the ObserverLocation contract without network', async () => {
    const result: SearchResult = {
      id: 'world:2643743',
      label: 'London, Royaume-Uni',
      detail: 'Ville · GeoNames',
      provider: 'geonames',
      lat: 51.50853,
      lng: -0.12574,
      rank: 0,
    }
    const fetcher = vi.fn() as unknown as SearchFetcher
    await expect(resolveSearchResult(result, { fetcher })).resolves.toEqual({
      lat: 51.50853,
      lng: -0.12574,
      label: 'London, Royaume-Uni',
      source: 'search',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
