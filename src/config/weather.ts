export const WEATHER = {
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  timezone: 'auto',
  timeformat: 'unixtime',
  requestDebounceMilliseconds: 250,
  requestTimeoutMilliseconds: 8_000,
  cacheDurationMilliseconds: 15 * 60 * 1_000,
  timeZoneCacheDurationMilliseconds: 24 * 60 * 60 * 1_000,
  coordinatePrecision: 3,
  attributionUrl: 'https://open-meteo.com/',
} as const

export const WEATHER_HOURLY_VARIABLES = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
] as const
