import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWeatherForecastUrl,
  clearWeatherCache,
  fetchWeatherDay,
  parseOpenMeteoResponse,
  WeatherForecastError,
  weatherAtTime,
  weatherConditionFromCode,
} from './weather'

const OPEN_METEO_RESPONSE = {
  latitude: 48.86,
  longitude: 2.36,
  elevation: 36,
  timezone: 'Europe/Paris',
  utc_offset_seconds: 7200,
  hourly: {
    time: ['2026-08-12T19:00', '2026-08-12T20:00', '2026-08-12T21:00'],
    temperature_2m: [35, 34.2, 32.6],
    apparent_temperature: [33.7, 32.7, 31.3],
    precipitation_probability: [0, 0, 5],
    weather_code: [0, 0, 1],
    cloud_cover: [0, 0, 6],
    visibility: [53_400, 53_560, 51_540],
    wind_speed_10m: [8.2, 8.4, 7.4],
  },
}

afterEach(() => {
  clearWeatherCache()
  vi.restoreAllMocks()
})

describe('buildWeatherForecastUrl', () => {
  it('requests one Paris-local day with only the useful hourly fields', () => {
    const url = new URL(buildWeatherForecastUrl(
      { lat: 48.856_61, lng: 2.352_21 },
      new Date('2026-08-12T18:17:00.000Z'),
    ))

    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe('48.857')
    expect(url.searchParams.get('longitude')).toBe('2.352')
    expect(url.searchParams.get('timezone')).toBe('Europe/Paris')
    expect(url.searchParams.get('start_date')).toBe('2026-08-12')
    expect(url.searchParams.get('end_date')).toBe('2026-08-12')
    expect(url.searchParams.get('hourly')?.split(',')).toHaveLength(7)
  })
})

describe('weatherAtTime', () => {
  it('selects the closest forecast hour around maximum eclipse', () => {
    const forecast = parseOpenMeteoResponse(OPEN_METEO_RESPONSE, new Date('2026-08-09T18:00:00Z'))
    const snapshot = weatherAtTime(forecast, new Date('2026-08-12T18:17:00Z'))

    expect(snapshot?.forecastTime.toISOString()).toBe('2026-08-12T18:00:00.000Z')
    expect(snapshot?.temperatureCelsius).toBe(34.2)
    expect(snapshot?.condition.label).toBe('Ciel dégagé')
    expect(snapshot?.cloudCover).toBe(0)
  })

  it('returns null outside the downloaded day', () => {
    const forecast = parseOpenMeteoResponse(OPEN_METEO_RESPONSE)
    expect(weatherAtTime(forecast, new Date('2026-08-13T04:00:00Z'))).toBeNull()
  })
})

describe('weatherConditionFromCode', () => {
  it.each([
    [0, 'Ciel dégagé', 'clear'],
    [2, 'Éclaircies', 'partly-cloudy'],
    [45, 'Brouillard', 'fog'],
    [63, 'Pluie', 'rain'],
    [82, 'Averses', 'rain'],
    [95, 'Orage', 'storm'],
  ] as const)('maps WMO code %s to a concise French condition', (code, label, icon) => {
    expect(weatherConditionFromCode(code)).toEqual({ label, icon })
  })
})

describe('fetchWeatherDay', () => {
  it('caches a successful location/day request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(OPEN_METEO_RESPONSE)))
    const location = { lat: 48.8566, lng: 2.3522 }
    const date = new Date('2026-08-12T18:17:00Z')

    await fetchWeatherDay(location, date, { fetcher })
    await fetchWeatherDay(location, date, { fetcher })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('turns a forecast-horizon response into an unavailable error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ reason: 'Date is out of allowed range' }),
      { status: 400 },
    ))

    await expect(fetchWeatherDay(
      { lat: 48.8566, lng: 2.3522 },
      new Date('2026-08-12T18:17:00Z'),
      { fetcher },
    )).rejects.toMatchObject({ kind: 'unavailable' } satisfies Partial<WeatherForecastError>)
  })
})
