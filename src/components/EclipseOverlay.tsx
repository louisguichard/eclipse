import { Cloud } from 'lucide-react'
import { useId } from 'react'
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
  demo?: boolean
  cloudCover?: number | null
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
  demo = false,
  cloudCover = null,
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
  const mobileTravel = (15.5 / 46 / Math.max(snapshot.sunAngularRadius, 0.0001)) * 100
  const eclipseRatio = Math.min(
    1,
    snapshot.obscuration / Math.max(snapshot.circumstances.peakObscuration, 0.0001),
  )
  const glow = 0.25 + (1 - eclipseRatio) * 0.75
  const calloutSide = position.x > 0.6 ? 'left' : 'right'

  return (
    <div
      aria-hidden={!visible}
      aria-label={`Position simulée du Soleil, éclipse occultée à ${Math.round(snapshot.obscuration * 100)} %`}
      className="sun-marker"
      data-visible={visible}
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
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
          <strong>{Math.round(snapshot.obscuration * 100)} %</strong>
          <span>Du Soleil caché</span>
          <span className="sun-marker__mobile-clouds">
            <Cloud size={13} strokeWidth={1.6} />
            <b>{cloudCover == null ? '—' : `${Math.round(cloudCover)} %`}</b>
            <span>Nuages</span>
          </span>
        </span>
      </div>

      <span className="sun-marker__label">
        {belowHorizon ? 'Sous l’horizon' : 'Le Soleil'}
        {demo ? ' · aperçu' : ''}
      </span>
    </div>
  )
}
