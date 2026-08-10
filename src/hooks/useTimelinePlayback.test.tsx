/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTimelinePlayback } from './useTimelinePlayback'

function renderControlledPlayback(onMinuteChange: (minute: number) => void, blocked = false) {
  return renderHook(() => {
    const [minute, setMinute] = useState(62)
    const changeMinute = (next: number) => {
      onMinuteChange(next)
      setMinute(next)
    }
    return useTimelinePlayback({
      minute,
      start: 7,
      end: 114,
      blocked,
      onMinuteChange: changeMinute,
    })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useTimelinePlayback', () => {
  it('starts at C1 and advances monotonically from one absolute RAF origin', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const changes = vi.fn()
    const { result } = renderControlledPlayback(changes)

    act(() => result.current.togglePlayback())
    expect(changes).toHaveBeenCalledWith(7)
    for (const timestamp of [0, 17, 34, 51, 68]) {
      act(() => callbacks.shift()?.(timestamp))
    }

    const animated = changes.mock.calls.slice(1).map(([value]) => value as number)
    expect(animated).toHaveLength(4)
    expect(animated.every((value, index) => index === 0 || value > animated[index - 1])).toBe(true)
    expect(animated.at(-1)).toBeCloseTo(8.1, 5)
  })

  it('lands exactly on C4, stops, and leaves no extra frame queued', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const changes = vi.fn()
    const { result } = renderControlledPlayback(changes)

    act(() => result.current.togglePlayback())
    act(() => callbacks.shift()?.(0))
    act(() => callbacks.shift()?.(7_000))

    expect(changes).toHaveBeenLastCalledWith(114)
    expect(result.current.playing).toBe(false)
    expect(callbacks).toHaveLength(0)
  })

  it('does not start while the interface is blocked', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const changes = vi.fn()
    const { result } = renderControlledPlayback(changes, true)

    act(() => result.current.togglePlayback())
    expect(result.current.playing).toBe(false)
    expect(changes).not.toHaveBeenCalled()
  })
})
