import { useCallback, useEffect, useMemo, useState } from 'react'
import { WEATHER } from '../config/weather'
import { fetchWeatherDay, WeatherForecastError, weatherAtTime } from '../lib/weather'
import type { LatLng } from '../types'
import type { WeatherDayForecast, WeatherResult, WeatherStatus } from '../types/weather'

function parisDateKey(date: Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: WEATHER.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function useWeather(location: LatLng, selectedTime: Date): WeatherResult {
  const roundedLat = location.lat.toFixed(WEATHER.coordinatePrecision)
  const roundedLng = location.lng.toFixed(WEATHER.coordinatePrecision)
  const dateKey = parisDateKey(selectedTime)
  const forecastDate = useMemo(() => new Date(`${dateKey}T12:00:00.000Z`), [dateKey])
  const [forecast, setForecast] = useState<WeatherDayForecast | null>(null)
  const [status, setStatus] = useState<WeatherStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setStatus('loading')
      setError(null)
      fetchWeatherDay(
        { lat: Number(roundedLat), lng: Number(roundedLng) },
        forecastDate,
        { signal: controller.signal },
      ).then((nextForecast) => {
        if (controller.signal.aborted) return
        setForecast(nextForecast)
        setStatus('ready')
      }).catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        setForecast(null)
        if (requestError instanceof WeatherForecastError && requestError.kind === 'unavailable') {
          setStatus('unavailable')
          setError('Prévision pas encore disponible')
          return
        }
        setStatus('error')
        setError('Météo indisponible')
      })
    }, WEATHER.requestDebounceMilliseconds)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [forecastDate, revision, roundedLat, roundedLng])

  const snapshot = useMemo(
    () => forecast ? weatherAtTime(forecast, selectedTime) : null,
    [forecast, selectedTime],
  )

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  return {
    status: status === 'ready' && !snapshot ? 'unavailable' : status,
    snapshot,
    error: status === 'ready' && !snapshot ? 'Prévision pas encore disponible' : error,
    refresh,
  }
}
