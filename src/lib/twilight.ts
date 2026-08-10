import type { EclipseSnapshot } from '../types'

/**
 * Street View panoramas are shot in flat daylight. The eclipse of 12 August
 * 2026 is a low-sun event over France, so the real scene will look nothing
 * like the stored photograph: warm and raking near the horizon, then rapidly
 * colder and dimmer as the Moon eats the disc.
 *
 * `gradeTwilight` turns a snapshot into the handful of numbers the overlay
 * needs to reproduce that. Everything is derived, never toggled by hand, so
 * scrubbing the timeline grades the scene continuously.
 */
export type TwilightGrade = {
  /** 0 = untouched daylight, 1 = deepest eclipse dusk. */
  intensity: number
  /** Low-sun factor: golden hour through blue hour. */
  dusk: number
  /** Perceived darkening from occultation — deliberately not linear. */
  shadow: number
  /**
   * Tonal filter used only by the app-owned fallback illustration. Live
   * Street View content stays native; its atmosphere comes from separate,
   * feathered overlays.
   */
  panoramaFilter: string
  /** Warm band hugging the horizon. */
  emberOpacity: number
  /** Cold wash falling from the zenith. */
  nightOpacity: number
  /** Neutral full-frame dimming that carries the eclipse dusk into the scene. */
  shadeOpacity: number
  /** Corner darkening. */
  vignetteOpacity: number
  /** Halo around the projected Sun; fades as the crescent thins. */
  glowOpacity: number
}

const HORIZON_ALTITUDE = -0.833

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Two decimals, not more. Playback re-grades the scene on every animation
 * frame; quantising here means the filter string and the layer opacities stay
 * byte-identical between most frames, so React leaves the DOM alone and the
 * compositor is not asked to rebuild a full-screen filtered layer at 60 Hz.
 * The steps are far below what the eye resolves.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Sunlight does not visibly fade in step with the occulted fraction: the solar
 * disc stays bright enough to flatten the scene until roughly 80 % is covered,
 * and only then does the landscape drop away. The exponent reproduces that
 * late collapse — 50 % occultation reads as a barely-there dimming, 92 % as
 * a distinct dusk.
 */
function perceivedShadow(obscuration: number): number {
  return clamp01(obscuration) ** 2.4
}

/** 18° above the horizon is still plain daylight; −6° is full civil dusk. */
function duskFactor(altitudeDegrees: number): number {
  return clamp01((18 - altitudeDegrees) / 24)
}

export function gradeTwilight(snapshot: EclipseSnapshot): TwilightGrade {
  const dusk = duskFactor(snapshot.sun.altitude)
  const shadow = perceivedShadow(snapshot.obscuration)
  const belowHorizon = snapshot.sun.altitude < HORIZON_ALTITUDE
  const intensity = clamp01(dusk * 0.55 + shadow * 0.85)

  // An eclipse desaturates (the eye switches toward rod vision) while a low Sun
  // does the opposite, so the two pull against each other.
  const saturation = clamp01(1 - shadow * 0.34 + dusk * 0.22)
  const brightness = 1 - intensity * 0.46
  const contrast = 1 + intensity * 0.1
  const warmth = dusk * 0.2 * (1 - shadow * 0.6)

  return {
    intensity: round(intensity),
    dusk: round(dusk),
    shadow: round(shadow),
    panoramaFilter: [
      `brightness(${round(brightness)})`,
      `saturate(${round(saturation)})`,
      `contrast(${round(contrast)})`,
      `sepia(${round(warmth)})`,
      `hue-rotate(${round(-8 * shadow)}deg)`,
    ].join(' '),
    // Near maximum, Paris combines a low Sun with a very deep partial eclipse.
    // Let both effects reinforce the amber horizon, while the blue wash and
    // vignette carry the extra loss of daylight. These layers are used only by
    // the app-owned desktop treatment; live Google imagery remains unfiltered.
    emberOpacity: round(clamp01(dusk * 0.7 + shadow * 0.29) * (belowHorizon ? 0.45 : 1)),
    nightOpacity: round(clamp01(intensity * 0.77 + (belowHorizon ? 0.2 : 0))),
    shadeOpacity: round(clamp01(intensity * 0.36 + shadow * 0.05)),
    vignetteOpacity: round(0.26 + intensity * 0.41),
    glowOpacity: round(
      belowHorizon ? 0 : clamp01((1 - clamp01(snapshot.obscuration) * 0.6) * (0.32 + dusk * 0.45)),
    ),
  }
}
