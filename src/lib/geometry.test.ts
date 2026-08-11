import { describe, expect, it } from 'vitest'
import { azimuthToCompass, azimuthToCompassShort } from './format'
import {
  angularDiameterToPixels,
  angularDifference,
  horizontalFieldOfView,
  cameraAngularDistance,
  destinationPoint,
  haversineDistance,
  horizontalToViewportPoint,
  normalizeHeading,
  sunToStreetViewPov,
} from './geometry'

describe('heading geometry', () => {
  it('normalizes arbitrary headings into [0, 360)', () => {
    expect(normalizeHeading(0)).toBe(0)
    expect(normalizeHeading(360)).toBe(0)
    expect(normalizeHeading(-1)).toBe(359)
    expect(normalizeHeading(721)).toBe(1)
    expect(normalizeHeading(-721)).toBe(359)
  })

  it('finds the signed shortest rotation across north', () => {
    expect(angularDifference(5, 355)).toBe(10)
    expect(angularDifference(355, 5)).toBe(-10)
    expect(angularDifference(90, 270)).toBe(-180)
    expect(angularDifference(270, 90)).toBe(-180)
  })

  it('formats wrapped azimuths as French compass directions', () => {
    expect(azimuthToCompass(0)).toBe('Nord')
    expect(azimuthToCompass(90)).toBe('Est')
    expect(azimuthToCompass(180)).toBe('Sud')
    expect(azimuthToCompass(284)).toBe('Ouest-nord-ouest')
    expect(azimuthToCompass(-76)).toBe('Ouest-nord-ouest')
    expect(azimuthToCompass(360)).toBe('Nord')
    expect(azimuthToCompassShort(284)).toBe('ONO')
    expect(azimuthToCompassShort(-76)).toBe('ONO')
  })
})

describe('Street View camera geometry', () => {
  it('maps solar azimuth and altitude to heading and upward pitch', () => {
    const sun = { azimuth: 283.77, altitude: 7.76 }
    const camera = sunToStreetViewPov(sun, 2)

    expect(camera).toEqual({ heading: 283.77, pitch: 7.76, zoom: 2 })
    expect(cameraAngularDistance(sun, camera)).toBeCloseTo(0, 12)
  })

  it('normalizes heading, clamps pitch, and preserves zoom', () => {
    expect(sunToStreetViewPov({ azimuth: -10, altitude: 120 }, 3)).toEqual({
      heading: 350,
      pitch: 90,
      zoom: 3,
    })
  })

  it('projects the target into the exact viewport center when recentered', () => {
    const sun = { azimuth: 283.77, altitude: 7.76 }
    const camera = sunToStreetViewPov(sun, 1)
    const point = horizontalToViewportPoint(sun, camera, 16 / 9)

    expect(point.x).toBeCloseTo(0.5, 12)
    expect(point.y).toBeCloseTo(0.5, 12)
    expect(point.visible).toBe(true)
  })

  it('keeps the Sun projected in-frame while the panorama is panned', () => {
    const sun = { azimuth: 284, altitude: 8 }
    const point = horizontalToViewportPoint(
      sun,
      { heading: 264, pitch: 8, zoom: 1 },
      16 / 9,
    )

    expect(point.visible).toBe(true)
    expect(point.x).toBeGreaterThan(0.5)
    expect(point.x).toBeLessThan(1)
    expect(Math.abs(point.y - 0.5)).toBeLessThan(0.02)
  })

  it('keeps the Sun attached to the panorama at the fully zoomed-out level', () => {
    const sun = { azimuth: 284, altitude: 8 }
    const firstPan = horizontalToViewportPoint(
      sun,
      { heading: 264, pitch: 8, zoom: 0 },
      16 / 9,
    )
    const secondPan = horizontalToViewportPoint(
      sun,
      { heading: 244, pitch: 8, zoom: 0 },
      16 / 9,
    )
    const tiltedDown = horizontalToViewportPoint(
      sun,
      { heading: 264, pitch: -12, zoom: 0 },
      16 / 9,
    )

    expect(firstPan.visible).toBe(true)
    expect(firstPan.x).toBeGreaterThan(0.55)
    expect(secondPan.x).toBeGreaterThan(firstPan.x + 0.08)
    expect(tiltedDown.y).toBeLessThan(0.4)
  })

  it('tracks fractional zoom values returned near Street View zoom zero', () => {
    const sun = { azimuth: 284, altitude: 8 }
    const point = horizontalToViewportPoint(
      sun,
      { heading: 239, pitch: -12, zoom: 0.03 },
      16 / 9,
    )

    expect(point.visible).toBe(true)
    expect(point.x).toBeGreaterThan(0.7)
    expect(point.y).toBeLessThan(0.4)
  })

  it('scales a fixed panorama ray with Street View focal zoom', () => {
    const target = { azimuth: 10, altitude: 0 }
    const atZoomOne = horizontalToViewportPoint(
      target,
      { heading: 0, pitch: 0, zoom: 1 },
      16 / 9,
    )
    const atZoomTwo = horizontalToViewportPoint(
      target,
      { heading: 0, pitch: 0, zoom: 2 },
      16 / 9,
    )

    expect((atZoomTwo.x - 0.5) / (atZoomOne.x - 0.5)).toBeCloseTo(2, 12)
    expect(atZoomTwo.y).toBeCloseTo(0.5, 12)
  })

  it('matches the calibrated native projection during a fractional wheel zoom', () => {
    const point = horizontalToViewportPoint(
      { azimuth: 273.6473, altitude: 16.6739 },
      { heading: 284.27, pitch: 20.86, zoom: 2.3 },
      1296 / 714,
    )

    expect(point.x).toBeCloseTo(0.2786, 4)
    expect(point.y).toBeCloseTo(0.6528, 4)
  })

  it('stays finite across low zoom levels and viewport shapes', () => {
    const sun = { azimuth: 284, altitude: 8 }

    for (const zoom of [0, 0.03, 0.25, 1]) {
      for (const aspectRatio of [9 / 16, 16 / 9]) {
        const point = horizontalToViewportPoint(
          sun,
          { heading: 254, pitch: -2, zoom },
          aspectRatio,
        )
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
      }
    }
  })

  it('marks directions behind the 180° viewport as out of frame', () => {
    const point = horizontalToViewportPoint(
      { azimuth: 284, altitude: 8 },
      { heading: 184, pitch: 8, zoom: 0 },
      16 / 9,
    )

    expect(point.visible).toBe(false)
  })

  it('detects when the Sun is genuinely beyond the Street View field of view', () => {
    const sun = { azimuth: 284, altitude: 8 }
    const point = horizontalToViewportPoint(
      sun,
      { heading: 234, pitch: 8, zoom: 1 },
      16 / 9,
    )

    expect(point.visible).toBe(false)
    expect(point.x).toBeGreaterThan(1)
  })
})

