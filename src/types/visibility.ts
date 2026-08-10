export type VisibilityClassId =
  | 'clear'
  | 'sensitive'
  | 'uncertain'
  | 'blocked'
  | 'no-data'

export type VisibilityLayerStatus =
  | 'unavailable'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'

export type GeographicBounds = {
  north: number
  south: number
  east: number
  west: number
}

export type VisibilityReference = {
  mode: 'fixed-instant' | 'local-maximum'
  /** ISO-8601 instant. Required when mode is `fixed-instant`. */
  timeUtc?: string
  label: string
}

export type VisibilityLegendItem = {
  id: VisibilityClassId
  label: string
  description: string
  color: string
  minClearanceDegrees?: number
  maxClearanceDegrees?: number
}

export type VisibilityTilePyramid = {
  scheme: 'xyz'
  tileSize: 256 | 512
  minZoom: number
  maxZoom: number
  /** Supports `{z}`, `{x}`, `{y}`, and `{version}` placeholders. */
  urlTemplate: string
}

export type VisibilitySurfaceModel = {
  description: string
  resolutionMeters: number | null
  observerHeightMeters: number
  includesBuildings: boolean
  includesVegetation: boolean
  generatedAt?: string
  sources: ReadonlyArray<{
    label: string
    url?: string
    license?: string
  }>
}

export type VisibilityDatasetManifest = {
  id: string
  version: string
  label: string
  availability: 'ready' | 'unavailable'
  unavailableReason?: string
  coverage: GeographicBounds
  reference: VisibilityReference
  surface: VisibilitySurfaceModel
  tiles: VisibilityTilePyramid | null
  legend: readonly VisibilityLegendItem[]
  attribution: string
  disclaimer: string
}

export type VisibilityEstimate = {
  status: VisibilityLayerStatus
  classId: VisibilityClassId
  clearanceDegrees: number | null
  resolutionMeters: number | null
  datasetVersion: string | null
  message?: string
}
