import { useCallback, useEffect, useRef, useState } from 'react'
import { TIMELINE } from '../config/eclipse'

type TimelinePlaybackOptions = {
  minute: number
  start: number
  end: number
  blocked?: boolean
  onMinuteChange: (minute: number) => void
}

export type TimelinePlaybackController = {
  playing: boolean
  stopPlayback: () => void
  togglePlayback: () => void
}

/**
 * A single clock for both timeline presentations.
 *
 * Keeping the callback and range in refs is intentional: a parent render must
 * not tear down and restart the RAF loop. The elapsed time therefore remains
 * continuous even while the astronomy snapshot is recalculated every frame.
 */
export function useTimelinePlayback({
  minute,
  start,
  end,
  blocked = false,
  onMinuteChange,
}: TimelinePlaybackOptions): TimelinePlaybackController {
  const [playing, setPlaying] = useState(false)
  const minuteRef = useRef(minute)
  const endRef = useRef(end)
  const onMinuteChangeRef = useRef(onMinuteChange)

  // While running, the RAF clock is authoritative. Keeping an older prop from
  // an unrelated render from overwriting it avoids tiny backwards jumps.
  if (!playing) minuteRef.current = minute
  endRef.current = end
  onMinuteChangeRef.current = onMinuteChange

  const stopPlayback = useCallback(() => {
    setPlaying(false)
  }, [])

  const togglePlayback = useCallback(() => {
    if (blocked) return
    if (playing) {
      setPlaying(false)
      return
    }

    const firstContact = Math.min(start, end)
    minuteRef.current = firstContact
    onMinuteChangeRef.current(firstContact)
    setPlaying(true)
  }, [blocked, end, playing, start])

  useEffect(() => {
    if (!playing || blocked) return undefined

    let frame = 0
    let startTimestamp: number | null = null
    const startMinute = minuteRef.current

    const tick = (timestamp: number) => {
      if (startTimestamp == null) {
        startTimestamp = timestamp
        frame = window.requestAnimationFrame(tick)
        return
      }

      const elapsedSeconds = Math.max(0, timestamp - startTimestamp) / 1000
      const finalContact = endRef.current
      const nextMinute = startMinute + elapsedSeconds * TIMELINE.playMinutesPerSecond

      if (nextMinute >= finalContact) {
        minuteRef.current = finalContact
        onMinuteChangeRef.current(finalContact)
        setPlaying(false)
        return
      }

      minuteRef.current = nextMinute
      onMinuteChangeRef.current(nextMinute)
      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [blocked, playing])

  useEffect(() => {
    if (blocked) setPlaying(false)
  }, [blocked])

  return { playing, stopPlayback, togglePlayback }
}
