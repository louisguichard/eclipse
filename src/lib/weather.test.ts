import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTimeZoneUrl,
  buildWeatherForecastUrl,
  clearWeatherCache,
  fetchTimeZone,
  fetchWeatherDay,
  fetchWeatherForLocation,
  parseWeatherApiResponse,
  WeatherForecastError,
  weatherAtTime,
  weatherConditionFromCode,
} from './weather'

const WEATHER_API_RESPONSE = {
  location: {
    lat: 48.86,
    lon: 2.36,
    tz_id: 'Europe/Paris',
  },
  forecast: {
    forecastday: [{
      date: '2026-08-12',
      hour: [
        {
          time_epoch: Date.parse('2026-08-12T17:00:00Z') / 1_000,
          temp_c: 35,
          feelslike_c: 33.7,
          chance_of_rain: 0,
          condition: { code: 1000, text: 'Sunny' },
          cloud: 0,
          vis_km: 53.4,
          wind_kph: 8.2,
        },
        {
          time_epoch: Date.parse('2026-08-12T18:00:00Z') / 1_000,
          temp_c: 34.2,
          feelslike_c: 32.7,
          chance_of_rain: 0,
          condition: { code: 1000, text: 'Sunny' },
          cloud: 0,
          vis_km: 53.56,
          wind_kph: 8.4,
        },
        {
          time_epoch: Date.parse('2026-08-12T19:00:00Z') / 1_000,
          temp_c: 32.6,
          feelslike_c: 31.3,
          chance_of_rain: 5,
          condition: { code: 1003, text: 'Partly cloudy' },
          cloud: 6,
          vis_km: 51.54,
          wind_kph: 7.4,
        },
      ],
    }],
  },
}

afterEach(() => {
  clearWeatherCache()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('buildWeatherForecastUrl', () => {
  it('requests three forecast days for rounded coordinates', () => {
    const url = new URL(buildWeatherForecastUrl(
      { lat: 48.856_61, lng: 2.352_21 },
      new Date('2026-08-12T18:17:00.000Z'),
      undefined,
      'temporary-key',
    ))

    expect(url.origin + url.pathname).toBe('https://api.weatherapi.com/v1/forecast.json')
    expect(url.searchParams.get('key')).toBe('temporary-key')
    expect(url.searchParams.get('q')).toBe('48.857,2.352')
    expect(url.searchParams.get('days')).toBe('3')
    expect(url.searchParams.get('aqi')).toBe('no')
    expect(url.searchParams.get('alerts')).toBe('no')
  })
})

describe('time zone lookup', () => {
  it('uses the WeatherAPI.com timezone endpoint', () => {
    const url = new URL(buildTimeZoneUrl(
      { lat: 48.856_61, lng: 2.352_21 },
      undefined,
      'temporary-key',
    ))

    expect(url.origin + url.pathname).toBe('https://api.weatherapi.com/v1/timezone.json')
    expect(url.searchParams.get('key')).toBe('temporary-key')
    expect(url.searchParams.get('q')).toBe('48.857,2.352')
  })

  it('resolves and caches the IANA zone', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      location: { tz_id: 'Europe/Paris' },
    })))
    const location = { lat: 48.8566, lng: 2.3522 }

    await expect(fetchTimeZone(location, { fetcher, apiKey: 'temporary-key' }))
      .resolves.toBe('Europe/Paris')
    await expect(fetchTimeZone(location, { fetcher, apiKey: 'temporary-key' }))
      .resolves.toBe('Europe/Paris')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('combined weather lookup', () => {
  it('returns the forecast, cloud cover, and IANA zone with one request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(WEATHER_API_RESPONSE)),
    )

    const result = await fetchWeatherForLocation(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
      {
        fetcher,
        apiKey: 'temporary-key',
        now: new Date('2026-08-11T12:00:00Z'),
      },
    )

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.timeZone).toBe('Europe/Paris')
    expect(result.forecastError).toBeNull()
    expect(result.stale).toBe(false)
    expect(weatherAtTime(result.forecast!, new Date('2026-08-12T18:17:00Z'))?.cloudCover)
      .toBe(0)
  })

  it('uses one timezone request when the dated forecast is out of range', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      location: { tz_id: 'Europe/Paris' },
    })))

    const result = await fetchWeatherForLocation(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
      {
        fetcher,
        apiKey: 'temporary-key',
        now: new Date('2026-01-01T12:00:00Z'),
      },
    )
    const url = new URL(String(fetcher.mock.calls[0][0]))

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.forecast).toBeNull()
    expect(result.forecastError?.kind).toBe('unavailable')
    expect(result.timeZone).toBe('Europe/Paris')
    expect(url.pathname).toBe('/v1/timezone.json')
  })

  it('uses an expired forecast when a refresh hits a provider outage', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'))
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(WEATHER_API_RESPONSE)))
      .mockRejectedValueOnce(new TypeError('Load failed'))
    const location = { lat: 48.8566, lng: 2.3522 }
    const date = new Date('2026-08-12T18:17:00Z')
    const options = {
      fetcher,
      apiKey: 'temporary-key',
      now: new Date('2026-08-11T12:00:00Z'),
    }

    await fetchWeatherForLocation(location, date, options)
    vi.advanceTimersByTime(16 * 60 * 1_000)
    const fallback = await fetchWeatherForLocation(location, date, options)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fallback.forecast).not.toBeNull()
    expect(fallback.forecastError).toMatchObject({ kind: 'network' })
    expect(fallback.timeZone).toBe('Europe/Paris')
    expect(fallback.stale).toBe(true)
  })
})

