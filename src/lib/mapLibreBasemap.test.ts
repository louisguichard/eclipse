import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  layers: vi.fn((source: string) => [{ id: `${source}-earth`, type: 'fill' }]),
  protocolTile: vi.fn(),
}))

vi.mock('@protomaps/basemaps', () => ({
  DARK: { background: '#000' },
  layers: mocks.layers,
}))

vi.mock('pmtiles', () => ({
  Protocol: class {
    tile = mocks.protocolTile
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllEnvs())

describe('MapLibre basemap resolution', () => {
  it('uses and registers one PMTiles protocol for a configured archive', async () => {
    vi.stubEnv('VITE_BASEMAP_PMTILES_URL', 'https://cdn.example.test/world.pmtiles')
    const addProtocol = vi.fn()
    const maplibre = { addProtocol } as unknown as typeof import('maplibre-gl')
    const { resolveBasemapStyle } = await import('./mapLibreBasemap')

    const firstStyle = await resolveBasemapStyle(maplibre)
    await resolveBasemapStyle(maplibre)

    expect(addProtocol).toHaveBeenCalledOnce()
    expect(addProtocol).toHaveBeenCalledWith('pmtiles', mocks.protocolTile)
    expect(firstStyle).toMatchObject({
      version: 8,
      sources: {
        'protomaps-basemap': {
          type: 'vector',
          url: 'pmtiles://https://cdn.example.test/world.pmtiles',
        },
      },
    })
    expect(mocks.layers).toHaveBeenCalledWith(
      'protomaps-basemap',
      expect.anything(),
      { lang: 'fr' },
    )
  })

  it('uses the keyless style bootstrap without loading PMTiles', async () => {
    vi.stubEnv('VITE_BASEMAP_PMTILES_URL', '')
    vi.stubEnv('VITE_BASEMAP_STYLE_URL', 'https://styles.example.test/dark')
    const addProtocol = vi.fn()
    const maplibre = { addProtocol } as unknown as typeof import('maplibre-gl')
    const { resolveBasemapStyle } = await import('./mapLibreBasemap')

    await expect(resolveBasemapStyle(maplibre)).resolves.toBe(
      'https://styles.example.test/dark',
    )
    expect(addProtocol).not.toHaveBeenCalled()
  })
})
