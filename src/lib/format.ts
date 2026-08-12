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

type DateTimeFormatKind = 'time' | 'time-with-seconds' | 'date-time'

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat | null>()
const numberFormatters = new Map<number, Intl.NumberFormat | null>()

function dateTimeFormatOptions(
  kind: DateTimeFormatKind,
  timeZone: string,
): Intl.DateTimeFormatOptions {
  if (kind === 'date-time') {
    return {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
      hourCycle: 'h23',
    }
  }

  return {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(kind === 'time-with-seconds' ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }
}

function getDateTimeFormatter(
  kind: DateTimeFormatKind,
  timeZone: string,
): Intl.DateTimeFormat | null {
  const key = `${kind}:${timeZone}`
  if (dateTimeFormatters.has(key)) return dateTimeFormatters.get(key) ?? null

  try {
    const formatter = new Intl.DateTimeFormat(
      'fr-FR',
      dateTimeFormatOptions(kind, timeZone),
    )
    dateTimeFormatters.set(key, formatter)
    return formatter
  } catch {
    // Some WebKit builds can refuse new Intl objects under sustained render
    // pressure. Remember the failure so every animation frame does not retry.
    dateTimeFormatters.set(key, null)
    return null
  }
}

function tryFormatDateTime(
  date: Date,
  kind: DateTimeFormatKind,
  timeZone: string,
): string | null {
  const formatter = getDateTimeFormatter(kind, timeZone)
  if (!formatter) return null

  try {
    return formatter.format(date)
  } catch {
    dateTimeFormatters.set(`${kind}:${timeZone}`, null)
    return null
  }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function fallbackUtcTime(date: Date, includeSeconds: boolean): string {
  if (!Number.isFinite(date.getTime())) return '—'
  const time = `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`
  return includeSeconds ? `${time}:${twoDigits(date.getUTCSeconds())}` : time
}

function fallbackUtcDateTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) return '—'
  const day = twoDigits(date.getUTCDate())
  const month = twoDigits(date.getUTCMonth() + 1)
  const year = date.getUTCFullYear()
  return `${day}/${month}/${year} ${fallbackUtcTime(date, true)} UTC`
}

function safeFractionDigits(digits: number): number {
  if (!Number.isFinite(digits)) return 0
  return Math.max(0, Math.min(20, Math.trunc(digits)))
}

function getPercentFormatter(digits: number): Intl.NumberFormat | null {
  if (numberFormatters.has(digits)) return numberFormatters.get(digits) ?? null

  try {
    const formatter = new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    numberFormatters.set(digits, formatter)
    return formatter
  } catch {
    numberFormatters.set(digits, null)
    return null
  }
}

function fallbackPercent(value: number, digits: number): string {
  const percent = value * 100
  if (!Number.isFinite(percent)) return '—'
  return `${percent.toFixed(digits).replace('.', ',')} %`
}

export function azimuthToCompass(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360
  return COMPASS_DIRECTIONS[Math.round(normalized / 22.5) % 16]
}

export function azimuthToCompassShort(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360
  return COMPASS_ABBREVIATIONS[Math.round(normalized / 22.5) % 16]
}

export function formatLocalTime(
  date: Date,
  timeZone: string | null | undefined,
  includeSeconds = false,
): string {
  const kind = includeSeconds ? 'time-with-seconds' : 'time'
  const requestedTimeZone = timeZone || 'UTC'
  return tryFormatDateTime(date, kind, requestedTimeZone)
    ?? (requestedTimeZone === 'UTC' ? null : tryFormatDateTime(date, kind, 'UTC'))
    ?? fallbackUtcTime(date, includeSeconds)
}

export function formatLocalDateTime(
  date: Date,
  timeZone: string | null | undefined,
): string {
  const requestedTimeZone = timeZone || 'UTC'
  return tryFormatDateTime(date, 'date-time', requestedTimeZone)
    ?? (requestedTimeZone === 'UTC'
      ? null
      : tryFormatDateTime(date, 'date-time', 'UTC'))
    ?? fallbackUtcDateTime(date)
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
  const safeDigits = safeFractionDigits(digits)
  const formatter = getPercentFormatter(safeDigits)
  if (formatter) {
    try {
      return formatter.format(value)
    } catch {
      numberFormatters.set(safeDigits, null)
    }
  }
  return fallbackPercent(value, safeDigits)
}

/** Avoid saying 0 % while a first, still sub-percent notch is already visible. */
export function formatObscuration(value: number): string {
  const safeValue = Math.max(0, Math.min(1, value))
  if (safeValue === 0) return '0 %'
  if (safeValue < 0.01) return '< 1 %'
  return formatPercent(safeValue)
}

export function formatDegrees(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}°`
}
