import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Compass } from 'lucide-react'
import type {
  ErrorEvent as MapLibreErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from 'maplibre-gl'
import { buildSunTrajectory } from '../lib/astronomy'
import { VISIBILITY_DATASETS, VISIBILITY_LAYER_OPACITY } from '../config/visibility'
import { destinationPoint } from '../lib/geometry'
import { formatLocalTime } from '../lib/format'
import { resolveBasemapStyle } from '../lib/mapLibreBasemap'
import { createVisibilityRasterDefinition } from '../lib/mapLibreVisibility'
import {
  knownVisibilityCoverageAtPoint,
  preferredVisibilityDatasetAtPoint,
  visibilityDatasetsForView,
} from '../lib/visibilityTiles'
import type { EclipseSnapshot, ObserverLocation } from '../types'
import type { GeographicBounds, VisibilityDatasetManifest } from '../types/visibility'

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

type VisibilityLegendProps = {
  preferredVisibilityDataset?: VisibilityDatasetManifest | null
  knownVisibilityDataset?: VisibilityDatasetManifest | null
}

function visibilitySourceLabel(manifest: VisibilityDatasetManifest): string {
  const resolution = manifest.surface.resolutionMeters
  return resolution === null
    ? manifest.attribution
    : `${manifest.attribution} · Résolution ${resolution} m`
}

export function VisibilityLegend({
  preferredVisibilityDataset,
  knownVisibilityDataset,
}: VisibilityLegendProps) {
  return (
    <p
      className={`map-legend ${preferredVisibilityDataset ? '' : 'map-legend--unavailable'}`}
      title={
        preferredVisibilityDataset?.disclaimer
        ?? knownVisibilityDataset?.unavailableReason
        ?? 'Aucune donnée de visibilité publiée pour cette zone.'
      }
    >
      <span className="map-legend__swatch" aria-hidden="true" />
      <span className="map-legend__copy">
        <strong>{preferredVisibilityDataset ? 'En jaune : dégagement probable' : 'Zones de visibilité'}</strong>
        <span>
          {preferredVisibilityDataset
            ? `${preferredVisibilityDataset.label} · ${
                preferredVisibilityDataset.reference.mode === 'fixed-instant'
                  ? formatLocalTime(
                      new Date(preferredVisibilityDataset.reference.timeUtc!),
                      'Europe/Paris',
                    )
                  : 'maximum local'
              } · hors météo`
            : knownVisibilityDataset
              ? 'Données de visibilité momentanément indisponibles'
              : 'Couche LiDAR disponible dans les 20 plus grandes agglomérations de France'}
        </span>
        {preferredVisibilityDataset?.warnings?.map((warning) => (
          <span key={warning}>⚠ {warning}</span>
        ))}
      </span>
      {preferredVisibilityDataset && (
        <span className="map-legend__source">
          {visibilitySourceLabel(preferredVisibilityDataset)}
        </span>
      )}
    </p>
  )
}

function geographicViewport(map: MapLibreMap): GeographicBounds {
  const bounds = map.getBounds()
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  }
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
  const visibilityLayerIdsRef = useRef<Map<string, string>>(new Map())
  const activeVisibilityKeyRef = useRef<string | null>(null)
  const [shouldInitialize, setShouldInitialize] = useState(active)
  const [status, setStatus] = useState<MapStatus>('idle')

  observerRef.current = observer
  onLocationChangeRef.current = onLocationChange

  const preferredVisibilityDataset = preferredVisibilityDatasetAtPoint(
    VISIBILITY_DATASETS,
    observer,
  )
  const knownVisibilityDataset = knownVisibilityCoverageAtPoint(
    VISIBILITY_DATASETS,
    observer,
  )

  const syncVisibilityLayers = useCallback(() => {
    const map = mapRef.current
    if (!map || visibilityLayerIdsRef.current.size === 0) return

    const visibleDatasets = visibilityDatasetsForView(
      VISIBILITY_DATASETS,
      observerRef.current,
      geographicViewport(map),
      map.getZoom(),
    ).filter(({ id }) => visibilityLayerIdsRef.current.has(id))
    const visibleIds = new Set(visibleDatasets.map(({ id }) => id))
    const nextKey = visibleDatasets.map(({ id }) => id).join('|')
    if (nextKey === activeVisibilityKeyRef.current) return

    for (const [datasetId, layerId] of visibilityLayerIdsRef.current) {
      if (!map.getLayer(layerId)) continue
      map.setLayoutProperty(
        layerId,
        'visibility',
        visibleIds.has(datasetId) ? 'visible' : 'none',
      )
    }
    activeVisibilityKeyRef.current = nextKey
  }, [])

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
    return () => desktop.removeEventListener('change', initializeOnDesktop)
  }, [active, shouldInitialize])

  useEffect(() => {
    if (!shouldInitialize) return undefined

    const initializedVisibilityLayerIds = visibilityLayerIdsRef.current
    let cancelled = false
    let initializedMap: MapLibreMap | null = null
    let initializedMarker: MapLibreMarker | null = null
    let handleLoad: (() => void) | null = null
    let handleClick: ((event: MapMouseEvent) => void) | null = null
    let handleMoveEnd: (() => void) | null = null
    let handleError: ((event: MapLibreErrorEvent) => void) | null = null

    async function initializeMap() {
      setStatus('loading')
      try {
        const [maplibre] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])
        const style = await resolveBasemapStyle(maplibre)
        const host = hostRef.current
        if (cancelled || !host) return

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
          onLocationChangeRef.current({
            lat: event.lngLat.lat,
            lng: event.lngLat.lng,
            label: 'Point sélectionné',
            source: 'map',
          })
        }
        handleMoveEnd = syncVisibilityLayers
        handleError = (event) => {
          if (baseStyleReady || cancelled) return
          console.error('MapLibre basemap failed to load', event.error)
          setStatus('error')
        }
        handleLoad = () => {
          if (cancelled) return
          collapseCompactAttribution(host)
          baseStyleReady = true

          const firstSymbolLayerId = map.getStyle().layers.find(
            ({ type }) => type === 'symbol',
          )?.id
          for (const manifest of [...VISIBILITY_DATASETS].reverse()) {
            const definition = createVisibilityRasterDefinition(
              manifest,
              VISIBILITY_LAYER_OPACITY,
            )
            if (!definition) continue
            try {
              map.addSource(definition.sourceId, definition.source)
              map.addLayer(definition.layer, firstSymbolLayerId)
              visibilityLayerIdsRef.current.set(
                definition.datasetId,
                definition.layerId,
              )
            } catch (error) {
              console.warn(`Visibility layer unavailable: ${manifest.id}`, error)
            }
          }

          try {
            addSolarLayers(map)
          } catch (error) {
            console.warn('Solar map layers unavailable', error)
          }
          activeVisibilityKeyRef.current = null
          syncVisibilityLayers()
          setStatus('ready')
        }

        map.on('click', handleClick)
        map.on('moveend', handleMoveEnd)
        map.on('error', handleError)
        map.once('load', handleLoad)
      } catch (error) {
        console.error('MapLibre failed to initialize', error)
        if (!cancelled) setStatus('error')
      }
    }

    void initializeMap()
    return () => {
      cancelled = true
      if (initializedMap && handleClick) initializedMap.off('click', handleClick)
      if (initializedMap && handleMoveEnd) initializedMap.off('moveend', handleMoveEnd)
      if (initializedMap && handleError) initializedMap.off('error', handleError)
      if (initializedMap && handleLoad) initializedMap.off('load', handleLoad)
      initializedMarker?.remove()
      if (markerRef.current === initializedMarker) markerRef.current = null
      initializedMap?.remove()
      if (mapRef.current === initializedMap) mapRef.current = null
      initializedVisibilityLayerIds.clear()
      activeVisibilityKeyRef.current = null
    }
  }, [shouldInitialize, syncVisibilityLayers])

  useEffect(() => {
    if (status !== 'ready') return
    syncVisibilityLayers()
  }, [observer.lat, observer.lng, status, syncVisibilityLayers])

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

  return (
    <div className="map-stage">
      <div
        ref={hostRef}
        className="map-canvas"
        role="region"
        aria-label="Carte interactive MapLibre"
        aria-busy={status === 'loading'}
      />
      {status === 'loading' && (
        <div className="panel-loading" role="status">
          <span className="orb-loader" /> Chargement de la carte…
        </div>
      )}
      {status === 'error' && (
        <MapFallback observer={observer} snapshot={snapshot} timeZone={timeZone} />
      )}
      <VisibilityLegend
        preferredVisibilityDataset={preferredVisibilityDataset}
        knownVisibilityDataset={knownVisibilityDataset}
      />
    </div>
  )
}
