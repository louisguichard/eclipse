import {
  ArrowUp,
  ChevronUp,
  Crosshair,
  Expand,
  LoaderCircle,
  MapPin,
  Minimize,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { STREET_VIEW } from '../config/eclipse'
import {
  azimuthToCompass,
  formatDegrees,
  formatDistance,
  formatParisDateTime,
  formatPercent,
} from '../lib/format'
import {
  angularDiameterToPixels,
  angularDifference,
  horizontalFieldOfView,
  horizontalToViewportPoint,
} from '../lib/geometry'
import { gradeTwilight } from '../lib/twilight'
import type { EclipseSnapshot, LatLng, ObserverLocation, PanoramaState } from '../types'
import { useStreetView } from '../hooks/useStreetView'
import type { StreetViewStep } from '../hooks/useStreetView'
import { EclipseOverlay } from './EclipseOverlay'
import { TwilightFilter } from './TwilightFilter'

export type StreetViewProps = {
  observer: ObserverLocation
  snapshot: EclipseSnapshot
  active: boolean
  expanded: boolean
  cloudCover?: number | null
  onExpandedChange: (value: boolean) => void
  onPanoramaStateChange?: (state: PanoramaState) => void
  onUserPositionChange?: (position: LatLng) => void
  debug?: boolean
}

type ProjectedSun = {
  edgeCue: {
    angle: number
    x: number
    y: number
  } | null
  point: {
    visible: boolean
    x: number
    y: number
  }
}

const DEG_TO_RAD = Math.PI / 180

function edgeIntersection(
  directionX: number,
  directionY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  // The cue is a compact pill rather than a point; keep its full label inside
  // narrow phone viewports while still indicating the correct edge.
  const horizontalInset = Math.min(80, width * 0.23) / width
  const topInset = Math.min(76, height * 0.3) / height
  const bottomInset = Math.min(68, height * 0.3) / height
  const bounds = {
    bottom: 1 - bottomInset,
    left: horizontalInset,
    right: 1 - horizontalInset,
    top: topInset,
  }
  const scales: number[] = []

  if (directionX > 0) scales.push((bounds.right - 0.5) / directionX)
  if (directionX < 0) scales.push((bounds.left - 0.5) / directionX)
  if (directionY > 0) scales.push((bounds.bottom - 0.5) / directionY)
  if (directionY < 0) scales.push((bounds.top - 0.5) / directionY)
  const scale = Math.min(...scales.filter((value) => value >= 0 && Number.isFinite(value)))

  return {
    x: Math.max(bounds.left, Math.min(bounds.right, 0.5 + directionX * scale)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, 0.5 + directionY * scale)),
  }
}

function projectSunIntoStreetView(
  snapshot: EclipseSnapshot,
  camera: { heading: number; pitch: number; zoom: number },
  viewport: { height: number; width: number },
): ProjectedSun {
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)
  const point = horizontalToViewportPoint(snapshot.sun, camera, width / height)
  if (point.visible) return { edgeCue: null, point }

  const yaw = angularDifference(snapshot.sun.azimuth, camera.heading)
  const yawRadians = yaw * DEG_TO_RAD
  const pitchDeltaRadians = (snapshot.sun.altitude - camera.pitch) * DEG_TO_RAD
  const depth =
    Math.sin(snapshot.sun.altitude * DEG_TO_RAD) * Math.sin(camera.pitch * DEG_TO_RAD) +
    Math.cos(snapshot.sun.altitude * DEG_TO_RAD) * Math.cos(camera.pitch * DEG_TO_RAD) *
      Math.cos(yawRadians)

  let directionX: number
  let directionY: number
  if (depth > 0 && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    directionX = point.x - 0.5
    directionY = point.y - 0.5
  } else {
    directionX = Math.sin(yawRadians)
    directionY = -Math.sin(pitchDeltaRadians)
    if (Math.abs(yaw) > 90 && Math.abs(directionX) < 0.12) {
      directionX = yaw >= 0 ? 0.8 : -0.8
    }
  }

  if (Math.hypot(directionX, directionY) < 0.001) directionY = -1
  const edge = edgeIntersection(directionX, directionY, width, height)
  return {
    point: {
      visible: false,
      x: Number.isFinite(point.x) ? point.x : 0.5,
      y: Number.isFinite(point.y) ? point.y : 0.5,
    },
    edgeCue: {
      ...edge,
      angle: Math.atan2(directionY, directionX) / DEG_TO_RAD,
    },
  }
}

