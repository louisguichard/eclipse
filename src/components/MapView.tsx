import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Compass } from 'lucide-react'
import { buildSunTrajectory } from '../lib/astronomy'
import { PARIS_VISIBILITY_MANIFEST, VISIBILITY_LAYER_OPACITY } from '../config/visibility'
import { destinationPoint } from '../lib/geometry'
import { formatParisTime } from '../lib/format'
import { googleMapId, hasGoogleMapsApiKey, loadGoogleLibrary } from '../lib/googleMaps'
import { createVisibilityImageMapType, pointInGeographicBounds } from '../lib/visibilityTiles'
import type { EclipseSnapshot, ObserverLocation } from '../types'

type MapViewProps = {
  observer: ObserverLocation
  snapshot: EclipseSnapshot
  active: boolean
  onLocationChange: (location: ObserverLocation) => void
}

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#101a2c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#101a2c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8492a9' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c5ccda' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#17253a' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#18332f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#789b8f' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#25334a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#152137' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#344158' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1a2940' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#071426' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#526a86' }] },
]

// Keep the line of sight visually separate from the yellow LiDAR visibility
// layer. The distance is only a graphic aid; reducing it does not alter the
// calculated solar azimuth.
const SOLAR_DIRECTION_COLOR = '#ff5a5f'
const SOLAR_DIRECTION_DISTANCE_METERS = 250

function DemoMap({
  observer,
  snapshot,
  loadFailed = false,
}: Pick<MapViewProps, 'observer' | 'snapshot'> & { loadFailed?: boolean }) {
  const rotation = snapshot.sun.azimuth
  return (
    <div className="demo-map" role="img" aria-label="Aperçu cartographique simulé de Paris">
      <div className="demo-map__river" />
      {Array.from({ length: 9 }, (_, index) => <i key={`h-${index}`} className={`street street-h street-h-${index}`} />)}
      {Array.from({ length: 8 }, (_, index) => <i key={`v-${index}`} className={`street street-v street-v-${index}`} />)}
      <span className="demo-map__district district-a">PARIS 15e</span>
      <span className="demo-map__district district-b">PARIS 7e</span>
      <span className="demo-map__district district-c">PARIS 16e</span>
      <div className="demo-map__observer" aria-hidden="true"><span /></div>
      <div className="demo-map__ray" style={{ transform: `rotate(${rotation}deg)` }}>
        <span className="demo-map__ray-line" />
        <span className="demo-map__sun-label" style={{ transform: `rotate(${-rotation}deg)` }}>
          ☀ {formatParisTime(snapshot.date)}
        </span>
      </div>
      <div className="demo-map__compass"><Compass size={15} /> N</div>
      <div className="demo-map__notice"><AlertTriangle size={14} /> {loadFailed ? 'Google Maps indisponible' : 'Carte de démonstration · clé requise'}</div>
      <span className="demo-map__location">{observer.label}</span>
    </div>
  )
}

