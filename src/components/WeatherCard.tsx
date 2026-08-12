import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Cloudy,
  Snowflake,
  Sun,
} from 'lucide-react'
import { WEATHER } from '../config/weather'
import { formatLocalTime } from '../lib/format'
import type { WeatherIconName, WeatherResult } from '../types/weather'

type WeatherCardProps = {
  weather: WeatherResult
  /** `strip` drops the card chrome so the forecast can sit inside another surface. */
  variant?: 'card' | 'strip'
  className?: string
}

function WeatherIcon({ name }: { name: WeatherIconName }) {
  const props = { size: 20, strokeWidth: 1.6, 'aria-hidden': true as const }
  if (name === 'clear') return <Sun {...props} />
  if (name === 'partly-cloudy') return <CloudSun {...props} />
  if (name === 'cloudy') return <Cloudy {...props} />
  if (name === 'fog') return <CloudFog {...props} />
  if (name === 'drizzle' || name === 'rain') return <CloudRain {...props} />
  if (name === 'snow') return <Snowflake {...props} />
  if (name === 'storm') return <CloudLightning {...props} />
  return <Cloud {...props} />
}

function rounded(value: number | null, suffix: string): string | null {
  return value == null ? null : `${Math.round(value)}${suffix}`
}

export function WeatherCard({ weather, variant = 'card', className = '' }: WeatherCardProps) {
  const surface = `weather weather--${variant} ${className}`.trimEnd()

  if (weather.status === 'idle' || weather.status === 'loading') {
    return (
      <section className={`${surface} weather--quiet`} aria-label="Météo" aria-busy="true">
        <Cloud size={20} strokeWidth={1.6} aria-hidden="true" />
        <span className="weather__message">Météo…</span>
      </section>
    )
  }

  if (!weather.snapshot) {
    return (
      <section className={`${surface} weather--quiet`} aria-label="Météo" role="status">
        <Cloud size={20} strokeWidth={1.6} aria-hidden="true" />
        <span className="weather__message">{weather.error ?? 'Météo indisponible'}</span>
      </section>
    )
  }

  const snapshot = weather.snapshot
  const temperature = rounded(snapshot.temperatureCelsius, '°') ?? '—'
  const clouds = rounded(snapshot.cloudCover, ' % nuages')
  const rain = snapshot.precipitationProbability != null && snapshot.precipitationProbability >= 10
    ? rounded(snapshot.precipitationProbability, ' % pluie')
    : null
  const freshness = weather.stale ? 'données en cache' : null

  return (
    <section className={surface} aria-label="Prévision météo">
      <span className="weather__icon"><WeatherIcon name={snapshot.condition.icon} /></span>
      <strong className="weather__temperature">{temperature}</strong>
      <span className="weather__detail">
        <span className="weather__condition">{snapshot.condition.label}</span>
        <span className="weather__meta-row">
          <span className="weather__meta">
            {[formatLocalTime(snapshot.forecastTime, weather.timeZone), clouds, rain, freshness]
              .filter(Boolean).join(' · ')}
          </span>
          <a
            className="weather__source"
            href={WEATHER.attributionUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Données WeatherAPI.com, valeurs arrondies"
            title="Données WeatherAPI.com, valeurs arrondies"
          >
            WeatherAPI.com
          </a>
        </span>
      </span>
    </section>
  )
}
