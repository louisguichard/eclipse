/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREET_VIEW } from '../config/eclipse'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import { findNearestPanorama, useStreetView } from './useStreetView'
import type { UseStreetViewResult } from './useStreetView'

const googleMapsMocks = vi.hoisted(() => ({
  loadGoogleLibrary: vi.fn(),
}))

vi.mock('../lib/googleMaps', () => ({
  hasGoogleMapsApiKey: true,
  loadGoogleLibrary: googleMapsMocks.loadGoogleLibrary,
}))

const SOURCE = {
  DEFAULT: 'default',
  GOOGLE: 'google',
  OUTDOOR: 'outdoor',
} as const

function responseAt(lat: number, lng: number): google.maps.StreetViewResponse {
  return {
    data: {
      location: {
        pano: `pano-${lat}-${lng}`,
        latLng: {
          lat: () => lat,
          lng: () => lng,
        },
      },
    },
  } as unknown as google.maps.StreetViewResponse
}

function lookupInstances(getPanorama: ReturnType<typeof vi.fn>) {
  return {
    library: {
      StreetViewPreference: { NEAREST: 'nearest' },
      StreetViewSource: SOURCE,
    },
    panorama: {},
    service: { getPanorama },
  } as unknown as Parameters<typeof findNearestPanorama>[0]
}

describe('findNearestPanorama', () => {
  it('restricts every lookup to official Google outdoor panoramas', async () => {
    const getPanorama = vi.fn().mockResolvedValue(responseAt(48.8737, 2.2959))

    const result = await findNearestPanorama(
      lookupInstances(getPanorama),
      { lat: 48.8737, lng: 2.2959 },
      () => true,
    )

    expect(result?.pano).toBe('pano-48.8737-2.2959')
    expect(getPanorama).toHaveBeenCalledOnce()
    expect(getPanorama).toHaveBeenCalledWith(expect.objectContaining({
      preference: 'nearest',
      sources: ['google', 'outdoor'],
    }))
  })

  it('widens the radius without falling back to the default source', async () => {
    const getPanorama = vi.fn().mockRejectedValue('ZERO_RESULTS')

    const result = await findNearestPanorama(
      lookupInstances(getPanorama),
      { lat: 48.8741, lng: 2.2964 },
      () => true,
    )

    expect(result).toBeNull()
    expect(getPanorama).toHaveBeenCalledTimes(STREET_VIEW.searchRadiiMeters.length)
    expect(getPanorama.mock.calls.map(([request]) => request.radius)).toEqual(
      STREET_VIEW.searchRadiiMeters,
    )
    expect(getPanorama.mock.calls.every(([request]) =>
      request.sources.join(',') === 'google,outdoor')).toBe(true)
  })
})

type Listener = () => void

class FakeStreetViewPanorama {
  private listeners = new Map<string, Set<Listener>>()
  private pano = ''
  private pov = { heading: 0, pitch: 0 }
  private position = { lat: () => 48.9, lng: () => 2.3 }
  private zoom: number = STREET_VIEW.zoom

  addListener = vi.fn((eventName: string, listener: Listener) => {
    const listeners = this.listeners.get(eventName) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(eventName, listeners)
    return { remove: () => listeners.delete(listener) }
  })

  getLinks = vi.fn(() => [])
  getPano = vi.fn(() => this.pano)
  getPosition = vi.fn(() => this.position)
  getPov = vi.fn(() => this.pov)
  getZoom = vi.fn(() => this.zoom)
  setPano = vi.fn((pano: string) => { this.pano = pano })
  setPov = vi.fn((pov: { heading: number; pitch: number }) => { this.pov = pov })
  setVisible = vi.fn()
  setZoom = vi.fn((zoom: number) => { this.zoom = zoom })

  changeCamera(heading: number, pitch: number, zoom: number) {
    this.pov = { heading, pitch }
    this.zoom = zoom
    for (const eventName of ['pov_changed', 'zoom_changed']) {
      for (const listener of this.listeners.get(eventName) ?? []) listener()
    }
  }
}

class FakeStreetViewService {
  getPanorama = vi.fn().mockResolvedValue(responseAt(48.9, 2.3))
}

const fakePanoramas: FakeStreetViewPanorama[] = []

