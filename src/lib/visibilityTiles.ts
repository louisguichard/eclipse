import type {
  GeographicBounds,
  VisibilityDatasetManifest,
} from '../types/visibility'

export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878
export const WEB_MERCATOR_MAX_ZOOM = 30

/** Overlay bounds only; the Google map UI keeps its native location-dependent range. */
export const VISIBILITY_MIN_DISPLAY_ZOOM = 0
export const VISIBILITY_MAX_DISPLAY_ZOOM = WEB_MERCATOR_MAX_ZOOM

/** A geographic feature smaller than this becomes an indicative map dot. */
export const MIN_VISIBILITY_FOOTPRINT_PIXELS = 2

export type TileCoordinate = {
  x: number
  y: number
}

export type VisibilityMapTypeConstructors = {
  Size: new (width: number, height: number) => { width: number; height: number }
}

type VisibilityImageMapType = {
  alt: string
  name: string
  minZoom: number
  maxZoom: number
  projection: null
  radius: number
  tileSize: { width: number; height: number }
  getTile: (coordinate: TileCoordinate, zoom: number, ownerDocument: Document) => Element
  releaseTile: (tile: Element | null) => void
}

export type VisibilityTileRequest = {
  url: string
  sourceCoordinate: TileCoordinate
  sourceZoom: number
  scale: number
  left: number
  top: number
}

export type VisibilityImageMapTypeResult =
  | {
      status: 'ready'
      mapType: VisibilityImageMapType
      message: null
    }
  | {
      status: 'unavailable' | 'error'
      mapType: null
      message: string
    }

