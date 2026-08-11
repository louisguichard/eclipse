import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STREET_VIEW } from '../config/eclipse'
import { sunToStreetViewPov } from '../lib/geometry'
import {
  googleStreetViewEmbedUrl,
  hasGoogleMapsEmbedApiKey,
} from '../lib/googleMaps'
import type {
  EclipseSnapshot,
  LatLng,
  ObserverLocation,
  PanoramaState,
  StreetViewCamera,
} from '../types'

type EmbedScene = {
  camera: StreetViewCamera
  location: LatLng
  revision: number
}

export type UseStreetViewEmbedResult = {
  camera: StreetViewCamera
  embedUrl: string | null
  iframeKey: string
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  markError: (revision: number) => void
  markLoaded: (revision: number) => void
  panoramaState: PanoramaState
  revision: number
  retry: () => void
  viewportSize: {
    height: number
    width: number
  }
}

function sameLocation(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng
}

function loadingState(message = 'Chargement de Street View…'): PanoramaState {
  return {
    status: 'loading',
    position: null,
    distanceMeters: null,
    radiusMeters: null,
    message,
  }
}

/**
 * Owns the fixed, free Street View Embed scene. Its URL is deliberately based
 * on an anchored camera rather than the live timeline snapshot: changing the
 * time therefore reprojects the Sun in React without reloading the iframe.
 */
export function useStreetViewEmbed(
  observer: ObserverLocation,
  snapshot: EclipseSnapshot,
  enabled = true,
): UseStreetViewEmbedResult {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const snapshotRef = useRef(snapshot)
  const observerRef = useRef(observer)
  const currentRevisionRef = useRef(0)
  const resizeFrameRef = useRef<number | null>(null)
  const [scene, setScene] = useState<EmbedScene>(() => ({
    camera: sunToStreetViewPov(snapshot.sun, STREET_VIEW.zoom),
    location: { lat: observer.lat, lng: observer.lng },
    revision: 0,
  }))
  const sceneLocationRef = useRef<LatLng>(scene.location)
  const [panoramaState, setPanoramaState] = useState<PanoramaState>(() =>
    hasGoogleMapsEmbedApiKey
      ? loadingState()
      : {
          status: 'demo',
          position: null,
          distanceMeters: null,
          radiusMeters: null,
          message: 'Ajoutez une clé Google Maps pour afficher la vue réelle.',
        },
  )
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 })

  snapshotRef.current = snapshot
  observerRef.current = observer
  currentRevisionRef.current = scene.revision
  sceneLocationRef.current = scene.location

  const embedUrl = useMemo(
    () => enabled ? googleStreetViewEmbedUrl(scene.location, scene.camera) : null,
    [enabled, scene.camera, scene.location],
  )

  // Location searches can emit several nearby updates in quick succession.
  // Debounce the iframe replacement just like the former panorama lookup.
  useEffect(() => {
    if (!enabled) {
      setPanoramaState((previous) => previous.status === 'idle'
        ? previous
        : {
            status: 'idle',
            position: null,
            distanceMeters: null,
            radiusMeters: null,
          })
      return undefined
    }
    if (!hasGoogleMapsEmbedApiKey) {
      setPanoramaState({
        status: 'demo',
        position: null,
        distanceMeters: null,
        radiusMeters: null,
        message: 'Ajoutez une clé Google Maps pour afficher la vue réelle.',
      })
      return undefined
    }

    const nextLocation = { lat: observer.lat, lng: observer.lng }
    if (sameLocation(scene.location, nextLocation)) return undefined

    const timer = window.setTimeout(() => {
      setPanoramaState(loadingState('Chargement de la nouvelle vue…'))
      setScene((previous) => ({
        camera: sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom),
        location: nextLocation,
        revision: previous.revision + 1,
      }))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [enabled, observer.lat, observer.lng, scene.location])

  useEffect(() => {
    if (!enabled || !embedUrl) return undefined
    const iframe = iframeRef.current
    if (!iframe) return undefined

    const measure = () => {
      const { height, width } = iframe.getBoundingClientRect()
      if (height > 0 && width > 0) {
        setViewportSize((previous) =>
          Math.abs(previous.height - height) < 0.5 && Math.abs(previous.width - width) < 0.5
            ? previous
            : { height, width })
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        measure()
      })
    })
    resizeObserver.observe(iframe)
    return () => {
      resizeObserver.disconnect()
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [embedUrl, enabled])

  useEffect(() => {
    if (!enabled || !embedUrl) return undefined
    const revision = scene.revision
    const loadTimeout = window.setTimeout(() => {
      if (
        revision !== currentRevisionRef.current ||
        !sameLocation(sceneLocationRef.current, observerRef.current)
      ) return
      setPanoramaState((previous) =>
        previous.status === 'loading' || previous.status === 'idle'
          ? {
              status: 'error',
              position: null,
              distanceMeters: null,
              radiusMeters: null,
              message: 'Street View Embed ne répond pas. Vérifiez le réseau puis réessayez.',
            }
          : previous)
    }, 15_000)
    return () => window.clearTimeout(loadTimeout)
  }, [embedUrl, enabled, scene.revision])

  const markLoaded = useCallback((revision: number) => {
    if (
      !enabled ||
      revision !== currentRevisionRef.current ||
      !sameLocation(sceneLocationRef.current, observerRef.current)
    ) return
    setPanoramaState({
      status: 'ready',
      position: null,
      distanceMeters: null,
      radiusMeters: null,
    })
  }, [enabled])

  const markError = useCallback((revision: number) => {
    if (
      !enabled ||
      revision !== currentRevisionRef.current ||
      !sameLocation(sceneLocationRef.current, observerRef.current)
    ) return
    setPanoramaState({
      status: 'error',
      position: null,
      distanceMeters: null,
      radiusMeters: null,
      message: 'Impossible de charger Street View Embed. Vérifiez la clé et ses restrictions.',
    })
  }, [enabled])

  const reload = useCallback((message = 'Recentrage vers le Soleil…') => {
    if (!enabled || !hasGoogleMapsEmbedApiKey) return
    setPanoramaState(loadingState(message))
    setScene((previous) => ({
      camera: sunToStreetViewPov(snapshotRef.current.sun, STREET_VIEW.zoom),
      location: { lat: observerRef.current.lat, lng: observerRef.current.lng },
      revision: previous.revision + 1,
    }))
  }, [enabled])

  const retry = useCallback(() => reload('Nouvelle tentative de chargement…'), [reload])

  useEffect(() => {
    if (!enabled) return undefined
    const retryWhenOnline = () => {
      if (panoramaState.status === 'error') retry()
    }
    window.addEventListener('online', retryWhenOnline)
    return () => window.removeEventListener('online', retryWhenOnline)
  }, [enabled, panoramaState.status, retry])

  return {
    camera: scene.camera,
    embedUrl,
    iframeKey: `${scene.location.lat},${scene.location.lng}:${scene.revision}`,
    iframeRef,
    markError,
    markLoaded,
    panoramaState,
    revision: scene.revision,
    retry,
    viewportSize,
  }
}
