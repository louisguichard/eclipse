// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { VisibilityDatasetManifest } from '../types/visibility'
import {
  buildVisibilityTileUrl,
  createVisibilityImageMapType,
  geographicBoundsIntersect,
  isValidTileY,
  knownVisibilityCoverageAtPoint,
  latLngToTileCoordinate,
  normalizeTileX,
  pointInGeographicBounds,
  preferredVisibilityDatasetAtPoint,
  tileGeographicBounds,
  tileIntersectsBounds,
  visibilityDatasetsForView,
  visibilityManifestIssue,
} from './visibilityTiles'

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

  it('honours zoom ranges and distinguishes unpublished known coverage', () => {
    const unavailable: VisibilityDatasetManifest = {
      ...COARSE_MANIFEST,
      availability: 'unavailable',
      unavailableReason: 'Publication à venir.',
      tiles: null,
    }
    const point = { lat: 48.4, lng: 2.7 }

    expect(visibilityDatasetsForView([COARSE_MANIFEST], point, null, 16)).toEqual([])
    expect(preferredVisibilityDatasetAtPoint([unavailable], point)).toBeNull()
    expect(knownVisibilityCoverageAtPoint([unavailable], point)?.id).toBe('idf-coarse')
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
        Size: FakeSize as unknown as typeof google.maps.Size,
      },
      READY_MANIFEST,
      1.8,
    )

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ready map type')
    const mapType = result.mapType
    expect(mapType.minZoom).toBe(10)
    expect(mapType.maxZoom).toBe(17)
    expect((mapType.tileSize as unknown as FakeSize).width).toBe(256)

    const tile = mapType.getTile(
      { x: 8299, y: 5636 } as google.maps.Point,
      14,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    expect(tile.style.opacity).toBe('1')
    expect(image?.src).toContain('/14/8299/5636.png')
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
      { Size: FakeSize as unknown as typeof google.maps.Size },
      READY_MANIFEST,
      0.92,
    )
    if (result.status !== 'ready') throw new Error('Expected a ready map type')

    const tile = result.mapType.getTile(
      { x: 8299, y: 5636 } as google.maps.Point,
      14,
      document,
    ) as HTMLDivElement
    const image = tile.querySelector('img')
    expect(image).not.toBeNull()
    image?.dispatchEvent(new Event('error'))
    expect(tile.querySelector('img')).toBeNull()
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
        Size: class {} as unknown as typeof google.maps.Size,
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
