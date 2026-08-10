import { describe, expect, it } from 'vitest'
import {
  ILE_DE_FRANCE_VISIBILITY_MANIFESTS,
  PARIS_VISIBILITY_MANIFEST,
  URBAN_UNIT_VISIBILITY_MANIFESTS,
  VISIBILITY_DATASETS,
} from './visibility'
import { URBAN_UNIT_VISIBILITY_REGIONS } from './visibility-regions.generated'
import { preferredVisibilityDatasetAtPoint } from '../lib/visibilityTiles'

describe('visibility dataset catalogue', () => {
  it('keeps Paris and the seven departments ahead of the 19 urban units', () => {
    expect(VISIBILITY_DATASETS).toHaveLength(27)
    expect(VISIBILITY_DATASETS[0]).toBe(PARIS_VISIBILITY_MANIFEST)
    expect(VISIBILITY_DATASETS.map(({ version }) => version)).toEqual([
      'paris-2026-max-v1',
      'idf-77-2026-max-v1',
      'idf-78-2026-max-v1',
      'idf-91-2026-max-v1',
      'idf-92-2026-max-v1',
      'idf-93-2026-max-v1',
      'idf-94-2026-max-v1',
      'idf-95-2026-max-v1',
      'uu-00760-2026-max-v1',
      'uu-00759-2026-max-v1',
      'uu-00758-2026-max-v1',
      'uu-59702-2026-max-v1',
      'uu-33701-2026-max-v1',
      'uu-06701-2026-max-v1',
      'uu-44701-2026-max-v1',
      'uu-00757-2026-max-v1',
      'uu-00756-2026-max-v1',
      'uu-67701-2026-max-v1',
      'uu-34701-2026-max-v1',
      'uu-00755-2026-max-v1',
      'uu-00754-2026-max-v1',
      'uu-38701-2026-max-v1',
      'uu-35701-2026-max-v1',
      'uu-00753-2026-max-v1',
      'uu-37701-2026-max-v1',
      'uu-00752-2026-max-v1',
      'uu-59701-2026-max-v1',
    ])
    expect(PARIS_VISIBILITY_MANIFEST.surface.resolutionMeters).toBe(2)
    expect(ILE_DE_FRANCE_VISIBILITY_MANIFESTS.every(
      ({ surface }) => surface.resolutionMeters === 5,
    )).toBe(true)
    expect(URBAN_UNIT_VISIBILITY_MANIFESTS.every(
      ({ surface }) => surface.resolutionMeters === 5,
    )).toBe(true)
  })

  it('publishes every 5 m regional tile contract without an extra feature flag', () => {
    const regional = [
      ...ILE_DE_FRANCE_VISIBILITY_MANIFESTS,
      ...URBAN_UNIT_VISIBILITY_MANIFESTS,
    ]
    for (const manifest of regional) {
      expect(manifest.availability).toBe('ready')
      expect(manifest.tiles?.minZoom).toBe(8)
      expect(manifest.tiles?.maxZoom).toBe(15)
    }
  })

  it('copies exact published coverage and reference metadata into each urban unit', () => {
    expect(URBAN_UNIT_VISIBILITY_MANIFESTS).toHaveLength(19)
    for (const [index, manifest] of URBAN_UNIT_VISIBILITY_MANIFESTS.entries()) {
      const published = URBAN_UNIT_VISIBILITY_REGIONS[index]
      expect(manifest.id).toBe(published.id)
      expect(manifest.version).toBe(`uu-${published.code}-2026-max-v1`)
      expect(manifest.coverage).toBe(published.coverage)
      expect(manifest.reference).toBe(published.reference)
      expect(manifest.surface.generatedAt).toBe(published.surface.generatedAt)
    }

    expect(new Set(VISIBILITY_DATASETS.map(({ id }) => id)).size).toBe(27)
    expect(new Set(VISIBILITY_DATASETS.map(({ version }) => version)).size).toBe(27)
  })

  it('selects Montpellier and Rennes while preserving the 2 m Paris priority', () => {
    expect(preferredVisibilityDatasetAtPoint(
      VISIBILITY_DATASETS,
      { lat: 43.6141, lng: 3.8593 },
    )?.id).toBe('uu-34701-maximum-geometry')
    expect(preferredVisibilityDatasetAtPoint(
      VISIBILITY_DATASETS,
      { lat: 48.1203, lng: -1.6858 },
    )?.id).toBe('uu-35701-maximum-geometry')
    expect(preferredVisibilityDatasetAtPoint(
      VISIBILITY_DATASETS,
      { lat: 48.8566, lng: 2.3522 },
    )?.id).toBe('paris-maximum-geometry')
  })

  it('surfaces the six published datasets whose relief halo reached its cap', () => {
    expect(URBAN_UNIT_VISIBILITY_MANIFESTS
      .filter(({ warnings }) => warnings?.length)
      .map(({ version }) => version)).toEqual([
      'uu-00759-2026-max-v1',
      'uu-06701-2026-max-v1',
      'uu-00757-2026-max-v1',
      'uu-00754-2026-max-v1',
      'uu-38701-2026-max-v1',
      'uu-00753-2026-max-v1',
    ])
  })

  it('uses the same configurable parent URL for every published pyramid', () => {
    const published = VISIBILITY_DATASETS.filter(({ tiles }) => tiles !== null)
    const parentUrls = published.map(({ tiles }) =>
      tiles!.urlTemplate.replace('/{version}/{z}/{x}/{y}.png', ''),
    )

    expect(new Set(parentUrls).size).toBe(1)
  })
})
