/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EclipseSnapshot,
  LatLng,
  ObserverLocation,
  StreetViewCamera,
} from '../types'
import { useStreetViewEmbed } from './useStreetViewEmbed'

const googleMapsMocks = vi.hoisted(() => ({
  googleStreetViewEmbedUrl: vi.fn(),
}))

vi.mock('../lib/googleMaps', () => ({
  googleStreetViewEmbedUrl: googleMapsMocks.googleStreetViewEmbedUrl,
  hasGoogleMapsEmbedApiKey: true,
}))

const PARIS: ObserverLocation = {
  lat: 48.8566,
  lng: 2.3522,
  label: 'Paris',
  source: 'search',
}

const MADRID: ObserverLocation = {
  lat: 40.4168,
  lng: -3.7038,
  label: 'Madrid',
  source: 'search',
}

const OVIEDO: ObserverLocation = {
  lat: 43.3614,
  lng: -5.8494,
  label: 'Oviedo',
  source: 'search',
}

function snapshotAt(isoDate: string, azimuth: number, altitude: number): EclipseSnapshot {
  return {
    date: new Date(isoDate),
    sun: { azimuth, altitude },
    moon: { azimuth: azimuth + 0.1, altitude: altitude + 0.1 },
    sunAngularRadius: 0.263,
    moonAngularRadius: 0.272,
    centerSeparation: 0.1,
    obscuration: 0.5,
    magnitude: 0.5,
    moonOffset: { horizontal: 0.1, vertical: 0.1 },
    circumstances: {
      visible: true,
      begin: { time: new Date('2026-08-12T17:22:00.000Z'), altitude: 16 },
      maximum: { time: new Date('2026-08-12T18:17:00.000Z'), altitude: 8 },
      end: { time: new Date('2026-08-12T19:09:00.000Z'), altitude: 0 },
      peakObscuration: 0.92,
      kind: 'partial',
    },
    sunset: new Date('2026-08-12T19:11:00.000Z'),
    phaseLabel: 'L’éclipse progresse',
  }
}

function fakeEmbedUrl(location: LatLng, camera: StreetViewCamera): string {
  const params = new URLSearchParams({
    location: `${location.lat},${location.lng}`,
    heading: String(camera.heading),
    pitch: String(camera.pitch),
    zoom: String(camera.zoom),
  })
  return `https://embed.test/streetview?${params}`
}

describe('useStreetViewEmbed iframe ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    googleMapsMocks.googleStreetViewEmbedUrl.mockImplementation(fakeEmbedUrl)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('keeps the Embed URL and iframe key stable while only the timeline changes', () => {
    const first = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const second = snapshotAt('2026-08-12T18:18:00.000Z', 286, 5)
    const { result, rerender } = renderHook(
      ({ snapshot }) => useStreetViewEmbed(PARIS, snapshot),
      { initialProps: { snapshot: first } },
    )
    const initial = {
      camera: result.current.camera,
      iframeKey: result.current.iframeKey,
      revision: result.current.revision,
      url: result.current.embedUrl,
    }

    rerender({ snapshot: second })

    expect(result.current.embedUrl).toBe(initial.url)
    expect(result.current.iframeKey).toBe(initial.iframeKey)
    expect(result.current.revision).toBe(initial.revision)
    expect(result.current.camera).toBe(initial.camera)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledOnce()
  })

  it('replaces the iframe once with the latest observer after 220 ms', () => {
    const snapshot = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const { result, rerender } = renderHook(
      ({ observer }) => useStreetViewEmbed(observer, snapshot),
      { initialProps: { observer: PARIS } },
    )
    const initialUrl = result.current.embedUrl
    const initialKey = result.current.iframeKey

    rerender({ observer: MADRID })
    act(() => vi.advanceTimersByTime(100))
    rerender({ observer: OVIEDO })
    act(() => vi.advanceTimersByTime(219))

    expect(result.current.embedUrl).toBe(initialUrl)
    expect(result.current.iframeKey).toBe(initialKey)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledOnce()

    act(() => vi.advanceTimersByTime(1))

    expect(result.current.revision).toBe(1)
    expect(result.current.embedUrl).not.toBe(initialUrl)
    expect(result.current.iframeKey).not.toBe(initialKey)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledTimes(2)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenLastCalledWith(
      { lat: OVIEDO.lat, lng: OVIEDO.lng },
      expect.any(Object),
    )

    act(() => vi.advanceTimersByTime(1_000))
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledTimes(2)
  })

  it('keeps the current iframe ready when a pending location change is cancelled', () => {
    const snapshot = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const { result, rerender } = renderHook(
      ({ observer }) => useStreetViewEmbed(observer, snapshot),
      { initialProps: { observer: PARIS } },
    )
    act(() => result.current.markLoaded(result.current.revision))
    const initialUrl = result.current.embedUrl

    rerender({ observer: MADRID })
    act(() => vi.advanceTimersByTime(100))
    rerender({ observer: PARIS })
    act(() => vi.advanceTimersByTime(500))

    expect(result.current.panoramaState.status).toBe('ready')
    expect(result.current.revision).toBe(0)
    expect(result.current.embedUrl).toBe(initialUrl)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledOnce()
  })

  it('ignores a stale load event after the observer has replaced the iframe', () => {
    const snapshot = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const { result, rerender } = renderHook(
      ({ observer }) => useStreetViewEmbed(observer, snapshot),
      { initialProps: { observer: PARIS } },
    )
    const staleRevision = result.current.revision
    act(() => result.current.markLoaded(staleRevision))
    expect(result.current.panoramaState.status).toBe('ready')

    rerender({ observer: OVIEDO })
    act(() => vi.advanceTimersByTime(220))
    expect(result.current.revision).toBe(1)
    expect(result.current.panoramaState.status).toBe('loading')

    act(() => result.current.markLoaded(staleRevision))
    expect(result.current.panoramaState.status).toBe('loading')

    act(() => result.current.markLoaded(result.current.revision))
    expect(result.current.panoramaState.status).toBe('ready')
  })

  it('can retry a failed Embed without enabling the JavaScript provider', () => {
    const snapshot = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const { result } = renderHook(() => useStreetViewEmbed(PARIS, snapshot))
    const initialKey = result.current.iframeKey

    act(() => result.current.markError(result.current.revision))
    expect(result.current.panoramaState.status).toBe('error')
    act(() => result.current.retry())

    expect(result.current.panoramaState.status).toBe('loading')
    expect(result.current.revision).toBe(1)
    expect(result.current.iframeKey).not.toBe(initialKey)
    expect(googleMapsMocks.googleStreetViewEmbedUrl).toHaveBeenCalledTimes(2)
  })
})
