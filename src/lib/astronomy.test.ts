import { describe, expect, it } from 'vitest'
import {
  calculateEclipseSnapshot,
  dateFromTimelineMinute,
  localEclipseCircumstances,
  localSunset,
} from './astronomy'

const CENTRAL_PARIS = { lat: 48.8566, lng: 2.3522 }
const PARIS_MAXIMUM = new Date('2026-08-12T18:17:00.000Z')

function expectDateBetween(date: Date, earliest: string, latest: string): void {
  expect(date.getTime()).toBeGreaterThanOrEqual(new Date(earliest).getTime())
  expect(date.getTime()).toBeLessThanOrEqual(new Date(latest).getTime())
}

describe('Paris eclipse calculations', () => {
  it('matches the trusted August 12, 2026 maximum-eclipse reference', () => {
    const snapshot = calculateEclipseSnapshot(CENTRAL_PARIS, PARIS_MAXIMUM)

    expect(snapshot.obscuration).toBeGreaterThanOrEqual(0.91)
    expect(snapshot.obscuration).toBeLessThanOrEqual(0.93)
    expect(snapshot.magnitude).toBeGreaterThanOrEqual(0.92)
    expect(snapshot.magnitude).toBeLessThanOrEqual(0.94)

    expect(snapshot.sun.azimuth).toBeGreaterThanOrEqual(283)
    expect(snapshot.sun.azimuth).toBeLessThanOrEqual(285)
    expect(snapshot.sun.altitude).toBeGreaterThanOrEqual(7.2)
    expect(snapshot.sun.altitude).toBeLessThanOrEqual(8.3)
    expect(snapshot.sun.altitude).toBeGreaterThan(0)
  })

  it('calculates the local contacts, peak, and sunset in expected UTC windows', () => {
    const circumstances = localEclipseCircumstances(CENTRAL_PARIS)
    const sunset = localSunset(CENTRAL_PARIS)

    expect(circumstances.visible).toBe(true)
    expectDateBetween(
      circumstances.begin.time,
      '2026-08-12T17:15:00.000Z',
      '2026-08-12T17:30:00.000Z',
    )
    expectDateBetween(
      circumstances.maximum.time,
      '2026-08-12T18:10:00.000Z',
      '2026-08-12T18:25:00.000Z',
    )
    expectDateBetween(
      circumstances.end.time,
      '2026-08-12T19:00:00.000Z',
      '2026-08-12T19:15:00.000Z',
    )

    expect(sunset).not.toBeNull()
    expectDateBetween(
      sunset!,
      '2026-08-12T19:05:00.000Z',
      '2026-08-12T19:20:00.000Z',
    )

    expect(circumstances.begin.time.getTime()).toBeLessThan(
      circumstances.maximum.time.getTime(),
    )
    expect(circumstances.maximum.time.getTime()).toBeLessThan(
      circumstances.end.time.getTime(),
    )
    expect(circumstances.end.time.getTime()).toBeLessThan(sunset!.getTime())
  })

  it('has negligible obscuration at first and fourth contact', () => {
    const circumstances = localEclipseCircumstances(CENTRAL_PARIS)
    const firstContact = calculateEclipseSnapshot(
      CENTRAL_PARIS,
      circumstances.begin.time,
    )
    const fourthContact = calculateEclipseSnapshot(
      CENTRAL_PARIS,
      circumstances.end.time,
    )

    expect(firstContact.obscuration).toBeGreaterThanOrEqual(0)
    expect(firstContact.obscuration).toBeLessThan(0.01)
    expect(fourthContact.obscuration).toBeGreaterThanOrEqual(0)
    expect(fourthContact.obscuration).toBeLessThan(0.01)
  })
})

describe('worldwide eclipse calculations', () => {
  it('keeps legacy minute links while allowing the earlier North American window', () => {
    expect(dateFromTimelineMinute(62).toISOString()).toBe('2026-08-12T18:17:00.000Z')
    expect(dateFromTimelineMinute(-105).toISOString()).toBe('2026-08-12T15:30:00.000Z')
  })

  it('includes the complete observable eclipse in Anchorage', () => {
    const anchorage = { lat: 61.2181, lng: -149.9003 }
    const circumstances = localEclipseCircumstances(anchorage)
    const sunset = localSunset(anchorage)

    expect(circumstances.visible).toBe(true)
    expectDateBetween(
      circumstances.begin.time,
      '2026-08-12T15:30:00.000Z',
      '2026-08-12T15:45:00.000Z',
    )
    expectDateBetween(
      circumstances.maximum.time,
      '2026-08-12T16:15:00.000Z',
      '2026-08-12T16:30:00.000Z',
    )
    expectDateBetween(
      circumstances.end.time,
      '2026-08-12T17:00:00.000Z',
      '2026-08-12T17:15:00.000Z',
    )
    expect(sunset?.getTime()).toBeGreaterThan(circumstances.end.time.getTime())
  })

  it('recognises totality in Reykjavik and a small partial eclipse in New York', () => {
    const reykjavik = localEclipseCircumstances({ lat: 64.1466, lng: -21.9426 })
    const newYork = localEclipseCircumstances({ lat: 40.7128, lng: -74.006 })

    expect(reykjavik.visible).toBe(true)
    expect(reykjavik.kind).toBe('total')
    expect(reykjavik.peakObscuration).toBeCloseTo(1, 4)
    expectDateBetween(
      reykjavik.begin.time,
      '2026-08-12T16:40:00.000Z',
      '2026-08-12T16:55:00.000Z',
    )

    expect(newYork.visible).toBe(true)
    expect(newYork.kind).toBe('partial')
    expect(newYork.peakObscuration).toBeGreaterThan(0.08)
    expect(newYork.peakObscuration).toBeLessThan(0.11)
  })

  it('clips the reported maximum to sunset when the theoretical peak is below the horizon', () => {
    const moscow = localEclipseCircumstances({ lat: 55.7558, lng: 37.6173 })

    expect(moscow.visible).toBe(true)
    expect(moscow.theoretical?.maximum.altitude).toBeLessThan(0)
    expect(moscow.maximum.time.getTime()).toBe(moscow.end.time.getTime())
    expect(moscow.peakObscuration).toBeGreaterThan(0.07)
    expect(moscow.peakObscuration).toBeLessThan(0.1)
  })

  it.each([
    ['Sydney', { lat: -33.8688, lng: 151.2093 }],
    ['Tokyo', { lat: 35.6762, lng: 139.6503 }],
  ])('does not substitute a future eclipse in %s', (_label, location) => {
    const circumstances = localEclipseCircumstances(location)

    expect(circumstances.visible).toBe(false)
    expect(circumstances.kind).toBe('none')
    expect(circumstances.maximum.time.toISOString()).toBe('2026-08-12T17:45:53.800Z')
    expect(circumstances.peakObscuration).toBe(0)
  })
})
