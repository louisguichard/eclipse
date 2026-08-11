import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchFetcher } from './types'
import { clearWorldCityCache, searchWorldCities, WORLD_CITIES_URL } from './worldCities'

function cityResponse(): Response {
  return new Response(JSON.stringify([
    [2643743, 'London', 'London', 'GB', 'ENG', 51.50853, -0.12574, 8961989],
    [2988507, 'Paris', 'Paris', 'FR', '11', 48.85341, 2.3488, 2138551],
    [3117735, 'Madrid', 'Madrid', 'ES', '29', 40.4165, -3.70256, 3255944],
    [5128581, 'New York City', 'New York City', 'US', 'NY', 40.71427, -74.00597, 8804190],
    [1850147, 'Tokyo', 'Tokyo', 'JP', '40', 35.6895, 139.69171, 8336599],
  ]))
}

describe('lazy GeoNames world city index', () => {
  beforeEach(() => clearWorldCityCache())

  it('does not fetch the asset before the minimum query length', async () => {
    const fetcher = vi.fn() as unknown as SearchFetcher
    await expect(searchWorldCities('Lo', { fetcher })).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('loads the static asset lazily, normalizes text and caches it', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => cityResponse())
    const fetcher = fetchMock as unknown as SearchFetcher
    const first = await searchWorldCities('london', { fetcher })
    const second = await searchWorldCities('tokyo', { fetcher })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(WORLD_CITIES_URL)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(first[0]).toMatchObject({
      id: 'world:2643743',
      provider: 'geonames',
      lat: 51.50853,
      lng: -0.12574,
    })
    expect(second[0]?.label).toContain('Tokyo')
  })

  it('retains France and Spain as a national-provider fallback', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => cityResponse())
    const fetcher = fetchMock as unknown as SearchFetcher

    expect((await searchWorldCities('Paris', { fetcher }))[0]).toMatchObject({
      id: 'world:2988507',
      provider: 'geonames',
    })
    expect((await searchWorldCities('Madrid', { fetcher }))[0]).toMatchObject({
      id: 'world:3117735',
      provider: 'geonames',
    })
  })

  it('shares the first download when an obsolete query is aborted', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    const fetcher = fetchMock as unknown as SearchFetcher
    const controller = new AbortController()

    const obsolete = searchWorldCities('London', { fetcher, signal: controller.signal })
    controller.abort()
    await expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })

    const current = searchWorldCities('Tokyo', { fetcher })
    resolveFetch(cityResponse())
    await expect(current).resolves.toMatchObject([{
      id: 'world:1850147',
      provider: 'geonames',
    }])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeUndefined()
  })
})
