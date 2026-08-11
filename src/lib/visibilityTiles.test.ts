// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisibilityDatasetManifest } from '../types/visibility'
import {
  MIN_VISIBILITY_FOOTPRINT_PIXELS,
  VISIBILITY_MAX_DISPLAY_ZOOM,
  VISIBILITY_MIN_DISPLAY_ZOOM,
  buildVisibilityTileUrl,
  createVisibilityImageMapType,
  geographicBoundsIntersect,
  isValidTileY,
  knownVisibilityCoverageAtPoint,
  latLngToTileCoordinate,
  normalizeTileX,
  pointInGeographicBounds,
  preferredVisibilityDatasetAtPoint,
  resolveVisibilityTileRequests,
  tileGeographicBounds,
  tileIntersectsBounds,
  visibilityDatasetsForView,
  visibilityManifestIssue,
} from './visibilityTiles'

const drawImage = vi.fn()
const fillRect = vi.fn()
const canvasContext = {
  drawImage,
  fillRect,
  fillStyle: '',
  imageSmoothingEnabled: true,
}

beforeEach(() => {
  drawImage.mockReset()
  fillRect.mockReset()
  canvasContext.fillStyle = ''
  canvasContext.imageSmoothingEnabled = true
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D,
  )
})

afterEach(() => vi.restoreAllMocks())

const READY_MANIFEST: VisibilityDatasetManifest = {
  id: 'paris-test',
  version: '2026.08.12+surface',
  label: 'Visibilité test',
  availability: 'ready',
  coverage: { north: 49.05, south: 48.65, east: 2.65, west: 1.95 },
  reference: {
    mode: 'fixed-instant',
    timeUtc: '2026-08-12T18:17:11.916Z',
    label: 'Maximum à Paris · 20:17',
  },
  surface: {
    description: 'Fixture',
    resolutionMeters: 5,
    observerHeightMeters: 1.7,
    includesBuildings: true,
    includesVegetation: true,
    sources: [],
  },
  tiles: {
    scheme: 'xyz',
    tileSize: 256,
    minZoom: 10,
    maxZoom: 17,
    urlTemplate: 'https://tiles.example/{version}/{z}/{x}/{y}.png',
  },
  legend: [],
  attribution: 'Fixture',
  disclaimer: 'Fixture',
}

const COARSE_MANIFEST: VisibilityDatasetManifest = {
  ...READY_MANIFEST,
  id: 'idf-coarse',
  version: 'idf-coarse-v1',
  label: 'Île-de-France · 5 m',
  coverage: { north: 49.25, south: 48.1, east: 3.6, west: 1.4 },
  surface: {
    ...READY_MANIFEST.surface,
    resolutionMeters: 5,
  },
  tiles: {
    ...READY_MANIFEST.tiles!,
    minZoom: 8,
    maxZoom: 15,
  },
}

describe('Web Mercator tile geometry', () => {
  it('converts central Paris to the expected XYZ tile', () => {
    expect(latLngToTileCoordinate(48.8566, 2.3522, 14)).toEqual({
      x: 8299,
      y: 5636,
    })
  })

  it('detects whether an observer is inside the published coverage', () => {
    expect(pointInGeographicBounds({ lat: 48.8566, lng: 2.3522 }, READY_MANIFEST.coverage)).toBe(true)
    expect(pointInGeographicBounds({ lat: 45.764, lng: 4.8357 }, READY_MANIFEST.coverage)).toBe(false)
  })

  it('intersects ordinary and antimeridian-crossing geographic bounds', () => {
    expect(geographicBoundsIntersect(
      { north: 49, south: 48, west: 1, east: 3 },
      { north: 48.5, south: 47, west: 2, east: 4 },
    )).toBe(true)
    expect(geographicBoundsIntersect(
      { north: 10, south: -10, west: 170, east: -170 },
      { north: 5, south: -5, west: -179, east: -175 },
    )).toBe(true)
    expect(geographicBoundsIntersect(
      { north: 49, south: 48, west: 1, east: 3 },
      { north: 47, south: 46, west: 1, east: 3 },
    )).toBe(false)
  })

  it('wraps x across the antimeridian and rejects y outside the world', () => {
    expect(normalizeTileX(-1, 3)).toBe(7)
    expect(normalizeTileX(8, 3)).toBe(0)
    expect(isValidTileY(0, 3)).toBe(true)
    expect(isValidTileY(7, 3)).toBe(true)
    expect(isValidTileY(8, 3)).toBe(false)
  })

  it('returns geographic bounds that contain the source point', () => {
    const coordinate = latLngToTileCoordinate(48.8566, 2.3522, 14)
    const bounds = tileGeographicBounds(coordinate, 14)

    expect(bounds.west).toBeLessThanOrEqual(2.3522)
    expect(bounds.east).toBeGreaterThanOrEqual(2.3522)
    expect(bounds.south).toBeLessThanOrEqual(48.8566)
    expect(bounds.north).toBeGreaterThanOrEqual(48.8566)
    expect(tileIntersectsBounds(coordinate, 14, READY_MANIFEST.coverage)).toBe(true)
  })
})