function streetViewLibrary() {
  return {
    StreetViewPanorama: class extends FakeStreetViewPanorama {
      constructor() {
        super()
        fakePanoramas.push(this)
      }
    },
    StreetViewService: FakeStreetViewService,
    StreetViewPreference: { NEAREST: 'nearest' },
    StreetViewSource: SOURCE,
  } as unknown as google.maps.StreetViewLibrary
}

const OBSERVER: ObserverLocation = {
  lat: 48.9,
  lng: 2.3,
  label: 'Test',
  source: 'search',
}

function snapshotAt(isoDate: string, azimuth: number, altitude: number): EclipseSnapshot {
  const date = new Date(isoDate)
  return {
    date,
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

let latestStreetView: UseStreetViewResult | null = null
let animationFrames: FrameRequestCallback[] = []

function flushAnimationFrames() {
  const callbacks = animationFrames.splice(0)
  for (const callback of callbacks) callback(performance.now())
}

function StreetViewHarness({ snapshot }: { snapshot: EclipseSnapshot }) {
  latestStreetView = useStreetView(OBSERVER, snapshot, true)
  return createElement('div', {
    'data-testid': 'panorama',
    ref: latestStreetView.containerRef,
  })
}

describe('useStreetView camera ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakePanoramas.length = 0
    animationFrames = []
    latestStreetView = null
    googleMapsMocks.loadGoogleLibrary.mockResolvedValue(streetViewLibrary())
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    cleanup()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    googleMapsMocks.loadGoogleLibrary.mockReset()
  })

  it('keeps a user camera stable during playback and lets recenter resume Sun following', async () => {
    const first = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const second = snapshotAt('2026-08-12T18:18:00.000Z', 284.2, 7.8)
    const third = snapshotAt('2026-08-12T18:19:00.000Z', 284.4, 7.6)
    const view = render(createElement(StreetViewHarness, { snapshot: first }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(221)
    })

    const panorama = fakePanoramas[0]
    expect(panorama).toBeDefined()
    expect(latestStreetView?.panoramaState.status).toBe('ready')
    expect(panorama.setPov).toHaveBeenCalledWith({ heading: 284, pitch: 8 })
    expect(panorama.setZoom).toHaveBeenCalledWith(STREET_VIEW.zoom)

    panorama.setPov.mockClear()
    panorama.setZoom.mockClear()
    fireEvent.pointerDown(view.getByTestId('panorama'))
    view.rerender(createElement(StreetViewHarness, { snapshot: second }))

    expect(panorama.setPov).not.toHaveBeenCalled()
    expect(panorama.setZoom).not.toHaveBeenCalled()

    act(() => latestStreetView?.recenter())
    expect(panorama.setPov).toHaveBeenCalledWith({
      heading: expect.closeTo(284.2, 10),
      pitch: 7.8,
    })
    expect(panorama.setZoom).toHaveBeenCalledWith(STREET_VIEW.zoom)

    panorama.setPov.mockClear()
    panorama.setZoom.mockClear()
    view.rerender(createElement(StreetViewHarness, { snapshot: third }))

    expect(panorama.setPov).toHaveBeenCalledWith({
      heading: expect.closeTo(284.4, 10),
      pitch: 7.6,
    })
    expect(panorama.setZoom).not.toHaveBeenCalled()
  })

  it('tracks the latest fractional zoom camera without overriding it', async () => {
    const snapshot = snapshotAt('2026-08-12T18:17:00.000Z', 284, 8)
    const view = render(createElement(StreetViewHarness, { snapshot }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(221)
    })

    const panorama = fakePanoramas[0]
    fireEvent.wheel(view.getByTestId('panorama'))
    panorama.setPov.mockClear()
    panorama.setZoom.mockClear()

    panorama.changeCamera(283.8, 8.4, 1.4)
    panorama.changeCamera(283.2, 9.1, 1.7)
    panorama.changeCamera(282.6, 9.8, 2.2)

    act(flushAnimationFrames)

    expect(latestStreetView?.camera).toEqual({
      heading: 282.6,
      pitch: 9.8,
      zoom: 2.2,
    })
    expect(panorama.setPov).not.toHaveBeenCalled()
    expect(panorama.setZoom).not.toHaveBeenCalled()
  })

})
