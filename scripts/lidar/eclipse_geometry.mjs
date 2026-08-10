#!/usr/bin/env node

import {
  Body,
  Equator,
  Horizon,
  KM_PER_AU,
  Observer,
  SearchLocalSolarEclipse,
} from 'astronomy-engine'

const SUN_RADIUS_KM = 695700

function option(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing ${name}`)
  }
  return process.argv[index + 1]
}

const latitude = Number(option('--lat'))
const longitude = Number(option('--lng'))
const searchStart = new Date(option('--search-start'))
if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
  throw new Error('Latitude and longitude must be finite numbers')
}
if (Number.isNaN(searchStart.getTime())) {
  throw new Error('Invalid --search-start date')
}

const observer = new Observer(latitude, longitude, 0)
const eclipse = SearchLocalSolarEclipse(searchStart, observer)
const peak = eclipse.peak.time.date
const equatorial = Equator(Body.Sun, peak, observer, true, true)
const horizontal = Horizon(
  peak,
  observer,
  equatorial.ra,
  equatorial.dec,
  'normal',
)
const angularRadius =
  Math.asin((SUN_RADIUS_KM / KM_PER_AU) / equatorial.dist) * (180 / Math.PI)

process.stdout.write(
  `${JSON.stringify({
    searchStartUtc: searchStart.toISOString(),
    kind: eclipse.kind,
    obscuration: eclipse.obscuration,
    partialBeginUtc: eclipse.partial_begin.time.date.toISOString(),
    maximumUtc: peak.toISOString(),
    partialEndUtc: eclipse.partial_end.time.date.toISOString(),
    sunAzimuthDegrees: horizontal.azimuth,
    sunApparentAltitudeDegrees: horizontal.altitude,
    sunAngularRadiusDegrees: angularRadius,
  })}\n`,
)
