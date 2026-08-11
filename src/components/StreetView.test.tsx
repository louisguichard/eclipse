/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import { StreetView } from './StreetView'

const mocks = vi.hoisted(() => ({
  useStreetViewEmbed: vi.fn(),
}))

vi.mock('../hooks/useStreetViewEmbed', () => ({
  useStreetViewEmbed: mocks.useStreetViewEmbed,
}))

vi.mock('./EclipseOverlay', () => ({
  EclipseOverlay: () => <div data-testid="eclipse-overlay" />,
}))

const OBSERVER: ObserverLocation = {
  lat: 48.8737,
  lng: 2.2959,
  label: 'Paris · Arc de Triomphe',
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

describe('StreetView fixed Embed surface', () => {
  beforeEach(() => {
    mocks.useStreetViewEmbed.mockReturnValue({
      camera: { heading: 284, pitch: 8, zoom: 1 },
      embedUrl: 'https://www.google.com/maps/embed/v1/streetview?key=test',
      iframeKey: 'paris:0',
      iframeRef: { current: null },
      markError: vi.fn(),
      markLoaded: vi.fn(),
      panoramaState: {
        status: 'loading',
        position: null,
        distanceMeters: null,
        radiusMeters: null,
      },
      revision: 0,
      retry: vi.fn(),
      viewportSize: { width: 1280, height: 720 },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps the iframe inert and covers it before loading completes', () => {
    render(<StreetView observer={OBSERVER} snapshot={SNAPSHOT} active />)

    const iframe = screen.getByTitle('Google Street View')
    expect(iframe).toHaveAttribute('inert')
    expect(iframe).toHaveAttribute('aria-hidden', 'true')
    expect(iframe).toHaveAttribute('tabindex', '-1')
    expect(document.querySelector('.street-embed-lock')).toBeInTheDocument()
  })
})
