import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { STREET_VIEW } from '../config/eclipse'
import { useStreetViewEmbed } from '../hooks/useStreetViewEmbed'
import { angularDiameterToPixels, horizontalToViewportPoint } from '../lib/geometry'
import type { EclipseSnapshot, ObserverLocation, PanoramaState } from '../types'
import { EclipseOverlay } from './EclipseOverlay'

export type StreetViewProps = {
  observer: ObserverLocation
  snapshot: EclipseSnapshot
  active: boolean
  cloudCover?: number | null
}

function StateMessage({
  state,
  onRetry,
}: {
  state: PanoramaState
  onRetry: () => void
}) {
  const loading = state.status === 'loading' || state.status === 'idle'
  const Icon = loading ? LoaderCircle : TriangleAlert

  return (
    <div className="scene-state" role={loading ? 'status' : 'alert'} aria-live="polite">
      <div className="scene-state__card">
        <Icon
          aria-hidden="true"
          size={26}
          strokeWidth={1.6}
          className={loading ? 'scene-state__icon scene-state__icon--spin' : 'scene-state__icon'}
        />
        <strong>{loading ? 'Chargement de Street View Embed…' : 'Street View Embed indisponible'}</strong>
        <p>{state.message ?? 'Vérifiez la clé Maps Embed API et ses restrictions.'}</p>
        {!loading && state.status !== 'demo' && (
          <div className="scene-state__actions">
            <button type="button" onClick={onRetry}>Réessayer</button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Maps Embed is the only Street View provider. The parent draws the calculated
 * Sun marker but never loads a paid Maps JavaScript panorama. Since Embed does
 * not expose camera events, its known initial camera stays locked so the marker
 * cannot silently become inaccurate.
 */
export function StreetView({
  observer,
  snapshot,
  active,
  cloudCover = null,
}: StreetViewProps) {
  const embedView = useStreetViewEmbed(observer, snapshot)
  const ready = embedView.panoramaState.status === 'ready'
  const projectedSun = useMemo(() => horizontalToViewportPoint(
    snapshot.sun,
    embedView.camera,
    Math.max(1, embedView.viewportSize.width) / Math.max(1, embedView.viewportSize.height),
  ), [embedView.camera, embedView.viewportSize.height, embedView.viewportSize.width, snapshot.sun])
  const sunDiameterPixels = Math.max(
    STREET_VIEW.sunMinimumPixels,
    angularDiameterToPixels(
      snapshot.sunAngularRadius * 2,
      embedView.camera,
      Math.max(1, embedView.viewportSize.width),
    ) * STREET_VIEW.sunRenderScale,
  )

  return (
    <section
      aria-label="Google Street View Embed"
      aria-hidden={!active}
      className="street-scene"
      data-active={active}
      data-renderer="embed"
    >
      <div className="street-scene__stage" aria-busy={!ready}>
        {embedView.embedUrl && (
          <iframe
            key={embedView.iframeKey}
            ref={embedView.iframeRef}
            className="street-scene__panorama street-scene__embed"
            src={embedView.embedUrl}
            title="Google Street View"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="eager"
            inert
            aria-hidden="true"
            tabIndex={-1}
            onLoad={() => embedView.markLoaded(embedView.revision)}
            onError={() => embedView.markError(embedView.revision)}
          />
        )}

        {embedView.embedUrl && <div className="street-embed-lock" aria-hidden="true" />}

        {ready && snapshot.circumstances.visible && (
          <EclipseOverlay
            snapshot={snapshot}
            expanded={false}
            diameterPixels={sunDiameterPixels}
            position={projectedSun}
            visible={projectedSun.visible}
            cloudCover={cloudCover}
          />
        )}

        {!ready && (
          <StateMessage
            state={embedView.panoramaState}
            onRetry={embedView.retry}
          />
        )}
      </div>
    </section>
  )
}
