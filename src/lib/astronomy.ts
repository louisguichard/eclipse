import {
  AngleBetween,
  Body,
  Equator,
  Horizon,
  KM_PER_AU,
  Observer,
  SearchLocalSolarEclipse,
  SearchRiseSet,
} from 'astronomy-engine'
import {
  ECLIPSE_GLOBAL_PEAK_UTC,
  MOON_POLAR_RADIUS_KM,
  SUN_RADIUS_KM,
  TIMELINE,
} from '../config/eclipse'
import type {
  EclipseCircumstances,
  EclipseSnapshot,
  HorizontalCoordinates,
  LatLng,
} from '../types'

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const ECLIPSE_SEARCH_START = new Date('2027-07-20T00:00:00.000Z')
const TARGET_ECLIPSE_TOLERANCE_MS = 12 * 60 * 60 * 1_000
const circumstancesCache = new Map<string, EclipseCircumstances>()
const sunsetCache = new Map<string, Date | null>()

function locationCacheKey(location: LatLng): string {
  return `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`
}

/**
 * Fractional minutes are deliberate: playback advances the timeline every
 * frame, and rounding here would quantise the whole simulation back to
 * one-minute steps.
 */
export function dateFromTimelineMinute(minute: number): Date {
  const safeMinute = Number.isFinite(minute)
    ? Math.max(TIMELINE.minMinute, Math.min(TIMELINE.maxMinute, minute))
    : TIMELINE.defaultMinute
  return new Date(
    TIMELINE.startUtc.getTime() + Math.round(safeMinute * 60_000),
  )
}

export function timelineMinuteFromDate(date: Date): number {
  return (date.getTime() - TIMELINE.startUtc.getTime()) / 60_000
}

export function bodyHorizontalCoordinates(
  body: Body,
  location: LatLng,
  date: Date,
): HorizontalCoordinates {
  const observer = new Observer(location.lat, location.lng, 0)
  const equatorial = Equator(body, date, observer, true, true)
  const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal')
  return {
    altitude: horizontal.altitude,
    azimuth: horizontal.azimuth,
  }
}

export function sunHorizontalCoordinates(
  location: LatLng,
  date: Date,
): HorizontalCoordinates {
  return bodyHorizontalCoordinates(Body.Sun, location, date)
}

function eclipseEventAt(location: LatLng, time: Date) {
  return {
    time,
    altitude: sunHorizontalCoordinates(location, time).altitude,
  }
}

function invisibleCircumstances(
  location: LatLng,
  theoretical?: NonNullable<EclipseCircumstances['theoretical']>,
): EclipseCircumstances {
  return {
    visible: false,
    begin: eclipseEventAt(location, new Date(TIMELINE.rangeStartUtc)),
    maximum: eclipseEventAt(location, new Date(ECLIPSE_GLOBAL_PEAK_UTC)),
    end: eclipseEventAt(location, new Date(TIMELINE.endUtc)),
    peakObscuration: 0,
    kind: 'none',
    theoretical,
  }
}

