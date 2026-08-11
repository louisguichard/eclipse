import type { ObserverLocation } from '../../types'

export type SearchProvider = 'geoplateforme' | 'cartociudad' | 'geonames'

export type SearchResult = {
  /** Stable within a provider and suitable for React/ARIA identifiers. */
  id: string
  label: string
  detail: string
  provider: SearchProvider
  lat: number | null
  lng: number | null
  rank: number
  resolver?: {
    id: string
    type: string
  }
}

export type SearchFetcher = typeof fetch

export type SearchRequestOptions = {
  fetcher?: SearchFetcher
  signal?: AbortSignal
}

export type ResolvedSearchLocation = ObserverLocation
