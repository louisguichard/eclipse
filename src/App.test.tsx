/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelinePlaybackController } from './hooks/useTimelinePlayback'
import type { EclipseSnapshot, ObserverLocation } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  setMinute: vi.fn(),
  requestGeolocation: vi.fn(),
  desktopPlayback: null as TimelinePlaybackController | null,
  mobilePlayback: null as TimelinePlaybackController | null,
}))

const MAP_POINT: ObserverLocation = {
  lat: 48.86,
  lng: 2.35,
  label: 'Point sélectionné',
  source: 'map',
}

const SEARCH_POINT: ObserverLocation = {
  lat: 48.87,
  lng: 2.34,
  label: 'Adresse sélectionnée',
  source: 'search',
}

const snapshot = {
  date: new Date('2026-08-12T18:17:00.000Z'),
  obscuration: 0.92,
  sun: { azimuth: 284, altitude: 7.8 },
  moon: { azimuth: 284, altitude: 7.8 },
  circumstances: {
    visible: true,
    begin: { time: new Date('2026-08-12T17:22:00.000Z'), altitude: 16 },
    maximum: { time: new Date('2026-08-12T18:17:00.000Z'), altitude: 8 },
    end: { time: new Date('2026-08-12T19:09:00.000Z'), altitude: 0 },
    peakObscuration: 0.92,
    kind: 'partial',
  },
} as EclipseSnapshot

vi.mock('./lib/googleMaps', () => ({ hasGoogleMapsApiKey: false }))
vi.mock('./hooks/useObserverLocation', () => ({
  useObserverLocation: () => ({
    location: { lat: 48.8566, lng: 2.3522, label: 'Paris', source: 'default' },
    setLocation: mocks.setLocation,
    minute: 62,
    setMinute: mocks.setMinute,
    requestGeolocation: mocks.requestGeolocation,
    geolocationStatus: 'idle',
    shareUrl: () => 'https://example.test/eclipse',
  }),
}))
vi.mock('./hooks/useEclipse', () => ({ useEclipse: () => ({ snapshot, error: null }) }))
vi.mock('./hooks/useWeather', () => ({
  useWeather: () => ({
    status: 'ready',
    error: null,
    refresh: vi.fn(),
    timeZone: 'Europe/Paris',
    snapshot: { cloudCover: 10 },
  }),
}))

