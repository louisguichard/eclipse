/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import {
  headingToViewerYaw,
  horizontalFovToStreetZoom,
  useStreetView,
  viewerYawToHeading,
} from './useStreetView'
import type { UseStreetViewResult } from './useStreetView'

type ViewerPosition = { yaw: number; pitch: number }
type ViewerListener = () => void
type FakeViewerShape = {
  destroy: ReturnType<typeof vi.fn>
  panoramaOptions: Record<string, unknown> | null
  rotate: ReturnType<typeof vi.fn>
  state: { hFov: number }
  emitCamera: (position: ViewerPosition, horizontalFov: number) => void
  emitProjection: (point: { x: number; y: number }, visible: boolean) => void
}

const streetlevelMocks = vi.hoisted(() => ({
  findNearestPanorama: vi.fn(),
  loadPanoramaImage: vi.fn(),
}))

const viewerMocks = vi.hoisted(() => ({
  instances: [] as FakeViewerShape[],
  systemLoad: vi.fn(),
}))

vi.mock('../lib/streetlevel', () => ({
  findNearestPanorama: streetlevelMocks.findNearestPanorama,
  loadPanoramaImage: streetlevelMocks.loadPanoramaImage,
}))

vi.mock('@photo-sphere-viewer/core', () => {
  class FakeViewer {
    private listeners = new Map<string, Set<ViewerListener>>()
    private position: ViewerPosition = { yaw: 0, pitch: 0 }
    panoramaOptions: Record<string, unknown> | null = null
    state = { hFov: 90 }
    private projectedPoint = { x: 500, y: 250 }
    private projectedPointVisible = true
    dataHelper = {
      hFovToVFov: (value: number) => value,
      fovToZoomLevel: (value: number) => 100 - value,
      sphericalCoordsToViewerCoords: () => this.projectedPoint,
      isPointVisible: () => this.projectedPointVisible,
    }
    destroy = vi.fn()
    autoSize = vi.fn()
    addEventListener = vi.fn((name: string, listener: ViewerListener) => {
      const listeners = this.listeners.get(name) ?? new Set<ViewerListener>()
      listeners.add(listener)
      this.listeners.set(name, listeners)
    })
    getPosition = vi.fn(() => this.position)
    getSize = vi.fn(() => ({ width: 1000, height: 500 }))
    rotate = vi.fn((position: ViewerPosition) => {
      this.position = position
      this.dispatch('position-updated')
    })
    zoom = vi.fn((level: number) => {
      this.state.hFov = 100 - level
      this.dispatch('zoom-updated')
    })
    setPanorama = vi.fn(async (_url: string, options: Record<string, unknown>) => {
      this.panoramaOptions = options
      const position = options.position as ViewerPosition
      this.position = position
      this.state.hFov = 100 - Number(options.zoom)
      this.dispatch('position-updated')
      this.dispatch('zoom-updated')
      return true
    })

    constructor() {
      viewerMocks.instances.push(this)
    }

    emitCamera(position: ViewerPosition, horizontalFov: number) {
      this.position = position
      this.state.hFov = horizontalFov
      this.dispatch('position-updated')
      this.dispatch('zoom-updated')
    }

    emitProjection(point: { x: number; y: number }, visible: boolean) {
      this.projectedPoint = point
      this.projectedPointVisible = visible
      this.dispatch('position-updated')
    }

    private dispatch(name: string) {
      for (const listener of this.listeners.get(name) ?? []) listener()
    }
  }

  return {
    SYSTEM: { load: viewerMocks.systemLoad },
    Viewer: FakeViewer,
  }
})

const OBSERVER: ObserverLocation = {
  lat: 48.8566,
  lng: 2.3522,
  label: 'Paris',
  source: 'search',
}

const PANORAMA = {
  id: 'pano-current',
  position: { lat: 48.85661, lng: 2.35221 },
  heading: 190,
  pitchCorrection: -0.4,
  rollCorrection: -0.1,
  tileSize: { width: 512, height: 512 },
  imageSizes: [{ width: 416, height: 208 }, { width: 832, height: 416 }],
  links: [{
    pano: 'pano-next',
    heading: 42,
    position: { lat: 48.8567, lng: 2.3523 },
    panoramaHeading: 192,
    pitchCorrection: 0.2,
    rollCorrection: 0.1,
  }],
  copyright: '© 2026 Google',
  source: 'launch',
}

function snapshotAt(azimuth: number, altitude: number): EclipseSnapshot {
  return {
    date: new Date('2026-08-12T18:17:00.000Z'),
    sun: { azimuth, altitude },
    moon: { azimuth, altitude },
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
  const frames = animationFrames.splice(0)
  for (const frame of frames) frame(performance.now())
}

function StreetViewHarness({
  snapshot,
  onMove,
}: {
  snapshot: EclipseSnapshot
  onMove?: (position: { lat: number; lng: number }) => void
}) {
  latestStreetView = useStreetView(OBSERVER, snapshot, true, onMove)
  return createElement('div', {
    'data-testid': 'panorama',
    ref: latestStreetView.containerRef,
  })
}

async function finishLookup() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(221)
    await Promise.resolve()
    await Promise.resolve()
  })
  act(flushAnimationFrames)
}

