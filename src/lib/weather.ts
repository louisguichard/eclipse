import { WEATHER, WEATHER_HOURLY_VARIABLES } from '../config/weather'
import type { LatLng } from '../types'
import type {
  WeatherCondition,
  WeatherDayForecast,
  WeatherErrorKind,
  WeatherHourlyData,
  WeatherSnapshot,
} from '../types/weather'

type FetchWeatherOptions = {
  signal?: AbortSignal
  fetcher?: typeof fetch
  endpoint?: string
}

type CacheEntry = {
  expiresAt: number
  forecast: WeatherDayForecast
}

type OpenMeteoResponse = {
  latitude?: unknown
  longitude?: unknown
  elevation?: unknown
  timezone?: unknown
  utc_offset_seconds?: unknown
  hourly?: unknown
}

const weatherCache = new Map<string, CacheEntry>()

export class WeatherForecastError extends Error {
  readonly kind: WeatherErrorKind

  constructor(kind: WeatherErrorKind, message: string) {
    super(message)
    this.name = 'WeatherForecastError'
    this.kind = kind
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableNumberArray(value: unknown): value is Array<number | null> {
  return Array.isArray(value) && value.every((item) => item === null || Number.isFinite(item))
}

function readHourlyData(value: unknown): WeatherHourlyData {
  if (!isRecord(value)) {
    throw new WeatherForecastError('invalid-response', 'La réponse météo ne contient pas de série horaire valide.')
  }
  const time = value.time
  if (!Array.isArray(time) || !time.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new WeatherForecastError('invalid-response', 'La réponse météo ne contient pas de série horaire valide.')
  }

  const readField = (field: (typeof WEATHER_HOURLY_VARIABLES)[number]): Array<number | null> => {
    const series = value[field]
    if (!isNullableNumberArray(series) || series.length !== time.length) {
      throw new WeatherForecastError('invalid-response', `La série météo « ${field} » est invalide.`)
    }
    return series
  }

  return {
    time,
    temperature_2m: readField('temperature_2m'),
    apparent_temperature: readField('apparent_temperature'),
    precipitation_probability: readField('precipitation_probability'),
    weather_code: readField('weather_code'),
    cloud_cover: readField('cloud_cover'),
    visibility: readField('visibility'),
    wind_speed_10m: readField('wind_speed_10m'),
  }
}

export function parseOpenMeteoResponse(value: unknown, fetchedAt = new Date()): WeatherDayForecast {
  if (!isRecord(value)) {
    throw new WeatherForecastError('invalid-response', 'La réponse météo est invalide.')
  }

  const response = value as OpenMeteoResponse
  if (
    typeof response.latitude !== 'number'
    || typeof response.longitude !== 'number'
    || typeof response.timezone !== 'string'
    || typeof response.utc_offset_seconds !== 'number'
  ) {
    throw new WeatherForecastError('invalid-response', 'La réponse météo ne contient pas les métadonnées attendues.')
  }

  return {
    latitude: response.latitude,
    longitude: response.longitude,
    elevation: typeof response.elevation === 'number' ? response.elevation : null,
    timezone: response.timezone,
    utcOffsetSeconds: response.utc_offset_seconds,
    fetchedAt,
    hourly: readHourlyData(response.hourly),
  }
}

function utcDateKey(date: Date, dayOffset = 0): string {
  return new Date(date.getTime() + dayOffset * 86_400_000).toISOString().slice(0, 10)
}

function roundedCoordinate(value: number): number {
  const factor = 10 ** WEATHER.coordinatePrecision
  return Math.round(value * factor) / factor
}

function normalizedLocation(location: LatLng): LatLng {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new WeatherForecastError('unavailable', 'Coordonnées météo invalides.')
  }
  return {
    lat: roundedCoordinate(Math.max(-90, Math.min(90, location.lat))),
    lng: roundedCoordinate(Math.max(-180, Math.min(180, location.lng))),
  }
}

export function buildWeatherForecastUrl(
  location: LatLng,
  date: Date,
  endpoint: string = WEATHER.endpoint,
): string {
  const normalized = normalizedLocation(location)
  const url = new URL(endpoint)
  url.searchParams.set('latitude', String(normalized.lat))
  url.searchParams.set('longitude', String(normalized.lng))
  url.searchParams.set('hourly', WEATHER_HOURLY_VARIABLES.join(','))
  url.searchParams.set('timezone', WEATHER.timezone)
  url.searchParams.set('timeformat', WEATHER.timeformat)
  // These dates are interpreted in the location's time zone, which is not
  // known until the response arrives. This envelope covers UTC-12 to UTC+14.
  url.searchParams.set('start_date', utcDateKey(date, -1))
  url.searchParams.set('end_date', utcDateKey(date, 1))
  url.searchParams.set('cell_selection', 'land')
  return url.toString()
}

function cacheKey(location: LatLng, date: Date): string {
  const normalized = normalizedLocation(location)
  return `${normalized.lat},${normalized.lng}:${utcDateKey(date)}`
}

function errorFromStatus(status: number, reason?: string): WeatherForecastError {
  if (status === 429) {
    return new WeatherForecastError('rate-limit', 'Le service météo reçoit trop de demandes.')
  }
  if (status === 400 || status === 404) {
    return new WeatherForecastError('unavailable', reason || 'La prévision n’est pas encore disponible.')
  }
  return new WeatherForecastError('network', 'Le service météo est momentanément indisponible.')
}

export async function fetchWeatherDay(
  location: LatLng,
  date: Date,
  options: FetchWeatherOptions = {},
): Promise<WeatherDayForecast> {
  const key = cacheKey(location, date)
  const cached = weatherCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.forecast

  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = globalThis.setTimeout(abort, WEATHER.requestTimeoutMilliseconds)

  try {
    const response = await (options.fetcher ?? fetch)(
      buildWeatherForecastUrl(location, date, options.endpoint),
      { signal: controller.signal },
    )
    if (!response.ok) {
      let reason: string | undefined
      try {
        const body: unknown = await response.json()
        if (isRecord(body) && typeof body.reason === 'string') reason = body.reason
      } catch {
        // The HTTP status remains sufficient if the API did not return JSON.
      }
      throw errorFromStatus(response.status, reason)
    }

    const forecast = parseOpenMeteoResponse(await response.json())
    weatherCache.set(key, {
      expiresAt: Date.now() + WEATHER.cacheDurationMilliseconds,
      forecast,
    })
    return forecast
  } catch (error) {
    if (error instanceof WeatherForecastError) throw error
    if (controller.signal.aborted) {
      const kind: WeatherErrorKind = options.signal?.aborted ? 'aborted' : 'network'
      const message = kind === 'aborted' ? 'Requête météo annulée.' : 'Le service météo ne répond pas.'
      throw new WeatherForecastError(kind, message)
    }
    throw new WeatherForecastError('network', 'Impossible de charger la météo.')
  } finally {
    globalThis.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

function valueAt(values: Array<number | null>, index: number): number | null {
  const value = values[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function weatherConditionFromCode(code: number | null): WeatherCondition {
  if (code === 0) return { label: 'Ciel dégagé', icon: 'clear' }
  if (code === 1) return { label: 'Peu nuageux', icon: 'partly-cloudy' }
  if (code === 2) return { label: 'Éclaircies', icon: 'partly-cloudy' }
  if (code === 3) return { label: 'Couvert', icon: 'cloudy' }
  if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'fog' }
  if (code != null && code >= 51 && code <= 57) return { label: 'Bruine', icon: 'drizzle' }
  if (code != null && ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))) {
    return { label: code >= 80 ? 'Averses' : 'Pluie', icon: 'rain' }
  }
  if (code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)) {
    return { label: 'Neige', icon: 'snow' }
  }
  if (code != null && code >= 95 && code <= 99) return { label: 'Orage', icon: 'storm' }
  return { label: 'Météo variable', icon: 'unknown' }
}

export function weatherAtTime(forecast: WeatherDayForecast, date: Date): WeatherSnapshot | null {
  const target = date.getTime()
  let nearestIndex = -1
  let nearestDifference = Number.POSITIVE_INFINITY

  forecast.hourly.time.forEach((time, index) => {
    const timestamp = time * 1_000
    const difference = Math.abs(timestamp - target)
    if (Number.isFinite(timestamp) && difference < nearestDifference) {
      nearestIndex = index
      nearestDifference = difference
    }
  })

  if (nearestIndex < 0 || nearestDifference > 90 * 60 * 1_000) return null
  const weatherCode = valueAt(forecast.hourly.weather_code, nearestIndex)
  return {
    forecastTime: new Date(forecast.hourly.time[nearestIndex] * 1_000),
    temperatureCelsius: valueAt(forecast.hourly.temperature_2m, nearestIndex),
    apparentTemperatureCelsius: valueAt(forecast.hourly.apparent_temperature, nearestIndex),
    precipitationProbability: valueAt(forecast.hourly.precipitation_probability, nearestIndex),
    weatherCode,
    cloudCover: valueAt(forecast.hourly.cloud_cover, nearestIndex),
    visibilityMeters: valueAt(forecast.hourly.visibility, nearestIndex),
    windSpeedKmh: valueAt(forecast.hourly.wind_speed_10m, nearestIndex),
    condition: weatherConditionFromCode(weatherCode),
  }
}

export function clearWeatherCache(): void {
  weatherCache.clear()
}
