/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WeatherForecastError } from '../lib/weather'
import { useWeather } from './useWeather'
import type { WeatherDayForecast, WeatherSnapshot } from '../types/weather'

const weatherMocks = vi.hoisted(() => ({
  fetchWeatherForLocation: vi.fn(),
  weatherAtTime: vi.fn(),
}))

vi.mock('../lib/weather', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/weather')>(),
  fetchWeatherForLocation: weatherMocks.fetchWeatherForLocation,
  weatherAtTime: weatherMocks.weatherAtTime,
}))

const DAY: WeatherDayForecast = {
  latitude: 48.86,
  longitude: 2.36,
  elevation: 36,
  timezone: 'Europe/Paris',
  utcOffsetSeconds: 7200,
  fetchedAt: new Date('2026-08-09T18:00:00Z'),
  hourly: {
    time: [],
    temperature_2m: [],
    apparent_temperature: [],
    precipitation_probability: [],
    weather_code: [],
    cloud_cover: [],
    visibility: [],
    wind_speed_10m: [],
  },
}

function snapshotAt(date: Date): WeatherSnapshot {
  return {
    forecastTime: date,
    temperatureCelsius: 34,
    apparentTemperatureCelsius: 33,
    precipitationProbability: 0,
    weatherCode: 0,
    cloudCover: 0,
    visibilityMeters: 50_000,
    windSpeedKmh: 8,
    condition: { label: 'Ciel dégagé', icon: 'clear' },
  }
}

describe('useWeather', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'))
    weatherMocks.fetchWeatherForLocation.mockResolvedValue({
      forecast: DAY,
      timeZone: 'Europe/Paris',
      forecastError: null,
      stale: false,
    })
    weatherMocks.weatherAtTime.mockImplementation((_forecast: WeatherDayForecast, date: Date) => snapshotAt(date))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('does not refetch while the timeline moves within the same day', async () => {
    const location = { lat: 48.8566, lng: 2.3522 }
    const { result, rerender } = renderHook(
      ({ selectedTime }) => useWeather(location, selectedTime),
      { initialProps: { selectedTime: new Date('2026-08-12T18:17:00Z') } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.timeZone).toBe('Europe/Paris')
    expect(weatherMocks.fetchWeatherForLocation).toHaveBeenCalledTimes(1)

    rerender({ selectedTime: new Date('2026-08-12T18:42:00Z') })

    expect(result.current.snapshot?.forecastTime.toISOString()).toBe('2026-08-12T18:42:00.000Z')
    expect(weatherMocks.fetchWeatherForLocation).toHaveBeenCalledTimes(1)
  })

  it('debounces and reloads when the rounded location changes', async () => {
    const { rerender } = renderHook(
      ({ lat }) => useWeather({ lat, lng: 2.3522 }, new Date('2026-08-12T18:17:00Z')),
      { initialProps: { lat: 48.8566 } },
    )

    rerender({ lat: 48.8626 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })

    expect(weatherMocks.fetchWeatherForLocation).toHaveBeenCalledTimes(1)
    expect(weatherMocks.fetchWeatherForLocation).toHaveBeenCalledWith(
      { lat: 48.863, lng: 2.352 },
      expect.any(Date),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('drops the previous forecast and time zone as soon as the location changes', async () => {
    const tokyoDay: WeatherDayForecast = {
      ...DAY,
      latitude: 35.68,
      longitude: 139.65,
      timezone: 'Asia/Tokyo',
      utcOffsetSeconds: 32_400,
    }
    weatherMocks.fetchWeatherForLocation
      .mockResolvedValueOnce({
        forecast: DAY,
        timeZone: 'Europe/Paris',
        forecastError: null,
        stale: false,
      })
      .mockResolvedValueOnce({
        forecast: tokyoDay,
        timeZone: 'Asia/Tokyo',
        forecastError: null,
        stale: false,
      })
    const { result, rerender } = renderHook(
      ({ lat, lng }) => useWeather({ lat, lng }, new Date('2026-08-12T18:17:00Z')),
      { initialProps: { lat: 48.8566, lng: 2.3522 } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })
    expect(result.current.timeZone).toBe('Europe/Paris')

    rerender({ lat: 35.6762, lng: 139.6503 })
    expect(result.current.timeZone).toBeNull()
    expect(result.current.snapshot).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })
    expect(result.current.timeZone).toBe('Asia/Tokyo')
  })

  it('keeps local clock formatting available when the dated forecast is unavailable', async () => {
    weatherMocks.fetchWeatherForLocation.mockResolvedValue({
      forecast: null,
      timeZone: 'Europe/Paris',
      forecastError: new WeatherForecastError(
        'unavailable',
        'Date is out of allowed range',
      ),
      stale: false,
    })
    const { result } = renderHook(() => useWeather(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
    ))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })

    expect(result.current.timeZone).toBe('Europe/Paris')
    expect(result.current.status).toBe('unavailable')
  })

  it('keeps an expired forecast visible during a provider outage', async () => {
    weatherMocks.fetchWeatherForLocation.mockResolvedValue({
      forecast: DAY,
      timeZone: 'Europe/Paris',
      forecastError: new WeatherForecastError('network', 'Le service météo ne répond pas.'),
      stale: true,
    })
    const { result } = renderHook(() => useWeather(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
    ))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251)
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.snapshot).not.toBeNull()
    expect(result.current.stale).toBe(true)
  })
})