describe('weatherAtTime', () => {
  it('selects the closest forecast hour around maximum eclipse', () => {
    const forecast = parseWeatherApiResponse(
      WEATHER_API_RESPONSE,
      new Date('2026-08-12T10:00:00Z'),
    )
    const snapshot = weatherAtTime(forecast, new Date('2026-08-12T18:17:00Z'))

    expect(snapshot?.forecastTime.toISOString()).toBe('2026-08-12T18:00:00.000Z')
    expect(snapshot?.temperatureCelsius).toBe(34.2)
    expect(snapshot?.condition.label).toBe('Ciel dégagé')
    expect(snapshot?.cloudCover).toBe(0)
    expect(snapshot?.visibilityMeters).toBe(53_560)
  })

  it('returns null outside the downloaded forecast', () => {
    const forecast = parseWeatherApiResponse(WEATHER_API_RESPONSE)
    expect(weatherAtTime(forecast, new Date('2026-08-13T04:00:00Z'))).toBeNull()
  })

  it('uses absolute Unix instants independently of the time zone', () => {
    const tokyoForecast = parseWeatherApiResponse({
      ...WEATHER_API_RESPONSE,
      location: { ...WEATHER_API_RESPONSE.location, tz_id: 'Asia/Tokyo' },
    })
    const snapshot = weatherAtTime(tokyoForecast, new Date('2026-08-12T18:17:00Z'))

    expect(snapshot?.forecastTime.toISOString()).toBe('2026-08-12T18:00:00.000Z')
    expect(snapshot?.temperatureCelsius).toBe(34.2)
  })
})

describe('weatherConditionFromCode', () => {
  it.each([
    [1000, 'Ciel dégagé', 'clear'],
    [1003, 'Éclaircies', 'partly-cloudy'],
    [1135, 'Brouillard', 'fog'],
    [1189, 'Pluie', 'rain'],
    [1243, 'Averses', 'rain'],
    [1276, 'Orage', 'storm'],
  ] as const)('maps WeatherAPI code %s to a concise French condition', (code, label, icon) => {
    expect(weatherConditionFromCode(code)).toEqual({ label, icon })
  })
})

describe('fetchWeatherDay', () => {
  it('caches a successful location/day request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(WEATHER_API_RESPONSE)),
    )
    const location = { lat: 48.8566, lng: 2.3522 }
    const date = new Date('2026-08-12T18:17:00Z')

    await fetchWeatherDay(location, date, { fetcher, apiKey: 'temporary-key' })
    await fetchWeatherDay(location, date, { fetcher, apiKey: 'temporary-key' })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('turns an API quota response into a rate-limit error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 2007, message: 'API monthly call quota exceeded.' } }),
      { status: 403 },
    ))

    await expect(fetchWeatherDay(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
      { fetcher, apiKey: 'temporary-key' },
    )).rejects.toMatchObject({ kind: 'rate-limit' } satisfies Partial<WeatherForecastError>)
  })

  it('fails locally when the temporary key is absent', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(fetchWeatherDay(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
      { fetcher, apiKey: '' },
    )).rejects.toMatchObject({ kind: 'unavailable' } satisfies Partial<WeatherForecastError>)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
