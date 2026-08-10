import type {
  GeographicBounds,
  VisibilityDatasetManifest,
} from '../types/visibility'

export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878

export type TileCoordinate = {
  x: number
  y: number
}

export type VisibilityImageMapTypeConstructors = {
  ImageMapType: typeof google.maps.ImageMapType
  Size: typeof google.maps.Size
}

export type VisibilityImageMapTypeResult =
  | {
      status: 'ready'
      mapType: google.maps.ImageMapType
      message: null
    }
  | {
      status: 'unavailable' | 'error'
      mapType: null
      message: string
    }

function tileCount(zoom: number): number {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 30) {
    throw new RangeError(`Invalid Web Mercator zoom: ${zoom}`)
  }
  return 2 ** zoom
}

export function normalizeTileX(x: number, zoom: number): number {
  const count = tileCount(zoom)
  const integerX = Math.trunc(x)
  return ((integerX % count) + count) % count
}

export function isValidTileY(y: number, zoom: number): boolean {
  const count = tileCount(zoom)
  return Number.isInteger(y) && y >= 0 && y < count
}

export function latLngToTileCoordinate(
  latitude: number,
  longitude: number,
  zoom: number,
): TileCoordinate {
  const count = tileCount(zoom)
  const latitudeClamped = Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude),
  )
  const longitudeWrapped = ((longitude + 180) % 360 + 360) % 360 - 180
  const latitudeRadians = latitudeClamped * Math.PI / 180
  const x = Math.floor(((longitudeWrapped + 180) / 360) * count)
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) *
      count,
  )

  return {
    x: Math.max(0, Math.min(count - 1, x)),
    y: Math.max(0, Math.min(count - 1, y)),
  }
}

function tileLatitude(y: number, count: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / count))) * 180 / Math.PI
}

export function tileGeographicBounds(
  coordinate: TileCoordinate,
  zoom: number,
): GeographicBounds {
  const count = tileCount(zoom)
  const x = normalizeTileX(coordinate.x, zoom)
  return {
    west: (x / count) * 360 - 180,
    east: ((x + 1) / count) * 360 - 180,
    north: tileLatitude(coordinate.y, count),
    south: tileLatitude(coordinate.y + 1, count),
  }
}

function longitudeRanges(bounds: GeographicBounds): Array<[number, number]> {
  return bounds.west <= bounds.east
    ? [[bounds.west, bounds.east]]
    : [[bounds.west, 180], [-180, bounds.east]]
}

export function pointInGeographicBounds(
  point: { lat: number; lng: number },
  bounds: GeographicBounds,
): boolean {
  const latitudeInside = point.lat >= bounds.south && point.lat <= bounds.north
  if (!latitudeInside) return false
  return longitudeRanges(bounds).some(([west, east]) => point.lng >= west && point.lng <= east)
}

export function tileIntersectsBounds(
  coordinate: TileCoordinate,
  zoom: number,
  coverage: GeographicBounds,
): boolean {
  if (!isValidTileY(coordinate.y, zoom)) return false
  const tileBounds = tileGeographicBounds(coordinate, zoom)
  const latitudeIntersects =
    tileBounds.north >= coverage.south && tileBounds.south <= coverage.north
  if (!latitudeIntersects) return false

  return longitudeRanges(coverage).some(([west, east]) =>
    tileBounds.east >= west && tileBounds.west <= east,
  )
}

export function visibilityManifestIssue(
  manifest: VisibilityDatasetManifest,
): string | null {
  if (manifest.availability !== 'ready' || !manifest.tiles) {
    return manifest.unavailableReason ?? 'Données de visibilité indisponibles.'
  }
  if (manifest.tiles.scheme !== 'xyz') return 'Schéma de tuiles non pris en charge.'
  if (manifest.tiles.minZoom < 0 || manifest.tiles.maxZoom < manifest.tiles.minZoom) {
    return 'Plage de zoom invalide.'
  }
  const requiredPlaceholders = ['{z}', '{x}', '{y}']
  if (!requiredPlaceholders.every((placeholder) => manifest.tiles!.urlTemplate.includes(placeholder))) {
    return 'Modèle d’URL de tuiles invalide.'
  }
  return null
}

export function buildVisibilityTileUrl(
  manifest: VisibilityDatasetManifest,
  coordinate: TileCoordinate,
  zoom: number,
): string | null {
  if (visibilityManifestIssue(manifest) || !manifest.tiles) return null
  if (zoom < manifest.tiles.minZoom || zoom > manifest.tiles.maxZoom) return null
  if (!Number.isInteger(coordinate.x) || !isValidTileY(coordinate.y, zoom)) return null

  const normalizedCoordinate = {
    x: normalizeTileX(coordinate.x, zoom),
    y: coordinate.y,
  }
  if (!tileIntersectsBounds(normalizedCoordinate, zoom, manifest.coverage)) return null

  return manifest.tiles.urlTemplate
    .replaceAll('{version}', encodeURIComponent(manifest.version))
    .replaceAll('{z}', String(zoom))
    .replaceAll('{x}', String(normalizedCoordinate.x))
    .replaceAll('{y}', String(normalizedCoordinate.y))
}

export function createVisibilityImageMapType(
  constructors: VisibilityImageMapTypeConstructors,
  manifest: VisibilityDatasetManifest,
  opacity: number,
): VisibilityImageMapTypeResult {
  const issue = visibilityManifestIssue(manifest)
  if (issue || !manifest.tiles) {
    return {
      status: manifest.availability === 'unavailable' ? 'unavailable' : 'error',
      mapType: null,
      message: issue ?? 'Données de visibilité indisponibles.',
    }
  }

  const safeOpacity = Math.max(0, Math.min(1, opacity))
  const mapType = new constructors.ImageMapType({
    alt: manifest.disclaimer,
    name: manifest.label,
    minZoom: manifest.tiles.minZoom,
    maxZoom: manifest.tiles.maxZoom,
    opacity: safeOpacity,
    tileSize: new constructors.Size(manifest.tiles.tileSize, manifest.tiles.tileSize),
    getTileUrl: (coordinate, zoom) => buildVisibilityTileUrl(manifest, coordinate, zoom),
  })

  return { status: 'ready', mapType, message: null }
}
