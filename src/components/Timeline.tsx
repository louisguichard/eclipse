import { useMemo } from 'react'
import { Pause, Play } from 'lucide-react'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import { timelineMinuteFromDate } from '../lib/astronomy'
import { formatParisTime, formatPercent } from '../lib/format'
import type { EclipseSnapshot } from '../types'

type TimelineProps = {
  minute: number
  snapshot: EclipseSnapshot
  onMinuteChange: (minute: number) => void
  playback: TimelinePlaybackController
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function Timeline({ minute, snapshot, onMinuteChange, playback }: TimelineProps) {
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
        <strong>{formatParisTime(snapshot.date)}</strong>
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
            onMinuteChange(Math.round(Number(event.target.value)))
          }}
          aria-label="Heure simulée"
          aria-valuetext={`${formatParisTime(snapshot.date)}, ${snapshot.phaseLabel}, ${formatPercent(snapshot.obscuration)} occulté`}
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />

        <span className="timeline-anchor timeline-anchor--start">
          {formatParisTime(snapshot.circumstances.begin.time)}
        </span>
        <button
          type="button"
          className="timeline-maximum"
          style={{ left: `${contacts.maximumPosition}%` }}
          onClick={() => {
            stopPlayback()
            onMinuteChange(contacts.maximum)
          }}
          aria-label={`Aller au maximum, ${formatParisTime(snapshot.circumstances.maximum.time)}`}
        >
          <span>max</span> {formatParisTime(snapshot.circumstances.maximum.time)}
        </button>
        <span className="timeline-anchor timeline-anchor--end">
          {formatParisTime(snapshot.circumstances.end.time)}
        </span>
      </div>
    </section>
  )
}
