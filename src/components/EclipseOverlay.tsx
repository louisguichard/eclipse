import { useId } from 'react'
import { formatObscuration } from '../lib/format'
import type { EclipseSnapshot } from '../types'

export type EclipseOverlayProps = {
  snapshot: EclipseSnapshot
  expanded: boolean
  /** Screen diameter of the solar disc, in pixels, at the unmagnified size. */
  diameterPixels: number
  position: {
    x: number
    y: number
  }
  visible: boolean
  /** Position is also updated imperatively from the panorama render loop. */
  synchronizedPosition?: boolean
  demo?: boolean
}

/** The SVG draws the Sun at r=70 inside a 200-unit box. */
const DISC_FILL_RATIO = 140 / 200
const MAGNIFICATION = 12
const MAGNIFIED_RANGE = { min: 44, max: 132 }

export function EclipseOverlay({
  snapshot,
  expanded,
  diameterPixels,
  position,
  visible,
  synchronizedPosition = false,
  demo = false,
}: EclipseOverlayProps) {
  const rawId = useId()
  const clipId = `eclipse-sun-${rawId.replaceAll(':', '')}`
  const scale = 70 / Math.max(snapshot.sunAngularRadius, 0.0001)
  const moonRadius = Math.max(0, snapshot.moonAngularRadius * scale)
  const moonX = 100 + snapshot.moonOffset.horizontal * scale
  const moonY = 100 - snapshot.moonOffset.vertical * scale
  // Unmagnified, the Sun is a handful of pixels across — that is very nearly
  // what half a degree looks like. The magnified mode exists to inspect the
  // crescent, not to correct the scale.
  const boxSize = Math.max(3, diameterPixels / DISC_FILL_RATIO)
  const diskSize = expanded
    ? Math.min(MAGNIFIED_RANGE.max, Math.max(MAGNIFIED_RANGE.min, boxSize * MAGNIFICATION))
    : Math.max(32, boxSize)
  const belowHorizon = snapshot.sun.altitude < -0.833
  const mobileTravel = (0.5 / Math.max(snapshot.sunAngularRadius, 0.0001)) * 100
  const eclipseRatio = Math.min(
    1,
    snapshot.obscuration / Math.max(snapshot.circumstances.peakObscuration, 0.0001),
  )
  const glow = 0.25 + (1 - eclipseRatio) * 0.75
  // On mobile the callout runs about 190px past the marker — more than half a
  // 375px screen. Flipping at the midpoint is what keeps "du Soleil caché" from
  // being sliced off the right edge on the narrowest phones.
  const calloutSide = position.x > 0.5 ? 'left' : 'right'
  const fallbackLeft = `${position.x * 100}%`
  const fallbackTop = `${position.y * 100}%`

  return (
    <div
      aria-hidden={!visible}
      aria-label={`Position simulée du Soleil, éclipse occultée à ${formatObscuration(snapshot.obscuration)}`}
      className="sun-marker"
      data-visible={visible}
      style={{
        left: synchronizedPosition ? `var(--street-sun-x, ${fallbackLeft})` : fallbackLeft,
        top: synchronizedPosition ? `var(--street-sun-y, ${fallbackTop})` : fallbackTop,
        opacity: visible ? (belowHorizon ? 0.58 : 1) : 0,
        transform: `translate(-50%, -50%) scale(${visible ? 1 : 0.86})`,
        '--mobile-moon-x': `${snapshot.moonOffset.horizontal * mobileTravel}%`,
        '--mobile-moon-y': `${-snapshot.moonOffset.vertical * mobileTravel}%`,
        '--mobile-moon-scale': snapshot.moonAngularRadius / Math.max(snapshot.sunAngularRadius, 0.0001),
        '--mobile-glow-blur': `${24 * 1.1 * glow}px`,
        '--mobile-glow-alpha': 0.9 * glow,
      } as React.CSSProperties}
      data-callout-side={calloutSide}
    >
      <div className="sun-marker__reticle" aria-hidden="true">
        <span className="sun-marker__tick sun-marker__tick--n" />
        <span className="sun-marker__tick sun-marker__tick--s" />
        <span className="sun-marker__tick sun-marker__tick--w" />
        <span className="sun-marker__tick sun-marker__tick--e" />
        <span className="sun-marker__ring" />

        <svg
          viewBox="0 0 200 200"
          width={diskSize}
          height={diskSize}
          className="sun-marker__disc"
          role="img"
        >
          <defs>
            <clipPath id={clipId}>
              <circle cx="100" cy="100" r="70" />
            </clipPath>
            <radialGradient id={`${clipId}-sun`} cx="45%" cy="40%">
              <stop offset="0" stopColor="#fff7cf" />
              <stop offset="0.62" stopColor="#ffd46a" />
              <stop offset="1" stopColor="#f6a821" />
            </radialGradient>
          </defs>
          <circle
            cx="100"
            cy="100"
            r="70"
            fill={`url(#${clipId}-sun)`}
            opacity={belowHorizon ? 0.72 : 1}
          />
          <circle
            cx={moonX}
            cy={moonY}
            r={moonRadius}
            fill="#07101f"
            stroke="rgba(192, 213, 234, 0.22)"
            strokeWidth="1.2"
            clipPath={`url(#${clipId})`}
          />
        </svg>
      </div>

      <div className="sun-marker__mobile-observation" aria-hidden="true">
        <span className="sun-marker__mobile-target">
          <span className="sun-marker__mobile-disc"><i /></span>
        </span>
        <span className="sun-marker__mobile-line" />
        <span className="sun-marker__mobile-figures">
          <strong>{formatObscuration(snapshot.obscuration)}</strong>
          <span>Du Soleil caché</span>
        </span>
      </div>

      <span className="sun-marker__label">
        {belowHorizon ? 'Sous l’horizon' : 'Le Soleil'}
        {demo ? ' · aperçu' : ''}
      </span>
    </div>
  )
}
