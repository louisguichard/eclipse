/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaintenanceBanner } from './MaintenanceBanner'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty('--maintenance-banner-h')
})

describe('MaintenanceBanner', () => {
  it('warns immediately and reserves its measured height', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 47,
      height: 47,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const { unmount } = render(<MaintenanceBanner />)

    expect(screen.getByRole('status')).toHaveTextContent(
      '🚧 Une mise à jour de l’application est en cours. En cas de problème, revenez d’ici une heure !',
    )
    expect(document.documentElement.style.getPropertyValue('--maintenance-banner-h')).toBe('47px')

    unmount()
    expect(document.documentElement.style.getPropertyValue('--maintenance-banner-h')).toBe('')
  })
})
