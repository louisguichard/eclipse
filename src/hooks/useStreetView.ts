import '@photo-sphere-viewer/core/index.css'

import { SYSTEM, Viewer } from '@photo-sphere-viewer/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { STREET_VIEW } from '../config/eclipse'
import {
  angularDifference,
  cameraAngularDistance,
  clampPitch,
  haversineDistance,
  horizontalFieldOfView,
  normalizeHeading,
  sunToStreetViewPov,
} from '../lib/geometry'
import {
  findNearestPanorama,
  loadPanoramaImage,
} from '../lib/streetlevel'
import { captureOperationalError } from '../lib/sentry'
import type {
  StreetLevelLink,
  StreetLevelPanorama,
  StreetLevelPanoramaImage,
} from '../lib/streetlevel'
import type {
  EclipseSnapshot,
  LatLng,
  ObserverLocation,
  PanoramaState,
  StreetViewCamera,
} from '../types'

export type StreetViewStep = {
  pano: string
  heading: number
  description: string
}

export type StreetViewSunPoint = {
  visible: boolean
  x: number
  y: number
}

export type UseStreetViewResult = {
  attribution: string | null
  camera: StreetViewCamera
  centered: boolean
  containerRef: RefObject<HTMLDivElement | null>
  /** Adjacent panoramas the observer can walk to, in panorama order. */
  links: StreetViewStep[]
  moveTo: (pano: string) => void
  panoramaState: PanoramaState
  recenter: () => void
  /** Exact Sun projection produced by Photo Sphere Viewer's own camera. */
  sunViewportPoint: StreetViewSunPoint | null
  viewportSize: {
    height: number
    width: number
  }
}

