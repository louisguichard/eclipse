import { WEATHER } from '../config/weather'
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
  apiKey?: string
}

type FetchTimeZoneOptions = FetchWeatherOptions

type FetchWeatherForLocationOptions = FetchWeatherOptions & {
  now?: Date
}

type CacheEntry = {
  expiresAt: number
  forecast: WeatherDayForecast
}

type TimeZoneCacheEntry = {
  expiresAt: number
  timeZone: string
}

const weatherCache = new Map<string, CacheEntry>()
const timeZoneCache = new Map<string, TimeZoneCacheEntry>()
// The free WeatherAPI.com plan returns today plus two forecast days. One day
// of tolerance covers locations across the international date line.
const SAFE_FORECAST_FUTURE_DAYS = 2
const SAFE_FORECAST_PAST_DAYS = 1

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

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function requiredNumber(value: unknown, field: string): number {
  const number = finiteNumber(value)
  if (number === null) {
    throw new WeatherForecastError(
      'invalid-response',
      `La réponse météo ne contient pas de valeur valide pour « ${field} ».`,
    )
  }
  return number
}

function readTimeZone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new WeatherForecastError(
      'invalid-response',
      'La réponse ne contient pas de fuseau horaire valide.',
    )
  }
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value }).format(0)
  } catch {
    throw new WeatherForecastError(
      'invalid-response',
      'La réponse contient un fuseau horaire inconnu.',
    )
  }
  return value
}

function requireApiKey(value: string): string {
  const apiKey = value.trim()
  if (!apiKey) {
    throw new WeatherForecastError(
      'unavailable',
      'La clé WeatherAPI.com n’est pas configurée.',
    )
  }
  return apiKey
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
  _date: Date,
  endpoint: string = WEATHER.forecastEndpoint,
  apiKey: string = WEATHER.apiKey,
): string {
  const normalized = normalizedLocation(location)
  const url = new URL(endpoint)
  url.searchParams.set('key', requireApiKey(apiKey))
  url.searchParams.set('q', `${normalized.lat},${normalized.lng}`)
  url.searchParams.set('days', String(WEATHER.forecastDays))
  url.searchParams.set('aqi', 'no')
  url.searchParams.set('alerts', 'no')
  return url.toString()
}

export function buildTimeZoneUrl(
  location: LatLng,
  endpoint: string = WEATHER.timeZoneEndpoint,
  apiKey: string = WEATHER.apiKey,
): string {
  const normalized = normalizedLocation(location)
  const url = new URL(endpoint)
  url.searchParams.set('key', requireApiKey(apiKey))
  url.searchParams.set('q', `${normalized.lat},${normalized.lng}`)
  return url.toString()
}

function cacheKey(location: LatLng, date: Date): string {
  const normalized = normalizedLocation(location)
  return `${normalized.lat},${normalized.lng}:${date.toISOString().slice(0, 10)}`
}

function timeZoneCacheKey(location: LatLng): string {
  const normalized = normalizedLocation(location)
  return `${normalized.lat},${normalized.lng}`
}

function cacheTimeZone(location: LatLng, timeZone: string): void {
  timeZoneCache.set(timeZoneCacheKey(location), {
    expiresAt: Date.now() + WEATHER.timeZoneCacheDurationMilliseconds,
    timeZone,
  })
}

function cachedTimeZone(location: LatLng): string | null {
  const cached = timeZoneCache.get(timeZoneCacheKey(location))
  return cached && cached.expiresAt > Date.now() ? cached.timeZone : null
}

function utcDayNumber(date: Date): number | null {
  if (!Number.isFinite(date.getTime())) return null
  return Math.floor(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ) / 86_400_000)
}

export function isWeatherForecastDateRequestable(date: Date, now = new Date()): boolean {
  const dateDay = utcDayNumber(date)
  const nowDay = utcDayNumber(now)
  if (dateDay === null || nowDay === null) return false
  const distanceDays = dateDay - nowDay
  return distanceDays >= -SAFE_FORECAST_PAST_DAYS
    && distanceDays <= SAFE_FORECAST_FUTURE_DAYS
}

function utcOffsetSeconds(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return Math.round((representedAsUtc - at.getTime()) / 1_000)
}