function tileCount(zoom: number): number {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > WEB_MERCATOR_MAX_ZOOM) {
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

export function geographicBoundsIntersect(
  first: GeographicBounds,
  second: GeographicBounds,
): boolean {
  const latitudeIntersects =
    first.north >= second.south && first.south <= second.north
  if (!latitudeIntersects) return false

  const firstLongitudeRanges = longitudeRanges(first)
  const secondLongitudeRanges = longitudeRanges(second)
  return firstLongitudeRanges.some(([firstWest, firstEast]) =>
    secondLongitudeRanges.some(([secondWest, secondEast]) =>
      firstEast >= secondWest && firstWest <= secondEast,
    ),
  )
}

export function pointInGeographicBounds(
  point: { lat: number; lng: number },
  bounds: GeographicBounds,
): boolean {
  const latitudeInside = point.lat >= bounds.south && point.lat <= bounds.north
  if (!latitudeInside) return false
  return longitudeRanges(bounds).some(([west, east]) => point.lng >= west && point.lng <= east)
}

/**
 * Returns ready datasets in catalogue order (fine to coarse) that can paint
 * either the observation point or the visible map. Outside a pyramid's native
 * range, its nearest published level remains mounted through the shared map
 * zoom range.
 */
export function visibilityDatasetsForView(
  manifests: readonly VisibilityDatasetManifest[],
  point: { lat: number; lng: number },
  viewport: GeographicBounds | null,
  zoom?: number,
): VisibilityDatasetManifest[] {
  return manifests.filter((manifest) => {
    if (visibilityManifestIssue(manifest) || !manifest.tiles) return false
    if (
      zoom !== undefined
      && (
        zoom < Math.min(manifest.tiles.minZoom, VISIBILITY_MIN_DISPLAY_ZOOM)
        || zoom > Math.max(manifest.tiles.maxZoom, VISIBILITY_MAX_DISPLAY_ZOOM)
      )
    ) {
      return false
    }

    return pointInGeographicBounds(point, manifest.coverage)
      || (viewport !== null && geographicBoundsIntersect(viewport, manifest.coverage))
  })
}

/** Fine-to-coarse catalogue order makes the first match the best local layer. */
export function preferredVisibilityDatasetAtPoint(
  manifests: readonly VisibilityDatasetManifest[],
  point: { lat: number; lng: number },
): VisibilityDatasetManifest | null {
  return manifests.find((manifest) =>
    !visibilityManifestIssue(manifest)
    && pointInGeographicBounds(point, manifest.coverage),
  ) ?? null
}

/** Includes unpublished entries so the UI can distinguish pending data from out-of-area. */
export function knownVisibilityCoverageAtPoint(
  manifests: readonly VisibilityDatasetManifest[],
  point: { lat: number; lng: number },
): VisibilityDatasetManifest | null {
  return manifests.find((manifest) =>
    pointInGeographicBounds(point, manifest.coverage),
  ) ?? null
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

function longitudeToTileX(longitude: number, zoom: number): number {
  const count = tileCount(zoom)
  const clamped = Math.max(-180, Math.min(180, longitude))
  return Math.max(
    0,
    Math.min(count - 1, Math.floor(((clamped + 180) / 360) * count)),
  )
}

function coverageTileXRanges(
  coverage: GeographicBounds,
  zoom: number,
): Array<[number, number]> {
  return longitudeRanges(coverage).map(([west, east]) => [
    longitudeToTileX(west, zoom),
    longitudeToTileX(east, zoom),
  ])
}

/**
 * Resolves a displayed Google tile to one or more published source tiles. At
 * native zooms this is a one-to-one lookup. Overzoom selects one precise child
 * quadrant of the last level; underzoom builds a small mosaic from the first
 * level so the overlay also remains present at world scale.
 */
export function resolveVisibilityTileRequests(
  manifest: VisibilityDatasetManifest,
  coordinate: TileCoordinate,
  zoom: number,
): VisibilityTileRequest[] {
  if (visibilityManifestIssue(manifest) || !manifest.tiles) return []
  const minimumDisplayZoom = Math.min(
    manifest.tiles.minZoom,
    VISIBILITY_MIN_DISPLAY_ZOOM,
  )
  const maximumDisplayZoom = Math.max(
    manifest.tiles.maxZoom,
    VISIBILITY_MAX_DISPLAY_ZOOM,
  )
  if (zoom < minimumDisplayZoom || zoom > maximumDisplayZoom) return []
  if (!Number.isInteger(coordinate.x) || !isValidTileY(coordinate.y, zoom)) return []

  const displayedCoordinate = {
    x: normalizeTileX(coordinate.x, zoom),
    y: coordinate.y,
  }
  if (!tileIntersectsBounds(displayedCoordinate, zoom, manifest.coverage)) return []

  const sourceZoom = Math.max(
    manifest.tiles.minZoom,
    Math.min(zoom, manifest.tiles.maxZoom),
  )
  if (sourceZoom <= zoom) {
    const scale = 2 ** (zoom - sourceZoom)
    const sourceCoordinate = {
      x: Math.floor(displayedCoordinate.x / scale),
      y: Math.floor(displayedCoordinate.y / scale),
    }
    const url = buildVisibilityTileUrl(manifest, sourceCoordinate, sourceZoom)
    if (!url) return []

    return [{
      url,
      sourceCoordinate,
      sourceZoom,
      scale,
      left: -(displayedCoordinate.x % scale) * manifest.tiles.tileSize,
      top: -(displayedCoordinate.y % scale) * manifest.tiles.tileSize,
    }]
  }

  const sourceTilesPerAxis = 2 ** (sourceZoom - zoom)
  const sourceDisplaySize = manifest.tiles.tileSize / sourceTilesPerAxis
  const displayedSourceWest = displayedCoordinate.x * sourceTilesPerAxis
  const displayedSourceNorth = displayedCoordinate.y * sourceTilesPerAxis
  const displayedSourceEast = displayedSourceWest + sourceTilesPerAxis - 1
  const displayedSourceSouth = displayedSourceNorth + sourceTilesPerAxis - 1
  const coverageNorth = latLngToTileCoordinate(
    manifest.coverage.north,
    0,
    sourceZoom,
  ).y
  const coverageSouth = latLngToTileCoordinate(
    manifest.coverage.south,
    0,
    sourceZoom,
  ).y
  const requests: VisibilityTileRequest[] = []
  const firstY = Math.max(displayedSourceNorth, coverageNorth)
  const lastY = Math.min(displayedSourceSouth, coverageSouth)
  for (const [coverageWest, coverageEast] of coverageTileXRanges(
    manifest.coverage,
    sourceZoom,
  )) {
    const firstX = Math.max(displayedSourceWest, coverageWest)
    const lastX = Math.min(displayedSourceEast, coverageEast)
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        const sourceCoordinate = { x, y }
        const url = buildVisibilityTileUrl(manifest, sourceCoordinate, sourceZoom)
        if (!url) continue
        requests.push({
          url,
          sourceCoordinate,
          sourceZoom,
          scale: 1 / sourceTilesPerAxis,
          left: (x - displayedSourceWest) * sourceDisplaySize,
          top: (y - displayedSourceNorth) * sourceDisplaySize,
        })
      }
    }
  }
  return requests
}

