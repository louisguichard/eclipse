import type { LatLng } from '../types'
import { haversineDistance } from './geometry'

export type PanoramaPositionChange = 'duplicate' | 'programmatic' | 'user'

/**
 * Distinguishes a Street View lookup from a walk performed inside the scene.
 * Google emits the same `position_changed` event for both, so the origin has
 * to be recorded before calling `setPano`.
 */
export class PanoramaMovementTracker {
  private lastPano: string | null = null
  private lastPosition: LatLng | null = null
  private programmaticTarget: { pano: string; position: LatLng } | null = null
  private userTargetPano: string | null = null

  markProgrammatic(pano: string, position: LatLng): void {
    this.programmaticTarget = { pano, position }
    this.userTargetPano = null
  }

  markUserNavigation(pano: string): void {
    this.userTargetPano = pano
  }

  remember(position: LatLng, pano: string | null = null): void {
    this.lastPano = pano
    this.lastPosition = position
    this.programmaticTarget = null
    this.userTargetPano = null
  }

  observe(pano: string | null, position: LatLng): PanoramaPositionChange {
    const userNavigation = this.userTargetPano != null && this.userTargetPano === pano
    if (userNavigation) {
      this.lastPano = pano
      this.lastPosition = position
      this.programmaticTarget = null
      this.userTargetPano = null
      return 'user'
    }

    const programmaticTarget = this.programmaticTarget
    if (programmaticTarget) {
      const reachedTarget = pano === programmaticTarget.pano || (
        pano == null && haversineDistance(programmaticTarget.position, position) < 2
      )

      // Google may emit a stale position from the previous panorama while
      // `setPano` is installing a lookup result. Keep the guard armed until
      // the requested panorama itself is observed; neither event is a walk.
      if (!reachedTarget) return 'programmatic'

      this.lastPano = pano ?? programmaticTarget.pano
      this.lastPosition = position
      this.programmaticTarget = null
      return 'programmatic'
    }

    // A panorama has one fixed capture position. Google can nevertheless
    // report that position more than once with slightly different precision;
    // the pano id is therefore the authoritative duplicate signal.
    const duplicatePano = pano != null && this.lastPano === pano
    const duplicatePosition = this.lastPosition != null &&
      haversineDistance(this.lastPosition, position) < 0.5

    this.lastPano = pano
    this.lastPosition = position

    const duplicate = duplicatePano || duplicatePosition
    if (duplicate) return 'duplicate'

    return 'user'
  }
}
