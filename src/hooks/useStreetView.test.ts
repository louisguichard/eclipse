import { describe, expect, it, vi } from 'vitest'
import { STREET_VIEW } from '../config/eclipse'
import { findNearestPanorama } from './useStreetView'

const SOURCE = {
  DEFAULT: 'default',
  GOOGLE: 'google',
  OUTDOOR: 'outdoor',
} as const

function responseAt(lat: number, lng: number): google.maps.StreetViewResponse {
  return {
    data: {
      location: {
        pano: `pano-${lat}-${lng}`,
        latLng: {
          lat: () => lat,
          lng: () => lng,
        },
      },
    },
  } as unknown as google.maps.StreetViewResponse
}

function lookupInstances(getPanorama: ReturnType<typeof vi.fn>) {
  return {
    library: {
      StreetViewPreference: { NEAREST: 'nearest' },
      StreetViewSource: SOURCE,
    },
    panorama: {},
    service: { getPanorama },
  } as unknown as Parameters<typeof findNearestPanorama>[0]
}

describe('findNearestPanorama', () => {
  it('restricts every lookup to official Google outdoor panoramas', async () => {
    const getPanorama = vi.fn().mockResolvedValue(responseAt(48.8737, 2.2959))

    const result = await findNearestPanorama(
      lookupInstances(getPanorama),
      { lat: 48.8737, lng: 2.2959 },
      () => true,
    )

    expect(result?.pano).toBe('pano-48.8737-2.2959')
    expect(getPanorama).toHaveBeenCalledOnce()
    expect(getPanorama).toHaveBeenCalledWith(expect.objectContaining({
      preference: 'nearest',
      sources: ['google', 'outdoor'],
    }))
  })

  it('widens the radius without falling back to the default source', async () => {
    const getPanorama = vi.fn().mockRejectedValue('ZERO_RESULTS')

    const result = await findNearestPanorama(
      lookupInstances(getPanorama),
      { lat: 48.8741, lng: 2.2964 },
      () => true,
    )

    expect(result).toBeNull()
    expect(getPanorama).toHaveBeenCalledTimes(STREET_VIEW.searchRadiiMeters.length)
    expect(getPanorama.mock.calls.map(([request]) => request.radius)).toEqual(
      STREET_VIEW.searchRadiiMeters,
    )
    expect(getPanorama.mock.calls.every(([request]) =>
      request.sources.join(',') === 'google,outdoor')).toBe(true)
  })
})