export function createVisibilityImageMapType(
  constructors: VisibilityMapTypeConstructors,
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
  const tileSize = manifest.tiles.tileSize
  const minimumDisplayZoom = Math.min(
    manifest.tiles.minZoom,
    VISIBILITY_MIN_DISPLAY_ZOOM,
  )
  const maximumDisplayZoom = Math.max(
    manifest.tiles.maxZoom,
    VISIBILITY_MAX_DISPLAY_ZOOM,
  )
  const visibilityColor = manifest.legend.find(({ id }) => id === 'clear')?.color
    ?? '#ffc933'
  const releasedTiles = new WeakSet<Element>()
  const mapType: VisibilityImageMapType = {
    alt: manifest.disclaimer,
    name: manifest.label,
    minZoom: minimumDisplayZoom,
    maxZoom: maximumDisplayZoom,
    projection: null,
    radius: 6_378_137,
    tileSize: new constructors.Size(tileSize, tileSize),
    getTile: (coordinate, zoom, ownerDocument) => {
      const tile = ownerDocument.createElement('div')
      tile.style.width = `${tileSize}px`
      tile.style.height = `${tileSize}px`
      tile.style.position = 'relative'
      tile.style.overflow = 'hidden'
      tile.style.opacity = String(safeOpacity)

      // A fixed-size canvas avoids both rendering failure modes of CSS image
      // transforms: sub-pixel rasters at world zoom and multi-million-pixel
      // offsets at close zoom. Drawing cross-origin images is allowed; the
      // canvas may be tainted, but it is never read back.
      const canvas = ownerDocument.createElement('canvas')
      canvas.width = tileSize
      canvas.height = tileSize
      canvas.ariaHidden = 'true'
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.width = `${tileSize}px`
      canvas.style.height = `${tileSize}px`
      tile.append(canvas)
      const context = canvas.getContext('2d')

      const requests = resolveVisibilityTileRequests(manifest, coordinate, zoom)
      for (const request of requests) {
        const image = ownerDocument.createElement('img')
        image.alt = ''
        image.ariaHidden = 'true'
        image.decoding = 'async'
        image.draggable = false
        image.width = tileSize
        image.height = tileSize
        if (context) {
          image.style.display = 'none'
          image.addEventListener('load', () => {
            if (releasedTiles.has(tile)) return
            if (request.scale >= 1) {
              const exactSourceSize = tileSize / request.scale
              const sourceSize = Math.max(1, exactSourceSize)
              const sourceX = exactSourceSize < 1
                ? Math.floor(-request.left / request.scale)
                : -request.left / request.scale
              const sourceY = exactSourceSize < 1
                ? Math.floor(-request.top / request.scale)
                : -request.top / request.scale
              context.imageSmoothingEnabled = false
              context.drawImage(
                image,
                sourceX,
                sourceY,
                sourceSize,
                sourceSize,
                0,
                0,
                tileSize,
                tileSize,
              )
              return
            }

            const renderedSize = tileSize * request.scale
            context.imageSmoothingEnabled = true
            context.drawImage(
              image,
              0,
              0,
              tileSize,
              tileSize,
              request.left,
              request.top,
              renderedSize,
              renderedSize,
            )
            if (renderedSize <= MIN_VISIBILITY_FOOTPRINT_PIXELS) {
              const markerLeft = Math.max(0, Math.min(
                tileSize - MIN_VISIBILITY_FOOTPRINT_PIXELS,
                Math.round(
                  request.left
                  + renderedSize / 2
                  - MIN_VISIBILITY_FOOTPRINT_PIXELS / 2,
                ),
              ))
              const markerTop = Math.max(0, Math.min(
                tileSize - MIN_VISIBILITY_FOOTPRINT_PIXELS,
                Math.round(
                  request.top
                  + renderedSize / 2
                  - MIN_VISIBILITY_FOOTPRINT_PIXELS / 2,
                ),
              ))
              context.fillStyle = visibilityColor
              context.fillRect(
                markerLeft,
                markerTop,
                MIN_VISIBILITY_FOOTPRINT_PIXELS,
                MIN_VISIBILITY_FOOTPRINT_PIXELS,
              )
            }
          }, { once: true })
        } else {
          // Defensive fallback for environments without Canvas 2D. Normal
          // browsers take the fixed-canvas path above.
          image.style.position = 'absolute'
          image.style.top = `${request.top}px`
          image.style.left = `${request.left}px`
          image.style.width = `${tileSize}px`
          image.style.height = `${tileSize}px`
          image.style.maxWidth = 'none'
          image.style.maxHeight = 'none'
          image.style.transformOrigin = 'top left'
          if (request.scale !== 1) {
            if (request.scale > 1) image.style.imageRendering = 'pixelated'
            image.style.transform = `scale(${request.scale})`
          }
        }
        image.addEventListener('error', () => image.remove(), { once: true })
        image.src = request.url
        tile.append(image)
      }
      return tile
    },
    releaseTile: (tile) => {
      if (!tile) return
      releasedTiles.add(tile)
      tile.replaceChildren()
    },
  }

  return { status: 'ready', mapType, message: null }
}
