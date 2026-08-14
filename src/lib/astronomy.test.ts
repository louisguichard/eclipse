import { describe, expect, it } from 'vitest'
import {
  calculateEclipseSnapshot,
  dateFromTimelineMinute,
  localEclipseCircumstances,
  localSunset,
} from './astronomy'

const CENTRAL_PARIS = { lat: 48.8566, lng: 2.3522 }
const PARIS_MAXIMUM = new Date('2027-08-02T09:01:06.496Z')

function expectDateBetween(date: Date, earliest: string, latest: string): void {
  expect(date.getTime()).toBeGreaterThanOrEqual(new Date(earliest).getTime())
  expect(date.getTime()).toBeLessThanOrEqual(new Date(latest).getTime())
}

describe('Paris eclipse calculations', () => {
  it('matches the August 2, 2027 maximum-eclipse reference for Paris', () => {
    const snapshot = calculateEclipseSnapshot(CENTRAL_PARIS, PARIS_MAXIMUM)

    expect(snapshot.obscuration).toBeGreaterThanOrEqual(0.50)
    expect(snapshot.obscuration).toBeLessThanOrEqual(0.53)
    expect(snapshot.magnitude).toBeGreaterThanOrEqual(0.59)
    expect(snapshot.magnitude).toBeLessThanOrEqual(0.70)

    expect(snapshot.sun.azimuth).toBeGreaterThanOrEqual(115)
    expect(snapshot.sun.azimuth).toBeLessThanOrEqual(116)
    expect(snapshot.sun.altitude).toBeGreaterThanOrEqual(42)
    expect(snapshot.sun.altitude).toBeLessThanOrEqual(44)
    expect(snapshot.sun.altitude).toBeGreaterThan(0)
  })

  it('calculates the local contacts, peak, and sunset in expected UTC windows', () => {
    const circumstances = localEclipseCircumstances(CENTRAL_PARIS)
    const sunset = localSunset(CENTRAL_PARIS)

    expect(circumstances.visible).toBe(true)
    expectDateBetween(
      circumstances.begin.time,
      '2027-08-02T07:55:00.000Z',
      '2027-08-02T08:05:00.000Z',
    )
    expectDateBetween(
      circumstances.maximum.time,
      '2027-08-02T08:55:00.000Z',
      '2027-08-02T09:05:00.000Z',
    )
    expectDateBetween(
      circumstances.end.time,
      '2027-08-02T10:00:00.000Z',
      '2027-08-02T10:10:00.000Z',
    )

    expect(sunset).not.toBeNull()
    expectDateBetween(
      sunset!,
      '2027-08-02T19:20:00.000Z',
      '2027-08-02T19:35:00.000Z',
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
  it('covers the full 2027 event around the Paris-oriented epoch', () => {
    expect(dateFromTimelineMinute(61).toISOString()).toBe('2027-08-02T09:01:00.000Z')
    expect(dateFromTimelineMinute(-60).toISOString()).toBe('2027-08-02T07:00:00.000Z')
  })

  it('includes the complete observable eclipse in Cadiz', () => {
    const cadiz = { lat: 36.5297, lng: -6.2927 }
    const circumstances = localEclipseCircumstances(cadiz)
    const sunset = localSunset(cadiz)

    expect(circumstances.visible).toBe(true)
    expectDateBetween(
      circumstances.begin.time,
      '2027-08-02T07:35:00.000Z',
      '2027-08-02T07:45:00.000Z',
    )
    expectDateBetween(
      circumstances.maximum.time,
      '2027-08-02T08:40:00.000Z',
      '2027-08-02T08:50:00.000Z',
    )
    expectDateBetween(
      circumstances.end.time,
      '2027-08-02T09:55:00.000Z',
      '2027-08-02T10:05:00.000Z',
    )
    expect(sunset?.getTime()).toBeGreaterThan(circumstances.end.time.getTime())
  })

  it('recognises totality in Luxor and a small partial eclipse in Reykjavik', () => {
    const luxor = localEclipseCircumstances({ lat: 25.6872, lng: 32.6396 })
    const reykjavik = localEclipseCircumstances({ lat: 64.1466, lng: -21.9426 })

    expect(luxor.visible).toBe(true)
    expect(luxor.kind).toBe('total')
    expect(luxor.peakObscuration).toBeCloseTo(1, 4)
    expectDateBetween(
      luxor.begin.time,
      '2027-08-02T08:35:00.000Z',
      '2027-08-02T08:45:00.000Z',
    )

    expect(reykjavik.visible).toBe(true)
    expect(reykjavik.kind).toBe('partial')
    expect(reykjavik.peakObscuration).toBeGreaterThan(0.05)
    expect(reykjavik.peakObscuration).toBeLessThan(0.07)
  })

  it('clips the reported maximum to sunset when the theoretical peak is below the horizon', () => {
    const indianOcean = localEclipseCircumstances({ lat: -20, lng: 100 })

    expect(indianOcean.visible).toBe(true)
    expect(indianOcean.theoretical?.maximum.altitude).toBeLessThan(0)
    expect(indianOcean.maximum.time.getTime()).toBe(indianOcean.end.time.getTime())
    expect(indianOcean.peakObscuration).toBeGreaterThan(0)
    expect(indianOcean.peakObscuration).toBeLessThan(indianOcean.theoretical!.peakObscuration)
  })

  it.each([
    ['Sydney', { lat: -33.8688, lng: 151.2093 }],
    ['Tokyo', { lat: 35.6762, lng: 139.6503 }],
  ])('does not substitute a future eclipse in %s', (_label, location) => {
    const circumstances = localEclipseCircumstances(location)

    expect(circumstances.visible).toBe(false)
    expect(circumstances.kind).toBe('none')
    expect(circumstances.maximum.time.toISOString()).toBe('2027-08-02T10:06:34.636Z')
    expect(circumstances.peakObscuration).toBe(0)
  })
})
