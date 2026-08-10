import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  GitFork,
  Globe2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Search,
  Share2,
  WifiOff,
  X,
} from 'lucide-react'
import { EclipseInfo } from './components/EclipseInfo'
import { LegalModal } from './components/LegalModal'
import { LocationSearch } from './components/LocationSearch'
import { MapView } from './components/MapView'
import { MobileDialTimeline } from './components/MobileDialTimeline'
import { StreetView } from './components/StreetView'
import { Timeline } from './components/Timeline'
import { formatParisDateTime } from './lib/format'
import { hasGoogleMapsApiKey } from './lib/googleMaps'
import { useEclipse } from './hooks/useEclipse'
import { useObserverLocation } from './hooks/useObserverLocation'
import { useWeather } from './hooks/useWeather'
import { useTimelinePlayback } from './hooks/useTimelinePlayback'
import { TIMELINE } from './config/eclipse'
import type { LatLng, MobileView, PanoramaState } from './types'

const INITIAL_PANORAMA: PanoramaState = {
  status: hasGoogleMapsApiKey ? 'idle' : 'demo',
  position: null,
  distanceMeters: null,
  radiusMeters: null,
}

function App() {
  const {
    location,
    setLocation,
    minute,
    setMinute,
    requestGeolocation,
    geolocationStatus,
    shareUrl,
  } = useObserverLocation()
  const { snapshot, error: astronomyError } = useEclipse(location, minute)
  const weather = useWeather(
    location,
    snapshot?.date ?? new Date('2026-08-12T18:17:00.000Z'),
  )
  const [mobileView, setMobileView] = useState<MobileView>('street')
  const [mobileLayer, setMobileLayer] = useState<'menu' | 'search' | null>(null)
  const [desktopMapExpanded, setDesktopMapExpanded] = useState(false)
  // The Sun starts at its true angular size — half a degree, a few pixels.
  // Magnifying it is an explicit choice, not the default impression.
  const [expandedSimulation, setExpandedSimulation] = useState(false)
  const [, setPanorama] = useState<PanoramaState>(INITIAL_PANORAMA)
  const [copied, setCopied] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null)
  const debug = useMemo(() => new URLSearchParams(window.location.search).get('debug') === 'true', [])
  const cloudCover = weather.snapshot?.cloudCover
  const playbackStart = snapshot
    ? (snapshot.circumstances.begin.time.getTime() - TIMELINE.startUtc.getTime()) / 60_000
    : 0
  const playbackEnd = snapshot
    ? (snapshot.circumstances.end.time.getTime() - TIMELINE.startUtc.getTime()) / 60_000
    : TIMELINE.totalMinutes
  const playback = useTimelinePlayback({
    minute,
    start: playbackStart,
    end: playbackEnd,
    blocked: mobileLayer != null,
    onMinuteChange: setMinute,
  })

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  useEffect(() => {
    if (!mobileLayer) return undefined
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileLayer(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [mobileLayer])

  useEffect(() => {
    if (!desktopMapExpanded) return undefined
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDesktopMapExpanded(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [desktopMapExpanded])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mobileViewport = window.matchMedia('(max-width: 860px)')
    const closeExpandedMap = (event: MediaQueryListEvent) => {
      if (event.matches) setDesktopMapExpanded(false)
    }
    mobileViewport.addEventListener('change', closeExpandedMap)
    return () => mobileViewport.removeEventListener('change', closeExpandedMap)
  }, [])

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl())
      setCopied(true)
    } catch (error) {
      console.error('Copy failed', error)
    }
  }, [shareUrl])

  const selectLocation = useCallback((next: Parameters<typeof setLocation>[0]) => {
    setLocation(next)
    setMobileLayer(null)
  }, [setLocation])

  const selectMapLocation = useCallback((next: Parameters<typeof setLocation>[0]) => {
    setLocation(next)
    setDesktopMapExpanded(false)
    setMobileView('street')
  }, [setLocation])

  const selectStreetViewLocation = useCallback((position: LatLng) => {
    setLocation({
      ...position,
      label: 'Position Street View',
      source: 'streetview',
    })
  }, [setLocation])

  if (!snapshot || astronomyError) {
    return (
      <main className="fatal-error">
        <span className="brand__glyph" aria-hidden="true" />
        <h1>Calcul astronomique indisponible</h1>
        <p>{astronomyError ?? 'Impossible de calculer la position du Soleil.'}</p>
        <button type="button" onClick={() => window.location.reload()}>Réessayer</button>
      </main>
    )
  }

  return (
    <div className="app-shell" data-mobile-view={mobileView}>
      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff size={13} /> Hors connexion
        </div>
      )}

      {mobileLayer && (
        <button
          type="button"
          className="mobile-layer-scrim"
          aria-label="Fermer"
          onClick={() => setMobileLayer(null)}
        />
      )}

      <header className={`app-header ${mobileLayer ? `is-${mobileLayer}-open` : ''}`}>
        <div className="brand">
          <span className="brand__glyph" aria-hidden="true" />
          <span className="brand__text brand__text--desktop">
            <h1>Éclipse</h1>
            <p>12 août 2026</p>
          </span>
          <button
            type="button"
            className="brand__mobile-trigger"
            aria-haspopup="menu"
            aria-expanded={mobileLayer === 'menu'}
            onClick={() => setMobileLayer((layer) => layer === 'menu' ? null : 'menu')}
          >
            <span className="brand__text">
              <strong>Éclipse</strong>
              <span>12 août 2026</span>
            </span>
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        </div>

        <div className="desktop-search-cluster">
          <LocationSearch
            observer={location}
            onSelect={selectLocation}
            autoFocus={mobileLayer === 'search'}
          />
          <button
            className="icon-button desktop-geolocation"
            type="button"
            onClick={requestGeolocation}
            disabled={geolocationStatus === 'loading'}
            aria-label={geolocationStatus === 'loading' ? 'Localisation en cours' : 'Utiliser ma position'}
            title="Ma position"
          >
            <LocateFixed size={17} />
          </button>
        </div>

        <button
          className="mobile-search-trigger"
          type="button"
          aria-label={mobileLayer === 'search' ? 'Fermer la recherche' : 'Rechercher un lieu'}
          aria-expanded={mobileLayer === 'search'}
          onClick={() => setMobileLayer((layer) => layer === 'search' ? null : 'search')}
        >
          {mobileLayer === 'search' ? <X aria-hidden="true" size={19} /> : <Search aria-hidden="true" size={19} />}
        </button>

        <div className="mobile-title-menu" role="menu" aria-hidden={mobileLayer !== 'menu'}>
          <button
            type="button"
            role="menuitem"
            onClick={() => { void copyShareLink(); setMobileLayer(null) }}
          >
            {copied ? <Check aria-hidden="true" size={16} /> : <Share2 aria-hidden="true" size={16} />}
            Partager
          </button>
          <a href="https://github.com/louisguichard/eclipse" target="_blank" rel="noreferrer" role="menuitem">
            <GitFork aria-hidden="true" size={16} /> Code source
          </a>
          <a
            href="https://louisguichard.fr"
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            aria-label="Auteur — louisguichard.fr"
          >
            <Globe2 aria-hidden="true" size={16} /> Auteur
          </a>
          <div className="mobile-title-menu__credits">
            <span className="mobile-title-menu__source-title">Sources</span>
            <span>Astronomie · Astronomy Engine · NASA</span>
            <span>Carte · Google Maps · Street View</span>
            <span>Météo · Open-Meteo</span>
            <span>Relief · IGN LiDAR HD</span>
            <span>
              <button type="button" onClick={() => { setLegal('terms'); setMobileLayer(null) }}>Conditions</button>
              {' · '}
              <button type="button" onClick={() => { setLegal('privacy'); setMobileLayer(null) }}>Confidentialité</button>
            </span>
          </div>
        </div>
      </header>

      {(geolocationStatus === 'denied' || geolocationStatus === 'error') && (
        <div className="permission-message" role="status">
          {geolocationStatus === 'denied'
            ? 'Accès à la position refusé. Autorisez-le dans le navigateur ou cliquez sur la carte.'
            : 'Position introuvable. Recherchez une adresse ou cliquez sur la carte.'}
        </div>
      )}

      {desktopMapExpanded && (
        <button
          type="button"
          className="desktop-map-scrim"
          aria-label="Fermer la carte agrandie"
          onClick={() => setDesktopMapExpanded(false)}
        />
      )}

      <main className="workspace">
        <section className={`view-panel street-panel ${mobileView === 'street' ? 'is-mobile-active' : ''}`}>
          <div className="panel-body">
            <StreetView
              observer={location}
              snapshot={snapshot}
              active={mobileView === 'street'}
              expanded={expandedSimulation}
              onExpandedChange={setExpandedSimulation}
              onPanoramaStateChange={setPanorama}
              onUserPositionChange={selectStreetViewLocation}
              cloudCover={cloudCover}
              debug={debug}
            />
          </div>
        </section>

        <div
          className={`desktop-hud ${desktopMapExpanded ? 'is-map-expanded' : ''}`}
          aria-label="Informations d’observation"
        >
          <aside className="scene-readout" aria-label="Conditions d’observation">
            <EclipseInfo snapshot={snapshot} cloudCover={cloudCover} />
          </aside>

          <Timeline
            minute={minute}
            snapshot={snapshot}
            onMinuteChange={setMinute}
            playback={playback}
          />

          <section
            id="observation-map"
            className={`view-panel map-panel ${mobileView === 'map' ? 'is-mobile-active' : ''} ${desktopMapExpanded ? 'is-desktop-expanded' : ''}`}
          >
            <div className="panel-body">
              <MapView
                observer={location}
                snapshot={snapshot}
                active={mobileView === 'map' || desktopMapExpanded}
                onLocationChange={selectMapLocation}
              />
            </div>
            <button
              type="button"
              className="map-expand-button"
              aria-controls="observation-map"
              aria-expanded={desktopMapExpanded}
              aria-label={desktopMapExpanded ? 'Réduire la carte' : 'Agrandir la carte'}
              title={desktopMapExpanded ? 'Réduire la carte' : 'Agrandir la carte'}
              onClick={() => setDesktopMapExpanded((expanded) => !expanded)}
            >
              {desktopMapExpanded
                ? <Minimize2 aria-hidden="true" size={18} />
                : <Maximize2 aria-hidden="true" size={18} />}
            </button>
          </section>
        </div>
      </main>

      <div className={`mobile-timeline-layer ${mobileView === 'street' ? 'is-visible' : ''}`}>
        <MobileDialTimeline
          minute={minute}
          snapshot={snapshot}
          blocked={mobileLayer != null}
          onMinuteChange={setMinute}
          playback={playback}
        />
      </div>

      {/* Phones get a real tab bar at the thumb, not a control floating over
          the scene. Hidden on desktop, where both panels are on screen. */}
      <nav
        className="mobile-tabs"
        data-view={mobileView}
        aria-label="Choisir la vue"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          className={mobileView === 'street' ? 'is-active' : ''}
          aria-selected={mobileView === 'street'}
          onClick={() => setMobileView('street')}
        >
          Vue
        </button>
        <button
          type="button"
          role="tab"
          className={mobileView === 'map' ? 'is-active' : ''}
          aria-selected={mobileView === 'map'}
          onClick={() => setMobileView('map')}
        >
          Carte
        </button>
      </nav>

      {copied && <div className="copy-toast" role="status"><Copy size={15} /> Lien copié</div>}
      {debug && (
        <div className="debug-app">
          <strong>DEBUG · APP</strong>
          <span>Observer&nbsp;: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</span>
          <span>Soleil&nbsp;: az {snapshot.sun.azimuth.toFixed(4)}° · alt {snapshot.sun.altitude.toFixed(4)}°</span>
          <span>Lune&nbsp;: az {snapshot.moon.azimuth.toFixed(4)}° · alt {snapshot.moon.altitude.toFixed(4)}°</span>
          <span>Obscuration&nbsp;: {(snapshot.obscuration * 100).toFixed(4)} %</span>
          <span>UTC&nbsp;: {snapshot.date.toISOString()}</span>
          <span>Paris&nbsp;: {formatParisDateTime(snapshot.date)}</span>
        </div>
      )}
      <LegalModal type={legal} onClose={() => setLegal(null)} />
    </div>
  )
}

export default App