export function localEclipseCircumstances(location: LatLng): EclipseCircumstances {
  const cacheKey = locationCacheKey(location)
  const cached = circumstancesCache.get(cacheKey)
  if (cached) return cached
  const observer = new Observer(location.lat, location.lng, 0)
  const result = SearchLocalSolarEclipse(ECLIPSE_SEARCH_START, observer)
  const theoretical = {
    begin: {
      time: result.partial_begin.time.date,
      altitude: result.partial_begin.altitude,
    },
    maximum: { time: result.peak.time.date, altitude: result.peak.altitude },
    end: {
      time: result.partial_end.time.date,
      altitude: result.partial_end.altitude,
    },
    peakObscuration: result.obscuration,
    kind: String(result.kind),
  }

  // SearchLocalSolarEclipse finds the next locally visible event. Outside the
  // 2027 footprint that can be an eclipse years later, which must never leak
  // into this app's timeline.
  if (
    Math.abs(result.peak.time.date.getTime() - ECLIPSE_GLOBAL_PEAK_UTC.getTime())
      > TARGET_ECLIPSE_TOLERANCE_MS
  ) {
    const circumstances = invisibleCircumstances(location)
    circumstancesCache.set(cacheKey, circumstances)
    return circumstances
  }

  let observableBegin = theoretical.begin.time
  let observableEnd = theoretical.end.time
  const searchDays = Math.max(
    0.25,
    (observableEnd.getTime() - observableBegin.getTime()) / 86_400_000 + 0.1,
  )

  if (theoretical.begin.altitude <= 0) {
    const sunrise = SearchRiseSet(Body.Sun, observer, +1, observableBegin, searchDays)
    if (!sunrise || sunrise.date >= observableEnd) {
      const circumstances = invisibleCircumstances(location, theoretical)
      circumstancesCache.set(cacheKey, circumstances)
      return circumstances
    }
    observableBegin = sunrise.date
  }

  if (theoretical.end.altitude <= 0) {
    const sunset = SearchRiseSet(Body.Sun, observer, -1, observableBegin, searchDays)
    if (sunset && sunset.date < observableEnd) observableEnd = sunset.date
  }

  if (observableBegin >= observableEnd) {
    const circumstances = invisibleCircumstances(location, theoretical)
    circumstancesCache.set(cacheKey, circumstances)
    return circumstances
  }

  const observableMaximumTime = new Date(Math.max(
    observableBegin.getTime(),
    Math.min(observableEnd.getTime(), theoretical.maximum.time.getTime()),
  ))
  const observableGeometry = eclipseGeometry(location, observableMaximumTime)
  const clippedAtHorizon = observableMaximumTime.getTime() !== theoretical.maximum.time.getTime()
  const circumstances: EclipseCircumstances = {
    visible: true,
    begin: eclipseEventAt(location, observableBegin),
    maximum: eclipseEventAt(location, observableMaximumTime),
    end: eclipseEventAt(location, observableEnd),
    peakObscuration: observableGeometry.obscuration,
    kind: clippedAtHorizon && observableGeometry.obscuration < 0.9999
      ? 'partial'
      : theoretical.kind,
    theoretical,
  }
  circumstancesCache.set(cacheKey, circumstances)
  return circumstances
}

export function localSunset(location: LatLng): Date | null {
  const cacheKey = locationCacheKey(location)
  if (sunsetCache.has(cacheKey)) return sunsetCache.get(cacheKey) ?? null
  const circumstances = localEclipseCircumstances(location)
  if (!circumstances.visible) {
    sunsetCache.set(cacheKey, null)
    return null
  }
  const observer = new Observer(location.lat, location.lng, 0)
  const sunset = SearchRiseSet(Body.Sun, observer, -1, circumstances.begin.time, 2)
  const sunsetDate = sunset?.date ?? null
  sunsetCache.set(cacheKey, sunsetDate)
  return sunsetDate
}

export function circleOverlapFraction(
  sunRadius: number,
  moonRadius: number,
  separation: number,
): number {
  if (separation >= sunRadius + moonRadius) return 0
  if (separation <= Math.abs(sunRadius - moonRadius)) {
    return Math.min(1, (moonRadius ** 2) / (sunRadius ** 2))
  }

  const sunTerm = Math.acos(
    (separation ** 2 + sunRadius ** 2 - moonRadius ** 2) /
      (2 * separation * sunRadius),
  )
  const moonTerm = Math.acos(
    (separation ** 2 + moonRadius ** 2 - sunRadius ** 2) /
      (2 * separation * moonRadius),
  )
  const lens = 0.5 * Math.sqrt(
    Math.max(
      0,
      (-separation + sunRadius + moonRadius) *
        (separation + sunRadius - moonRadius) *
        (separation - sunRadius + moonRadius) *
        (separation + sunRadius + moonRadius),
    ),
  )
  const overlapArea = sunRadius ** 2 * sunTerm + moonRadius ** 2 * moonTerm - lens
  return Math.max(0, Math.min(1, overlapArea / (Math.PI * sunRadius ** 2)))
}

function phaseLabel(date: Date, circumstances: EclipseCircumstances): string {
  if (!circumstances.visible) return 'Éclipse non visible ici'
  const time = date.getTime()
  const begin = circumstances.begin.time.getTime()
  const maximum = circumstances.maximum.time.getTime()
  const end = circumstances.end.time.getTime()
  const closeTo = (target: number) => Math.abs(time - target) <= 45_000

  if (closeTo(begin)) return 'Début'
  if (closeTo(maximum)) return 'Maximum'
  if (closeTo(end)) return 'Fin'
  if (time < begin) return 'Avant l’éclipse'
  if (time > end) return 'Après l’éclipse'
  return time < maximum ? 'L’éclipse progresse' : 'L’éclipse décroît'
}

