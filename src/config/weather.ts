export const WEATHER = {
  forecastEndpoint: 'https://api.weatherapi.com/v1/forecast.json',
  timeZoneEndpoint: 'https://api.weatherapi.com/v1/timezone.json',
  apiKey: import.meta.env.VITE_WEATHERAPI_KEY?.trim() ?? '',
  forecastDays: 3,
  requestDebounceMilliseconds: 250,
  requestTimeoutMilliseconds: 8_000,
  cacheDurationMilliseconds: 15 * 60 * 1_000,
  timeZoneCacheDurationMilliseconds: 24 * 60 * 60 * 1_000,
  coordinatePrecision: 3,
  attributionUrl: 'https://www.weatherapi.com/',
} as const
