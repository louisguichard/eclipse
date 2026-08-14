export const ECLIPSE_DATE_LABEL = 'Lundi 2 août 2027'
export const ECLIPSE_GLOBAL_PEAK_UTC = new Date('2027-08-02T10:06:34.636Z')

export const TIMELINE = {
  /** Minute zero stays just before first contact in Paris. */
  startUtc: new Date('2027-08-02T08:00:00.000Z'),
  endUtc: new Date('2027-08-02T13:00:00.000Z'),
  rangeStartUtc: new Date('2027-08-02T07:00:00.000Z'),
  minMinute: -60,
  maxMinute: 300,
  totalMinutes: 360,
  defaultMinute: 61,
  /** About 1.1 simulated minutes every 68 ms, shared by both timelines. */
  playMinutesPerSecond: 1.1 / 0.068,
} as const

export const PARIS_REFERENCE = {
  beginMinute: 1,
  maximumMinute: 61,
  endMinute: 125,
  obscuration: 0.512,
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
