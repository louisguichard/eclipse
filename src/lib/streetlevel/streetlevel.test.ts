import { describe, expect, it } from 'vitest'
import { buildFindPanoramaUrl } from './api'
import { parsePanoramaSearchPayload } from './parse'
import { panoramaTiles } from './tiles'

function panoramaPayload(): unknown[] {
  const message: unknown[] = []
  message[1] = [2, 'pano-current']
  message[2] = [2, 2, null, [
    [
      [[208, 416]],
      [[416, 832]],
      [[832, 1664]],
      [[1664, 3328]],
    ],
    [512, 512],
  ]]
  message[4] = [[[['© 2026 Google']]]]

  const current = [[2, 'pano-current'], null, [
    [null, null, 48.8566, 2.3522],
    [32],
    [190.75, 90.4, 359.9],
  ]]
  const linked = [[2, 'pano-next'], null, [
    [null, null, 48.8567, 2.3523],
    [32],
    [192, 89.8, 0.2],
  ]]
  message[5] = [[
    [1],
    [[null, null, 48.8566, 2.3522], null, [190.75, 90.4, 359.9]],
    null,
    [[current, linked]],
    null,
    null,
    [[1, [null, null, null, 42]]],
  ]]
  message[6] = [3, 2, 1, [1], null, [null, null, 'launch']]
  return [[0], message, [12]]
}

describe('Streetlevel browser protocol', () => {
  it('builds an official-coverage JSONP lookup without an API key', () => {
    const url = new URL(buildFindPanoramaUrl(48.8566, 2.3522, 1000, '__callbacks.c1'))
    expect(url.origin).toBe('https://maps.googleapis.com')
    expect(url.pathname).toContain('GeoPhotoService.SingleImageSearch')
    expect(url.searchParams.get('callback')).toBe('__callbacks.c1')
    expect(url.searchParams.get('key')).toBeNull()
    expect(url.searchParams.get('pb')).toContain('!3d48.8566!4d2.3522')
  })

  it('parses dimensions, north alignment, attribution and linked panoramas', () => {
    const panorama = parsePanoramaSearchPayload(panoramaPayload())
    expect(panorama).toMatchObject({
      id: 'pano-current',
      position: { lat: 48.8566, lng: 2.3522 },
      heading: 190.75,
      tileSize: { width: 512, height: 512 },
      copyright: '© 2026 Google',
      source: 'launch',
    })
    expect(panorama?.pitchCorrection).toBeCloseTo(-0.4, 10)
    expect(panorama?.rollCorrection).toBeCloseTo(-0.1, 10)
    expect(panorama?.imageSizes[3]).toEqual({ width: 3328, height: 1664 })
    expect(panorama?.links).toEqual([expect.objectContaining({
      pano: 'pano-next',
      heading: 42,
      position: { lat: 48.8567, lng: 2.3523 },
    })])
  })

  it('returns null when Google reports no panorama', () => {
    expect(parsePanoramaSearchPayload([[5]])).toBeNull()
  })

  it('generates the bounded z3 grid used by the client viewer', () => {
    const panorama = parsePanoramaSearchPayload(panoramaPayload())
    expect(panorama).not.toBeNull()
    const grid = panoramaTiles(panorama!, 3)
    expect(grid.size).toEqual({ width: 3328, height: 1664 })
    expect(grid.tiles).toHaveLength(28)
    expect(grid.tiles[0]?.url).toContain('cb_client=apiv3')
    expect(grid.tiles[0]?.url).toContain('zoom=3')
    expect(grid.tiles.at(-1)).toMatchObject({ x: 6, y: 3 })
  })
})
