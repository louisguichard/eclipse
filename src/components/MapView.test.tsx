/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import type { VisibilityDatasetManifest } from '../types/visibility'
import { VisibilityLegend } from './MapView'

const MANIFEST: VisibilityDatasetManifest = {
  id: 'fixture-maximum-geometry',
  version: 'fixture-v1',
  label: 'Agglomération test · 5 m',
  availability: 'ready',
  coverage: { north: 49, south: 48, east: 3, west: 2 },
  reference: {
    mode: 'local-maximum',
    label: 'Maximum local · Agglomération test',
  },
  surface: {
    description: 'Surface de test.',
    resolutionMeters: 5,
    observerHeightMeters: 1.7,
    includesBuildings: true,
    includesVegetation: true,
    sources: [],
  },
  tiles: {
    scheme: 'xyz',
    tileSize: 256,
    minZoom: 8,
    maxZoom: 15,
    urlTemplate: 'https://example.test/{version}/{z}/{x}/{y}.png',
  },
  legend: [],
  attribution: '© Source cartographique test · Licence test',
  disclaimer: 'Estimation géométrique de test.',
  warnings: [
    'Prudence : le relief situé au-delà des 15 km calculés peut encore masquer le Soleil dans cette zone.',
  ],
}

describe('VisibilityLegend', () => {
  afterEach(cleanup)

  it('names the yellow on the card and keeps the manifest metadata in the tooltip', () => {
    render(<VisibilityLegend preferredVisibilityDataset={MANIFEST} />)

    expect(screen.getByText('En jaune : dégagement probable')).toBeInTheDocument()
    // The card carries one line; the dataset, its reference instant, the
    // licence credit and the caveats are all reachable without covering it.
    expect(screen.queryByText(/hors météo/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Licence test/)).not.toBeInTheDocument()

    const tooltip = screen.getByTitle(/Agglomération test/)
    expect(tooltip.title).toContain('maximum local · hors météo')
    expect(tooltip.title).toContain('© Source cartographique test · Licence test · Résolution 5 m')
    expect(tooltip.title).toContain('relief situé au-delà des 15 km calculés')
  })

  it('advertises the twenty largest urban areas outside published coverage', () => {
    render(<VisibilityLegend />)

    expect(screen.getByText('Couche LiDAR disponible dans les 20 plus grandes agglomérations de France')).toBeInTheDocument()
    expect(screen.queryByText(/Île-de-France uniquement/i)).not.toBeInTheDocument()
  })
})
