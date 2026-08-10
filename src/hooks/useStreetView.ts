/// <reference types="google.maps" />

import { useCallback, useEffect, useRef, useState } from 'react'
import { STREET_VIEW } from '../config/eclipse'
import { cameraAngularDistance, haversineDistance, sunToStreetViewPov } from '../lib/geometry'
import { hasGoogleMapsApiKey, loadGoogleLibrary } from '../lib/googleMaps'
import { PanoramaMovementTracker } from '../lib/streetview'
import type {
  EclipseSnapshot,
  LatLng,
  ObserverLocation,
  PanoramaState,
  StreetViewCamera,
} from '../types'

type PanoramaResult = {
  pano: string
  position: LatLng
  radiusMeters: number
}

type StreetViewInstances = {
  library: google.maps.StreetViewLibrary
  panorama: google.maps.StreetViewPanorama
  service: google.maps.StreetViewService
}

export type StreetViewStep = {
  pano: string
  heading: number
  description: string
}

export type UseStreetViewResult = {
  camera: StreetViewCamera
  centered: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Adjacent panoramas the observer can walk to, in panorama order. */
  links: StreetViewStep[]
  moveTo: (pano: string) => void
  panoramaState: PanoramaState
  recenter: () => void
  viewportSize: {
    height: number
    width: number
  }
}

const panoramaCache = new Map<string, PanoramaResult | null>()

function cacheKey(location: LatLng): string {
  return `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`
}

function errorCode(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return `${error.name} ${error.message}`
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; status?: unknown; message?: unknown }
    return [candidate.code, candidate.status, candidate.message]
      .filter((value) => typeof value === 'string')
      .join(' ')
  }
  return ''
}

function isNoPanoramaError(error: unknown): boolean {
  const code = errorCode(error).toUpperCase()
  return code.includes('ZERO_RESULTS') || code.includes('NOT_FOUND') || code.includes('NOT FOUND')
}

function initialPanoramaState(): PanoramaState {
  if (!hasGoogleMapsApiKey) {
    return {
      status: 'demo',
      position: null,
      distanceMeters: null,
      radiusMeters: null,
      message: 'Ajoutez une clé Google Maps pour afficher la vue réelle.',
    }
  }
  return {
    status: 'idle',
    position: null,
    distanceMeters: null,
    radiusMeters: null,
  }
}

export async function findNearestPanorama(
  instances: StreetViewInstances,
  observer: LatLng,
  requestIsCurrent: () => boolean,
): Promise<PanoramaResult | null | undefined> {
  if (!requestIsCurrent()) return undefined
  const key = cacheKey(observer)
  if (panoramaCache.has(key)) return panoramaCache.get(key)

  const { StreetViewPreference, StreetViewSource } = instances.library
  // Multiple sources are evaluated as an intersection by Google: this keeps
  // the lookup both outdoors and inside the official Google collection. Do
  // not fall back to DEFAULT here, because it can reintroduce indoor or
  // user-contributed panoramas after the outdoor pass fails.
  const sources = [StreetViewSource.GOOGLE, StreetViewSource.OUTDOOR] as const

  for (const radiusMeters of STREET_VIEW.searchRadiiMeters) {
    if (!requestIsCurrent()) return undefined
    let response: google.maps.StreetViewResponse
    try {
      response = await instances.service.getPanorama({
        location: observer,
        preference: StreetViewPreference.NEAREST,
        radius: radiusMeters,
        sources,
      })
    } catch (error) {
      if (!requestIsCurrent()) return undefined
      if (isNoPanoramaError(error)) continue
      throw error
    }

    if (!requestIsCurrent()) return undefined
    const location = response.data.location
    const latLng = location?.latLng
    if (!location?.pano || !latLng) continue

    const result: PanoramaResult = {
      pano: location.pano,
      position: { lat: latLng.lat(), lng: latLng.lng() },
      radiusMeters,
    }
    panoramaCache.set(key, result)
    return result
  }

  panoramaCache.set(key, null)
  return null
}

/**
 * Owns the single StreetViewPanorama/StreetViewService pair used by the view.
 * Location changes perform a cached panorama lookup; time changes only move
 * the existing camera, so scrubbing the timeline never creates billable
 * panorama searches.
 */