describe('Streetlevel camera conversion', () => {
  it('aligns an image-relative yaw with true compass north', () => {
    const yaw = headingToViewerYaw(280, 190)
    expect(yaw).toBeCloseTo(Math.PI / 2, 10)
    expect(viewerYawToHeading(yaw, 190)).toBeCloseTo(280, 10)
  })

  it('preserves the existing Street View zoom/FOV relation', () => {
    expect(horizontalFovToStreetZoom(90)).toBeCloseTo(1, 10)
    expect(horizontalFovToStreetZoom(53.130102)).toBeCloseTo(2, 6)
  })
})

describe('useStreetView with the browser Streetlevel provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    viewerMocks.instances.length = 0
    viewerMocks.systemLoad.mockReset()
    animationFrames = []
    latestStreetView = null
    streetlevelMocks.findNearestPanorama.mockResolvedValue(PANORAMA)
    streetlevelMocks.loadPanoramaImage.mockResolvedValue({
      url: 'blob:panorama',
      width: 3328,
      height: 1664,
      zoom: 3,
    })
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
    streetlevelMocks.findNearestPanorama.mockReset()
    streetlevelMocks.loadPanoramaImage.mockReset()
  })

  it('loads, attributes and points the panorama at the Sun without an API key', async () => {
    render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8) }))
    await finishLookup()

    const viewer = viewerMocks.instances[0]
    expect(viewer).toBeDefined()
    expect(latestStreetView?.panoramaState.status).toBe('ready')
    expect(latestStreetView?.attribution).toBe('© 2026 Google')
    expect(latestStreetView?.links).toEqual([
      { pano: 'pano-next', heading: 42, description: 'Avancer' },
    ])
    const position = viewer.panoramaOptions?.position as ViewerPosition
    expect(viewerYawToHeading(position.yaw, PANORAMA.heading)).toBeCloseTo(284, 10)
    expect(position.pitch).toBeCloseTo(8 * Math.PI / 180, 10)
    expect(viewer.panoramaOptions?.sphereCorrection).toEqual({
      tilt: expect.closeTo(-0.4 * Math.PI / 180, 10),
      roll: expect.closeTo(-0.1 * Math.PI / 180, 10),
    })
  })

  it('rejects unsupported WebGL before Photo Sphere Viewer returns an invalid instance', async () => {
    const webglError = new Error('WebGL 2 is not supported.')
    viewerMocks.systemLoad.mockImplementationOnce(() => {
      throw webglError
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8) }))
    await finishLookup()

    expect(viewerMocks.systemLoad).toHaveBeenCalledOnce()
    expect(viewerMocks.instances).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
    expect(latestStreetView?.panoramaState).toMatchObject({
      status: 'unavailable',
      message: 'La vue 360° n’est pas compatible avec ce navigateur ou cet appareil.',
    })
  })

  it('respects a user camera during playback, then recenters on demand', async () => {
    const view = render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8) }))
    await finishLookup()
    const viewer = viewerMocks.instances[0]

    fireEvent.pointerDown(view.getByTestId('panorama'))
    viewer.rotate.mockClear()
    view.rerender(createElement(StreetViewHarness, { snapshot: snapshotAt(286, 7) }))
    expect(viewer.rotate).not.toHaveBeenCalled()

    act(() => latestStreetView?.recenter())
    expect(viewer.rotate).toHaveBeenCalledWith({
      yaw: expect.closeTo(headingToViewerYaw(286, PANORAMA.heading), 10),
      pitch: expect.closeTo(7 * Math.PI / 180, 10),
    })
  })

  it('promotes a neighboring panorama position back to the application', async () => {
    const onMove = vi.fn()
    render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8), onMove }))
    await finishLookup()

    act(() => latestStreetView?.moveTo('pano-next'))
    expect(onMove).toHaveBeenCalledWith(PANORAMA.links[0]?.position)
    expect(latestStreetView?.panoramaState.status).toBe('loading')
  })

  it('maps viewer rotation and fractional FOV back to the overlay camera', async () => {
    render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8) }))
    await finishLookup()
    const viewer = viewerMocks.instances[0]

    act(() => {
      viewer.emitCamera({ yaw: Math.PI / 2, pitch: 0.2 }, 53.130102)
      flushAnimationFrames()
    })
    expect(latestStreetView?.camera.heading).toBeCloseTo(280, 10)
    expect(latestStreetView?.camera.pitch).toBeCloseTo(0.2 * 180 / Math.PI, 10)
    expect(latestStreetView?.camera.zoom).toBeCloseTo(2, 6)
  })

  it('uses the viewer camera for an exact, immediately updated Sun projection', async () => {
    const view = render(createElement(StreetViewHarness, { snapshot: snapshotAt(284, 8) }))
    await finishLookup()
    const viewer = viewerMocks.instances[0]

    act(() => viewer.emitProjection({ x: 725, y: 125 }, true))

    expect(latestStreetView?.sunViewportPoint).toEqual({
      visible: true,
      x: 0.725,
      y: 0.25,
    })
    expect(view.container.style.getPropertyValue('--street-sun-x')).toBe('72.5%')
    expect(view.container.style.getPropertyValue('--street-sun-y')).toBe('25%')
  })
})