describe('earth surface geometry', () => {
  it('returns zero distance for identical coordinates', () => {
    const paris = { lat: 48.8566, lng: 2.3522 }
    expect(haversineDistance(paris, paris)).toBe(0)
  })

  it('places a destination at the requested great-circle distance', () => {
    const paris = { lat: 48.8566, lng: 2.3522 }
    const destination = destinationPoint(paris, 1_000, 90)

    expect(Math.abs(haversineDistance(paris, destination) - 1_000)).toBeLessThan(0.001)
    expect(destination.lng).toBeGreaterThan(paris.lng)
    expect(destination.lat).toBeCloseTo(paris.lat, 3)
  })

  it('uses a realistic earth scale', () => {
    const equatorOrigin = { lat: 0, lng: 0 }
    const oneDegreeEast = { lat: 0, lng: 1 }
    const distance = haversineDistance(equatorOrigin, oneDegreeEast)

    expect(distance).toBeGreaterThan(111_000)
    expect(distance).toBeLessThan(111_300)
  })
})

describe('apparent solar size', () => {
  const SUN_DIAMETER_DEGREES = 0.5259 // 2 × the 2026 maximum angular radius

  it('follows the Street View zoom-to-field relation', () => {
    expect(horizontalFieldOfView(0)).toBeCloseTo(126.8699, 4)
    expect(horizontalFieldOfView(0.5)).toBeCloseTo(109.4712, 4)
    expect(horizontalFieldOfView(1)).toBe(90)
    expect(horizontalFieldOfView(2.3)).toBeCloseTo(44.2067, 4)
    expect(horizontalFieldOfView(3)).toBeCloseTo(28.0725, 4)
  })

  it('renders the Sun as the few pixels it really is', () => {
    // Half a degree across a 90° field on a 1400 px viewport.
    const pixels = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 1 }, 1400)
    expect(pixels).toBeGreaterThan(6)
    expect(pixels).toBeLessThan(7)
  })

  it('doubles perspective magnification at each zoom level', () => {
    const wide = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 1 }, 1400)
    const tight = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 3 }, 1400)
    expect(tight / wide).toBeCloseTo(4, 12)
  })

  it('keeps a finite angular size at the fully zoomed-out level', () => {
    const pixels = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 0 }, 1400)

    expect(pixels).toBeGreaterThan(3)
    expect(pixels).toBeLessThan(4)
  })

  it('scales linearly with the viewport width', () => {
    const small = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 1 }, 400)
    const large = angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 1 }, 800)
    expect(large).toBeCloseTo(small * 2, 6)
  })

  it('never returns a negative or non-finite size', () => {
    expect(angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: 1 }, 0)).toBe(0)
    expect(angularDiameterToPixels(0, { zoom: 1 }, 1400)).toBe(0)
    expect(angularDiameterToPixels(SUN_DIAMETER_DEGREES, { zoom: -5 }, 1400)).toBeGreaterThan(0)
  })
})
