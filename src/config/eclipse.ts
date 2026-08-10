export const ECLIPSE_DATE_LABEL = 'Mercredi 12 août 2026'
export const ECLIPSE_GLOBAL_PEAK_UTC = new Date('2026-08-12T17:45:53.800Z')

export const TIMELINE = {
  /**
   * Minute zero is kept at the original Paris-oriented epoch so existing
   * shared links such as `?time=62` still point to the same instant.
   */
  startUtc: new Date('2026-08-12T17:15:00.000Z'),
  endUtc: new Date('2026-08-12T20:00:00.000Z'),
  rangeStartUtc: new Date('2026-08-12T15:30:00.000Z'),
  minMinute: -105,
  maxMinute: 165,
  totalMinutes: 270,
  defaultMinute: 62,
  /** About 1.1 simulated minutes every 68 ms, shared by both timelines. */
  playMinutesPerSecond: 1.1 / 0.068,
} as const

export const PARIS_REFERENCE = {
  beginMinute: 7,
  maximumMinute: 62,
  endMinute: 114,
  obscuration: 0.92,
} as const

export const STREET_VIEW = {
  zoom: 1,
  searchRadiiMeters: [25, 50, 100, 250, 500, 1000],
  confidenceDistanceMeters: 30,
  centeredToleranceDegrees: 1.25,
  /**
   * The solar disc is drawn slightly above its true angular size. Half a
   * degree is geometrically correct but perceptually smaller than the Sun
   * reads to the naked eye — the retina does not resolve a marker the way a
   * screenshot does — and at true size the crescent is impossible to make out.
   */
  sunRenderScale: 1.5,
  /**
   * Floor for that disc, in pixels. A narrow phone viewport carries the same
   * field of view across far fewer pixels, so the honest projection collapses
   * to two or three pixels there; below this the marker stops reading as the
   * Sun at all.
   */
  sunMinimumPixels: 9,
} as const

export const SUN_RADIUS_KM = 695_700
export const MOON_POLAR_RADIUS_KM = 1_736
