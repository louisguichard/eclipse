import { describe, expect, it } from 'vitest'
import { gradeTwilight } from './twilight'
import type { EclipseSnapshot } from '../types'

function snapshotWith(altitude: number, obscuration: number): EclipseSnapshot {
  return {
    date: new Date('2026-08-12T18:17:00.000Z'),
    sun: { altitude, azimuth: 284 },
    moon: { altitude, azimuth: 284 },
    sunAngularRadius: 0.262,
    moonAngularRadius: 0.271,
    centerSeparation: 0.1,
    obscuration,
    magnitude: 0.95,
    moonOffset: { horizontal: 0.05, vertical: 0.05 },
    circumstances: {
      begin: { time: new Date('2026-08-12T17:22:00.000Z'), altitude: 15 },
      maximum: { time: new Date('2026-08-12T18:17:00.000Z'), altitude: 7.8 },
      end: { time: new Date('2026-08-12T19:09:00.000Z'), altitude: 1 },
      peakObscuration: 0.92,
      kind: 'partielle',
    },
    sunset: new Date('2026-08-12T19:11:00.000Z'),
    phaseLabel: 'Maximum',
  }
}

describe('gradeTwilight', () => {
  it('leaves a high, uneclipsed Sun essentially untouched', () => {
    const grade = gradeTwilight(snapshotWith(45, 0))
    expect(grade.intensity).toBe(0)
    expect(grade.dusk).toBe(0)
    expect(grade.shadow).toBe(0)
    expect(grade.emberOpacity).toBe(0)
    expect(grade.nightOpacity).toBe(0)
    expect(grade.shadeOpacity).toBe(0)
    expect(grade.panoramaFilter).toContain('brightness(1)')
    expect(grade.panoramaFilter).toContain('saturate(1)')
  })

  it('keeps a half-covered Sun close to daylight', () => {
    // Half the disc sounds dramatic but reads as a faint dimming outdoors.
    const grade = gradeTwilight(snapshotWith(45, 0.5))
    expect(grade.shadow).toBeLessThan(0.2)
    expect(grade.intensity).toBeLessThan(0.2)
  })

  it('grades the Paris maximum as a distinct dusk', () => {
    const grade = gradeTwilight(snapshotWith(7.8, 0.92))
    expect(grade.shadow).toBeGreaterThan(0.8)
    expect(grade.intensity).toBeGreaterThan(0.85)
    expect(grade.emberOpacity).toBeGreaterThan(0.5)
    expect(grade.nightOpacity).toBeGreaterThan(0.7)
    expect(grade.shadeOpacity).toBeGreaterThan(0.35)
    expect(grade.shadeOpacity).toBeLessThan(0.42)
    expect(grade.vignetteOpacity).toBeGreaterThan(0.6)
  })

  it('makes maximum substantially deeper and warmer than golden hour alone', () => {
    const goldenHour = gradeTwilight(snapshotWith(7.8, 0))
    const maximum = gradeTwilight(snapshotWith(7.8, 0.92))

    expect(maximum.nightOpacity - goldenHour.nightOpacity).toBeGreaterThan(0.45)
    expect(maximum.shadeOpacity - goldenHour.shadeOpacity).toBeGreaterThan(0.28)
    expect(maximum.emberOpacity - goldenHour.emberOpacity).toBeGreaterThan(0.2)
    expect(maximum.vignetteOpacity - goldenHour.vignetteOpacity).toBeGreaterThan(0.25)
  })

  it('rises monotonically with occultation at a fixed Sun height', () => {
    const steps = [0, 0.25, 0.5, 0.75, 0.92, 1].map(
      (obscuration) => gradeTwilight(snapshotWith(7.8, obscuration)).intensity,
    )
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1])
    }
  })

  it('drops the Sun halo once the disc is below the horizon', () => {
    const grade = gradeTwilight(snapshotWith(-3, 0.4))
    expect(grade.glowOpacity).toBe(0)
    expect(grade.nightOpacity).toBeGreaterThan(0.5)
  })

  it('stays within the ranges the overlay can render', () => {
    for (let altitude = -10; altitude <= 60; altitude += 5) {
      for (let obscuration = 0; obscuration <= 1; obscuration += 0.1) {
        const grade = gradeTwilight(snapshotWith(altitude, obscuration))
        for (const value of [
          grade.intensity,
          grade.dusk,
          grade.shadow,
          grade.emberOpacity,
          grade.nightOpacity,
          grade.shadeOpacity,
          grade.vignetteOpacity,
          grade.glowOpacity,
        ]) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
        expect(grade.panoramaFilter).not.toContain('NaN')
      }
    }
  })
})
