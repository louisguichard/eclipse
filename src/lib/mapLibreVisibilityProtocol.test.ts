import { describe, expect, it, vi } from 'vitest'
import {
  loadVisibilityTile,
  resolveVisibilityProtocolUrl,
  visibilityProtocolUrl,
} from './mapLibreVisibilityProtocol'

const SOURCE_URL = 'https://tiles.example/version%20%C3%A9t%C3%A9/{z}/{x}/{y}.png'

describe('MapLibre sparse visibility protocol', () => {
  it('round-trips the source URL while preserving XYZ placeholders', () => {
    const protocolUrl = visibilityProtocolUrl(SOURCE_URL)
    expect(protocolUrl).toContain('/{z}/{x}/{y}.png')
    expect(resolveVisibilityProtocolUrl(protocolUrl)).toBe(SOURCE_URL)
  })

  it('returns a valid transparent PNG when an omitted tile responds 404', async () => {
    const fetchTile = vi.fn(async () => new Response(null, { status: 404 }))
    const result = await loadVisibilityTile(
      visibilityProtocolUrl(SOURCE_URL).replace('{z}/{x}/{y}', '15/16592/11270'),
      new AbortController().signal,
      fetchTile,
    )

    expect(fetchTile).toHaveBeenCalledWith(
      'https://tiles.example/version%20%C3%A9t%C3%A9/15/16592/11270.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect([...new Uint8Array(result.data).slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
  })

  it('passes through a published tile and rejects server failures', async () => {
    const png = new Uint8Array([137, 80, 78, 71]).buffer
    const published = await loadVisibilityTile(
      visibilityProtocolUrl(SOURCE_URL).replace('{z}/{x}/{y}', '10/1/2'),
      new AbortController().signal,
      vi.fn(async () => new Response(png, {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=60', ETag: 'fixture' },
      })),
    )
    expect([...new Uint8Array(published.data)]).toEqual([137, 80, 78, 71])
    expect(published.cacheControl).toBe('public, max-age=60')
    expect(published.etag).toBe('fixture')

    await expect(loadVisibilityTile(
      visibilityProtocolUrl(SOURCE_URL).replace('{z}/{x}/{y}', '10/1/3'),
      new AbortController().signal,
      vi.fn(async () => new Response(null, { status: 503 })),
    )).rejects.toThrow('Visibility tile request failed (503)')
  })
})
