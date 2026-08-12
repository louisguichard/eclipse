import type { TwilightGrade } from '../lib/twilight'

export type TwilightFilterProps = {
  grade: TwilightGrade
  /** Viewport-relative position of the Sun, used to anchor the halo. */
  sunPosition: {
    x: number
    y: number
  }
  /** Faded in with the playback rather than applied at rest. */
  active?: boolean
}

/**
 * The twilight treatment: a halo where the Sun sits, a cold wash from the
 * zenith, a warm band along the horizon and a vignette. CSS feathers every
 * layer out before Google's attribution row, which remains native.
 *
 * Purely decorative, so it never intercepts pointer events nor exposes itself
 * to assistive technology.
 *
 * The wrapper carries the fade: none of the layers below use `backdrop-filter`,
 * so making it a backdrop root costs nothing, and one opacity is far cheaper to
 * animate than five custom properties.
 */
export function TwilightFilter({ grade, sunPosition, active = true }: TwilightFilterProps) {
  return (
    <div
      className="twilight"
      aria-hidden="true"
      data-active={active}
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
