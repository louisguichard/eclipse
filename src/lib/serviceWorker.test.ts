/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { registerSW } from 'virtual:pwa-register'
import {
  installServiceWorker,
  isServiceWorkerPermissionError,
} from './serviceWorker'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Service Worker registration', () => {
  it('recognizes a browser policy refusal', () => {
    expect(isServiceWorkerPermissionError(new DOMException(
      'The user denied permission to use Service Worker.',
      'NotSupportedError',
    ))).toBe(true)
    expect(isServiceWorkerPermissionError(new TypeError('Load failed'))).toBe(false)
  })

  it('handles a permission error through the registration callback', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {},
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const registrar = vi.fn((_options) => vi.fn()) as unknown as typeof registerSW

    expect(installServiceWorker(true, registrar)).toBe(true)
    const options = vi.mocked(registrar).mock.calls[0]?.[0]
    expect(() => options?.onRegisterError?.(new DOMException(
      'The user denied permission to use Service Worker.',
      'NotSupportedError',
    ))).not.toThrow()
    expect(info).toHaveBeenCalledOnce()
  })

  it('also catches a synchronous registrar failure', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {},
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registrar = vi.fn(() => {
      throw new TypeError('Registration unavailable')
    }) as unknown as typeof registerSW

    expect(installServiceWorker(true, registrar)).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })
})