function eclipseGeometry(
  location: LatLng,
  date: Date,
): Omit<EclipseSnapshot, 'date' | 'circumstances' | 'sunset' | 'phaseLabel'> {
  const observer = new Observer(location.lat, location.lng, 0)
  const sunEquatorial = Equator(Body.Sun, date, observer, true, true)
  const moonEquatorial = Equator(Body.Moon, date, observer, true, true)
  const sunHorizontal = Horizon(
    date,
    observer,
    sunEquatorial.ra,
    sunEquatorial.dec,
    'normal',
  )
  const moonHorizontal = Horizon(
    date,
    observer,
    moonEquatorial.ra,
    moonEquatorial.dec,
    'normal',
  )

  const sunAngularRadius = Math.asin(
    (SUN_RADIUS_KM / KM_PER_AU) / sunEquatorial.dist,
  ) * RAD_TO_DEG
  const moonAngularRadius = Math.asin(
    (MOON_POLAR_RADIUS_KM / KM_PER_AU) / moonEquatorial.dist,
  ) * RAD_TO_DEG
  const centerSeparation = AngleBetween(sunEquatorial.vec, moonEquatorial.vec)
  const obscuration = circleOverlapFraction(
    sunAngularRadius,
    moonAngularRadius,
    centerSeparation,
  )
  const magnitude = Math.max(
    0,
    (sunAngularRadius + moonAngularRadius - centerSeparation) / (2 * sunAngularRadius),
  )
  const sunAzimuth = sunHorizontal.azimuth * DEG_TO_RAD
  const sunAltitude = sunHorizontal.altitude * DEG_TO_RAD
  const moonAzimuth = moonHorizontal.azimuth * DEG_TO_RAD
  const moonAltitude = moonHorizontal.altitude * DEG_TO_RAD
  const moonVector = {
    x: Math.cos(moonAltitude) * Math.sin(moonAzimuth),
    y: Math.cos(moonAltitude) * Math.cos(moonAzimuth),
    z: Math.sin(moonAltitude),
  }
  const forward = {
    x: Math.cos(sunAltitude) * Math.sin(sunAzimuth),
    y: Math.cos(sunAltitude) * Math.cos(sunAzimuth),
    z: Math.sin(sunAltitude),
  }
  const right = { x: Math.cos(sunAzimuth), y: -Math.sin(sunAzimuth), z: 0 }
  const up = {
    x: -Math.sin(sunAltitude) * Math.sin(sunAzimuth),
    y: -Math.sin(sunAltitude) * Math.cos(sunAzimuth),
    z: Math.cos(sunAltitude),
  }
  const dot = (a: typeof moonVector, b: typeof moonVector) =>
    a.x * b.x + a.y * b.y + a.z * b.z
  const azimuthOffset = Math.atan2(dot(moonVector, right), dot(moonVector, forward)) *
    RAD_TO_DEG
  const altitudeOffset = Math.atan2(dot(moonVector, up), dot(moonVector, forward)) *
    RAD_TO_DEG

  return {
    sun: { altitude: sunHorizontal.altitude, azimuth: sunHorizontal.azimuth },
    moon: { altitude: moonHorizontal.altitude, azimuth: moonHorizontal.azimuth },
    sunAngularRadius,
    moonAngularRadius,
    centerSeparation,
    obscuration,
    magnitude,
    moonOffset: {
      horizontal: azimuthOffset,
      vertical: altitudeOffset,
    },
  }
}

export function calculateEclipseSnapshot(
  location: LatLng,
  date: Date,
): EclipseSnapshot {
  const circumstances = localEclipseCircumstances(location)
  return {
    date,
    ...eclipseGeometry(location, date),
    circumstances,
    sunset: localSunset(location),
    phaseLabel: phaseLabel(date, circumstances),
  }
}

export function buildSunTrajectory(
  location: LatLng,
  start: Date,
  end: Date,
  sampleCount = 18,
): HorizontalCoordinates[] {
  const span = end.getTime() - start.getTime()
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const date = new Date(start.getTime() + (span * index) / sampleCount)
    return sunHorizontalCoordinates(location, date)
  })
}
