/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPanoramaJsonp } from './api'

type JsonpRegistry = Record<string, ((payload: unknown) => void) | undefined>

function currentScript(): HTMLScriptElement {
  const script = document.head.querySelector<HTMLScriptElement>(
    'script[src*="GeoPhotoService.SingleImageSearch"]',
  )
  if (!script) throw new Error('Script JSONP Streetlevel introuvable')
  return script
}

function answerCurrentRequest(payload: unknown): void {
  const script = currentScript()
  const callback = new URL(script.src).searchParams.get('callback')
  const id = callback?.split('.').at(-1)
  const registry = (window as unknown as Record<string, unknown>)
    .__eclipseStreetlevelJsonp as JsonpRegistry
  if (!id || !registry[id]) throw new Error('Callback JSONP Streetlevel introuvable')
  registry[id](payload)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.head.querySelectorAll('script[src*="GeoPhotoService.SingleImageSearch"]')
    .forEach((script) => script.remove())
})

describe('Streetlevel metadata retries', () => {
  it('retries once after a transient script failure', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const append = vi.spyOn(document.head, 'append')
    const request = requestPanoramaJsonp(48.8566, 2.3522, 100, undefined, 8_000)

    currentScript().onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(300)
    expect(append).toHaveBeenCalledTimes(2)

    answerCurrentRequest({ panorama: true })
    await expect(request).resolves.toEqual({ panorama: true })
  })

  it('reports a timeout only after both attempts expire', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const append = vi.spyOn(document.head, 'append')
    const request = requestPanoramaJsonp(48.8566, 2.3522, 100, undefined, 100)
    const assertion = expect(request).rejects.toThrow('Délai Streetlevel dépassé')

    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(300)
    expect(append).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)

    await assertion
  })

  it('cancels a pending retry when the view changes', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const append = vi.spyOn(document.head, 'append')
    const request = requestPanoramaJsonp(48.8566, 2.3522, 100, controller.signal)
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' })

    currentScript().onerror?.(new Event('error'))
    controller.abort()
    await vi.runAllTimersAsync()

    await assertion
    expect(append).toHaveBeenCalledOnce()
  })
})