describe('visibility tile URLs', () => {
  it('resolves a versioned URL only inside coverage and configured zooms', () => {
    const parisTile = latLngToTileCoordinate(48.8566, 2.3522, 14)
    expect(buildVisibilityTileUrl(READY_MANIFEST, parisTile, 14)).toBe(
      'https://tiles.example/2026.08.12%2Bsurface/14/8299/5636.png',
    )

    const lyonTile = latLngToTileCoordinate(45.764, 4.8357, 14)
    expect(buildVisibilityTileUrl(READY_MANIFEST, lyonTile, 14)).toBeNull()
    expect(buildVisibilityTileUrl(READY_MANIFEST, parisTile, 9)).toBeNull()
  })

  it('returns a clean no-data issue when the pyramid is not published', () => {
    const unavailable: VisibilityDatasetManifest = {
      ...READY_MANIFEST,
      availability: 'unavailable',
      unavailableReason: 'Tuiles à venir.',
      tiles: null,
    }

    expect(visibilityManifestIssue(unavailable)).toBe('Tuiles à venir.')
    expect(buildVisibilityTileUrl(unavailable, { x: 0, y: 0 }, 0)).toBeNull()
  })

  it('validates all mandatory XYZ URL placeholders', () => {
    const invalid: VisibilityDatasetManifest = {
      ...READY_MANIFEST,
      tiles: {
        ...READY_MANIFEST.tiles!,
        urlTemplate: 'https://tiles.example/{z}/{x}.png',
      },
    }
    expect(visibilityManifestIssue(invalid)).toBe('Modèle d’URL de tuiles invalide.')
  })
})

describe('visibility dataset catalogue selection', () => {
  it('preserves fine-to-coarse priority at an overlapping point', () => {
    const catalogue = [READY_MANIFEST, COARSE_MANIFEST]
    const selected = visibilityDatasetsForView(
      catalogue,
      { lat: 48.8566, lng: 2.3522 },
      null,
      14,
    )

    expect(selected.map(({ id }) => id)).toEqual(['paris-test', 'idf-coarse'])
    expect(preferredVisibilityDatasetAtPoint(
      catalogue,
      { lat: 48.8566, lng: 2.3522 },
    )?.id).toBe('paris-test')
  })

  it('activates a regional layer intersecting the viewport without mounting unrelated data', () => {
    const catalogue = [READY_MANIFEST, COARSE_MANIFEST]
    const selected = visibilityDatasetsForView(
      catalogue,
      { lat: 45.764, lng: 4.8357 },
      { north: 48.9, south: 48.7, east: 2.5, west: 2.1 },
      15,
    )

    expect(selected.map(({ id }) => id)).toEqual(['paris-test', 'idf-coarse'])
    expect(visibilityDatasetsForView(
      catalogue,
      { lat: 45.764, lng: 4.8357 },
      { north: 46, south: 45.5, east: 5, west: 4.5 },
      15,
    )).toEqual([])
  })

  it('keeps published layers selected through the complete map zoom range', () => {
    const unavailable: VisibilityDatasetManifest = {
      ...COARSE_MANIFEST,
      availability: 'unavailable',
      unavailableReason: 'Publication à venir.',
      tiles: null,
    }
    const point = { lat: 48.4, lng: 2.7 }

    expect(visibilityDatasetsForView(
      [COARSE_MANIFEST],
      point,
      null,
      VISIBILITY_MAX_DISPLAY_ZOOM,
    )).toEqual([COARSE_MANIFEST])
    expect(visibilityDatasetsForView(
      [COARSE_MANIFEST],
      point,
      null,
      VISIBILITY_MAX_DISPLAY_ZOOM + 1,
    )).toEqual([])
    expect(visibilityDatasetsForView(
      [READY_MANIFEST],
      { lat: 48.8566, lng: 2.3522 },
      null,
      VISIBILITY_MIN_DISPLAY_ZOOM,
    )).toEqual([READY_MANIFEST])
    expect(visibilityDatasetsForView(
      [COARSE_MANIFEST],
      point,
      null,
      VISIBILITY_MIN_DISPLAY_ZOOM - 1,
    )).toEqual([])
    expect(preferredVisibilityDatasetAtPoint([unavailable], point)).toBeNull()
    expect(knownVisibilityCoverageAtPoint([unavailable], point)?.id).toBe('idf-coarse')
  })
})