type PanoramaLookup = {
  panorama: StreetLevelPanorama
  radiusMeters: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const LOOKUP_DELAY_MS = 220

class StreetViewCapabilityError extends Error {
  constructor(cause: unknown) {
    super('WebGL 2 indisponible pour le panorama.', { cause })
    this.name = 'StreetViewCapabilityError'
  }
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Converts a true compass heading to Photo Sphere Viewer's image-relative yaw. */
export function headingToViewerYaw(heading: number, panoramaHeading: number): number {
  return angularDifference(heading, panoramaHeading) * DEG_TO_RAD
}

/** Converts Photo Sphere Viewer's image-relative yaw back to true compass north. */
export function viewerYawToHeading(yaw: number, panoramaHeading: number): number {
  return normalizeHeading(panoramaHeading + yaw * RAD_TO_DEG)
}

/** Keeps the existing overlay projection compatible with Photo Sphere Viewer's FOV. */
export function horizontalFovToStreetZoom(horizontalFovDegrees: number): number {
  const boundedFov = Math.max(1, Math.min(179, horizontalFovDegrees)) * DEG_TO_RAD
  return Math.max(0, 1 - Math.log2(Math.tan(boundedFov / 2)))
}

async function lookupNearestPanorama(
  position: LatLng,
  signal: AbortSignal,
): Promise<PanoramaLookup | null> {
  for (const radiusMeters of STREET_VIEW.searchRadiiMeters) {
    if (signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
    const panorama = await findNearestPanorama(
      position.lat,
      position.lng,
      radiusMeters,
      signal,
    )
    if (panorama) return { panorama, radiusMeters }
  }
  return null
}

function viewerZoomForStreetZoom(viewer: Viewer, zoom: number): number {
  const horizontalFov = horizontalFieldOfView(zoom)
  const verticalFov = viewer.dataHelper.hFovToVFov(horizontalFov)
  return viewer.dataHelper.fovToZoomLevel(verticalFov)
}

function panoramaAttribution(panorama: StreetLevelPanorama): string {
  const copyright = panorama.copyright.trim() || '© Google'
  const source = panorama.source?.trim()
  if (!source || source === 'launch' || copyright.includes(source)) return copyright
  return `${copyright} · ${source}`
}

function panoData(image: StreetLevelPanoramaImage) {
  return {
    fullWidth: image.width,
    fullHeight: image.height,
    croppedWidth: image.width,
    croppedHeight: image.height,
    croppedX: 0,
    croppedY: 0,
  }
}

/**
 * Streetlevel browser integration.
 *
 * Metadata is fetched through Google's JSONP endpoint, then level-three JPEG
 * tiles are downloaded and assembled in the browser. No Google Maps SDK, API
 * key, paid Street View SKU or server-side image proxy is involved.
 */
export function useStreetView(
  observer: ObserverLocation,
  snapshot: EclipseSnapshot,
  active: boolean,
  onUserPositionChange?: (position: LatLng) => void,
): UseStreetViewResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const panoramaRef = useRef<StreetLevelPanorama | null>(null)
  const mountedRef = useRef(false)
  const activeRef = useRef(active)
  const observerRef = useRef(observer)
  const snapshotRef = useRef(snapshot)
  const onUserPositionChangeRef = useRef(onUserPositionChange)
  const requestTokenRef = useRef(0)
  const cameraFrameRef = useRef<number | null>(null)
  const followSunRef = useRef(true)
  const applyingCameraRef = useRef(false)
  const targetCameraRef = useRef(sunToStreetViewPov(snapshot.sun, STREET_VIEW.zoom))
  const [retryNonce, setRetryNonce] = useState(0)
  const [attribution, setAttribution] = useState<string | null>(null)
  const [links, setLinks] = useState<StreetViewStep[]>([])
  const [centered, setCentered] = useState(true)
  const [camera, setCamera] = useState<StreetViewCamera>(targetCameraRef.current)
  const [panoramaState, setPanoramaState] = useState<PanoramaState>({
    status: 'idle',
    position: null,
    distanceMeters: null,
    radiusMeters: null,
  })
  const [sunViewportPoint, setSunViewportPoint] = useState<StreetViewSunPoint | null>(null)
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 })

  activeRef.current = active
  observerRef.current = observer
  snapshotRef.current = snapshot
  onUserPositionChangeRef.current = onUserPositionChange
  targetCameraRef.current = sunToStreetViewPov(snapshot.sun, STREET_VIEW.zoom)

  const readCameraFromViewer = useCallback(() => {
    const viewer = viewerRef.current
    const panorama = panoramaRef.current
    if (!viewer || !panorama || !mountedRef.current) return
    const position = viewer.getPosition()
    const nextCamera: StreetViewCamera = {
      heading: viewerYawToHeading(position.yaw, panorama.heading),
      pitch: clampPitch(position.pitch * RAD_TO_DEG),
      zoom: horizontalFovToStreetZoom(viewer.state.hFov),
    }
    const size = viewer.getSize()
    const sunPosition = {
      yaw: headingToViewerYaw(snapshotRef.current.sun.azimuth, panorama.heading),
      pitch: snapshotRef.current.sun.altitude * DEG_TO_RAD,
    }
    const projectedSun = viewer.dataHelper.sphericalCoordsToViewerCoords(sunPosition)
    if (size.width > 0 && size.height > 0) {
      const nextSunPoint = {
        visible: viewer.dataHelper.isPointVisible(sunPosition),
        x: projectedSun.x / size.width,
        y: projectedSun.y / size.height,
      }
      // The panorama canvas and the solar marker are painted by different
      // renderers (WebGL and React). Updating CSS here keeps both positions in
      // the same browser frame instead of waiting for React's next commit.
      const stage = containerRef.current?.parentElement
      stage?.style.setProperty('--street-sun-x', `${nextSunPoint.x * 100}%`)
      stage?.style.setProperty('--street-sun-y', `${nextSunPoint.y * 100}%`)
      setSunViewportPoint((previous) =>
        previous &&
        previous.visible === nextSunPoint.visible &&
        Math.abs(previous.x - nextSunPoint.x) < 0.000_001 &&
        Math.abs(previous.y - nextSunPoint.y) < 0.000_001
          ? previous
          : nextSunPoint,
      )
    }
    setCamera(nextCamera)
    setCentered(
      cameraAngularDistance(snapshotRef.current.sun, nextCamera) <=
        STREET_VIEW.centeredToleranceDegrees,
    )
  }, [])

  const scheduleCameraRead = useCallback(() => {
    if (cameraFrameRef.current !== null) return
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null
      readCameraFromViewer()
    })
  }, [readCameraFromViewer])

  const ensureViewer = useCallback((): Viewer => {
    if (viewerRef.current) return viewerRef.current
    const container = containerRef.current
    if (!container) throw new Error('Conteneur du panorama indisponible')

    // Viewer catches this failure internally and returns a partially initialized
    // instance without dataHelper. Fail before construction so callers never use
    // that invalid instance (for example through rotate() or getPosition()).
    try {
      SYSTEM.load()
    } catch (error) {
      throw new StreetViewCapabilityError(error)
    }
    const viewer = new Viewer({
      container,
      navbar: false,
      keyboard: false,
      loadingTxt: 'Assemblage de la vue…',
      minFov: 20,
      maxFov: 80,
      mousemove: true,
      mousewheel: true,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
      canvasBackground: '#07101b',
    })
    // These events are already emitted on Photo Sphere Viewer's animation
    // frame. Read its camera immediately: another rAF here made the DOM marker
    // trail the WebGL panorama by one frame while dragging.
    viewer.addEventListener('position-updated', readCameraFromViewer)
    viewer.addEventListener('zoom-updated', readCameraFromViewer)
    viewer.addEventListener('size-updated', readCameraFromViewer)
    viewerRef.current = viewer
    return viewer
  }, [readCameraFromViewer])

  const applyCamera = useCallback((resetZoom: boolean) => {
    const viewer = viewerRef.current
    const panorama = panoramaRef.current
    if (!viewer || !panorama) return
    const target = targetCameraRef.current
    applyingCameraRef.current = true
    viewer.rotate({
      yaw: headingToViewerYaw(target.heading, panorama.heading),
      pitch: target.pitch * DEG_TO_RAD,
    })
    if (resetZoom) viewer.zoom(viewerZoomForStreetZoom(viewer, target.zoom))
    setCamera(target)
    setCentered(true)
    window.requestAnimationFrame(() => {
      applyingCameraRef.current = false
      scheduleCameraRead()
    })
  }, [scheduleCameraRead])

  const displayPanorama = useCallback(async (
    lookup: PanoramaLookup,
    image: StreetLevelPanoramaImage,
    searchedPosition: LatLng,
    requestToken: number,
  ) => {
    if (!mountedRef.current || requestToken !== requestTokenRef.current) return
    const viewer = ensureViewer()
    const target = targetCameraRef.current
    const panorama = lookup.panorama
    panoramaRef.current = panorama
    applyingCameraRef.current = true
    const displayed = await viewer.setPanorama(image.url, {
      panoData: panoData(image),
      position: {
        yaw: headingToViewerYaw(target.heading, panorama.heading),
        pitch: target.pitch * DEG_TO_RAD,
      },
      sphereCorrection: {
        tilt: panorama.pitchCorrection * DEG_TO_RAD,
        roll: panorama.rollCorrection * DEG_TO_RAD,
      },
      transition: false,
      zoom: viewerZoomForStreetZoom(viewer, target.zoom),
    })
    applyingCameraRef.current = false
    if (!displayed || !mountedRef.current || requestToken !== requestTokenRef.current) return

    viewer.autoSize()
    setCamera(target)
    setCentered(true)
    setAttribution(panoramaAttribution(panorama))
    setLinks(panorama.links.map((link) => ({
      pano: link.pano,
      heading: link.heading,
      description: 'Avancer',
    })))
    setPanoramaState({
      status: 'ready',
      position: panorama.position,
      distanceMeters: haversineDistance(searchedPosition, panorama.position),
      radiusMeters: lookup.radiusMeters,
    })
    scheduleCameraRead()
  }, [ensureViewer, scheduleCameraRead])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestTokenRef.current += 1
      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current)
        cameraFrameRef.current = null
      }
      viewerRef.current?.destroy()
      viewerRef.current = null
      panoramaRef.current = null
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const measure = () => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(0, Math.round(rect.width || container.clientWidth))
      const height = Math.max(0, Math.round(rect.height || container.clientHeight))
      setViewportSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      )
      if (width > 0 && height > 0) viewerRef.current?.autoSize()
    }
    measure()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(container)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const stopFollowing = () => {
      if (!panoramaRef.current || applyingCameraRef.current) return
      followSunRef.current = false
      setCentered(false)
    }
    container.addEventListener('pointerdown', stopFollowing, true)
    container.addEventListener('touchstart', stopFollowing, { capture: true, passive: true })
    container.addEventListener('wheel', stopFollowing, { capture: true, passive: true })
    return () => {
      container.removeEventListener('pointerdown', stopFollowing, true)
      container.removeEventListener('touchstart', stopFollowing, true)
      container.removeEventListener('wheel', stopFollowing, true)
    }
  }, [])

  useEffect(() => {
    const retry = () => setRetryNonce((value) => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  useEffect(() => {
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken
    const controller = new AbortController()
    followSunRef.current = true
    setLinks([])
    setAttribution(null)
    setSunViewportPoint(null)
    setCentered(true)
    setPanoramaState({
      status: 'loading',
      position: null,
      distanceMeters: null,
      radiusMeters: null,
      message: 'Recherche du panorama le plus proche…',
    })

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          if (!navigator.onLine) throw new Error('OFFLINE')
          const searchedPosition = { lat: observer.lat, lng: observer.lng }
          const lookup = await lookupNearestPanorama(searchedPosition, controller.signal)
          if (!mountedRef.current || requestToken !== requestTokenRef.current) return
          if (!lookup) {
            setPanoramaState({
              status: 'unavailable',
              position: null,
              distanceMeters: null,
              radiusMeters: STREET_VIEW.searchRadiiMeters.at(-1) ?? null,
              message: 'Aucune image Google Street View trouvée dans un rayon de 1 km.',
            })
            return
          }
          const image = await loadPanoramaImage(lookup.panorama, undefined, controller.signal)
          await displayPanorama(lookup, image, searchedPosition, requestToken)
        } catch (error) {
          if (abortError(error) || requestToken !== requestTokenRef.current) return
          if (error instanceof StreetViewCapabilityError) {
            setPanoramaState({
              status: 'unavailable',
              position: null,
              distanceMeters: null,
              radiusMeters: null,
              message: 'La vue 360° n’est pas compatible avec ce navigateur ou cet appareil.',
            })
            return
          }
          console.error('Streetlevel panorama failed', error)
          captureOperationalError('streetview', error)
          setPanoramaState({
            status: 'error',
            position: null,
            distanceMeters: null,
            radiusMeters: null,
            message: navigator.onLine
              ? 'Le service d’images de rue ne répond pas. Réessayez ou choisissez un autre point.'
              : 'Connexion indisponible. La vue se chargera au retour du réseau.',
          })
        }
      })()
    }, LOOKUP_DELAY_MS)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [displayPanorama, observer.lat, observer.lng, retryNonce])

  useEffect(() => {
    if (!viewerRef.current || !panoramaRef.current) return
    if (followSunRef.current) applyCamera(false)
    else scheduleCameraRead()
  }, [applyCamera, scheduleCameraRead, snapshot.sun.altitude, snapshot.sun.azimuth])

  useEffect(() => {
    if (!active) return
    viewerRef.current?.autoSize()
    scheduleCameraRead()
  }, [active, scheduleCameraRead])

  const recenter = useCallback(() => {
    followSunRef.current = true
    applyCamera(true)
  }, [applyCamera])

  const moveTo = useCallback((pano: string) => {
    const link: StreetLevelLink | undefined = panoramaRef.current?.links.find(
      (candidate) => candidate.pano === pano,
    )
    if (!link) return
    followSunRef.current = true
    setLinks([])
    setPanoramaState((previous) => ({
      ...previous,
      status: 'loading',
      message: 'Chargement de la vue suivante…',
    }))
    onUserPositionChangeRef.current?.(link.position)
  }, [])

  return {
    attribution,
    camera,
    centered,
    containerRef,
    links,
    moveTo,
    panoramaState,
    recenter,
    sunViewportPoint,
    viewportSize,
  }
}
