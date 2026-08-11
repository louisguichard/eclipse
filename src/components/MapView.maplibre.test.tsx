/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import { MapView } from './MapView'

type Handler = (payload: never) => void
type Source = { setData: ReturnType<typeof vi.fn> }

const mocks = vi.hoisted(() => ({
  maps: [] as Array<{
    options: Record<string, unknown>
    sources: Map<string, Source>
    layers: Array<Record<string, unknown>>
    emit: (event: string, payload?: unknown) => void
    setLayoutProperty: ReturnType<typeof vi.fn>
    easeTo: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }>,
  markers: [] as Array<{
    positions: Array<[number, number]>
    remove: ReturnType<typeof vi.fn>
  }>,
  resolveBasemapStyle: vi.fn(async () => 'https://example.test/dark-style.json'),
}))

vi.mock('../lib/mapLibreBasemap', () => ({
  resolveBasemapStyle: mocks.resolveBasemapStyle,
}))

vi.mock('maplibre-gl', () => {
  class MockMap {
    options: Record<string, unknown>
    sources = new globalThis.Map<string, Source>()
    layers: Array<Record<string, unknown>> = [
      { id: 'background', type: 'background' },
      { id: 'labels', type: 'symbol' },
    ]
    handlers = new globalThis.Map<string, Set<Handler>>()
    zoom = 15
    setLayoutProperty = vi.fn()
    easeTo = vi.fn()
    resize = vi.fn()
    remove = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = options
      mocks.maps.push(this)
      queueMicrotask(() => {
        const attribution = document.createElement('details')
        attribution.className = [
          'maplibregl-ctrl',
          'maplibregl-ctrl-attrib',
          'maplibregl-compact',
          'maplibregl-compact-show',
        ].join(' ')
        ;(options.container as HTMLElement).append(attribution)
        this.emit('load')
      })
    }

    on(event: string, handler: Handler) {
      const handlers = this.handlers.get(event) ?? new Set<Handler>()
      handlers.add(handler)
      this.handlers.set(event, handlers)
      return this
    }

    once(event: string, handler: Handler) {
      const wrapper: Handler = (payload) => {
        this.off(event, wrapper)
        handler(payload)
      }
      return this.on(event, wrapper)
    }

    off(event: string, handler: Handler) {
      this.handlers.get(event)?.delete(handler)
      return this
    }

    emit(event: string, payload?: unknown) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        handler(payload as never)
      }
    }

    addSource(id: string) {
      this.sources.set(id, { setData: vi.fn() })
      return this
    }

    getSource(id: string) {
      return this.sources.get(id)
    }

    addLayer(layer: Record<string, unknown>, beforeId?: string) {
      const index = beforeId
        ? this.layers.findIndex(({ id }) => id === beforeId)
        : -1
      if (index < 0) this.layers.push(layer)
      else this.layers.splice(index, 0, layer)
      return this
    }

    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id)
    }

    getStyle() {
      return { version: 8, sources: {}, layers: this.layers }
    }

    getBounds() {
      return {
        getNorth: () => 48.95,
        getSouth: () => 48.75,
        getEast: () => 2.5,
        getWest: () => 2.15,
      }
    }

    getZoom() {
      return this.zoom
    }
  }

  class MockMarker {
    positions: Array<[number, number]> = []
    remove = vi.fn(() => this)

    constructor() {
      mocks.markers.push(this)
    }

    setLngLat(position: [number, number]) {
      this.positions.push(position)
      return this
    }

    addTo() {
      return this
    }
  }

  return { Map: MockMap, Marker: MockMarker, addProtocol: vi.fn() }
})

const OBSERVER: ObserverLocation = {
  lat: 48.8566,
  lng: 2.3522,
  label: 'Paris',
  source: 'default',
}

const SNAPSHOT = {
  date: new Date('2026-08-12T18:17:00.000Z'),
  sun: { azimuth: 284, altitude: 8 },
  moon: { azimuth: 284, altitude: 8 },
  sunAngularRadius: 0.26,
  moonAngularRadius: 0.27,
  centerSeparation: 0.1,
  obscuration: 0.92,
  magnitude: 0.94,
  moonOffset: { horizontal: 0, vertical: 0 },
  circumstances: {
    visible: true,
    begin: { time: new Date('2026-08-12T17:22:00.000Z'), altitude: 16 },
    maximum: { time: new Date('2026-08-12T18:17:00.000Z'), altitude: 8 },
    end: { time: new Date('2026-08-12T19:09:00.000Z'), altitude: 0 },
    peakObscuration: 0.92,
    kind: 'partial',
  },
  sunset: new Date('2026-08-12T19:10:00.000Z'),
  phaseLabel: 'Maximum',
} satisfies EclipseSnapshot

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(min-width: 861px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => true,
    })),
  })
}

beforeEach(() => {
  mocks.maps.length = 0
  mocks.markers.length = 0
  vi.clearAllMocks()
  installMatchMedia(false)
})

afterEach(cleanup)

describe('MapView MapLibre lifecycle', () => {
  it('lazy-loads on mobile and initializes once the Carte tab is active', async () => {
    const { rerender } = render(
      <MapView observer={OBSERVER} snapshot={SNAPSHOT} active={false} onLocationChange={vi.fn()} />,
    )

    await act(async () => undefined)
    expect(mocks.maps).toHaveLength(0)

    rerender(
      <MapView observer={OBSERVER} snapshot={SNAPSHOT} active onLocationChange={vi.fn()} />,
    )
    await waitFor(() => expect(mocks.maps).toHaveLength(1))
    expect(mocks.maps[0].options.style).toBe('https://example.test/dark-style.json')
    expect(mocks.maps[0].options.attributionControl).toEqual({ compact: true })
    expect(document.querySelector('.maplibregl-compact-show')).toBeNull()
  })

  it('adds LiDAR and solar layers, handles clicks, then releases MapLibre', async () => {
    const onLocationChange = vi.fn()
    const { unmount } = render(
      <MapView observer={OBSERVER} snapshot={SNAPSHOT} active onLocationChange={onLocationChange} />,
    )
    await waitFor(() => expect(mocks.maps).toHaveLength(1))
    const map = mocks.maps[0]
    await waitFor(() => expect(map.sources.has('solar-direction-source')).toBe(true))

    expect(map.layers.some(({ id }) => String(id).startsWith('visibility-layer-'))).toBe(true)
    expect(map.sources.get('solar-direction-source')?.setData).toHaveBeenCalled()

    act(() => map.emit('click', { lngLat: { lat: 48.87, lng: 2.38 } }))
    expect(onLocationChange).toHaveBeenCalledWith({
      lat: 48.87,
      lng: 2.38,
      label: 'Point sélectionné',
      source: 'map',
    })

    unmount()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(mocks.markers[0].remove).toHaveBeenCalledOnce()
  })
})
