import { describe, expect, it } from 'vitest'
import type { VisibilityDatasetManifest } from '../types/visibility'
import {
  createVisibilityRasterDefinition,
  visibilityLayerId,
  visibilitySourceId,
} from './mapLibreVisibility'

const MANIFEST: VisibilityDatasetManifest = {
  id: 'test visibility/Paris',
  version: 'version été 2026',
  label: 'Paris test',
  availability: 'ready',
  coverage: { north: 49, south: 48, east: 3, west: 2 },
  reference: { mode: 'local-maximum', label: 'Maximum local' },
  surface: {
    description: 'Fixture',
    resolutionMeters: 2,
    observerHeightMeters: 1.7,
    includesBuildings: true,
    includesVegetation: true,
    sources: [],
  },
  tiles: {
    scheme: 'xyz',
    tileSize: 256,
    minZoom: 10,
    maxZoom: 16,
    urlTemplate: 'https://example.test/{version}/{z}/{x}/{y}.png',
  },
  legend: [],
  attribution: '© Source test',
  disclaimer: 'Fixture',
}

describe('MapLibre visibility raster definitions', () => {
  it('preserves the XYZ pyramid contract and categorical rendering', () => {
    const definition = createVisibilityRasterDefinition(MANIFEST, 1.5)

    expect(definition).not.toBeNull()
    expect(definition?.sourceId).toBe(visibilitySourceId(MANIFEST.id))
    expect(definition?.layerId).toBe(visibilityLayerId(MANIFEST.id))
    expect(definition?.source).toMatchObject({
      type: 'raster',
      tiles: [
        'eclipse-visibility://https%3A%2F%2Fexample.test%2Fversion%2520%25C3%25A9t%25C3%25A9%25202026/{z}/{x}/{y}.png',
      ],
      scheme: 'xyz',
      tileSize: 256,
      minzoom: 10,
      maxzoom: 16,
      bounds: [2, 48, 3, 49],
      attribution: '© Source test',
    })
    expect(definition?.layer).toMatchObject({
      id: 'visibility-layer-test-visibility-Paris',
      type: 'raster',
      layout: { visibility: 'none' },
      paint: {
        'raster-opacity': 1,
        'raster-fade-duration': 0,
        'raster-resampling': 'nearest',
      },
    })
  })

  it('rejects an unavailable or malformed pyramid', () => {
    expect(createVisibilityRasterDefinition({
      ...MANIFEST,
      availability: 'unavailable',
      unavailableReason: 'Pas encore publié',
      tiles: null,
    }, 0.84)).toBeNull()
  })
})
