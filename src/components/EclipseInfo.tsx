import { azimuthToCompassShort, formatDegrees, formatPercent } from '../lib/format'
import { SunDisc } from './SunDisc'
import type { EclipseSnapshot } from '../types'

type EclipseInfoProps = {
  snapshot: EclipseSnapshot
  cloudCover?: number | null
}

export function EclipseInfo({ snapshot, cloudCover = null }: EclipseInfoProps) {
  return (
    <section className="readout" aria-label="Éclipse à l’heure sélectionnée">
      <div className="readout__head">
        <SunDisc snapshot={snapshot} />
        <div className="readout__headline">
          <strong>{formatPercent(snapshot.obscuration)}</strong>
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
        <div>
          <dt>
            Nuages
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
          </dt>
          <dd>{cloudCover == null ? '—' : `${Math.round(cloudCover)} %`}</dd>
        </div>
      </dl>
    </section>
  )
}
