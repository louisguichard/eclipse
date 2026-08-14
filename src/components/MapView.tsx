import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Compass, Pointer } from 'lucide-react'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type {
  ErrorEvent as MapLibreErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from 'maplibre-gl'
import { buildSunTrajectory } from '../lib/astronomy'
import { destinationPoint } from '../lib/geometry'
import { formatLocalTime } from '../lib/format'
import { applyBasemapLandTone, resolveBasemapStyle } from '../lib/mapLibreBasemap'
import { captureOperationalError, isMapLibreShaderCompilationError } from '../lib/sentry'
import type { EclipseSnapshot, ObserverLocation } from '../types'

type MapViewProps = {
  observer: ObserverLocation
  snapshot: EclipseSnapshot
  timeZone?: string | null
  active: boolean
  onLocationChange: (location: ObserverLocation) => void
}

type MapStatus = 'idle' | 'loading' | 'ready' | 'error'

const DESKTOP_MAP_MEDIA_QUERY = '(min-width: 861px)'
const INITIAL_MAP_ZOOM = 15
const SEARCH_MAP_ZOOM = 16
const SOLAR_DIRECTION_COLOR = '#ff5a5f'
const SOLAR_DIRECTION_DISTANCE_METERS = 250
const SOLAR_TRAJECTORY_DISTANCE_METERS = 820
const SOLAR_RAY_SOURCE_ID = 'solar-direction-source'
const SOLAR_RAY_LAYER_ID = 'solar-direction-layer'
const SOLAR_TRAJECTORY_SOURCE_ID = 'solar-trajectory-source'
const SOLAR_TRAJECTORY_LAYER_ID = 'solar-trajectory-layer'

class MapCapabilityError extends Error {
  constructor(cause?: unknown) {
    super('WebGL 2 indisponible pour la carte.', { cause })
    this.name = 'MapCapabilityError'
  }
}

function assertMapWebGLSupport(): void {
  const canvas = document.createElement('canvas')
  try {
    const context = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: true,
    })
    if (!context) throw new MapCapabilityError()
    context.getExtension('WEBGL_lose_context')?.loseContext()
  } catch (error) {
    if (error instanceof MapCapabilityError) throw error
    throw new MapCapabilityError(error)
  }
}

type LineData = Parameters<GeoJSONSource['setData']>[0]

function lineData(points: ReadonlyArray<{ lat: number; lng: number }>): LineData {
  return {
    type: 'FeatureCollection',
    features: points.length < 2
      ? []
      : [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: points.map(({ lng, lat }) => [lng, lat]),
          },
        }],
  }
}

function updateLineSource(
  map: MapLibreMap,
  sourceId: string,
  points: ReadonlyArray<{ lat: number; lng: number }>,
) {
  const source = map.getSource(sourceId)
  if (source && 'setData' in source) {
    const geoJsonSource = source as GeoJSONSource
    geoJsonSource.setData(lineData(points))
  }
}

function collapseCompactAttribution(host: HTMLElement) {
  // MapLibre intentionally opens a compact attribution control on first
  // render. Start it collapsed so the required credits stay available through
  // the info button without covering the map card.
  host
    .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')
    ?.classList.remove('maplibregl-compact-show')
}

function MapFallback({
  observer,
  snapshot,
  timeZone = null,
}: Pick<MapViewProps, 'observer' | 'snapshot' | 'timeZone'>) {
  const rotation = snapshot.sun.azimuth
  return (
    <div className="demo-map" role="img" aria-label="Aperçu cartographique de secours">
      <div className="demo-map__river" />
      {Array.from({ length: 9 }, (_, index) => <i key={`h-${index}`} className={`street street-h street-h-${index}`} />)}
      {Array.from({ length: 8 }, (_, index) => <i key={`v-${index}`} className={`street street-v street-v-${index}`} />)}
      <div className="demo-map__observer" aria-hidden="true"><span /></div>
      {snapshot.circumstances.visible && (
        <div className="demo-map__ray" style={{ transform: `rotate(${rotation}deg)` }}>
          <span className="demo-map__ray-line" />
          <span className="demo-map__sun-label" style={{ transform: `rotate(${-rotation}deg)` }}>
            ☀ {formatLocalTime(snapshot.date, timeZone)}
          </span>
        </div>
      )}
      <div className="demo-map__compass"><Compass size={15} /> N</div>
      <div className="demo-map__notice">
        <AlertTriangle size={14} /> Fond de carte indisponible
      </div>
      <span className="demo-map__location">{observer.label}</span>
    </div>
  )
}