function readWeatherApiHour(value: unknown, hourly: WeatherHourlyData): void {
  if (!isRecord(value)) {
    throw new WeatherForecastError('invalid-response', 'La série météo horaire est invalide.')
  }
  const condition = value.condition
  const conditionCode = isRecord(condition) ? finiteNumber(condition.code) : null
  hourly.time.push(requiredNumber(value.time_epoch, 'time_epoch'))
  hourly.temperature_2m.push(finiteNumber(value.temp_c))
  hourly.apparent_temperature.push(finiteNumber(value.feelslike_c))
  hourly.precipitation_probability.push(finiteNumber(value.chance_of_rain))
  hourly.weather_code.push(conditionCode)
  hourly.cloud_cover.push(finiteNumber(value.cloud))
  const visibilityKm = finiteNumber(value.vis_km)
  hourly.visibility.push(visibilityKm === null ? null : visibilityKm * 1_000)
  hourly.wind_speed_10m.push(finiteNumber(value.wind_kph))
}

export function parseWeatherApiResponse(
  value: unknown,
  fetchedAt = new Date(),
): WeatherDayForecast {
  if (!isRecord(value) || !isRecord(value.location) || !isRecord(value.forecast)) {
    throw new WeatherForecastError('invalid-response', 'La réponse météo est invalide.')
  }
  const location = value.location
  const forecastDays = value.forecast.forecastday
  if (!Array.isArray(forecastDays)) {
    throw new WeatherForecastError('invalid-response', 'La réponse ne contient aucune prévision.')
  }

  const hourly: WeatherHourlyData = {
    time: [],
    temperature_2m: [],
    apparent_temperature: [],
    precipitation_probability: [],
    weather_code: [],
    cloud_cover: [],
    visibility: [],
    wind_speed_10m: [],
  }
  for (const day of forecastDays) {
    if (!isRecord(day) || !Array.isArray(day.hour)) {
      throw new WeatherForecastError('invalid-response', 'La prévision journalière est invalide.')
    }
    for (const hour of day.hour) readWeatherApiHour(hour, hourly)
  }
  if (hourly.time.length === 0) {
    throw new WeatherForecastError('invalid-response', 'La réponse ne contient aucune heure météo.')
  }

  const timezone = readTimeZone(location.tz_id)
  return {
    latitude: requiredNumber(location.lat, 'latitude'),
    longitude: requiredNumber(location.lon, 'longitude'),
    elevation: null,
    timezone,
    utcOffsetSeconds: utcOffsetSeconds(timezone, new Date(hourly.time[0] * 1_000)),
    fetchedAt,
    hourly,
  }
}

function weatherApiReason(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined
  return typeof value.error.message === 'string' ? value.error.message : undefined
}

function errorFromStatus(status: number, reason?: string): WeatherForecastError {
  if (status === 429 || /quota|limit|exceeded/i.test(reason ?? '')) {
    return new WeatherForecastError('rate-limit', 'Le quota WeatherAPI.com est épuisé.')
  }
  if ([400, 401, 403, 404].includes(status)) {
    return new WeatherForecastError('unavailable', reason || 'La prévision n’est pas disponible.')
  }
  return new WeatherForecastError('network', 'Le service météo est momentanément indisponible.')
}

async function errorFromResponse(response: Response): Promise<WeatherForecastError> {
  try {
    return errorFromStatus(response.status, weatherApiReason(await response.json()))
  } catch {
    return errorFromStatus(response.status)
  }
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
      buildWeatherForecastUrl(
        location,
        date,
        options.endpoint ?? WEATHER.forecastEndpoint,
        options.apiKey ?? WEATHER.apiKey,
      ),
      { signal: controller.signal },
    )
    if (!response.ok) throw await errorFromResponse(response)

    const forecast = parseWeatherApiResponse(await response.json())
    weatherCache.set(key, {
      expiresAt: Date.now() + WEATHER.cacheDurationMilliseconds,
      forecast,
    })
    cacheTimeZone(location, forecast.timezone)
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