/** Beyond this yaw a link is pinned to the edge instead of being projected. */
const NAVIGATION_PROJECT_LIMIT = 55
const NAVIGATION_EDGE = { left: 0.07, right: 0.93 }

type NavigationStep = StreetViewStep & {
  x: number
  yaw: number
  /** Stacking index for links that pile up on the same edge. */
  row: number
}

/**
 * Places the walkable links across the viewport with the same tangent
 * projection as the Sun, so an arrow sits where its street actually runs.
 *
 * Links well off to the side are pinned to the nearest edge rather than
 * dropped: the camera looks at the Sun, not down the street, so most of the
 * time every link would otherwise be out of frame and the view would look
 * like a dead end.
 */
function projectNavigationSteps(
  links: StreetViewStep[],
  camera: { heading: number; zoom: number },
): NavigationStep[] {
  const halfFov = (horizontalFieldOfView(camera.zoom) / 2) * DEG_TO_RAD
  const spread = Math.tan(halfFov)
  if (!Number.isFinite(spread) || spread <= 0) return []

  const edgeRows = { left: 0, right: 0 }
  return links.map((link) => {
    const yaw = angularDifference(link.heading, camera.heading)
    if (Math.abs(yaw) <= NAVIGATION_PROJECT_LIMIT) {
      const projected = 0.5 + Math.tan(yaw * DEG_TO_RAD) / (2 * spread)
      const x = Math.min(NAVIGATION_EDGE.right, Math.max(NAVIGATION_EDGE.left, projected))
      if (x > NAVIGATION_EDGE.left && x < NAVIGATION_EDGE.right) {
        return { ...link, x, yaw, row: 0 }
      }
    }
    const side = yaw >= 0 ? 'right' : 'left'
    const row = edgeRows[side]
    edgeRows[side] += 1
    return { ...link, x: NAVIGATION_EDGE[side], yaw, row }
  })
}

function DemoBackdrop({ filter }: { filter: string }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_68%_33%,rgba(245,158,11,0.16),transparent_28%),linear-gradient(180deg,#122445_0%,#203a55_54%,#111c27_55%,#07101b_100%)]"
      style={{ filter }}
    >
      <div className="absolute inset-x-0 bottom-0 h-[43%] opacity-80">
        <div className="absolute bottom-0 left-[-5%] h-[72%] w-[29%] bg-[#07111b] [clip-path:polygon(0_18%,35%_18%,35%_6%,60%_6%,60%_30%,100%_30%,100%_100%,0_100%)]" />
        <div className="absolute bottom-0 left-[22%] h-[56%] w-[31%] bg-[#091521] [clip-path:polygon(0_30%,18%_30%,18%_10%,40%_10%,40%_22%,68%_22%,68%_0,84%_0,84%_34%,100%_34%,100%_100%,0_100%)]" />
        <div className="absolute bottom-0 right-[-3%] h-[68%] w-[52%] bg-[#06101a] [clip-path:polygon(0_35%,18%_35%,18%_18%,39%_18%,39%_27%,58%_27%,58%_7%,77%_7%,77%_21%,100%_21%,100%_100%,0_100%)]" />
      </div>
      <div className="absolute inset-x-0 bottom-[10%] h-px bg-white/10" />
      <div className="demo-street-card absolute left-3 top-3 max-w-[11rem] rounded-2xl border border-white/10 bg-slate-950/55 p-2.5 text-left text-white shadow-xl backdrop-blur-xl sm:left-5 sm:top-5 sm:max-w-[16rem] sm:p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Mode aperçu</p>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-200 sm:text-xs">
          Ajoutez <code className="font-mono text-[11px] text-white">VITE_GOOGLE_MAPS_API_KEY</code> pour remplacer ce décor par Street View.
        </p>
      </div>
    </div>
  )
}

function confidencePresentation(distanceMeters: number | null) {
  if (distanceMeters == null) {
    return { label: 'Panorama à confirmer', className: 'scene-note--muted' }
  }
  if (distanceMeters <= STREET_VIEW.confidenceDistanceMeters) {
    return { label: `Panorama · ${formatDistance(distanceMeters)}`, className: 'scene-note--ok' }
  }
  return {
    label: `Vue décalée de ${formatDistance(distanceMeters)}`,
    className: 'scene-note--warn',
  }
}

