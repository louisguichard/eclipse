export type WeatherIconName =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'unknown'

export type WeatherErrorKind =
  | 'aborted'
  | 'network'
  | 'rate-limit'
  | 'unavailable'
  | 'invalid-response'

export type WeatherHourlyData = {
  /** Unix timestamps in seconds returned by WeatherAPI.com. */
  time: number[]
  temperature_2m: Array<number | null>
  apparent_temperature: Array<number | null>
  precipitation_probability: Array<number | null>
  weather_code: Array<number | null>
  cloud_cover: Array<number | null>
  visibility: Array<number | null>
  wind_speed_10m: Array<number | null>
}

export type WeatherDayForecast = {
  latitude: number
  longitude: number
  elevation: number | null
  timezone: string
  utcOffsetSeconds: number
  fetchedAt: Date
  hourly: WeatherHourlyData
}

export type WeatherCondition = {
  label: string
  icon: WeatherIconName
}

export type WeatherSnapshot = {
  forecastTime: Date
  temperatureCelsius: number | null
  apparentTemperatureCelsius: number | null
  precipitationProbability: number | null
  weatherCode: number | null
  cloudCover: number | null
  visibilityMeters: number | null
  windSpeedKmh: number | null
  condition: WeatherCondition
}

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export type WeatherResult = {
  status: WeatherStatus
  snapshot: WeatherSnapshot | null
  /** IANA time zone returned for the requested coordinates. */
  timeZone: string | null
  error: string | null
  refresh: () => void
}