vi.mock('./components/LocationSearch', () => ({
  LocationSearch: ({ onSelect }: { onSelect: (location: ObserverLocation) => void }) => (
    <button type="button" onClick={() => onSelect(SEARCH_POINT)}>Choisir adresse</button>
  ),
}))
vi.mock('./components/MapView', () => ({
  MapView: ({ onLocationChange }: { onLocationChange: (location: ObserverLocation) => void }) => (
    <button type="button" onClick={() => onLocationChange(MAP_POINT)}>Choisir point carte</button>
  ),
}))
vi.mock('./components/StreetView', () => ({
  StreetView: ({ onUserPositionChange }: { onUserPositionChange?: (position: { lat: number; lng: number }) => void }) => (
    <button
      type="button"
      onClick={() => onUserPositionChange?.({ lat: 48.873667, lng: 2.295891 })}
    >
      Avancer dans Street View
    </button>
  ),
}))
vi.mock('./components/EclipseInfo', () => ({ EclipseInfo: () => null }))
vi.mock('./components/LegalModal', () => ({ LegalModal: () => null }))
vi.mock('./components/MobileDialTimeline', () => ({
  MobileDialTimeline: ({ playback }: { playback: TimelinePlaybackController }) => {
    mocks.mobilePlayback = playback
    return (
      <button type="button" onClick={playback.togglePlayback}>
        Mobile {playback.playing ? 'lecture' : 'pause'}
      </button>
    )
  },
}))
vi.mock('./components/SunDisc', () => ({ SunDisc: () => null }))
vi.mock('./components/Timeline', () => ({
  Timeline: ({ playback }: { playback: TimelinePlaybackController }) => {
    mocks.desktopPlayback = playback
    return (
      <button type="button" onClick={playback.togglePlayback}>
        Desktop {playback.playing ? 'lecture' : 'pause'}
      </button>
    )
  },
}))
vi.mock('./components/WeatherCard', () => ({ WeatherCard: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile view routing', () => {
  it('opens Street View after selecting a point on the map', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Carte' }))
    expect(screen.getByRole('tab', { name: 'Carte' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Choisir point carte' }))

    expect(mocks.setLocation).toHaveBeenCalledWith(MAP_POINT)
    expect(screen.getByRole('tab', { name: 'Vue' })).toHaveAttribute('aria-selected', 'true')
  })

  it('expands and reduces the desktop map without replacing it', () => {
    render(<App />)
    const map = document.querySelector('#observation-map')
    const mapControl = screen.getByRole('button', { name: 'Agrandir la carte' })

    fireEvent.click(mapControl)

    expect(map).toHaveClass('is-desktop-expanded')
    expect(document.querySelector('#observation-map')).toBe(map)
    expect(mapControl).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Fermer la carte agrandie' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Réduire la carte' }))

    expect(map).not.toHaveClass('is-desktop-expanded')
    expect(document.querySelector('#observation-map')).toBe(map)
    expect(screen.queryByRole('button', { name: 'Fermer la carte agrandie' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Agrandir la carte' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la carte agrandie' }))
    expect(map).not.toHaveClass('is-desktop-expanded')
  })

  it('closes the enlarged map with Escape or a map selection', () => {
    render(<App />)
    const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Agrandir la carte' }))

    expand()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Agrandir la carte' })).toHaveAttribute('aria-expanded', 'false')

    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Choisir point carte' }))
    expect(screen.getByRole('button', { name: 'Agrandir la carte' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('tab', { name: 'Vue' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not change tabs when an address is selected', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Carte' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choisir adresse' }))

    expect(mocks.setLocation).toHaveBeenCalledWith(SEARCH_POINT)
    expect(screen.getByRole('tab', { name: 'Carte' })).toHaveAttribute('aria-selected', 'true')
  })

  it('promotes a Street View walk to the observer so URL sharing follows it', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Avancer dans Street View' }))

    expect(mocks.setLocation).toHaveBeenCalledWith({
      lat: 48.873667,
      lng: 2.295891,
      label: 'Position Street View',
      source: 'streetview',
    })
  })

  it('keeps sharing in the title menu with an explicit author label', () => {
    render(<App />)
    const menuItems = screen.getAllByRole('menuitem', { hidden: true })
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'Partager',
      'Code source',
      'Auteur',
    ])
    expect(screen.getByRole('menuitem', { name: 'Auteur — louisguichard.fr', hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ma position', hidden: true })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Éclipse.*12 août 2026/ }))
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveClass('mobile-layer-scrim--menu')
    expect(document.querySelector('.desktop-search-cluster')).toHaveAttribute('inert')
    expect(document.querySelector('.mobile-search-trigger')).toHaveAttribute('inert')

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(document.querySelector('.desktop-search-cluster')).not.toHaveAttribute('inert')
    expect(document.querySelector('.mobile-search-trigger')).not.toHaveAttribute('inert')
  })

  it('keeps a dedicated geolocation control beside desktop search', () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('Ma position'))
    expect(mocks.requestGeolocation).toHaveBeenCalledOnce()
  })

  it('shares one playback controller between desktop and mobile presentations', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<App />)

    expect(mocks.desktopPlayback).toBe(mocks.mobilePlayback)
    fireEvent.click(screen.getByRole('button', { name: 'Desktop pause' }))
    expect(screen.getByRole('button', { name: 'Desktop lecture' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mobile lecture' })).toBeInTheDocument()
    expect(mocks.setMinute).toHaveBeenCalledWith(7)
  })
})