describe('visibility tile overzoom', () => {
  it('maps a displayed child tile to the precise last-level source quadrant', () => {
    const displayedCoordinate = latLngToTileCoordinate(48.86, 2.36, 16)
    const requests = resolveVisibilityTileRequests(COARSE_MANIFEST, displayedCoordinate, 16)

    expect(requests).toEqual([{
      url: 'https://tiles.example/idf-coarse-v1/15/16598/11272.png',
      sourceCoordinate: { x: 16598, y: 11272 },
      sourceZoom: 15,
      scale: 2,
      left: -256,
      top: -256,
    }])
  })

  it('normalizes wrapped displayed coordinates before selecting their source tile', () => {
    const zoom = 16
    const displayedCoordinate = latLngToTileCoordinate(48.86, 2.36, zoom)
    const requests = resolveVisibilityTileRequests(
      COARSE_MANIFEST,
      { x: displayedCoordinate.x + 2 ** zoom, y: displayedCoordinate.y },
      zoom,
    )

    expect(requests[0]?.sourceCoordinate).toEqual({ x: 16598, y: 11272 })
    expect(requests[0]?.left).toBe(-256)
  })

  it('stops resolving tiles above the shared display ceiling', () => {
    const zoom = VISIBILITY_MAX_DISPLAY_ZOOM + 1

    expect(resolveVisibilityTileRequests(
      READY_MANIFEST,
      { x: 0, y: 0 },
      zoom,
    )).toEqual([])
  })
})

