import type { VisibilityDatasetManifest, VisibilityLegendItem } from '../types/visibility'

const configuredTileBaseUrl = import.meta.env.VITE_VISIBILITY_TILE_BASE_URL
  ?.trim()
  .replace(/\/+$/, '')
const bundledTileBaseUrl = `${import.meta.env.BASE_URL}visibility`.replace(/\/+$/, '')
const tileBaseUrl = configuredTileBaseUrl || bundledTileBaseUrl

/** Exact Lambert-93 calculation raster reprojected to WGS84 for XYZ lookup. */
export const PARIS_VISIBILITY_BOUNDS = {
  north: 48.902562656023136,
  south: 48.81483717314258,
  east: 2.470081181533466,
  west: 2.2234863632715887,
} as const

/**
 * One question, one colour. Everything the model cannot call robustly clear is
 * left unpainted rather than given a second shade the reader has to decode.
 */
export const VISIBILITY_LEGEND = [
  {
    id: 'clear',
    label: 'Dégagement probable',
    description: 'Le disque solaire dépasse l’obstacle avec une marge conservatrice.',
    color: '#ffc933',
    minClearanceDegrees: 0.5,
  },
] as const satisfies readonly VisibilityLegendItem[]

/**
 * Front-end contract for the bundled Paris visibility pyramid. An optional
 * environment variable can point at a CDN without changing the application.
 */
export const PARIS_VISIBILITY_MANIFEST: VisibilityDatasetManifest = {
  id: 'paris-maximum-geometry',
  version: 'paris-2026-max-v1',
  label: 'Visibilité estimée au maximum',
  availability: 'ready',
  coverage: PARIS_VISIBILITY_BOUNDS,
  reference: {
    mode: 'fixed-instant',
    timeUtc: '2026-08-12T18:17:11.916Z',
    label: 'Paris uniquement · maximum à 20:17',
  },
  surface: {
    description: 'MNT et MNS LiDAR HD IGN rééchantillonnés sur une grille Lambert-93.',
    resolutionMeters: 2,
    observerHeightMeters: 1.7,
    includesBuildings: true,
    includesVegetation: true,
    generatedAt: '2026-08-09T17:46:21.012Z',
    sources: [
      {
        label: 'IGN — LiDAR HD MNT/MNS, bloc KE · acquisition 03-03-2023 · édition 06-06-2025',
        url: 'https://www.ign.fr/institut/programme-lidar-hd-vers-une-nouvelle-cartographie-3d-du-territoire',
        license: 'Licence Ouverte Etalab 2.0',
      },
    ],
  },
  tiles: {
    scheme: 'xyz',
    tileSize: 256,
    // The pyramid reaches zoom 10 so the layer survives zooming out to the
    // whole city; the painted band is thinned to a pixel rather than dropped.
    minZoom: 10,
    maxZoom: 16,
    urlTemplate: `${tileBaseUrl}/{version}/{z}/{x}/{y}.png`,
  },
  legend: VISIBILITY_LEGEND,
  attribution: '© IGN — LiDAR HD MNT/MNS 2023, édition 2025 · Licence Ouverte 2.0',
  disclaimer:
    'Estimation géométrique à 2 m, élargie d’au moins 4 m pour la lisibilité. Sans météo ni garantie d’accès : vérifiez sur place.',
}

/** The layer is the reason the map exists, so it is painted, not whispered. */
export const VISIBILITY_LAYER_OPACITY = 0.92