function StateMessage({ state }: { state: PanoramaState }) {
  const loading = state.status === 'loading' || state.status === 'idle'
  const Icon = loading ? LoaderCircle : TriangleAlert
  return (
    <div className="scene-state">
      <div className="scene-state__card">
        <Icon
          aria-hidden="true"
          size={26}
          strokeWidth={1.6}
          className={loading ? 'scene-state__icon scene-state__icon--spin' : 'scene-state__icon'}
        />
        <strong>{loading ? 'Recherche de la vue réelle…' : 'Vue réelle indisponible'}</strong>
        <p>{state.message ?? 'Essayez un autre point d’observation.'}</p>
      </div>
    </div>
  )
}

export function StreetView({
  observer,
  snapshot,
  active,
  expanded,
  cloudCover = null,
  onExpandedChange,
  onPanoramaStateChange,
  onUserPositionChange,
  debug = false,
}: StreetViewProps) {
  const {
    camera,
    centered,
    containerRef,
    links,
    moveTo,
    panoramaState,
    recenter,
    viewportSize,
  } = useStreetView(observer, snapshot, active, onUserPositionChange)
  const demo = panoramaState.status === 'demo'
  const ready = panoramaState.status === 'ready'
  const showStateMessage = !demo && !ready
  const confidence = confidencePresentation(panoramaState.distanceMeters)
  const showConfidenceWarning =
    panoramaState.distanceMeters != null &&
    panoramaState.distanceMeters > STREET_VIEW.confidenceDistanceMeters
  const projectedSun = useMemo(
    () => projectSunIntoStreetView(snapshot, camera, viewportSize),
    [camera, snapshot, viewportSize],
  )
  const twilight = useMemo(() => gradeTwilight(snapshot), [snapshot])
  const eclipseVeilOpacity = Math.min(
    0.62,
    (snapshot.obscuration / Math.max(snapshot.circumstances.peakObscuration, 0.0001)) * 0.62,
  )
  const sunPosition = demo ? { x: 0.5, y: 0.5 } : projectedSun.point
  const sunDiameterPixels = Math.max(
    STREET_VIEW.sunMinimumPixels,
    angularDiameterToPixels(snapshot.sunAngularRadius * 2, camera, viewportSize.width) *
      STREET_VIEW.sunRenderScale,
  )
  const navigationSteps = useMemo(
    () => (ready ? projectNavigationSteps(links, camera) : []),
    [camera, links, ready],
  )

  useEffect(() => {
    onPanoramaStateChange?.(panoramaState)
  }, [onPanoramaStateChange, panoramaState])

  return (
    <section
      aria-label="Vue réelle orientée vers l’éclipse"
      aria-hidden={!active}
      className="street-scene"
      data-active={active}
    >
      <div
        className="street-scene__stage"
      >
        <div
          ref={containerRef}
          className="street-scene__panorama"
          aria-label="Panorama Google Street View"
          style={{
            visibility: demo ? 'hidden' : 'visible',
          }}
        />

        {demo && <DemoBackdrop filter={twilight.panoramaFilter} />}
        {showStateMessage && <StateMessage state={panoramaState} />}

        {(ready || demo) && <TwilightFilter grade={twilight} sunPosition={sunPosition} />}

        {(ready || demo) && (
          <>
            <div
              className="mobile-eclipse-veil"
              aria-hidden="true"
              style={{ opacity: eclipseVeilOpacity }}
            />
            <div className="mobile-photo-gradients" aria-hidden="true" />
          </>
        )}

        {(ready || demo) && (
          <EclipseOverlay
            snapshot={snapshot}
            expanded={expanded}
            diameterPixels={sunDiameterPixels}
            position={sunPosition}
            visible={demo || projectedSun.point.visible}
            demo={demo}
            cloudCover={cloudCover}
          />
        )}

        {ready && projectedSun.edgeCue && (
          <button
            type="button"
            onClick={recenter}
            aria-label="L’éclipse est hors champ. Recentrer la vue."
            className="scene-cue"
            style={{
              left: `${projectedSun.edgeCue.x * 100}%`,
              top: `${projectedSun.edgeCue.y * 100}%`,
            }}
          >
            <ArrowUp
              aria-hidden="true"
              size={13}
              style={{ transform: `rotate(${projectedSun.edgeCue.angle + 90}deg)` }}
            />
            Hors champ
          </button>
        )}

        {ready && showConfidenceWarning && (
          <div className={`scene-note ${confidence.className}`}>
            <MapPin aria-hidden="true" size={12} />
            {confidence.label}
          </div>
        )}

        {navigationSteps.length > 0 && (
          <nav className="street-nav" aria-label="Se déplacer dans la vue">
            {navigationSteps.map((step) => (
              <button
                key={step.pano}
                type="button"
                className="street-nav__step"
                style={{ left: `${step.x * 100}%`, bottom: `${step.row * 56}px` }}
                onClick={() => moveTo(step.pano)}
                // Both ends of a street share its name, so the bearing is what
                // actually tells the two arrows apart.
                title={`${step.description} · vers le ${azimuthToCompass(step.heading).toLowerCase()}`}
                aria-label={`Avancer sur ${step.description} vers le ${azimuthToCompass(step.heading).toLowerCase()}`}
              >
                <ChevronUp
                  aria-hidden="true"
                  size={20}
                  style={{ transform: `rotate(${step.yaw.toFixed(1)}deg)` }}
                />
              </button>
            ))}
          </nav>
        )}

        <div className="scene-controls">
          <button
            type="button"
            role="switch"
            aria-checked={expanded}
            aria-label={expanded ? 'Revenir au Soleil à l’échelle' : 'Agrandir le Soleil simulé'}
            title={expanded ? 'Soleil à l’échelle' : 'Agrandir le Soleil'}
            onClick={() => onExpandedChange(!expanded)}
            className="scene-control"
          >
            {expanded ? <Minimize aria-hidden="true" size={17} /> : <Expand aria-hidden="true" size={17} />}
          </button>
          <button
            type="button"
            onClick={recenter}
            disabled={!ready}
            aria-label="Recentrer la vue sur le Soleil"
            title="Recentrer sur le Soleil"
            className={`scene-control ${centered ? '' : 'scene-control--alert'}`}
          >
            <Crosshair aria-hidden="true" size={17} />
          </button>
        </div>

        {debug && (
          <dl className="absolute bottom-36 left-3 z-30 grid max-w-[19rem] grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl border border-cyan-300/25 bg-slate-950/85 p-2.5 font-mono text-[9px] leading-tight text-cyan-50 shadow-2xl backdrop-blur-lg">
            <dt className="text-cyan-300">OBS</dt><dd>{observer.lat.toFixed(6)}, {observer.lng.toFixed(6)}</dd>
            <dt className="text-cyan-300">PANO</dt><dd>{panoramaState.position ? `${panoramaState.position.lat.toFixed(6)}, ${panoramaState.position.lng.toFixed(6)}` : '—'}</dd>
            <dt className="text-cyan-300">DIST</dt><dd>{formatDistance(panoramaState.distanceMeters)}</dd>
            <dt className="text-cyan-300">SOLEIL</dt><dd>az {formatDegrees(snapshot.sun.azimuth, 2)} · alt {formatDegrees(snapshot.sun.altitude, 2)}</dd>
            <dt className="text-cyan-300">POV</dt><dd>h {formatDegrees(camera.heading, 2)} · p {formatDegrees(camera.pitch, 2)} · z {camera.zoom.toFixed(1)}</dd>
            <dt className="text-cyan-300">ÉCRAN</dt><dd>x {(projectedSun.point.x * 100).toFixed(1)} % · y {(projectedSun.point.y * 100).toFixed(1)} % · {projectedSun.point.visible ? 'visible' : 'hors champ'} · {centered ? 'centré' : 'déplacé'}</dd>
            <dt className="text-cyan-300">ÉCLIPSE</dt><dd>{formatPercent(snapshot.obscuration, 2)}</dd>
            <dt className="text-cyan-300">UTC</dt><dd>{snapshot.date.toISOString()}</dd>
            <dt className="text-cyan-300">PARIS</dt><dd>{formatParisDateTime(snapshot.date)}</dd>
          </dl>
        )}
      </div>
    </section>
  )
}
