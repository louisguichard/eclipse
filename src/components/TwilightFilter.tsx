import type { TwilightGrade } from '../lib/twilight'

export type TwilightFilterProps = {
  grade: TwilightGrade
  /** Viewport-relative position of the Sun, used to anchor the halo. */
  sunPosition: {
    x: number
    y: number
  }
}

/**
 * The twilight treatment: a halo where the Sun sits, a cold wash from the
 * zenith, a warm band along the horizon and a vignette. CSS feathers every
 * layer out before Google's attribution row, which remains native.
 *
 * Purely decorative, so it never intercepts pointer events nor exposes itself
 * to assistive technology.
 */
export function TwilightFilter({ grade, sunPosition }: TwilightFilterProps) {
  return (
    <div
      className="twilight"
      aria-hidden="true"
      style={{
        '--twilight-ember': grade.emberOpacity,
        '--twilight-night': grade.nightOpacity,
        '--twilight-shade': grade.shadeOpacity,
        '--twilight-vignette': grade.vignetteOpacity,
        '--twilight-glow': grade.glowOpacity,
        '--twilight-sun-x': `${(sunPosition.x * 100).toFixed(2)}%`,
        '--twilight-sun-y': `${(sunPosition.y * 100).toFixed(2)}%`,
      } as React.CSSProperties}
    >
      <div className="twilight__glow" />
      <div className="twilight__night" />
      <div className="twilight__shade" />
      <div className="twilight__ember" />
      <div className="twilight__vignette" />
      <div className="twilight__grain" />
    </div>
  )
}
