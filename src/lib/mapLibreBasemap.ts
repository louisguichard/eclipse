import type { MapOptions } from 'maplibre-gl'
import {
  BASEMAP_PMTILES_URL,
  BASEMAP_STYLE_URL,
  pmtilesSourceUrl,
} from '../config/basemap'

type MapLibreModule = typeof import('maplibre-gl')
type MapStyle = Exclude<MapOptions['style'], string | undefined>

const BASEMAP_SOURCE_ID = 'protomaps-basemap'
const BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const BASEMAP_GLYPHS_URL =
  'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
const BASEMAP_SPRITE_URL =
  'https://protomaps.github.io/basemaps-assets/sprites/v4/dark'

let pmtilesProtocolRegistration: Promise<void> | null = null

async function ensurePmtilesProtocol(maplibre: MapLibreModule): Promise<void> {
  pmtilesProtocolRegistration ??= import('pmtiles').then(({ Protocol }) => {
    const protocol = new Protocol()
    maplibre.addProtocol('pmtiles', protocol.tile)
  })
  await pmtilesProtocolRegistration
}

/**
 * Resolves to a style URL for the keyless bootstrap, or to an in-memory dark
 * Protomaps style when a PMTiles archive is configured. Everything expensive
 * stays behind MapView's lazy initialization boundary.
 */
export async function resolveBasemapStyle(
  maplibre: MapLibreModule,
): Promise<string | MapStyle> {
  if (!BASEMAP_PMTILES_URL) return BASEMAP_STYLE_URL

  const [, { DARK, layers }] = await Promise.all([
    ensurePmtilesProtocol(maplibre),
    import('@protomaps/basemaps'),
  ])

  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: 'vector',
        url: pmtilesSourceUrl(BASEMAP_PMTILES_URL),
        attribution: BASEMAP_ATTRIBUTION,
      },
    },
    layers: layers(BASEMAP_SOURCE_ID, DARK, { lang: 'fr' }),
    glyphs: BASEMAP_GLYPHS_URL,
    sprite: BASEMAP_SPRITE_URL,
  }
}
