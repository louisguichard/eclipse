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

  it('shows the Speakea banner to everyone by default', async () => {
    vi.stubEnv('VITE_SPEAKEA_BANNER_PERCENTAGE', '')
    const { SPEAKEA_BANNER_PERCENTAGE } = await import('./features')
    expect(SPEAKEA_BANNER_PERCENTAGE).toBe(100)
  })

  it('accepts and bounds the Speakea rollout percentage', async () => {
    vi.stubEnv('VITE_SPEAKEA_BANNER_PERCENTAGE', ' 24.5 ')
    let features = await import('./features')
    expect(features.SPEAKEA_BANNER_PERCENTAGE).toBe(24.5)

    vi.resetModules()
    vi.stubEnv('VITE_SPEAKEA_BANNER_PERCENTAGE', '-8')
    features = await import('./features')
    expect(features.SPEAKEA_BANNER_PERCENTAGE).toBe(0)

    vi.resetModules()
    vi.stubEnv('VITE_SPEAKEA_BANNER_PERCENTAGE', '180')
    features = await import('./features')
    expect(features.SPEAKEA_BANNER_PERCENTAGE).toBe(100)
  })
})
