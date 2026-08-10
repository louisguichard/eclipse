import type {
  GeographicBounds,
  VisibilityDatasetManifest,
  VisibilityLegendItem,
} from '../types/visibility'

function normalizeBaseUrl(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\/+$/, '')
  return normalized || null
}

const configuredTileBaseUrl = normalizeBaseUrl(
  import.meta.env.VITE_VISIBILITY_TILE_BASE_URL,
)
const bundledTileBaseUrl = `${import.meta.env.BASE_URL}visibility`.replace(/\/+$/, '')

/** Public, non-secret parent URL containing every versioned dataset folder. */
export const VISIBILITY_TILE_BASE_URL = configuredTileBaseUrl ?? bundledTileBaseUrl

/** Exact Lambert-93 Paris calculation raster reprojected to WGS84 for XYZ lookup. */
export const PARIS_VISIBILITY_BOUNDS = {
  north: 48.902562656023136,
  south: 48.81483717314258,
  east: 2.470081181533466,
  west: 2.2234863632715887,
} as const

/** Exact WGS84 envelopes written by the regional pipeline manifests. */
export const IDF_DEPARTMENT_BOUNDS = {
  '77': { north: 49.11662897526545, south: 48.118997130573035, east: 3.5644671663652856, west: 2.3831425691455306 },
  '78': { north: 49.092164848266506, south: 48.4336651881365, east: 2.234020003242152, west: 1.4451298814304276 },
  '91': { north: 48.777947358147614, south: 48.283459333846466, east: 2.5887392560249087, west: 1.9079874589138888 },
  '92': { north: 48.95139071805129, south: 48.72831547488424, east: 2.3395811822699892, west: 2.1438484639416084 },
  '93': { north: 49.012500643968316, south: 48.805836700324946, east: 2.604318319843682, west: 2.2875425596737347 },
  '94': { north: 48.86200360764224, south: 48.68645824106863, east: 2.616294196852614, west: 2.30725120884366 },
  '95': { north: 49.247719046189786, south: 48.903248784179915, east: 2.596097470298825, west: 1.604342752760251 },
} as const satisfies Record<string, GeographicBounds>

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

/** Front-end contract for the high-resolution Paris visibility pyramid. */
export const PARIS_VISIBILITY_MANIFEST: VisibilityDatasetManifest = {
  id: 'paris-maximum-geometry',
  version: 'paris-2026-max-v1',
  label: 'Paris · 2 m',
  availability: 'ready',
  coverage: PARIS_VISIBILITY_BOUNDS,
  reference: {
    mode: 'fixed-instant',
    timeUtc: '2026-08-12T18:17:11.916Z',
    label: 'Paris · maximum à 20:17',
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
    minZoom: 10,
    maxZoom: 16,
    urlTemplate: `${VISIBILITY_TILE_BASE_URL}/{version}/{z}/{x}/{y}.png`,
  },
  legend: VISIBILITY_LEGEND,
  attribution: '© IGN — LiDAR HD MNT/MNS 2023, édition 2025 · Licence Ouverte 2.0',
  disclaimer:
    'Estimation géométrique à 2 m, élargie d’au moins 4 m pour la lisibilité. Sans météo ni garantie d’accès : vérifiez sur place.',
}

type IdFDepartment = {
  code: keyof typeof IDF_DEPARTMENT_BOUNDS
  name: string
}

const IDF_DEPARTMENTS: readonly IdFDepartment[] = [
  { code: '77', name: 'Seine-et-Marne' },
  { code: '78', name: 'Yvelines' },
  { code: '91', name: 'Essonne' },
  { code: '92', name: 'Hauts-de-Seine' },
  { code: '93', name: 'Seine-Saint-Denis' },
  { code: '94', name: 'Val-de-Marne' },
  { code: '95', name: 'Val-d’Oise' },
]

function createIdFDepartmentManifest(
  department: IdFDepartment,
): VisibilityDatasetManifest {
  const version = `idf-${department.code}-2026-max-v1`
  return {
    id: `idf-${department.code}-maximum-geometry`,
    version,
    label: 'Île-de-France · 5 m',
    availability: 'ready',
    coverage: IDF_DEPARTMENT_BOUNDS[department.code],
    reference: {
      mode: 'local-maximum',
      label: `Maximum local · ${department.name}`,
    },
    surface: {
      description:
        `Modèle IGN hybride à 5 m · LiDAR HD en priorité, puis MNS Correl et RGE ALTI · ${department.name}.`,
      resolutionMeters: 5,
      observerHeightMeters: 1.7,
      includesBuildings: true,
      includesVegetation: true,
      sources: [
        {
          label: 'IGN — LiDAR HD MNT/MNS, selon disponibilité',
          url: 'https://www.ign.fr/institut/programme-lidar-hd-vers-une-nouvelle-cartographie-3d-du-territoire',
          license: 'Licence Ouverte Etalab 2.0',
        },
        {
          label: 'IGN — MNS Correl et RGE ALTI, couverture de complément',
          url: 'https://geoservices.ign.fr/',
          license: 'Licence Ouverte Etalab 2.0',
        },
      ],
    },
    tiles: {
      scheme: 'xyz',
      tileSize: 256,
      minZoom: 8,
      maxZoom: 15,
      urlTemplate: `${VISIBILITY_TILE_BASE_URL}/{version}/{z}/{x}/{y}.png`,
    },
    legend: VISIBILITY_LEGEND,
    attribution: '© IGN — LiDAR HD, MNS Correl et RGE ALTI · Licence Ouverte 2.0',
    disclaimer:
      'Estimation géométrique régionale à 5 m au maximum local. La précision varie selon la source IGN disponible et les petits obstacles peuvent ne pas être représentés ; vérifiez sur place.',
  }
}

export const ILE_DE_FRANCE_VISIBILITY_MANIFESTS = IDF_DEPARTMENTS.map(
  createIdFDepartmentManifest,
) as readonly VisibilityDatasetManifest[]

/**
 * Priority order is part of the rendering contract: fine datasets come first.
 * MapView inserts each entry at index zero, leaving Paris at the highest index
 * so it is painted above any intersecting 5 m departmental pyramid.
 */
export const VISIBILITY_DATASETS = [
  PARIS_VISIBILITY_MANIFEST,
  ...ILE_DE_FRANCE_VISIBILITY_MANIFESTS,
] as const satisfies readonly VisibilityDatasetManifest[]

/** The visibility layer is the purpose of the map, so it remains prominent. */
export const VISIBILITY_LAYER_OPACITY = 0.92
