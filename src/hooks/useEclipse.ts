import { useMemo } from 'react'
import { calculateEclipseSnapshot, dateFromTimelineMinute } from '../lib/astronomy'
import type { EclipseSnapshot, LatLng } from '../types'

type EclipseResult = {
  snapshot: EclipseSnapshot | null
  error: string | null
}

export function useEclipse(location: LatLng, minute: number): EclipseResult {
  const { lat, lng } = location
  return useMemo(() => {
    try {
      const date = dateFromTimelineMinute(minute)
      return {
        snapshot: calculateEclipseSnapshot({ lat, lng }, date),
        error: null,
      }
    } catch (error) {
      console.error('Astronomy calculation failed', error)
      return {
        snapshot: null,
        error: 'Le calcul astronomique a échoué pour ce point.',
      }
    }
  }, [lat, lng, minute])
}