export function MapView({ observer, snapshot, active, onLocationChange }: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Circle | google.maps.marker.AdvancedMarkerElement | null>(null)
  const rayRef = useRef<google.maps.Polyline | null>(null)
  const arcRef = useRef<google.maps.Polyline | null>(null)
  const visibilityMapTypeRef = useRef<google.maps.MapType | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const onLocationChangeRef = useRef(onLocationChange)
  const initialObserverRef = useRef(observer)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    hasGoogleMapsApiKey ? 'loading' : 'ready',
  )
  const visibilityAvailable = pointInGeographicBounds(
    observer,
    PARIS_VISIBILITY_MANIFEST.coverage,
  )

  onLocationChangeRef.current = onLocationChange

  useEffect(() => {
    if (!hasGoogleMapsApiKey) return
    let cancelled = false

    async function initializeMap() {
      try {
        const [{ Map }, markerLibrary] = await Promise.all([
          loadGoogleLibrary('maps'),
          loadGoogleLibrary('marker'),
        ])
        if (cancelled || !hostRef.current) return

        if (!mapRef.current) {
          const mapId = googleMapId()
          mapRef.current = new Map(hostRef.current, {
            center: initialObserverRef.current,
            // The inset is intentionally close enough for the 2 m LiDAR
            // classification to remain legible instead of merging into broad
            // yellow bands.
            zoom: 15,
            mapId,
            styles: mapId ? undefined : MAP_STYLES,
            disableDefaultUI: true,
            zoomControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: 'greedy',
            backgroundColor: '#101a2c',
          })
        }

        if (!markerRef.current) {
          const mapId = googleMapId()
          if (mapId) {
            const markerNode = document.createElement('div')
            markerNode.className = 'google-observer-marker'
            markerNode.innerHTML = '<span></span>'
            markerRef.current = new markerLibrary.AdvancedMarkerElement({
              map: mapRef.current,
              position: initialObserverRef.current,
              title: 'Position d’observation',
              content: markerNode,
            })
          } else {
            markerRef.current = new google.maps.Circle({
              map: mapRef.current,
              center: initialObserverRef.current,
              radius: 12,
              fillColor: '#ffb44a',
              fillOpacity: 1,
              strokeColor: '#fff4d6',
              strokeOpacity: 1,
              strokeWeight: 2,
              clickable: false,
            })
          }
        }

        rayRef.current ??= new google.maps.Polyline({
          map: mapRef.current,
          geodesic: true,
          strokeColor: SOLAR_DIRECTION_COLOR,
          strokeOpacity: 0.95,
          strokeWeight: 1.25,
          clickable: false,
          icons: [{
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              fillColor: SOLAR_DIRECTION_COLOR,
              fillOpacity: 1,
              strokeColor: SOLAR_DIRECTION_COLOR,
              strokeWeight: 0.6,
              scale: 1.8,
            },
            offset: '100%',
          }],
        })
        arcRef.current ??= new google.maps.Polyline({
          map: mapRef.current,
          geodesic: true,
          strokeColor: '#ff7774',
          strokeOpacity: 0.26,
          strokeWeight: 1.25,
          clickable: false,
        })

        if (!visibilityMapTypeRef.current) {
          const visibilityLayer = createVisibilityImageMapType(
            {
              Size: google.maps.Size,
            },
            PARIS_VISIBILITY_MANIFEST,
            VISIBILITY_LAYER_OPACITY,
          )
          if (visibilityLayer.status === 'ready') {
            visibilityMapTypeRef.current = visibilityLayer.mapType
          } else {
            console.warn('Visibility layer unavailable', visibilityLayer.message)
          }
        }

        if (!clickListenerRef.current) {
          clickListenerRef.current = mapRef.current.addListener('click', (event: google.maps.MapMouseEvent) => {
            const point = event.latLng
            if (!point) return
            onLocationChangeRef.current({
              lat: point.lat(),
              lng: point.lng(),
              label: 'Point sélectionné',
              source: 'map',
            })
          })
        }
        setStatus('ready')
      } catch (error) {
        console.error('Google Map failed to load', error)
        if (!cancelled) setStatus('error')
      }
    }

    void initializeMap()
    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      clickListenerRef.current = null
    }
  }, [])

  // The layer is the point of the map, so it is always on: no toggle, no state.
  useEffect(() => {
    const map = mapRef.current
    const layer = visibilityMapTypeRef.current
    if (!map || !layer || status !== 'ready') return

    const overlays = map.overlayMapTypes
    for (let index = 0; index < overlays.getLength(); index += 1) {
      if (overlays.getAt(index) === layer) return
    }
    overlays.insertAt(0, layer)
  }, [status])

  // Only the ray rotates during playback. Keeping the static marker and the
  // full contact-to-sunset trajectory out of this effect avoids rebuilding a
  // 21-point Google Maps polyline on every animation frame.
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    const endpoint = destinationPoint(
      observer,
      SOLAR_DIRECTION_DISTANCE_METERS,
      snapshot.sun.azimuth,
    )
    rayRef.current?.setPath([observer, endpoint])
  }, [observer, snapshot.sun.azimuth, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    if (markerRef.current instanceof google.maps.Circle) {
      markerRef.current.setCenter(observer)
    } else if (markerRef.current) {
      markerRef.current.position = observer
    }
  }, [observer, status])

  const trajectoryBeginTime = snapshot.circumstances.begin.time.getTime()
  const trajectoryEndTime = snapshot.circumstances.end.time.getTime()
  const sunsetTime = snapshot.sunset?.getTime() ?? null
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    const begin = new Date(trajectoryBeginTime)
    const circumstancesEnd = new Date(trajectoryEndTime)
    const sunset = sunsetTime == null ? null : new Date(sunsetTime)
    const trajectoryEnd = sunset && sunset > begin ? sunset : circumstancesEnd
    const trajectory = buildSunTrajectory(
      observer,
      begin,
      trajectoryEnd,
      20,
    ).map((point) => destinationPoint(observer, 820, point.azimuth))
    arcRef.current?.setPath(trajectory)
  }, [observer, status, sunsetTime, trajectoryBeginTime, trajectoryEndTime])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    // `active` only describes the selected mobile tab. On desktop both panels
    // are visible, so location changes must move the map even when that flag is
    // false (the default mobile tab is Street View).
    map.panTo({ lat: observer.lat, lng: observer.lng })
    if (observer.source === 'search' || observer.source === 'geolocation') {
      map.setZoom(Math.max(map.getZoom() ?? 14, 16))
    }
  }, [observer.lat, observer.lng, observer.source, status])

  useEffect(() => {
    const map = mapRef.current
    const host = hostRef.current
    if (!map || !host || status !== 'ready') return undefined

    // `active` is also the desktop expansion signal. Waiting for the next
    // frame lets the new panel geometry settle before Google recalculates its
    // tiles, and running on both boolean transitions keeps collapse just as
    // sharp as expansion without recreating the Map instance.
    const frame = window.requestAnimationFrame(() => {
      const bounds = host.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      google.maps.event.trigger(map, 'resize')
      map.panTo({ lat: observer.lat, lng: observer.lng })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, observer.lat, observer.lng, status])

  useEffect(() => {
    const map = mapRef.current
    const host = hostRef.current
    if (!map || !host || status !== 'ready' || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    // Container queries and viewport changes can resize the inset without
    // changing `active` (for example when returning to desktop from the Carte
    // mobile tab). Observe the actual host so every layout transition keeps
    // the same map instance correctly tiled and centred.
    let frame: number | null = null
    const sizeObserver = new ResizeObserver(() => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const bounds = host.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return
        google.maps.event.trigger(map, 'resize')
        map.panTo({ lat: observer.lat, lng: observer.lng })
      })
    })
    sizeObserver.observe(host)

    return () => {
      sizeObserver.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [observer.lat, observer.lng, status])

  if (!hasGoogleMapsApiKey || status === 'error') {
    return <DemoMap observer={observer} snapshot={snapshot} loadFailed={status === 'error'} />
  }

  return (
    <div className="map-stage">
      <div ref={hostRef} className="map-canvas" aria-label="Carte Google interactive" />
      {status === 'loading' && (
        <div className="panel-loading" role="status"><span className="orb-loader" /> Chargement de la carte…</div>
      )}
      <p
        className={`map-legend ${visibilityAvailable ? '' : 'map-legend--unavailable'}`}
        title={PARIS_VISIBILITY_MANIFEST.disclaimer}
      >
        <span className="map-legend__swatch" aria-hidden="true" />
        <span className="map-legend__copy">
          <strong>{visibilityAvailable ? 'Soleil probablement visible' : 'Zones de visibilité'}</strong>
          <span>
            {visibilityAvailable
              ? 'Jaune · 20:17 · hors météo'
              : 'Disponibles à Paris uniquement'}
          </span>
        </span>
        {visibilityAvailable && (
          <span className="map-legend__source">© IGN LiDAR HD · acquisition 2023 · édition 2025</span>
        )}
      </p>
    </div>
  )
}
