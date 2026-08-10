import { describe, expect, it } from 'vitest'
import {
  calculateEclipseSnapshot,
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
