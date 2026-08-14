import { azimuthToCompassShort, formatDegrees, formatObscuration } from '../lib/format'
import { SunDisc } from './SunDisc'
import type { EclipseSnapshot } from '../types'

type EclipseInfoProps = {
  snapshot: EclipseSnapshot
}

export function EclipseInfo({ snapshot }: EclipseInfoProps) {
  if (!snapshot.circumstances.visible) {
    return (
      <section
        className="readout readout--unavailable"
        aria-label="Éclipse non visible depuis ce lieu"
        role="status"
      >
        <strong>Non visible ici</strong>
        <p>L’éclipse du 2 août 2027 ne sera pas observable depuis ce lieu.</p>
      </section>
    )
  }

  return (
    <section className="readout" aria-label="Éclipse à l’heure sélectionnée">
      <div className="readout__head">
        <SunDisc snapshot={snapshot} />
        <div className="readout__headline">
          <strong>{formatObscuration(snapshot.obscuration)}</strong>
          <span className="readout__suffix">du Soleil caché</span>
        </div>
      </div>

      <dl className="readout__stats">
        <div>
          <dt>Direction</dt>
          <dd>
            {Math.round(snapshot.sun.azimuth)}°
            <span>{azimuthToCompassShort(snapshot.sun.azimuth)}</span>
          </dd>
        </div>
        <div>
          <dt>Hauteur</dt>
          <dd>{formatDegrees(snapshot.sun.altitude)}</dd>
        </div>
      </dl>
    </section>
  )
}
