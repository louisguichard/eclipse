import { describe, expect, it } from 'vitest'
import type { LatLng, StreetViewCamera } from '../types'
import { buildGoogleStreetViewEmbedUrl } from './googleMapsEmbed'

const LOCATION: LatLng = { lat: 48.8566, lng: 2.3522 }
const CAMERA: StreetViewCamera = { heading: 284.25, pitch: 8.5, zoom: 1 }

function buildUrl(
  location: LatLng = LOCATION,
  camera: StreetViewCamera = CAMERA,
): URL {
  return new URL(buildGoogleStreetViewEmbedUrl('test key+/=?&', location, camera))
}

describe('buildGoogleStreetViewEmbedUrl', () => {
  it('builds a restricted outdoor Street View Embed request', () => {
    const url = buildUrl()

    expect(url.origin).toBe('https://www.google.com')
    expect(url.pathname).toBe('/maps/embed/v1/streetview')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: 'test key+/=?&',
      location: '48.8566,2.3522',
      heading: '284.25',
      pitch: '8.5',
      fov: '90',
      radius: '1000',
      source: 'outdoor',
    })
  })

  it('normalizes heading and clamps pitch and field of view to Embed limits', () => {
    const minimumFov = buildUrl(LOCATION, {
      heading: 725,
      pitch: 120,
      zoom: 100,
    })
    expect(Number(minimumFov.searchParams.get('heading'))).toBe(5)
    expect(Number(minimumFov.searchParams.get('pitch'))).toBe(90)
    expect(Number(minimumFov.searchParams.get('fov'))).toBe(10)

    const maximumFov = buildUrl(LOCATION, {
      heading: -45,
      pitch: -120,
      zoom: -100,
    })
    expect(Number(maximumFov.searchParams.get('heading'))).toBe(315)
    expect(Number(maximumFov.searchParams.get('pitch'))).toBe(-90)
    expect(Number(maximumFov.searchParams.get('fov'))).toBe(100)
  })

  it.each([
    ['latitude below -90', { lat: -90.0001, lng: 0 }],
    ['latitude above 90', { lat: 90.0001, lng: 0 }],
    ['longitude below -180', { lat: 0, lng: -180.0001 }],
    ['longitude above 180', { lat: 0, lng: 180.0001 }],
  ] as const)('rejects %s', (_label, location) => {
    expect(() => buildUrl(location)).toThrow(RangeError)
  })

  it.each([
    [{ lat: -90, lng: -180 }, '-90,-180'],
    [{ lat: 90, lng: 180 }, '90,180'],
  ] as const)('accepts location boundary %j', (location, serialized) => {
    expect(buildUrl(location).searchParams.get('location')).toBe(serialized)
  })

  it.each(['', '   '])('rejects an empty API key', (apiKey) => {
    expect(() => buildGoogleStreetViewEmbedUrl(apiKey, LOCATION, CAMERA)).toThrow(TypeError)
  })

  const nonFiniteValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const nonFiniteCases = nonFiniteValues.flatMap((value) => [
    { target: 'location', field: 'lat', value },
    { target: 'location', field: 'lng', value },
    { target: 'camera', field: 'heading', value },
    { target: 'camera', field: 'pitch', value },
    { target: 'camera', field: 'zoom', value },
  ] as const)

  it.each(nonFiniteCases)(
    'rejects non-finite $target.$field ($value)',
    ({ target, field, value }) => {
      const location = { ...LOCATION }
      const camera = { ...CAMERA }
      if (target === 'location') location[field] = value
      else camera[field] = value

      expect(() => buildGoogleStreetViewEmbedUrl('test-key', location, camera)).toThrow(TypeError)
    },
  )
})
