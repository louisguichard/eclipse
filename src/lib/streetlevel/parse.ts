import { normalizeHeading } from '../geometry'
import type { StreetLevelLink, StreetLevelPanorama, StreetLevelSize } from './types'

type JsonArray = unknown[]

function array(value: unknown): JsonArray | null {
  return Array.isArray(value) ? value : null
}

function at(value: unknown, ...path: number[]): unknown {
  let current = value
  for (const index of path) {
    const currentArray = array(current)
    if (!currentArray || index < 0 || index >= currentArray.length) return undefined
    current = currentArray[index]
  }
  return current
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function signedDegrees(value: number): number {
  const normalized = normalizeHeading(value)
  return normalized > 180 ? normalized - 360 : normalized
}

function bearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const radians = Math.PI / 180
  const lat1 = fromLat * radians
  const lat2 = toLat * radians
  const deltaLng = (toLng - fromLng) * radians
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return normalizeHeading(Math.atan2(y, x) / radians)
}

function parseImageSizes(message: unknown): StreetLevelSize[] {
  const rawSizes = array(at(message, 2, 3, 0)) ?? []
  return rawSizes.flatMap((entry) => {
    const height = finiteNumber(at(entry, 0, 0))
    const width = finiteNumber(at(entry, 0, 1))
    return height !== null && width !== null && height > 0 && width > 0
      ? [{ width, height }]
      : []
  })
}

function parseLinks(
  message: unknown,
  currentId: string,
  currentLat: number,
  currentLng: number,
): StreetLevelLink[] {
  const others = array(at(message, 5, 0, 3, 0)) ?? []
  const rawLinks = array(at(message, 5, 0, 6)) ?? []

  return rawLinks.flatMap((rawLink) => {
    const index = finiteNumber(at(rawLink, 0))
    if (index === null || !Number.isInteger(index)) return []
    const other = others[index]
    const pano = string(at(other, 0, 1))
    const lat = finiteNumber(at(other, 2, 0, 2))
    const lng = finiteNumber(at(other, 2, 0, 3))
    if (!pano || pano === currentId || lat === null || lng === null) return []

    const explicitHeading = finiteNumber(at(rawLink, 1, 3))
    const panoramaHeading = finiteNumber(at(other, 2, 2, 0))
    const rawPitch = finiteNumber(at(other, 2, 2, 1))
    const rawRoll = finiteNumber(at(other, 2, 2, 2))
    return [{
      pano,
      heading: normalizeHeading(explicitHeading ?? bearing(currentLat, currentLng, lat, lng)),
      position: { lat, lng },
      panoramaHeading: panoramaHeading === null ? null : normalizeHeading(panoramaHeading),
      pitchCorrection: rawPitch === null ? 0 : 90 - rawPitch,
      rollCorrection: rawRoll === null ? 0 : signedDegrees(rawRoll),
    }]
  })
}

/** Parses the single argument passed to GeoPhotoService's JSONP callback. */
export function parsePanoramaSearchPayload(payload: unknown): StreetLevelPanorama | null {
  const status = finiteNumber(at(payload, 0, 0))
  if (status !== 0) return null

  const message = at(payload, 1)
  const id = string(at(message, 1, 1))
  const lat = finiteNumber(at(message, 5, 0, 1, 0, 2))
  const lng = finiteNumber(at(message, 5, 0, 1, 0, 3))
  const rawHeading = finiteNumber(at(message, 5, 0, 1, 2, 0))
  const rawPitch = finiteNumber(at(message, 5, 0, 1, 2, 1))
  const rawRoll = finiteNumber(at(message, 5, 0, 1, 2, 2))
  const tileWidth = finiteNumber(at(message, 2, 3, 1, 0))
  const tileHeight = finiteNumber(at(message, 2, 3, 1, 1))
  const imageSizes = parseImageSizes(message)
  if (
    !id || lat === null || lng === null || rawHeading === null ||
    tileWidth === null || tileHeight === null || tileWidth <= 0 || tileHeight <= 0 ||
    imageSizes.length === 0
  ) {
    throw new Error('Réponse Streetlevel incomplète')
  }

  return {
    id,
    position: { lat, lng },
    heading: normalizeHeading(rawHeading),
    pitchCorrection: rawPitch === null ? 0 : 90 - rawPitch,
    rollCorrection: rawRoll === null ? 0 : signedDegrees(rawRoll),
    tileSize: { width: tileWidth, height: tileHeight },
    imageSizes,
    links: parseLinks(message, id, lat, lng),
    copyright: string(at(message, 4, 0, 0, 0, 0)) ?? '© Google',
    source: string(at(message, 6, 5, 2)),
  }
}