describe('visibility tile underzoom', () => {
  it('resolves fine and regional coverage at every map zoom the UI permits', () => {
    for (const manifest of [READY_MANIFEST, COARSE_MANIFEST]) {
      for (
        let zoom = VISIBILITY_MIN_DISPLAY_ZOOM;
        zoom <= VISIBILITY_MAX_DISPLAY_ZOOM;
        zoom += 1
      ) {
        const displayedCoordinate = latLngToTileCoordinate(48.86, 2.36, zoom)
        const requests = resolveVisibilityTileRequests(
          manifest,
          displayedCoordinate,
          zoom,
        )

        expect(requests.length, `${manifest.id} au zoom ${zoom}`).toBeGreaterThan(0)
      }
    }
  })

  it('builds a bounded world-scale mosaic from intersecting source tiles only', () => {
    const displayedCoordinate = latLngToTileCoordinate(
      48.8566,
      2.3522,
      VISIBILITY_MIN_DISPLAY_ZOOM,
    )
    const requests = resolveVisibilityTileRequests(
      READY_MANIFEST,
      displayedCoordinate,
      VISIBILITY_MIN_DISPLAY_ZOOM,
    )

    expect(requests.map(({ sourceCoordinate }) => sourceCoordinate)).toEqual([
      { x: 517, y: 351 },
      { x: 518, y: 351 },
      { x: 519, y: 351 },
      { x: 517, y: 352 },
      { x: 518, y: 352 },
      { x: 519, y: 352 },
      { x: 517, y: 353 },
      { x: 518, y: 353 },
      { x: 519, y: 353 },
    ])
    expect(requests.map(({ scale, left, top }) => ({ scale, left, top }))).toEqual([
      { scale: 1 / 1024, left: 129.25, top: 87.75 },
      { scale: 1 / 1024, left: 129.5, top: 87.75 },
      { scale: 1 / 1024, left: 129.75, top: 87.75 },
      { scale: 1 / 1024, left: 129.25, top: 88 },
      { scale: 1 / 1024, left: 129.5, top: 88 },
      { scale: 1 / 1024, left: 129.75, top: 88 },
      { scale: 1 / 1024, left: 129.25, top: 88.25 },
      { scale: 1 / 1024, left: 129.5, top: 88.25 },
      { scale: 1 / 1024, left: 129.75, top: 88.25 },
    ])
  })

  it('does not resolve below the minimum map zoom', () => {
    const zoom = VISIBILITY_MIN_DISPLAY_ZOOM - 1

    expect(resolveVisibilityTileRequests(
      READY_MANIFEST,
      { x: 0, y: 0 },
      zoom,
    )).toEqual([])
  })
})

