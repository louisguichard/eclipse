import { useCallback, useEffect, useMemo, useState } from 'react'
import { WEATHER } from '../config/weather'
import { fetchTimeZone, fetchWeatherDay, WeatherForecastError, weatherAtTime } from '../lib/weather'
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
  const [timeZoneState, setTimeZoneState] = useState<{
    key: string
    value: string
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const coordinateKey = `${roundedLat},${roundedLng}`
  const requestKey = `${roundedLat},${roundedLng}:${dateKey}:${revision}`
  const forecast = forecastState?.key === requestKey ? forecastState.forecast : null
  const resolvedTimeZone = timeZoneState?.key === coordinateKey ? timeZoneState.value : null

  useEffect(() => {
    const controller = new AbortController()
    setStatus('idle')
    setError(null)
    void fetchTimeZone(
      { lat: Number(roundedLat), lng: Number(roundedLng) },
      { signal: controller.signal },
    ).then((timeZone) => {
      if (!controller.signal.aborted) setTimeZoneState({ key: coordinateKey, value: timeZone })
    }).catch(() => {
      // Forecast loading has its own visible status. A zone lookup failure is
      // deliberately quiet; successful forecast metadata remains a fallback.
    })
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
  }, [coordinateKey, forecastDate, requestKey, roundedLat, roundedLng])

  const snapshot = useMemo(
    () => forecast ? weatherAtTime(forecast, selectedTime) : null,
    [forecast, selectedTime],
  )

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  return {
    status: status === 'ready' && !snapshot ? 'unavailable' : status,
    snapshot,
    timeZone: resolvedTimeZone ?? forecast?.timezone ?? null,
    error: status === 'ready' && !snapshot ? 'Prévision pas encore disponible' : error,
    refresh,
  }
}
