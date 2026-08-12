/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStreetLevelImageCache, loadPanoramaImage } from './tiles'
import type { StreetLevelPanorama } from './types'

const PANORAMA: StreetLevelPanorama = {
  id: 'retry-test',
  position: { lat: 48.8566, lng: 2.3522 },
  heading: 0,
  pitchCorrection: 0,
  rollCorrection: 0,
  tileSize: { width: 512, height: 512 },
  imageSizes: [{ width: 512, height: 512 }],
  links: [],
  copyright: '© Google',
  source: null,
}

function response(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: vi.fn().mockResolvedValue(new Blob(['tile'])),
  } as unknown as Response
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['panorama']))
  })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:streetlevel-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  clearStreetLevelImageCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Streetlevel tile retries', () => {
  it.each([408, 429, 503])('recovers from a transient %i response', async (status) => {
    const fetchTile = vi.fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response(200))
    vi.stubGlobal('fetch', fetchTile)

    const loading = loadPanoramaImage({ ...PANORAMA, id: `transient-${status}` }, 0)
    await vi.advanceTimersByTimeAsync(250)

    await expect(loading).resolves.toMatchObject({
      url: 'blob:streetlevel-test',
      width: 512,
      height: 512,
    })
    expect(fetchTile).toHaveBeenCalledTimes(2)
  })

  it('recovers from a transient fetch failure', async () => {
    const fetchTile = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(response(200))
    vi.stubGlobal('fetch', fetchTile)

    const loading = loadPanoramaImage({ ...PANORAMA, id: 'network-failure' }, 0)
    await vi.advanceTimersByTimeAsync(250)

    await expect(loading).resolves.toMatchObject({ url: 'blob:streetlevel-test' })
    expect(fetchTile).toHaveBeenCalledTimes(2)
  })

  it('stops after three transient failures', async () => {
    const fetchTile = vi.fn().mockResolvedValue(response(503))
    vi.stubGlobal('fetch', fetchTile)
    const loading = loadPanoramaImage({ ...PANORAMA, id: 'exhausted' }, 0)
    const assertion = expect(loading).rejects.toThrow(
      'Tuile Streetlevel indisponible (503)',
    )

    await vi.advanceTimersByTimeAsync(750)

    await assertion
    expect(fetchTile).toHaveBeenCalledTimes(3)
  })

  it('does not retry a permanent 4xx response', async () => {
    const fetchTile = vi.fn().mockResolvedValue(response(404))
    vi.stubGlobal('fetch', fetchTile)

    await expect(loadPanoramaImage({ ...PANORAMA, id: 'not-found' }, 0))
      .rejects.toThrow('Tuile Streetlevel indisponible (404)')
    expect(fetchTile).toHaveBeenCalledOnce()
  })

  it('cancels a retry when the panorama request is aborted', async () => {
    const fetchTile = vi.fn().mockResolvedValue(response(503))
    vi.stubGlobal('fetch', fetchTile)
    const controller = new AbortController()
    const loading = loadPanoramaImage({ ...PANORAMA, id: 'aborted' }, 0, controller.signal)
    const assertion = expect(loading).rejects.toMatchObject({ name: 'AbortError' })

    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await vi.runAllTimersAsync()

    await assertion
    expect(fetchTile).toHaveBeenCalledOnce()
  })

  it('limits a panorama to four simultaneous tile requests', async () => {
    const resolvers: Array<(value: Response) => void> = []
    const fetchTile = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve)
    }))
    vi.stubGlobal('fetch', fetchTile)
    const widePanorama = {
      ...PANORAMA,
      id: 'concurrency',
      imageSizes: [{ width: 2_560, height: 512 }],
    }

    const loading = loadPanoramaImage(widePanorama, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTile).toHaveBeenCalledTimes(4)

    resolvers[0]?.(response(200))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTile).toHaveBeenCalledTimes(5)

    for (const resolve of resolvers.slice(1)) resolve(response(200))
    await expect(loading).resolves.toMatchObject({ width: 2_560, height: 512 })
  })
})
