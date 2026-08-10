import type { HorizontalCoordinates, LatLng, StreetViewCamera } from '../types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const EARTH_RADIUS_METERS = 6_371_008.8
const WIDE_ANGLE_BLEND_START = 120 * DEG_TO_RAD

function wideAngleProjectionWeight(horizontalFov: number): number {
  const progress = Math.max(
    0,
    Math.min(1, (horizontalFov - WIDE_ANGLE_BLEND_START) / (Math.PI - WIDE_ANGLE_BLEND_START)),
  )
  return progress * progress * (3 - 2 * progress)
}

export function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360
}

/** Signed shortest rotation from `from` to `to`, in [-180, 180). */
export function angularDifference(to: number, from: number): number {
  return ((to - from + 540) % 360) - 180
}

export function clampPitch(value: number): number {
  return Math.max(-90, Math.min(90, value))
}

/**
 * Astronomy Engine and Google Street View use the same heading convention:
 * true north = 0°, east = 90°. Street View pitch is positive upward.
 * Google exposes no geodetic horizon/roll calibration for a panorama, so the
 * altitude-to-pitch mapping is the documented nominal approximation.
 */
export function sunToStreetViewPov(
  sun: HorizontalCoordinates,
  zoom = 1,
): StreetViewCamera {
  return {
    heading: normalizeHeading(sun.azimuth),
    pitch: clampPitch(sun.altitude),
    zoom,
  }
}

export function cameraAngularDistance(
  target: HorizontalCoordinates,
  camera: StreetViewCamera,
): number {
  const horizontal = angularDifference(target.azimuth, camera.heading) *
    Math.cos(target.altitude * DEG_TO_RAD)
  const vertical = target.altitude - camera.pitch
  return Math.hypot(horizontal, vertical)
}

export function haversineDistance(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD
  const lat2 = b.lat * DEG_TO_RAD
  const deltaLat = (b.lat - a.lat) * DEG_TO_RAD
  const deltaLng = (b.lng - a.lng) * DEG_TO_RAD
  const h = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function destinationPoint(
  start: LatLng,
  distanceMeters: number,
  bearingDegrees: number,
): LatLng {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS
  const bearing = bearingDegrees * DEG_TO_RAD
  const lat1 = start.lat * DEG_TO_RAD
  const lng1 = start.lng * DEG_TO_RAD

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  )

  return {
    lat: lat2 * RAD_TO_DEG,
    lng: ((lng2 * RAD_TO_DEG + 540) % 360) - 180,
  }
}

/** Street View's documented relation between zoom level and horizontal field. */
export function horizontalFieldOfView(zoom: number): number {
  return 180 / 2 ** Math.max(0, zoom)
}

/**
 * Pixels subtended by an object of the given angular diameter at the centre of
 * the viewport.
 *
 * The Sun is half a degree across. In a 90°-wide panorama that is roughly one
 * pixel per hundred of viewport width — far smaller than people expect, which
 * is exactly why it is worth drawing honestly rather than at a flattering
 * fixed size.
 */
export function angularDiameterToPixels(
  angularDiameterDegrees: number,
  camera: Pick<StreetViewCamera, 'zoom'>,
  viewportWidth: number,
): number {
  const horizontalFov = horizontalFieldOfView(camera.zoom) * DEG_TO_RAD
  const halfFov = horizontalFov / 2
  const spread = 2 * Math.tan(halfFov)
  if (!Number.isFinite(spread) || spread <= 0) return 0
  const diameter = angularDiameterDegrees * DEG_TO_RAD
  const tangentNormalized = diameter / spread
  const angularNormalized = diameter / horizontalFov
  const wideAngleWeight = wideAngleProjectionWeight(horizontalFov)
  const normalized =
    tangentNormalized * (1 - wideAngleWeight) + angularNormalized * wideAngleWeight
  return Math.max(0, normalized * Math.max(0, viewportWidth))
}

/**
 * Projection of a horizontal sky direction into a Street View viewport.
 * Ordinary zooms use perspective coordinates; panoramic zooms transition to
 * angular coordinates. Returns normalized values with (0.5, 0.5) at center.
 */
export function horizontalToViewportPoint(
  target: HorizontalCoordinates,
  camera: StreetViewCamera,
  aspectRatio: number,
): { x: number; y: number; visible: boolean } {
  const azimuth = target.azimuth * DEG_TO_RAD
  const altitude = target.altitude * DEG_TO_RAD
  const heading = camera.heading * DEG_TO_RAD
  const pitch = camera.pitch * DEG_TO_RAD

  const targetVector = {
    x: Math.cos(altitude) * Math.sin(azimuth),
    y: Math.sin(altitude),
    z: Math.cos(altitude) * Math.cos(azimuth),
  }
  const forward = {
    x: Math.cos(pitch) * Math.sin(heading),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.cos(heading),
  }
  const right = { x: Math.cos(heading), y: 0, z: -Math.sin(heading) }
  const up = {
    x: -Math.sin(pitch) * Math.sin(heading),
    y: Math.cos(pitch),
    z: -Math.sin(pitch) * Math.cos(heading),
  }
  const dot = (a: typeof targetVector, b: typeof targetVector) =>
    a.x * b.x + a.y * b.y + a.z * b.z
  const depth = dot(targetVector, forward)
  const horizontal = dot(targetVector, right)
  const vertical = dot(targetVector, up)
  const horizontalFov = horizontalFieldOfView(camera.zoom) * DEG_TO_RAD
  const safeAspectRatio = Math.max(0.2, aspectRatio)
  const tangentVerticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) / safeAspectRatio)
  const angularVerticalFov = Math.min(Math.PI, horizontalFov / safeAspectRatio)
  const yaw = Math.atan2(horizontal, depth)
  const elevation = Math.atan2(vertical, Math.hypot(depth, horizontal))
  const angularX = 0.5 + yaw / horizontalFov
  const angularY = 0.5 - elevation / angularVerticalFov
  const wideAngleWeight = wideAngleProjectionWeight(horizontalFov)

  // Google allows fractional Street View zoom levels and often settles just
  // above zero when the user zooms all the way out. Near that 180° field of
  // view, a pinhole (tangent) projection becomes singular and collapses every
  // direction toward the centre. Blend into panoramic angular coordinates
  // above 120°; the normal/default zoom keeps the original tangent projection.
  let x = angularX
  let y = angularY
  if (wideAngleWeight < 1) {
    const tangentX = 0.5 + horizontal / (2 * depth * Math.tan(horizontalFov / 2))
    const tangentY = 0.5 - vertical / (2 * depth * Math.tan(tangentVerticalFov / 2))
    x = tangentX * (1 - wideAngleWeight) + angularX * wideAngleWeight
    y = tangentY * (1 - wideAngleWeight) + angularY * wideAngleWeight
  }

  return {
    x,
    y,
    visible: depth > 0 && x >= 0 && x <= 1 && y >= 0 && y <= 1,
  }
}
