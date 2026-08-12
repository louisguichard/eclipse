import type {
  StreetLevelPanorama,
  StreetLevelPanoramaImage,
  StreetLevelTile,
} from './types'
import { isAbortError, waitForRetry } from './retry'

const TILE_ENDPOINT = 'https://streetviewpixels-pa.googleapis.com/v1/tile'
const MAX_IMAGE_CACHE_ENTRIES = 3
const TILE_CONCURRENCY = 4
const TILE_MAX_ATTEMPTS = 3
const TILE_RETRY_DELAY_MS = 250
export const STREETLEVEL_DEFAULT_ZOOM = 3

type CachedImage = StreetLevelPanoramaImage & { touchedAt: number }
const imageCache = new Map<string, CachedImage>()

export function panoramaTiles(
  panorama: StreetLevelPanorama,
  requestedZoom = STREETLEVEL_DEFAULT_ZOOM,
): { size: { width: number; height: number }; tiles: StreetLevelTile[]; zoom: number } {
  const zoom = Math.max(0, Math.min(Math.floor(requestedZoom), panorama.imageSizes.length - 1))
  const size = panorama.imageSizes[zoom]
  if (!size) throw new Error('Résolution Streetlevel indisponible')
  const columns = Math.ceil(size.width / panorama.tileSize.width)
  const rows = Math.ceil(size.height / panorama.tileSize.height)
  const tiles: StreetLevelTile[] = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const url = new URL(TILE_ENDPOINT)
      // `apiv3` is the client used by the metadata request and currently
      // accepts browser origins consistently. `maps_sv.tactile` can return a
      // transient PERMISSION_DENIED response for the exact same panorama.
      url.searchParams.set('cb_client', 'apiv3')
      url.searchParams.set('panoid', panorama.id)
      url.searchParams.set('x', String(x))
      url.searchParams.set('y', String(y))
      url.searchParams.set('zoom', String(zoom))
      tiles.push({ x, y, url: url.toString() })
    }
  }
  return { size, tiles, zoom }
}

async function decodeTile(blob: Blob): Promise<{ image: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return { image: bitmap, close: () => bitmap.close() }
  }

  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    return { image, close: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function drawTile(
  context: CanvasRenderingContext2D,
  tile: StreetLevelTile,
  panorama: StreetLevelPanorama,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response | null = null
  for (let attempt = 0; attempt < TILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(tile.url, {
        cache: 'force-cache',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'strict-origin-when-cross-origin',
        signal,
      })
    } catch (error) {
      const finalAttempt = attempt === TILE_MAX_ATTEMPTS - 1
      if (finalAttempt || isAbortError(error)) throw error
      await waitForRetry(attempt, TILE_RETRY_DELAY_MS, signal)
      continue
    }

    if (response.ok) break
    const retryableStatus = response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    const finalAttempt = attempt === TILE_MAX_ATTEMPTS - 1
    if (!retryableStatus || finalAttempt) {
      throw new Error(`Tuile Streetlevel indisponible (${response.status})`)
    }
    await waitForRetry(attempt, TILE_RETRY_DELAY_MS, signal)
  }

  if (!response?.ok) throw new Error('Tuile Streetlevel indisponible')
  const decoded = await decodeTile(await response.blob())
  try {
    context.drawImage(
      decoded.image,
      tile.x * panorama.tileSize.width,
      tile.y * panorama.tileSize.height,
    )
  } finally {
    decoded.close()
  }
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Encodage du panorama impossible')),
      'image/jpeg',
      0.84,
    )
  })
}

function evictOldImages(): void {
  if (imageCache.size <= MAX_IMAGE_CACHE_ENTRIES) return
  const oldest = [...imageCache.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]
  if (!oldest) return
  imageCache.delete(oldest[0])
  URL.revokeObjectURL(oldest[1].url)
}

export async function loadPanoramaImage(
  panorama: StreetLevelPanorama,
  requestedZoom = STREETLEVEL_DEFAULT_ZOOM,
  signal?: AbortSignal,
): Promise<StreetLevelPanoramaImage> {
  const grid = panoramaTiles(panorama, requestedZoom)
  const key = `${panorama.id}:${grid.zoom}`
  const cached = imageCache.get(key)
  if (cached) {
    cached.touchedAt = Date.now()
    return cached
  }
  if (typeof document === 'undefined') throw new Error('Assemblage Streetlevel indisponible')

  const canvas = document.createElement('canvas')
  canvas.width = grid.size.width
  canvas.height = grid.size.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas Streetlevel indisponible')

  const loadController = new AbortController()
  const abortLoad = () => loadController.abort()
  signal?.addEventListener('abort', abortLoad, { once: true })
  if (signal?.aborted) loadController.abort()

  let nextTile = 0
  const workers = Array.from(
    { length: Math.min(TILE_CONCURRENCY, grid.tiles.length) },
    async () => {
      while (nextTile < grid.tiles.length) {
        const tile = grid.tiles[nextTile]
        nextTile += 1
        if (loadController.signal.aborted) {
          throw new DOMException('Chargement annulé', 'AbortError')
        }
        if (tile) await drawTile(context, tile, panorama, loadController.signal)
      }
    },
  )
  try {
    await Promise.all(workers)
  } catch (error) {
    loadController.abort()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortLoad)
  }
  const url = URL.createObjectURL(await canvasBlob(canvas))
  const loaded: CachedImage = {
    url,
    width: grid.size.width,
    height: grid.size.height,
    zoom: grid.zoom,
    touchedAt: Date.now(),
  }
  imageCache.set(key, loaded)
  evictOldImages()
  return loaded
}

export function clearStreetLevelImageCache(): void {
  for (const image of imageCache.values()) URL.revokeObjectURL(image.url)
  imageCache.clear()
}
