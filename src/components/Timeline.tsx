import { useMemo } from 'react'
import { Pause, Play } from 'lucide-react'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import { timelineMinuteFromDate } from '../lib/astronomy'
import { formatLocalTime, formatObscuration } from '../lib/format'
import type { EclipseSnapshot } from '../types'

type TimelineProps = {
  minute: number
  snapshot: EclipseSnapshot
  timeZone?: string | null
  onMinuteChange: (minute: number) => void
  playback: TimelinePlaybackController
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function Timeline({
  minute,
  snapshot,
  timeZone = null,
  onMinuteChange,
  playback,
}: TimelineProps) {
  const contacts = useMemo(() => {
    const begin = timelineMinuteFromDate(snapshot.circumstances.begin.time)
    const maximum = timelineMinuteFromDate(snapshot.circumstances.maximum.time)
    const end = timelineMinuteFromDate(snapshot.circumstances.end.time)
    return {
      begin,
      maximum,
      end,
      maximumPosition: ((maximum - begin) / Math.max(end - begin, 1)) * 100,
    }
  }, [snapshot.circumstances])

  if (!snapshot.circumstances.visible) {
    return (
      <section className="timeline timeline--unavailable" aria-label="Chronologie de l’éclipse">
        <div className="timeline__unavailable" role="status">
          <strong>Éclipse non visible depuis ce lieu</strong>
          <span>Essayez une adresse en Europe, en Afrique du Nord ou en Amérique du Nord.</span>
        </div>
      </section>
    )
  }

  const displayedMinute = clamp(minute, contacts.begin, contacts.end)
  const progress = ((displayedMinute - contacts.begin) / Math.max(contacts.end - contacts.begin, 1)) * 100
  const { playing, stopPlayback, togglePlayback } = playback

  return (
    <section className="timeline" aria-label="Chronologie de l’éclipse">
      <div className="timeline__now">
        <button
          type="button"
          className="play-button"
          onClick={togglePlayback}
          aria-label={playing ? 'Mettre en pause' : 'Lire l’éclipse'}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <strong>{formatLocalTime(snapshot.date, timeZone)}</strong>
      </div>

      <div className="timeline__track-wrap">
        {/* Fractional playback values need an unconstrained native step. */}
        <input
          className="timeline-range"
          type="range"
          min={contacts.begin}
          max={contacts.end}
          step="any"
          value={displayedMinute}
          onPointerDown={stopPlayback}
          onChange={(event) => {
            stopPlayback()
            onMinuteChange(Number(event.target.value))
          }}
          aria-label="Heure simulée"
          aria-valuetext={`${formatLocalTime(snapshot.date, timeZone)}, ${snapshot.phaseLabel}, ${formatObscuration(snapshot.obscuration)} occulté`}
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />

        <span className="timeline-anchor timeline-anchor--start">
          {formatLocalTime(snapshot.circumstances.begin.time, timeZone)}
        </span>
        <button
          type="button"
          className="timeline-maximum"
          style={{ left: `${contacts.maximumPosition}%` }}
          onClick={() => {
            stopPlayback()
            onMinuteChange(contacts.maximum)
          }}
          aria-label={`Aller au maximum, ${formatLocalTime(snapshot.circumstances.maximum.time, timeZone)}`}
        >
          <span>max</span> {formatLocalTime(snapshot.circumstances.maximum.time, timeZone)}
        </button>
        <span className="timeline-anchor timeline-anchor--end">
          {formatLocalTime(snapshot.circumstances.end.time, timeZone)}
        </span>
      </div>
    </section>
  )
}
