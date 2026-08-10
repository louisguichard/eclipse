import type { EclipseSnapshot } from '../types'

export type SunDiscProps = {
  snapshot: EclipseSnapshot
  className?: string
}

/**
 * How far the lunar disc travels, as a fraction of the badge, per unit of
 * angular offset in solar radii. Deliberately below the true geometry so the
 * Moon stays inside the badge at first and last contact instead of sliding
 * out of it — the badge reads the phase, it does not measure it.
 */
const OFFSET_FRACTION_PER_SOLAR_RADIUS = 15.5 / 46

/**
 * The phase badge: a solar disc with the Moon riding across it. Sized entirely
 * by CSS — the offsets are percentages of the badge, so the same component
 * serves the 46 px desktop card and the 30 px phone summary.
 */
export function SunDisc({ snapshot, className = 'readout__disc' }: SunDiscProps) {
  const radius = Math.max(snapshot.sunAngularRadius, 0.0001)
  const travel = (OFFSET_FRACTION_PER_SOLAR_RADIUS / radius) * 100

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        '--moon-x': `${snapshot.moonOffset.horizontal * travel}%`,
        '--moon-y': `${-snapshot.moonOffset.vertical * travel}%`,
        '--moon-scale': snapshot.moonAngularRadius / radius,
      } as React.CSSProperties}
    >
      <i />
    </span>
  )
}
