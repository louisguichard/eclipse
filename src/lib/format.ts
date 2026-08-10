const COMPASS_DIRECTIONS = [
  'Nord',
  'Nord-nord-est',
  'Nord-est',
  'Est-nord-est',
  'Est',
  'Est-sud-est',
  'Sud-est',
  'Sud-sud-est',
  'Sud',
  'Sud-sud-ouest',
  'Sud-ouest',
  'Ouest-sud-ouest',
  'Ouest',
  'Ouest-nord-ouest',
  'Nord-ouest',
  'Nord-nord-ouest',
] as const

const COMPASS_ABBREVIATIONS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSO',
  'SO',
  'OSO',
  'O',
  'ONO',
  'NO',
  'NNO',
] as const

export function azimuthToCompass(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360
  return COMPASS_DIRECTIONS[Math.round(normalized / 22.5) % 16]
}

export function azimuthToCompassShort(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360
  return COMPASS_ABBREVIATIONS[Math.round(normalized / 22.5) % 16]
}

function validTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone }).format(0)
    return timeZone
  } catch {
    return 'UTC'
  }
}

export function formatLocalTime(
  date: Date,
  timeZone: string | null | undefined,
  includeSeconds = false,
): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: validTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(date)
}

export function formatLocalDateTime(
  date: Date,
  timeZone: string | null | undefined,
): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: validTimeZone(timeZone),
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date)
}

export function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`
}

export function formatDistance(distanceMeters: number | null): string {
  if (distanceMeters == null) return '—'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`
  return `${(distanceMeters / 1000).toFixed(1).replace('.', ',')} km`
}

export function formatPercent(value: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatDegrees(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}°`
}