export async function fetchTimeZone(
  location: LatLng,
  options: FetchTimeZoneOptions = {},
): Promise<string> {
  const normalized = normalizedLocation(location)
  const cached = cachedTimeZone(normalized)
  if (cached) return cached

  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = globalThis.setTimeout(abort, WEATHER.requestTimeoutMilliseconds)

  try {
    const response = await (options.fetcher ?? fetch)(
      buildTimeZoneUrl(
        normalized,
        options.endpoint ?? WEATHER.timeZoneEndpoint,
        options.apiKey ?? WEATHER.apiKey,
      ),
      { signal: controller.signal },
    )
    if (!response.ok) throw await errorFromResponse(response)

    const body: unknown = await response.json()
    if (!isRecord(body) || !isRecord(body.location)) {
      throw new WeatherForecastError(
        'invalid-response',
        'La réponse ne contient pas de fuseau horaire valide.',
      )
    }
    const timeZone = readTimeZone(body.location.tz_id)
    cacheTimeZone(normalized, timeZone)
    return timeZone
  } catch (error) {
    if (error instanceof WeatherForecastError) throw error
    if (controller.signal.aborted) {
      const kind: WeatherErrorKind = options.signal?.aborted ? 'aborted' : 'network'
      throw new WeatherForecastError(
        kind,
        kind === 'aborted' ? 'Requête de fuseau horaire annulée.' : 'Le service de fuseau horaire ne répond pas.',
      )
    }
    throw new WeatherForecastError('network', 'Impossible de déterminer le fuseau horaire local.')
  } finally {
    globalThis.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

export type WeatherLocationForecast = {
  forecast: WeatherDayForecast | null
  timeZone: string
  forecastError: WeatherForecastError | null
  stale: boolean
}

function staleWeatherDay(location: LatLng, date: Date): WeatherDayForecast | null {
  return weatherCache.get(cacheKey(location, date))?.forecast ?? null
}

export async function fetchWeatherForLocation(
  location: LatLng,
  date: Date,
  options: FetchWeatherForLocationOptions = {},
): Promise<WeatherLocationForecast> {
  const { now = new Date(), ...fetchOptions } = options
  if (!isWeatherForecastDateRequestable(date, now)) {
    return {
      forecast: null,
      timeZone: await fetchTimeZone(location, fetchOptions),
      forecastError: new WeatherForecastError(
        'unavailable',
        'La prévision n’est pas encore disponible.',
      ),
      stale: false,
    }
  }

  try {
    const forecast = await fetchWeatherDay(location, date, fetchOptions)
    return { forecast, timeZone: forecast.timezone, forecastError: null, stale: false }
  } catch (error) {
    const staleForecast = staleWeatherDay(location, date)
    if (staleForecast && error instanceof WeatherForecastError &&
      error.kind !== 'aborted' && error.kind !== 'unavailable') {
      return {
        forecast: staleForecast,
        timeZone: staleForecast.timezone,
        forecastError: error,
        stale: true,
      }
    }
    const timeZone = cachedTimeZone(location)
    if (timeZone && error instanceof WeatherForecastError) {
      return { forecast: null, timeZone, forecastError: error, stale: false }
    }
    throw error
  }
}

function valueAt(values: Array<number | null>, index: number): number | null {
  const value = values[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function weatherConditionFromCode(code: number | null): WeatherCondition {
  if (code === 1000) return { label: 'Ciel dégagé', icon: 'clear' }
  if (code === 1003) return { label: 'Éclaircies', icon: 'partly-cloudy' }
  if (code === 1006 || code === 1009) return { label: 'Couvert', icon: 'cloudy' }
  if (code === 1030 || code === 1135 || code === 1147) {
    return { label: 'Brouillard', icon: 'fog' }
  }
  if ([1063, 1150, 1153, 1168, 1171].includes(code ?? -1)) {
    return { label: 'Bruine', icon: 'drizzle' }
  }
  if (
    (code != null && code >= 1180 && code <= 1201)
    || (code != null && code >= 1240 && code <= 1246)
  ) {
    return { label: code >= 1240 ? 'Averses' : 'Pluie', icon: 'rain' }
  }
  if (
    [1066, 1069, 1072, 1114, 1117].includes(code ?? -1)
    || (code != null && code >= 1204 && code <= 1237)
    || (code != null && code >= 1249 && code <= 1264)
  ) {
    return { label: 'Neige', icon: 'snow' }
  }
  if (code === 1087 || (code != null && code >= 1273 && code <= 1282)) {
    return { label: 'Orage', icon: 'storm' }
  }
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
  timeZoneCache.clear()
}
