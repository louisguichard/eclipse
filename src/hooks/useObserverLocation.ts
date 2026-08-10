import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LOCATION } from '../config/locations'
import { TIMELINE } from '../config/eclipse'
import { localEclipseCircumstances, timelineMinuteFromDate } from '../lib/astronomy'
import type { ObserverLocation } from '../types'

function validCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

function readInitialState(): { location: ObserverLocation; minute: number } {
  const params = new URLSearchParams(window.location.search)
  const lat = Number(params.get('lat'))
  const lng = Number(params.get('lng'))
  const minute = Number(params.get('time'))
  const hasLocationParams = params.has('lat') && params.has('lng')
  const hasValidLocation = hasLocationParams &&
    validCoordinate(lat, -90, 90) &&
    validCoordinate(lng, -180, 180)

  return {
    location: hasValidLocation
      ? {
          lat,
          lng,
          label: 'Point partagé',
          source: 'url',
        }
      : DEFAULT_LOCATION,
    minute: params.has('time') && Number.isFinite(minute)
      ? Math.max(TIMELINE.minMinute, Math.min(TIMELINE.maxMinute, Math.round(minute)))
      : TIMELINE.defaultMinute,
  }
}

export function useObserverLocation() {
  const initial = useMemo(readInitialState, [])
  const [location, setLocationState] = useState<ObserverLocation>(initial.location)
  const [minute, setMinute] = useState(initial.minute)
  const [geolocationStatus, setGeolocationStatus] = useState<
    'idle' | 'loading' | 'denied' | 'error'
  >('idle')
  const shareableMinute = Math.round(minute)

  const setLocation = useCallback((next: ObserverLocation) => {
    if (!validCoordinate(next.lat, -90, 90) || !validCoordinate(next.lng, -180, 180)) {
      return
    }
    setLocationState(next)
    // A Paris instant can fall after the eclipse in Alaska. Jump to the local
    // observable maximum on deliberate location changes, while preserving the
    // chosen time during small Street View walks and initial shared-URL loads.
    if (next.source !== 'streetview') {
      const circumstances = localEclipseCircumstances(next)
      setMinute(circumstances.visible
        ? timelineMinuteFromDate(circumstances.maximum.time)
        : TIMELINE.defaultMinute)
    }
  }, [])

  const requestGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationStatus('error')
      return
    }

    setGeolocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'Ma position',
          source: 'geolocation',
        })
        setGeolocationStatus('idle')
      },
      (error) => {
        setGeolocationStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [setLocation])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('lat', location.lat.toFixed(6))
    url.searchParams.set('lng', location.lng.toFixed(6))
    url.searchParams.set('time', String(shareableMinute))
    window.history.replaceState(null, '', url)
  }, [location.lat, location.lng, shareableMinute])

  const shareUrl = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('lat', location.lat.toFixed(6))
    url.searchParams.set('lng', location.lng.toFixed(6))
    url.searchParams.set('time', String(shareableMinute))
    return url.toString()
  }, [location.lat, location.lng, shareableMinute])

  return {
    location,
    setLocation,
    minute,
    setMinute,
    requestGeolocation,
    geolocationStatus,
    shareUrl,
  }
}
