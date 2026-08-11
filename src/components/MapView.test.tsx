/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import type { VisibilityDatasetManifest } from '../types/visibility'
import { MapView, VisibilityLegend } from './MapView'

type MockHandler = (event: never) => void

type MockSource = {
  definition: Record<string, unknown>
  setData: ReturnType<typeof vi.fn>
}

type MockMapInstance = {
  options: Record<string, unknown>
  sources: Map<string, MockSource>
  layers: Array<Record<string, unknown>>
  touchZoomRotate: { disableRotation: ReturnType<typeof vi.fn> }
  emit: (event: string, payload?: unknown) => void
  setLayoutProperty: ReturnType<typeof vi.fn>
  easeTo: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

type MockMarkerInstance = {
  positions: Array<[number, number]>
  remove: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  maps: [] as MockMapInstance[],
  markers: [] as MockMarkerInstance[],
  resolveBasemapStyle: vi.fn(async () => 'https://example.test/dark-style.json'),
}))

vi.mock('../lib/mapLibreBasemap', () => ({
  resolveBasemapStyle: mocks.resolveBasemapStyle,
}))

vi.mock('maplibre-gl', () => {
  class MockMap implements MockMapInstance {
    options: Record<string, unknown>
    sources = new globalThis.Map<string, MockSource>()
    layers: Array<Record<string, unknown>> = [
      { id: 'background', type: 'background' },
      { id: 'place-labels', type: 'symbol' },
    ]
    handlers = new globalThis.Map<string, Set<MockHandler>>()
    zoom = 15
    setLayoutProperty = vi.fn()
    easeTo = vi.fn()
    resize = vi.fn()
    remove = vi.fn()
    touchZoomRotate = { disableRotation: vi.fn() }

    constructor(options: Record<string, unknown>) {
      this.options = options
      mocks.maps.push(this)
      queueMicrotask(() => this.emit('load'))
    }

    on(event: string, handler: MockHandler) {
      const handlers = this.handlers.get(event) ?? new Set<MockHandler>()
      handlers.add(handler)
      this.handlers.set(event, handlers)
      return this
    }

    once(event: string, handler: MockHandler) {
      const wrapper: MockHandler = (payload) => {
        this.off(event, wrapper)
        handler(payload)
      }
      return this.on(event, wrapper)
    }

    off(event: string, handler: MockHandler) {
      this.handlers.get(event)?.delete(handler)
      return this
    }

    emit(event: string, payload?: unknown) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        handler(payload as never)
      }
    }

    addSource(id: string, definition: Record<string, unknown>) {
      this.sources.set(id, { definition, setData: vi.fn() })
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

  class MockMarker implements MockMarkerInstance {
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

  return {
    Map: MockMap,
    Marker: MockMarker,
    addProtocol: vi.fn(),
  }
})

const MANIFEST: VisibilityDatasetManifest = {
  id: 'fixture-maximum-geometry',
  version: 'fixture-v1',
  label: 'Agglomération test · 5 m',
  availability: 'ready',
  coverage: { north: 49, south: 48, east: 3, west: 2 },
  reference: {
    mode: 'local-maximum',
    label: 'Maximum local · Agglomération test',
  },
  surface: {
    description: 'Surface de test.',
    resolutionMeters: 5,
    observerHeightMeters: 1.7,
    includesBuildings: true,
    includesVegetation: true,
    sources: [],
  },
  tiles: {
    scheme: 'xyz',
    tileSize: 256,
    minZoom: 8,
    maxZoom: 15,
    urlTemplate: 'https://example.test/{version}/{z}/{x}/{y}.png',
  },
  legend: [],
  attribution: '© Source cartographique test · Licence test',
  disclaimer: 'Estimation géométrique de test.',
  warnings: [
    'Prudence : le relief situé au-delà des 15 km calculés peut encore masquer le Soleil dans cette zone.',
  ],
}

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
  const listeners = new Set<() => void>()
  const mediaQuery = {
    matches,
    media: '(min-width: 861px)',
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQuery),
  })
}

beforeEach(() => {
  mocks.maps.length = 0
  mocks.markers.length = 0
  vi.clearAllMocks()
  installMatchMedia(false)
})

afterEach(cleanup)

