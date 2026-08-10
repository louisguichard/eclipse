import { useCallback, useEffect, useMemo, useState } from 'react'
import { WEATHER } from '../config/weather'
import { fetchWeatherDay, WeatherForecastError, weatherAtTime } from '../lib/weather'
import type { LatLng } from '../types'
import type { WeatherDayForecast, WeatherResult, WeatherStatus } from '../types/weather'

export function useWeather(location: LatLng, selectedTime: Date): WeatherResult {
  const roundedLat = location.lat.toFixed(WEATHER.coordinatePrecision)
  const roundedLng = location.lng.toFixed(WEATHER.coordinatePrecision)
  const dateKey = selectedTime.toISOString().slice(0, 10)
  const forecastDate = useMemo(() => new Date(`${dateKey}T12:00:00.000Z`), [dateKey])
  const [forecastState, setForecastState] = useState<{
    key: string
    forecast: WeatherDayForecast
  } | null>(null)
  const [status, setStatus] = useState<WeatherStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const requestKey = `${roundedLat},${roundedLng}:${dateKey}:${revision}`
  const forecast = forecastState?.key === requestKey ? forecastState.forecast : null

  useEffect(() => {
    const controller = new AbortController()
    setStatus('idle')
    setError(null)
    const timeout = window.setTimeout(() => {
      setStatus('loading')
      fetchWeatherDay(
        { lat: Number(roundedLat), lng: Number(roundedLng) },
        forecastDate,
        { signal: controller.signal },
      ).then((nextForecast) => {
        if (controller.signal.aborted) return
        setForecastState({ key: requestKey, forecast: nextForecast })
        setStatus('ready')
      }).catch((requestError: unknown) => {
        if (controller.signal.aborted) return
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
  }, [forecastDate, requestKey, roundedLat, roundedLng])

  const snapshot = useMemo(
    () => forecast ? weatherAtTime(forecast, selectedTime) : null,
    [forecast, selectedTime],
  )

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  return {
    status: status === 'ready' && !snapshot ? 'unavailable' : status,
    snapshot,
    timeZone: forecast?.timezone ?? null,
    error: status === 'ready' && !snapshot ? 'Prévision pas encore disponible' : error,
    refresh,
  }
}
