import { describe, expect, it } from 'vitest'
import {
  ILE_DE_FRANCE_VISIBILITY_MANIFESTS,
  PARIS_VISIBILITY_MANIFEST,
  VISIBILITY_DATASETS,
} from './visibility'

describe('visibility dataset catalogue', () => {
  it('keeps the 2 m Paris pyramid ahead of all seven 5 m departments', () => {
    expect(VISIBILITY_DATASETS).toHaveLength(8)
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
    ])
    expect(PARIS_VISIBILITY_MANIFEST.surface.resolutionMeters).toBe(2)
    expect(ILE_DE_FRANCE_VISIBILITY_MANIFESTS.every(
      ({ surface }) => surface.resolutionMeters === 5,
    )).toBe(true)
  })

  it('publishes every regional tile contract without an extra feature flag', () => {
    for (const manifest of ILE_DE_FRANCE_VISIBILITY_MANIFESTS) {
      expect(manifest.availability).toBe('ready')
      expect(manifest.tiles?.minZoom).toBe(8)
      expect(manifest.tiles?.maxZoom).toBe(15)
    }
  })

  it('uses the same configurable parent URL for every published pyramid', () => {
    const published = VISIBILITY_DATASETS.filter(({ tiles }) => tiles !== null)
    const parentUrls = published.map(({ tiles }) =>
      tiles!.urlTemplate.replace('/{version}/{z}/{x}/{y}.png', ''),
    )

    expect(new Set(parentUrls).size).toBe(1)
  })
})
