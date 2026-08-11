import { describe, expect, it, vi } from 'vitest'
import {
  CARTOCIUDAD_CANDIDATES_ENDPOINT,
  CARTOCIUDAD_FIND_ENDPOINT,
  GEOPLATEFORME_SEARCH_ENDPOINT,
  resolveSpainResult,
  searchFrance,
  searchSpain,
} from './providers'
import type { SearchFetcher, SearchResult } from './types'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('free official search providers', () => {
  it('uses the current Géoplateforme endpoint and parses BAN GeoJSON', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [2.33115, 48.868989] },
        properties: {
          banId: 'ban-paix-10',
          label: '10 Rue de la Paix 75002 Paris',
          city: 'Paris',
          context: '75, Paris, Île-de-France',
          score: 0.96,
        },
      }],
    }))
    const fetcher = fetchMock as unknown as SearchFetcher

    const results = await searchFrance('10 rue de la paix Paris', { fetcher })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(`${url.origin}${url.pathname}`).toBe(GEOPLATEFORME_SEARCH_ENDPOINT)
    expect(url.searchParams.get('index')).toBe('address')
    expect(url.searchParams.get('autocomplete')).toBe('1')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(results[0]).toMatchObject({
      id: 'fr:ban-paix-10',
      label: '10 Rue de la Paix 75002 Paris',
      provider: 'geoplateforme',
      lat: 48.868989,
      lng: 2.33115,
    })
  })

  it('uses CartoCiudad candidates and defers 0/0 geometries until selection', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([{
      id: '28073',
      province: 'Madrid',
      muni: 'Humanes de Madrid',
      type: 'Municipio',
      address: 'Humanes de Madrid, Madrid',
      lat: 0,
      lng: 0,
    }]))
    const fetcher = fetchMock as unknown as SearchFetcher

    const results = await searchSpain('Humanes de Madrid', { fetcher })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(`${url.origin}${url.pathname}`).toBe(CARTOCIUDAD_CANDIDATES_ENDPOINT)
    expect(url.searchParams.get('limit')).toBe('5')
    expect(results[0]).toMatchObject({
      id: 'es:Municipio:28073',
      provider: 'cartociudad',
      lat: null,
      lng: null,
      resolver: { id: '28073', type: 'Municipio' },
    })
  })

  it('resolves a non-point CartoCiudad candidate by its official id and type', async () => {
    const result: SearchResult = {
      id: 'es:Municipio:28073',
      label: 'Humanes de Madrid, Madrid',
      detail: 'Madrid · CartoCiudad',
      provider: 'cartociudad',
      lat: null,
      lng: null,
      rank: 0,
      resolver: { id: '28073', type: 'Municipio' },
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      id: '28073',
      type: 'Municipio',
      lat: 40.25150425966791,
      lng: -3.8261026335043855,
    }))
    const fetcher = fetchMock as unknown as SearchFetcher

    await expect(resolveSpainResult(result, { fetcher })).resolves.toEqual({
      lat: 40.25150425966791,
      lng: -3.8261026335043855,
    })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(`${url.origin}${url.pathname}`).toBe(CARTOCIUDAD_FIND_ENDPOINT)
    expect(url.searchParams.get('id')).toBe('28073')
    expect(url.searchParams.get('type')).toBe('Municipio')
  })

  it('does not call /find for a point candidate with usable coordinates', async () => {
    const result: SearchResult = {
      id: 'es:toponimo:BTN_396604',
      label: 'Catedral de la Almudena, Madrid',
      detail: 'Madrid · CartoCiudad',
      provider: 'cartociudad',
      lat: 40.4156969,
      lng: -3.7144969,
      rank: 0,
    }
    const fetcher = vi.fn() as unknown as SearchFetcher
    await expect(resolveSpainResult(result, { fetcher })).resolves.toEqual({
      lat: 40.4156969,
      lng: -3.7144969,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