describe('VisibilityLegend', () => {
  it('describes yellow as a probable clearance and reads source metadata from the manifest', () => {
    render(<VisibilityLegend preferredVisibilityDataset={MANIFEST} />)

    expect(screen.getByText('En jaune : dégagement probable')).toBeInTheDocument()
    expect(screen.getByText('Agglomération test · 5 m · maximum local · hors météo')).toBeInTheDocument()
    expect(screen.getByText('© Source cartographique test · Licence test · Résolution 5 m')).toBeInTheDocument()
    expect(screen.getByText(/relief situé au-delà des 15 km calculés/)).toBeInTheDocument()
    expect(screen.queryByText('Soleil probablement visible')).not.toBeInTheDocument()
  })

  it('advertises the twenty largest urban areas outside published coverage', () => {
    render(<VisibilityLegend />)

    expect(screen.getByText('Couche LiDAR disponible dans les 20 plus grandes agglomérations de France')).toBeInTheDocument()
    expect(screen.queryByText(/Île-de-France uniquement/i)).not.toBeInTheDocument()
  })
})

describe('MapView MapLibre lifecycle', () => {
  it('does not initialize on the inactive mobile tab, then initializes when activated', async () => {
    const { rerender } = render(
      <MapView
        observer={OBSERVER}
        snapshot={SNAPSHOT}
        active={false}
        onLocationChange={vi.fn()}
      />,
    )

    await act(async () => undefined)
    expect(mocks.maps).toHaveLength(0)

    rerender(
      <MapView
        observer={OBSERVER}
        snapshot={SNAPSHOT}
        active
        onLocationChange={vi.fn()}
      />,
    )
    await waitFor(() => expect(mocks.maps).toHaveLength(1))
    expect(mocks.maps[0].options.style).toBe('https://example.test/dark-style.json')
    expect(mocks.maps[0].options.attributionControl).toBe(false)
    expect(mocks.maps[0].options).toMatchObject({
      boxZoom: true,
      doubleClickZoom: true,
      dragPan: true,
      dragRotate: false,
      keyboard: true,
      scrollZoom: true,
      touchPitch: false,
      touchZoomRotate: true,
    })
    expect(mocks.maps[0].touchZoomRotate.disableRotation).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: '© OpenMapTiles' })).toHaveAttribute(
      'href',
      'https://www.openmaptiles.org/',
    )
    expect(screen.getByRole('link', { name: '© OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
  })

  it('initializes the visible desktop inset even when active is false', async () => {
    installMatchMedia(true)
    render(
      <MapView
        observer={OBSERVER}
        snapshot={SNAPSHOT}
        active={false}
        onLocationChange={vi.fn()}
      />,
    )

    await waitFor(() => expect(mocks.maps).toHaveLength(1))
  })

  it('adds LiDAR and solar layers, handles map clicks, updates the marker, and cleans up', async () => {
    const onLocationChange = vi.fn()
    const { rerender, unmount } = render(
      <MapView
        observer={OBSERVER}
        snapshot={SNAPSHOT}
        active
        onLocationChange={onLocationChange}
      />,
    )
    await waitFor(() => expect(mocks.maps).toHaveLength(1))
    const map = mocks.maps[0]
    await waitFor(() => expect(map.sources.has('solar-direction-source')).toBe(true))

    expect(map.layers.some(({ id }) => String(id).startsWith('visibility-layer-'))).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'visibility-layer-paris-maximum-geometry',
      'visibility',
      'visible',
    )
    expect(map.sources.get('solar-direction-source')?.setData).toHaveBeenCalled()

    act(() => {
      map.emit('click', { lngLat: { lat: 48.87, lng: 2.38 } })
    })
    expect(onLocationChange).toHaveBeenCalledWith({
      lat: 48.87,
      lng: 2.38,
      label: 'Point sélectionné',
      source: 'map',
    })

    const nextObserver: ObserverLocation = {
      ...OBSERVER,
      lat: 48.9,
      lng: 2.4,
      source: 'search',
    }
    rerender(
      <MapView
        observer={nextObserver}
        snapshot={SNAPSHOT}
        active
        onLocationChange={onLocationChange}
      />,
    )
    await waitFor(() => {
      expect(mocks.markers[0].positions).toContainEqual([2.4, 48.9])
    })
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [2.4, 48.9],
      zoom: 16,
    }))

    unmount()
    expect(map.remove).toHaveBeenCalledOnce()
    expect(mocks.markers[0].remove).toHaveBeenCalledOnce()
  })
})