export function useStreetView(
  observer: ObserverLocation,
  snapshot: EclipseSnapshot,
  active: boolean,
  onUserPositionChange?: (position: LatLng) => void,
): UseStreetViewResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null)
  const serviceRef = useRef<google.maps.StreetViewService | null>(null)
  const libraryRef = useRef<google.maps.StreetViewLibrary | null>(null)
  const initializationRef = useRef<Promise<StreetViewInstances> | null>(null)
  const listenersRef = useRef<google.maps.MapsEventListener[]>([])
  const listenerCleanupTimerRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const requestTokenRef = useRef(0)
  const mountedRef = useRef(false)
  const observerRef = useRef(observer)
  const snapshotRef = useRef(snapshot)
  const targetCameraRef = useRef(sunToStreetViewPov(snapshot.sun, STREET_VIEW.zoom))
  const lastAppliedTimeRef = useRef<number | null>(null)
  const activeRef = useRef(active)
  const lookupRadiusRef = useRef<number | null>(null)
  const panoramaReadyRef = useRef(false)
  const movementTrackerRef = useRef(new PanoramaMovementTracker())
  const onUserPositionChangeRef = useRef(onUserPositionChange)
  const [retryNonce, setRetryNonce] = useState(0)
  const [links, setLinks] = useState<StreetViewStep[]>([])
  const [centered, setCentered] = useState(true)
  const [camera, setCamera] = useState<StreetViewCamera>(targetCameraRef.current)
  const [panoramaState, setPanoramaState] = useState<PanoramaState>(initialPanoramaState)
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 })

  observerRef.current = observer
  snapshotRef.current = snapshot
  activeRef.current = active
  onUserPositionChangeRef.current = onUserPositionChange
  targetCameraRef.current = sunToStreetViewPov(snapshot.sun, STREET_VIEW.zoom)

  const updateCameraFromPanorama = useCallback(() => {
    const panorama = panoramaRef.current
    if (!panorama || !mountedRef.current) return
    const pov = panorama.getPov()
    const nextCamera: StreetViewCamera = {
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: panorama.getZoom(),
    }
    setCamera(nextCamera)
    setCentered(
      cameraAngularDistance(snapshotRef.current.sun, nextCamera) <=
        STREET_VIEW.centeredToleranceDegrees,
    )
  }, [])

  const updatePositionFromPanorama = useCallback(() => {
    const panorama = panoramaRef.current
    if (!panorama || !mountedRef.current) return
    const position = panorama.getPosition()
    if (!position) return
    const nextPosition = { lat: position.lat(), lng: position.lng() }
    const pano = panorama.getPano() ?? null
    const movement = movementTrackerRef.current.observe(pano, nextPosition)

    setPanoramaState((previous) => {
      if (previous.status !== 'ready') return previous
      return {
        ...previous,
        position: nextPosition,
        distanceMeters: haversineDistance(observerRef.current, nextPosition),
        radiusMeters: lookupRadiusRef.current ?? previous.radiusMeters,
      }
    })

    // `setPano` is also used to install the panorama found for a searched
    // address. That initial position is an implementation detail, not a user
    // move: only a subsequent Street View navigation updates the observer.
    if (!panoramaReadyRef.current || movement !== 'user') return
    onUserPositionChangeRef.current?.(nextPosition)
  }, [])

  const updateLinksFromPanorama = useCallback(() => {
    const panorama = panoramaRef.current
    if (!panorama || !mountedRef.current) return
    const steps = (panorama.getLinks() ?? [])
      .filter((link): link is google.maps.StreetViewLink =>
        Boolean(link?.pano) && typeof link?.heading === 'number')
      .map((link) => ({
        pano: link.pano as string,
        heading: link.heading as number,
        description: link.description?.trim() || 'Avancer',
      }))
    setLinks((previous) => {
      const same =
        previous.length === steps.length &&
        previous.every((step, index) => step.pano === steps[index].pano)
      return same ? previous : steps
    })
  }, [])

  const attachPanoramaListeners = useCallback((panorama: google.maps.StreetViewPanorama) => {
    if (!mountedRef.current || listenersRef.current.length > 0) return
    listenersRef.current = [
      panorama.addListener('pov_changed', updateCameraFromPanorama),
      panorama.addListener('zoom_changed', updateCameraFromPanorama),
      panorama.addListener('position_changed', updatePositionFromPanorama),
      panorama.addListener('links_changed', updateLinksFromPanorama),
    ]
  }, [updateCameraFromPanorama, updateLinksFromPanorama, updatePositionFromPanorama])

  const ensureInitialized = useCallback((): Promise<StreetViewInstances> => {
    if (libraryRef.current && panoramaRef.current && serviceRef.current) {
      return Promise.resolve({
        library: libraryRef.current,
        panorama: panoramaRef.current,
        service: serviceRef.current,
      })
    }
    if (initializationRef.current) return initializationRef.current

    const initialization = (async () => {
      if (!navigator.onLine) throw new Error('OFFLINE')
      const library = await loadGoogleLibrary('streetView')
      const container = containerRef.current
      if (!container) throw new Error('Conteneur Street View indisponible')

      libraryRef.current = library
      serviceRef.current ??= new library.StreetViewService()
      // The scene is meant to read as a photograph of the sky, so every piece
      // of Google chrome that is not legally required is turned off. Dragging
      // still works; only the arrows, zoom box and capture-date badge go away.
      panoramaRef.current ??= new library.StreetViewPanorama(container, {
        addressControl: false,
        // Clicking the roadway moves; the on-brand arrows in `StreetView`
        // replace Google's chevrons, which are painted inside the WebGL scene
        // and expose no styling hook at all.
        clickToGo: true,
        disableDefaultUI: true,
        enableCloseButton: false,
        fullscreenControl: false,
        imageDateControl: false,
        linksControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        panControl: false,
        showRoadLabels: false,
        visible: activeRef.current,
        zoom: STREET_VIEW.zoom,
        zoomControl: false,
      })

      return {
        library,
        panorama: panoramaRef.current,
        service: serviceRef.current,
      }
    })()

    initializationRef.current = initialization
    void initialization.catch(() => {
      if (initializationRef.current === initialization) initializationRef.current = null
    })
    return initialization
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (listenerCleanupTimerRef.current != null) {
      window.clearTimeout(listenerCleanupTimerRef.current)
      listenerCleanupTimerRef.current = null
    }
    if (!hasGoogleMapsApiKey) return undefined

    let cancelled = false
    void ensureInitialized().then(({ panorama }) => {
      if (cancelled) return
      attachPanoramaListeners(panorama)
    }).catch(() => undefined)

    return () => {
      cancelled = true
      mountedRef.current = false
      // React StrictMode immediately re-runs this effect. Deferring disposal by
      // one task preserves the single listener pair during that development pass.
      listenerCleanupTimerRef.current = window.setTimeout(() => {
        for (const listener of listenersRef.current) listener.remove()
        listenersRef.current = []
        panoramaRef.current?.setVisible(false)
        listenerCleanupTimerRef.current = null
      }, 0)
    }
  }, [attachPanoramaListeners, ensureInitialized])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const measure = () => {
      const { height, width } = container.getBoundingClientRect()
      if (height > 0 && width > 0) {
        setViewportSize((previous) => {
          if (Math.abs(previous.height - height) < 0.5 && Math.abs(previous.width - width) < 0.5) {
            return previous
          }
          return { height, width }
        })
      }

      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        const panorama = panoramaRef.current
        if (panorama && activeRef.current && typeof google !== 'undefined') {
          google.maps.event.trigger(panorama, 'resize')
        }
        resizeFrameRef.current = null
      })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        window.removeEventListener('resize', measure)
        if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!hasGoogleMapsApiKey) return undefined
    const retry = () => setRetryNonce((value) => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  useEffect(() => {
    if (!hasGoogleMapsApiKey) {
      panoramaReadyRef.current = false
      setPanoramaState(initialPanoramaState())
      return undefined
    }

    const token = ++requestTokenRef.current
    const lookupObserver = { lat: observer.lat, lng: observer.lng }

    // Walking in Street View already installed the destination panorama. App
    // promotes that precise panorama position to the observer so the URL,
    // astronomy and map follow it; searching for it again would be redundant
    // and could produce a position_changed -> lookup loop.
    const displayedPosition = panoramaRef.current?.getPosition()
    if (
      observer.source === 'streetview' &&
      panoramaReadyRef.current &&
      displayedPosition &&
      haversineDistance(lookupObserver, {
        lat: displayedPosition.lat(),
        lng: displayedPosition.lng(),
      }) < 2
    ) {
      const position = { lat: displayedPosition.lat(), lng: displayedPosition.lng() }
      movementTrackerRef.current.remember(position, panoramaRef.current?.getPano() ?? null)
      setPanoramaState((previous) => previous.status === 'ready'
        ? { ...previous, position, distanceMeters: haversineDistance(lookupObserver, position) }
        : previous)
      return undefined
    }

    panoramaReadyRef.current = false
    const requestIsCurrent = () => token === requestTokenRef.current && mountedRef.current
    setPanoramaState({
      status: 'loading',
      position: null,
      distanceMeters: null,
      radiusMeters: null,
      message: 'Recherche de la vue extérieure la plus proche…',
    })

    const debounceTimer = window.setTimeout(() => {
      void ensureInitialized().then(async (instances) => {
        attachPanoramaListeners(instances.panorama)
        const result = await findNearestPanorama(instances, lookupObserver, requestIsCurrent)
        if (!requestIsCurrent() || result === undefined) return

        if (!result) {
          instances.panorama.setVisible(false)
          panoramaReadyRef.current = false
          setPanoramaState({
            status: 'unavailable',
            position: null,
            distanceMeters: null,
            radiusMeters: 1000,
            message: 'Aucune image Street View trouvée dans un rayon de 1 km.',
          })
          return
        }

        lookupRadiusRef.current = result.radiusMeters
        const target = sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom)
        targetCameraRef.current = target
        lastAppliedTimeRef.current = snapshotRef.current.date.getTime()
        movementTrackerRef.current.markProgrammatic(result.pano, result.position)
        instances.panorama.setPano(result.pano)
        instances.panorama.setPov({ heading: target.heading, pitch: target.pitch })
        instances.panorama.setZoom(target.zoom)
        instances.panorama.setVisible(activeRef.current)
        updateCameraFromPanorama()
        updateLinksFromPanorama()
        panoramaReadyRef.current = true
        setPanoramaState({
          status: 'ready',
          position: result.position,
          distanceMeters: haversineDistance(lookupObserver, result.position),
          radiusMeters: result.radiusMeters,
        })
      }).catch((error: unknown) => {
        if (!requestIsCurrent()) return
        panoramaReadyRef.current = false
        const offline = !navigator.onLine || errorCode(error).includes('OFFLINE')
        setPanoramaState({
          status: 'error',
          position: null,
          distanceMeters: null,
          radiusMeters: null,
          message: offline
            ? 'Connexion indisponible. Street View se chargera au retour du réseau.'
            : 'Impossible de charger Street View. Vérifiez la clé API et ses restrictions.',
        })
      })
    }, 220)

    return () => {
      window.clearTimeout(debounceTimer)
      if (requestTokenRef.current === token) requestTokenRef.current += 1
    }
  }, [
    attachPanoramaListeners,
    ensureInitialized,
    observer.lat,
    observer.lng,
    observer.source,
    retryNonce,
    updateCameraFromPanorama,
    updateLinksFromPanorama,
  ])

  const snapshotTime = snapshot.date.getTime()
  useEffect(() => {
    if (panoramaState.status === 'demo') {
      const target = sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom)
      setCamera(target)
      setCentered(true)
      return
    }
    if (panoramaState.status !== 'ready') return
    if (lastAppliedTimeRef.current === snapshotTime) return
    const panorama = panoramaRef.current
    if (!panorama) return
    const target = sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom)
    targetCameraRef.current = target
    panorama.setPov({ heading: target.heading, pitch: target.pitch })
    panorama.setZoom(target.zoom)
    lastAppliedTimeRef.current = snapshotTime
    updateCameraFromPanorama()
  }, [snapshotTime, panoramaState.status, updateCameraFromPanorama])

  useEffect(() => {
    const panorama = panoramaRef.current
    if (!panorama) return
    panorama.setVisible(active && panoramaState.status === 'ready')
    if (active && panoramaState.status === 'ready' && typeof google !== 'undefined') {
      requestAnimationFrame(() => google.maps.event.trigger(panorama, 'resize'))
    }
  }, [active, panoramaState.status])

  const recenter = useCallback(() => {
    const panorama = panoramaRef.current
    if (!panorama || panoramaState.status !== 'ready') return
    const target = sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom)
    targetCameraRef.current = target
    panorama.setPov({ heading: target.heading, pitch: target.pitch })
    panorama.setZoom(target.zoom)
    updateCameraFromPanorama()
  }, [panoramaState.status, updateCameraFromPanorama])

  /** Walk to an adjacent panorama; position_changed performs the URL sync. */
  const moveTo = useCallback((pano: string) => {
    const panorama = panoramaRef.current
    if (!panorama || panoramaState.status !== 'ready' || !pano) return
    movementTrackerRef.current.markUserNavigation(pano)
    panorama.setPano(pano)
  }, [panoramaState.status])

  return {
    camera,
    centered,
    containerRef,
    links,
    moveTo,
    panoramaState,
    recenter,
    viewportSize,
  }
}
