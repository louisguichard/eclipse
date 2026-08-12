import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TIMELINE } from '../config/eclipse'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import { formatLocalTime } from '../lib/format'
import type { EclipseSnapshot } from '../types'

type MobileDialTimelineProps = {
  minute: number
  snapshot: EclipseSnapshot
  timeZone?: string | null
  blocked?: boolean
  onMinuteChange: (minute: number) => void
  playback: TimelinePlaybackController
}

const SIZE = 300
const CENTER = 150
const RADIUS = 116
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function timelineMinute(date: Date): number {
  return (date.getTime() - TIMELINE.startUtc.getTime()) / 60_000
}

function pointOnArc(progress: number) {
  const angle = Math.PI + clamp(progress, 0, 1) * Math.PI
  return {
    x: CENTER + RADIUS * Math.cos(angle),
    y: CENTER + RADIUS * Math.sin(angle),
  }
}

export function MobileDialTimeline({
  minute,
  snapshot,
  timeZone = null,
  blocked = false,
  onMinuteChange,
  playback,
}: MobileDialTimelineProps) {
  const [dragging, setDragging] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const range = useMemo(() => {
    const start = clamp(
      timelineMinute(snapshot.circumstances.begin.time),
      TIMELINE.minMinute,
      TIMELINE.maxMinute,
    )
    const end = clamp(
      timelineMinute(snapshot.circumstances.end.time),
      TIMELINE.minMinute,
      TIMELINE.maxMinute,
    )
    const maximum = clamp(timelineMinute(snapshot.circumstances.maximum.time), start, end)
    return { start, end: Math.max(start + 1, end), maximum }
  }, [snapshot.circumstances])

  const progress = clamp((minute - range.start) / (range.end - range.start), 0, 1)
  const maximumProgress = clamp(
    (range.maximum - range.start) / (range.end - range.start),
    0,
    1,
  )
  const handle = pointOnArc(progress)
  const maximumMarker = pointOnArc(maximumProgress)
  const { playing, stopPlayback, togglePlayback } = playback

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((clientX - rect.left) / rect.width) * SIZE
    const y = ((clientY - rect.top) / rect.width) * SIZE
    let angle = Math.atan2(y - CENTER, x - CENTER)

    // Only the upper half of the circle is meaningful. A finger that strays
    // below it snaps to the closest endpoint instead of wrapping the time.
    if (angle > 0) angle = x < CENTER ? -Math.PI : 0
    const nextProgress = clamp((angle + Math.PI) / Math.PI, 0, 1)
    onMinuteChange(range.start + nextProgress * (range.end - range.start))
  }, [onMinuteChange, range])

  useEffect(() => {
    if (!dragging) return undefined
    const move = (event: PointerEvent) => {
      event.preventDefault()
      updateFromPointer(event.clientX, event.clientY)
    }
    const end = () => setDragging(false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, updateFromPointer])

  if (!snapshot.circumstances.visible) {
    return (
      <section
        className="mobile-timeline mobile-timeline--unavailable"
        aria-label="Chronologie de l’éclipse"
        role="status"
      >
        <strong>Éclipse non visible ici</strong>
        <span>Essayez un autre lieu d’observation.</span>
      </section>
    )
  }

  const changeByMinute = (delta: number) => {
    stopPlayback()
    onMinuteChange(clamp(minute + delta, range.start, range.end))
  }

  return (
    <section className="mobile-timeline" aria-label="Chronologie de l’éclipse">
      <div className="mobile-timeline__clock">
        <strong>{formatLocalTime(snapshot.date, timeZone)}</strong>
      </div>

      <div className="mobile-dial">
        <div
          ref={surfaceRef}
          className="mobile-dial__surface"
          role="slider"
          tabIndex={blocked ? -1 : 0}
          aria-label="Heure de l’éclipse"
          aria-valuemin={Math.round(range.start)}
          aria-valuemax={Math.round(range.end)}
          aria-valuenow={Math.round(minute)}
          aria-valuetext={formatLocalTime(snapshot.date, timeZone)}
          aria-disabled={blocked}
          onPointerDown={(event) => {
            if (blocked) return
            event.preventDefault()
            stopPlayback()
            setDragging(true)
            updateFromPointer(event.clientX, event.clientY)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              changeByMinute(-1)
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              changeByMinute(1)
            }
          }}
        >
          <svg className="mobile-dial__svg" viewBox="0 0 300 300" aria-hidden="true">
            <path className="mobile-dial__track" d="M 34 150 A 116 116 0 0 1 266 150" />
            <path
              className="mobile-dial__progress"
              d="M 34 150 A 116 116 0 0 1 266 150"
              pathLength="1"
              strokeDasharray={`${progress} 1`}
            />
            <circle
              className="mobile-dial__maximum"
              cx={maximumMarker.x}
              cy={maximumMarker.y}
              r="3.5"
            />
            <circle
              className="mobile-dial__handle-ring"
              cx={handle.x}
              cy={handle.y}
              r="15.5"
            />
            <circle
              className="mobile-dial__handle"
              cx={handle.x}
              cy={handle.y}
              r="12"
            />
          </svg>
          <span className="mobile-dial__time mobile-dial__time--start">
            {formatLocalTime(snapshot.circumstances.begin.time, timeZone)}
          </span>
          <span className="mobile-dial__time mobile-dial__time--end">
            {formatLocalTime(snapshot.circumstances.end.time, timeZone)}
          </span>
        </div>

        <button
          type="button"
          className="mobile-dial__play"
          onClick={togglePlayback}
          disabled={blocked}
          aria-label={playing ? 'Mettre en pause' : 'Lire l’éclipse'}
        >
          {playing
            ? <Pause aria-hidden="true" size={20} fill="currentColor" />
            : <Play aria-hidden="true" size={20} fill="currentColor" />}
        </button>
      </div>
    </section>
  )
}
