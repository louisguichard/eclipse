/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useObserverLocation } from './useObserverLocation'

describe('useObserverLocation URL synchronization', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?lat=48.856600&lng=2.352200&time=62')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('updates both the browser URL and share URL after a Street View walk', async () => {
    const { result } = renderHook(() => useObserverLocation())

    act(() => {
      result.current.setLocation({
        lat: 48.873667,
        lng: 2.295891,
        label: 'Position Street View',
        source: 'streetview',
      })
    })

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('lat')).toBe('48.873667')
      expect(new URLSearchParams(window.location.search).get('lng')).toBe('2.295891')
    })

    const shared = new URL(result.current.shareUrl())
    expect(shared.searchParams.get('lat')).toBe('48.873667')
    expect(shared.searchParams.get('lng')).toBe('2.295891')
    expect(shared.searchParams.get('time')).toBe('62')
  })

  it('preserves explicit coordinates exactly while the initial view loads', async () => {
    window.history.replaceState(null, '', '/?lat=48.873698&lng=2.295927&time=62')

    const { result, rerender } = renderHook(() => useObserverLocation())
    rerender()

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search)
      expect(params.get('lat')).toBe('48.873698')
      expect(params.get('lng')).toBe('2.295927')
      expect(params.get('time')).toBe('62')
    })

    const shared = new URL(result.current.shareUrl())
    expect(shared.searchParams.get('lat')).toBe('48.873698')
    expect(shared.searchParams.get('lng')).toBe('2.295927')
  })

  it('opens a base URL on the Arc de Triomphe observation point', async () => {
    window.history.replaceState(null, '', '/')

    const { result } = renderHook(() => useObserverLocation())

    expect(result.current.location).toMatchObject({
      lat: 48.873698,
      lng: 2.295927,
      label: 'Paris · Arc de Triomphe',
      source: 'default',
    })
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search)
      expect(params.get('lat')).toBe('48.873698')
      expect(params.get('lng')).toBe('2.295927')
      expect(params.get('time')).toBe('61')
    })
  })

  it('writes an integer share time only when the displayed minute changes', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useObserverLocation())
    await waitFor(() => expect(replaceState).toHaveBeenCalled())
    const initialWrites = replaceState.mock.calls.length

    act(() => result.current.setMinute(62.1))
    act(() => result.current.setMinute(62.35))
    act(() => result.current.setMinute(62.49))
    expect(replaceState).toHaveBeenCalledTimes(initialWrites)
    expect(new URL(result.current.shareUrl()).searchParams.get('time')).toBe('62')

    act(() => result.current.setMinute(62.51))
    await waitFor(() => expect(replaceState).toHaveBeenCalledTimes(initialWrites + 1))
    expect(new URLSearchParams(window.location.search).get('time')).toBe('63')
    expect(new URL(result.current.shareUrl()).searchParams.get('time')).toBe('63')
  })

  it('debounces rapid playback updates below Safari history limits', () => {
    vi.useFakeTimers()
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHook(() => useObserverLocation())

    act(() => vi.advanceTimersByTime(250))
    replaceState.mockClear()

    for (let minute = 7; minute <= 114; minute += 1) {
      act(() => result.current.setMinute(minute))
      act(() => vi.advanceTimersByTime(68))
    }

    expect(replaceState).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(250))
    expect(replaceState).toHaveBeenCalledOnce()
    expect(new URLSearchParams(window.location.search).get('time')).toBe('114')
  })

  it('preserves negative timeline minutes in shared links', () => {
    window.history.replaceState(
      null,
      '',
      '/?lat=61.218100&lng=-149.900300&time=-54',
    )

    const { result } = renderHook(() => useObserverLocation())

    expect(result.current.minute).toBe(-54)
    expect(new URL(result.current.shareUrl()).searchParams.get('time')).toBe('-54')
  })

  it('jumps to the observable local maximum after a deliberate location change', () => {
    const { result } = renderHook(() => useObserverLocation())

    act(() => {
      result.current.setLocation({
        lat: 36.5297,
        lng: -6.2927,
        label: 'Cadix',
        source: 'search',
      })
    })

    expect(result.current.minute).toBeCloseTo(46.7349, 4)
  })
})