/** "Cliquez" on a desktop pointer, "Appuyez" on a touchscreen. */
function pointerVerb(): string {
  const fine = typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  return fine ? 'Cliquez' : 'Appuyez'
}

function addSolarLayers(map: MapLibreMap) {
  const emptyLine = lineData([])
  map.addSource(SOLAR_TRAJECTORY_SOURCE_ID, {
    type: 'geojson',
    data: emptyLine,
  })
  map.addLayer({
    id: SOLAR_TRAJECTORY_LAYER_ID,
    type: 'line',
    source: SOLAR_TRAJECTORY_SOURCE_ID,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#ff7774',
      'line-opacity': 0.26,
      'line-width': 1.25,
    },
  })

  map.addSource(SOLAR_RAY_SOURCE_ID, {
    type: 'geojson',
    data: emptyLine,
  })
  map.addLayer({
    id: SOLAR_RAY_LAYER_ID,
    type: 'line',
    source: SOLAR_RAY_SOURCE_ID,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': SOLAR_DIRECTION_COLOR,
      'line-opacity': 0.95,
      'line-width': 1.5,
    },
  })
}

export function MapView({
  observer,
  snapshot,
  timeZone = null,
  active,
  onLocationChange,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<MapLibreMarker | null>(null)
  const observerRef = useRef(observer)
  const onLocationChangeRef = useRef(onLocationChange)
  const [shouldInitialize, setShouldInitialize] = useState(active)
  const [status, setStatus] = useState<MapStatus>('idle')
  // The hint replays each time the map is opened, until a first tap proves it
  // has been understood. `hintRun` remounts the element so the fade restarts.
  const [hintRun, setHintRun] = useState(0)
  const [hintLearned, setHintLearned] = useState(false)

  observerRef.current = observer
  onLocationChangeRef.current = onLocationChange

  useEffect(() => {
    if (shouldInitialize || active) {
      if (active) setShouldInitialize(true)
      return undefined
    }
    if (typeof window.matchMedia !== 'function') return undefined

    const desktop = window.matchMedia(DESKTOP_MAP_MEDIA_QUERY)
    const initializeOnDesktop = () => {
      if (desktop.matches) setShouldInitialize(true)
    }
    initializeOnDesktop()
    desktop.addEventListener('change', initializeOnDesktop)

    // Phones open the map from a tab, and building it on that tap is what made
    // the switch feel slow: a spinner, then tiles. Warming it once the first
    // view has settled costs one basemap fetch and makes the tab instant.
    // Skipped when the reader has asked their browser to save data.
    const saveData = (navigator as { connection?: { saveData?: boolean } })
      .connection?.saveData === true
    const warmUp = saveData
      ? null
      : window.setTimeout(() => setShouldInitialize(true), 2_500)

    return () => {
      desktop.removeEventListener('change', initializeOnDesktop)
      if (warmUp !== null) window.clearTimeout(warmUp)
    }
  }, [active, shouldInitialize])

  useEffect(() => {
    if (!shouldInitialize) return undefined

    let cancelled = false
    let initializedMap: MapLibreMap | null = null
    let initializedMarker: MapLibreMarker | null = null
    let handleLoad: (() => void) | null = null
    let handleClick: ((event: MapMouseEvent) => void) | null = null
    let handleError: ((event: MapLibreErrorEvent) => void) | null = null
    let rendererFailed = false

    function releaseMap() {
      const map = initializedMap
      const marker = initializedMarker
      initializedMap = null
      initializedMarker = null
      if (map && handleClick) map.off('click', handleClick)
      if (map && handleError) map.off('error', handleError)
      if (map && handleLoad) map.off('load', handleLoad)
      marker?.remove()
      if (markerRef.current === marker) markerRef.current = null
      try {
        map?.remove()
      } catch (error) {
        console.warn('MapLibre cleanup failed', error)
      }
      if (mapRef.current === map) mapRef.current = null
    }

    function handleWindowError(event: globalThis.ErrorEvent) {
      if (cancelled || rendererFailed || !isMapLibreShaderCompilationError(event.error)) return
      rendererFailed = true
      // MapLibre 6 rethrows shader failures from its animation frame instead
      // of forwarding them to map.on('error'). The context was created, so
      // fall back only after this specific late GPU failure.
      event.preventDefault()
      captureOperationalError('basemap-renderer', event.error)
      releaseMap()
      setStatus('error')
    }

    window.addEventListener('error', handleWindowError)

    async function initializeMap() {
      setStatus('loading')
      try {
        const [maplibre] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])
        // MapLibre resolves its default worker relative to its own module URL.
        // After Vite code-splitting that sibling file does not exist, so bundle
        // the worker explicitly and point MapLibre at the generated asset.
        maplibre.setWorkerUrl(mapLibreWorkerUrl)
        const style = await resolveBasemapStyle(maplibre)
        const host = hostRef.current
        if (cancelled || !host) return

        // MapLibre returns a partially initialized Map when WebGL creation
        // fails. Its remove() method then dereferences the missing painter.
        // Probe with the same required context attributes before construction.
        assertMapWebGLSupport()
        const map = new maplibre.Map({
          container: host,
          style,
          center: [observerRef.current.lng, observerRef.current.lat],
          zoom: INITIAL_MAP_ZOOM,
          minZoom: 2,
          maxZoom: 19,
          // Keep mandatory source credits behind MapLibre's compact info
          // button instead of covering the small floating map card.
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          fadeDuration: 0,
        })
        collapseCompactAttribution(host)
        initializedMap = map
        mapRef.current = map
        let baseStyleReady = false

        const markerNode = document.createElement('div')
        markerNode.className = 'map-observer-marker'
        markerNode.title = 'Position d’observation'
        markerNode.setAttribute('aria-label', 'Position d’observation')
        markerNode.innerHTML = '<span aria-hidden="true"></span>'
        initializedMarker = new maplibre.Marker({
          element: markerNode,
          anchor: 'center',
        })
          .setLngLat([observerRef.current.lng, observerRef.current.lat])
          .addTo(map)
        markerRef.current = initializedMarker

        handleClick = (event) => {
          setHintLearned(true)
          onLocationChangeRef.current({
            lat: event.lngLat.lat,
            lng: event.lngLat.lng,
            label: 'Point sélectionné',
            source: 'map',
          })
        }
        handleError = (event) => {
          if (baseStyleReady || cancelled) return
          console.error('MapLibre basemap failed to load', event.error)
          captureOperationalError('basemap', event.error)
          setStatus('error')
        }
        handleLoad = () => {
          if (cancelled) return
          collapseCompactAttribution(host)
          baseStyleReady = true
          applyBasemapLandTone(map)

          try {
            addSolarLayers(map)
          } catch (error) {
            console.warn('Solar map layers unavailable', error)
          }
          setStatus('ready')
        }

        map.on('click', handleClick)
        map.on('error', handleError)
        map.once('load', handleLoad)
      } catch (error) {
        if (error instanceof MapCapabilityError) {
          if (!cancelled) setStatus('error')
          return
        }
        console.error('MapLibre failed to initialize', error)
        captureOperationalError('basemap', error)
        if (!cancelled) setStatus('error')
      }
    }

    void initializeMap()
    return () => {
      cancelled = true
      window.removeEventListener('error', handleWindowError)
      releaseMap()
    }
  }, [shouldInitialize])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    if (!snapshot.circumstances.visible) {
      updateLineSource(map, SOLAR_RAY_SOURCE_ID, [])
      return
    }
    const endpoint = destinationPoint(
      observer,
      SOLAR_DIRECTION_DISTANCE_METERS,
      snapshot.sun.azimuth,
    )
    updateLineSource(map, SOLAR_RAY_SOURCE_ID, [observer, endpoint])
  }, [observer, snapshot.circumstances.visible, snapshot.sun.azimuth, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    markerRef.current?.setLngLat([observer.lng, observer.lat])
  }, [observer.lat, observer.lng, status])

  const trajectoryBeginTime = snapshot.circumstances.begin.time.getTime()
  const trajectoryEndTime = snapshot.circumstances.end.time.getTime()
  const sunsetTime = snapshot.sunset?.getTime() ?? null
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    if (!snapshot.circumstances.visible) {
      updateLineSource(map, SOLAR_TRAJECTORY_SOURCE_ID, [])
      return
    }

    const begin = new Date(trajectoryBeginTime)
    const circumstancesEnd = new Date(trajectoryEndTime)
    const sunset = sunsetTime === null ? null : new Date(sunsetTime)
    const trajectoryEnd = sunset && sunset > begin ? sunset : circumstancesEnd
    const trajectory = buildSunTrajectory(
      observer,
      begin,
      trajectoryEnd,
      20,
    ).map((point) => destinationPoint(
      observer,
      SOLAR_TRAJECTORY_DISTANCE_METERS,
      point.azimuth,
    ))
    updateLineSource(map, SOLAR_TRAJECTORY_SOURCE_ID, trajectory)
  }, [
    observer,
    snapshot.circumstances.visible,
    status,
    sunsetTime,
    trajectoryBeginTime,
    trajectoryEndTime,
  ])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    map.easeTo({
      center: [observer.lng, observer.lat],
      zoom: observer.source === 'search' || observer.source === 'geolocation'
        ? Math.max(map.getZoom(), SEARCH_MAP_ZOOM)
        : map.getZoom(),
      duration: 350,
      essential: true,
    })
  }, [observer.lat, observer.lng, observer.source, status])

  useEffect(() => {
    const map = mapRef.current
    const host = hostRef.current
    if (!map || !host || status !== 'ready') return undefined
    const frame = window.requestAnimationFrame(() => {
      const bounds = host.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      map.resize()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, status])

  useEffect(() => {
    const map = mapRef.current
    const host = hostRef.current
    if (!map || !host || status !== 'ready' || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    let frame: number | null = null
    const sizeObserver = new ResizeObserver(() => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const bounds = host.getBoundingClientRect()
        if (bounds.width > 0 && bounds.height > 0) map.resize()
      })
    })
    sizeObserver.observe(host)
    return () => {
      sizeObserver.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [status])

  useEffect(() => {
    if (!active || hintLearned) return
    setHintRun((run) => run + 1)
  }, [active, hintLearned])

  return (
    <div className="map-stage">
      <div
        ref={hostRef}
        className="map-canvas"
        role="region"
        aria-label="Carte interactive MapLibre"
        aria-busy={status === 'loading'}
      />
      {active && !hintLearned && status !== 'loading' && (
        <p className="map-hint" key={hintRun} role="status">
          <Pointer aria-hidden="true" size={13} />
          {pointerVerb()} sur la carte pour vous y déplacer
        </p>
      )}
      {status === 'loading' && (
        <div className="panel-loading" role="status">
          <span className="orb-loader" /> Chargement de la carte…
        </div>
      )}
      {status === 'error' && (
        <MapFallback observer={observer} snapshot={snapshot} timeZone={timeZone} />
      )}
    </div>
  )
}