describe('ImageMapType factory', () => {
  it('constructs one clamped, queryable Google overlay', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      {
        Size: FakeSize,
      },
      READY_MANIFEST,
      1.8,
    )

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ready map type')
    const mapType = result.mapType
    expect(mapType.minZoom).toBe(VISIBILITY_MIN_DISPLAY_ZOOM)
    expect(mapType.maxZoom).toBe(VISIBILITY_MAX_DISPLAY_ZOOM)
    expect((mapType.tileSize as unknown as FakeSize).width).toBe(256)

    const tile = mapType.getTile(
      { x: 8299, y: 5636 },
      14,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    const canvas = tile.querySelector('canvas')
    expect(tile.style.opacity).toBe('1')
    expect(canvas?.width).toBe(256)
    expect(canvas?.height).toBe(256)
    expect(image?.src).toContain('/14/8299/5636.png')
    image?.dispatchEvent(new Event('load'))
    expect(drawImage).toHaveBeenCalledWith(
      image,
      0,
      0,
      256,
      256,
      0,
      0,
      256,
      256,
    )
  })

  it('crops and scales the final source level instead of dropping closer tiles', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      { Size: FakeSize },
      COARSE_MANIFEST,
      0.92,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const displayedCoordinate = latLngToTileCoordinate(48.86, 2.36, 16)
    const tile = result.mapType.getTile(
      displayedCoordinate,
      16,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    const canvas = tile.querySelector('canvas')

    expect(image?.src).toContain('/15/16598/11272.png')
    expect(image?.style.display).toBe('none')
    expect(canvas?.style.width).toBe('256px')
    image?.dispatchEvent(new Event('load'))
    expect(drawImage).toHaveBeenCalledWith(
      image,
      128,
      128,
      128,
      128,
      0,
      0,
      256,
      256,
    )
    expect(fillRect).not.toHaveBeenCalled()
  })

  it('renders extreme overzoom into a fixed canvas without huge CSS transforms', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      { Size: FakeSize },
      COARSE_MANIFEST,
      0.84,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const displayedCoordinate = latLngToTileCoordinate(
      48.86,
      2.36,
      VISIBILITY_MAX_DISPLAY_ZOOM,
    )
    const tile = result.mapType.getTile(
      displayedCoordinate,
      VISIBILITY_MAX_DISPLAY_ZOOM,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    const canvas = tile.querySelector('canvas')

    expect(canvas?.width).toBe(256)
    expect(canvas?.style.inset).toBe('0px')
    expect(image?.style.display).toBe('none')
    expect(image?.style.transform).toBe('')
    image?.dispatchEvent(new Event('load'))
    const call = drawImage.mock.calls.at(-1)
    expect(call?.[3]).toBe(1)
    expect(call?.[4]).toBe(1)
    expect(call?.slice(5)).toEqual([0, 0, 256, 256])
  })

  it('composes first-level source tiles instead of dropping wider map tiles', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      { Size: FakeSize },
      READY_MANIFEST,
      0.84,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const displayedCoordinate = latLngToTileCoordinate(
      48.8566,
      2.3522,
      VISIBILITY_MIN_DISPLAY_ZOOM,
    )
    const tile = result.mapType.getTile(
      displayedCoordinate,
      VISIBILITY_MIN_DISPLAY_ZOOM,
      document,
    ) as HTMLDivElement
    const images = [...tile.querySelectorAll('img')]
    const canvas = tile.querySelector('canvas')

    expect(tile.style.opacity).toBe('0.84')
    expect(canvas?.width).toBe(256)
    expect(images).toHaveLength(9)
    expect(images.map(({ src }) => src)).toEqual([
      'https://tiles.example/2026.08.12%2Bsurface/10/517/351.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/518/351.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/519/351.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/517/352.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/518/352.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/519/352.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/517/353.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/518/353.png',
      'https://tiles.example/2026.08.12%2Bsurface/10/519/353.png',
    ])
    expect(images.every(({ style }) => style.display === 'none')).toBe(true)
    for (const image of images) image.dispatchEvent(new Event('load'))
    expect(drawImage).toHaveBeenCalledTimes(9)
    expect(fillRect).toHaveBeenCalledTimes(9)
    expect(fillRect.mock.calls.every(([, , width, height]) =>
      width === MIN_VISIBILITY_FOOTPRINT_PIXELS
      && height === MIN_VISIBILITY_FOOTPRINT_PIXELS,
    )).toBe(true)
    expect(canvasContext.fillStyle).toBe('#ffc933')
  })

  it('turns a missing CDN tile into a transparent tile without a broken image', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      { Size: FakeSize },
      READY_MANIFEST,
      0.92,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const tile = result.mapType.getTile(
      { x: 8299, y: 5636 },
      14,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    expect(image).not.toBeNull()
    image?.dispatchEvent(new Event('error'))
    expect(tile.querySelector('img')).toBeNull()
    expect(tile.querySelector('canvas')).not.toBeNull()
    expect(tile.childElementCount).toBe(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(fillRect).not.toHaveBeenCalled()
  })

  it('does not paint a tile whose image finishes loading after release', () => {
    class FakeSize {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }
    const result = createVisibilityImageMapType(
      { Size: FakeSize },
      READY_MANIFEST,
      0.84,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const displayedCoordinate = latLngToTileCoordinate(
      48.8566,
      2.3522,
      VISIBILITY_MIN_DISPLAY_ZOOM,
    )
    const tile = result.mapType.getTile(
      displayedCoordinate,
      VISIBILITY_MIN_DISPLAY_ZOOM,
      document,
    ) as HTMLDivElement
    const delayedImage = tile.querySelector('img')

    expect(delayedImage).not.toBeNull()
    result.mapType.releaseTile(tile)
    expect(tile.childElementCount).toBe(0)
    delayedImage?.dispatchEvent(new Event('load'))
    expect(drawImage).not.toHaveBeenCalled()
    expect(fillRect).not.toHaveBeenCalled()
    expect(tile.childElementCount).toBe(0)
  })

  it('does not create a Google object while data is unavailable', () => {
    const unavailable: VisibilityDatasetManifest = {
      ...READY_MANIFEST,
      availability: 'unavailable',
      unavailableReason: 'Pas encore publié.',
      tiles: null,
    }
    const result = createVisibilityImageMapType(
      {
        Size: class {
          width: number
          height: number

          constructor(width: number, height: number) {
            this.width = width
            this.height = height
          }
        },
      },
      unavailable,
      0.5,
    )

    expect(result).toEqual({
      status: 'unavailable',
      mapType: null,
      message: 'Pas encore publié.',
    })
  })
})
