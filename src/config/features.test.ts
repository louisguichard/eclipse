import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('feature flags', () => {
  it('keeps the maintenance banner disabled by default', async () => {
    vi.stubEnv('VITE_MAINTENANCE_BANNER_ENABLED', '')
    const { MAINTENANCE_BANNER_ENABLED } = await import('./features')
    expect(MAINTENANCE_BANNER_ENABLED).toBe(false)
  })

  it('enables the maintenance banner only with an explicit true value', async () => {
    vi.stubEnv('VITE_MAINTENANCE_BANNER_ENABLED', ' TRUE ')
    const { MAINTENANCE_BANNER_ENABLED } = await import('./features')
    expect(MAINTENANCE_BANNER_ENABLED).toBe(true)
  })
})
