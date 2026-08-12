import type { Map as MapLibreMap, MapOptions } from 'maplibre-gl'
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

/**
 * Both the OpenFreeMap and Protomaps dark styles paint their land almost black,
 * which reads as a hole punched in the interface rather than as ground. A
 * neutral graphite keeps the card unmistakably part of a night theme while
 * giving streets, water and the yellow visibility layer something to sit on.
 */
const BASEMAP_LAND_COLOR = '#262b33'

/**
 * In a dense city almost none of the ground is visible: the building footprints
 * are what the eye reads as "the map". Both dark styles paint them near-black,
 * so lifting the ground alone changes nothing — the blocks have to come up with
 * it, one notch lighter so the streets still read as streets.
 */
const BASEMAP_BUILDING_COLOR = '#333a45'
const BASEMAP_BUILDING_OUTLINE = '#3d4552'

/** Enough blue to read as water, still darker than the ground around it. */
const BASEMAP_WATER_COLOR = '#1c232c'

/** Parks keep a hint of green so they stay usable as landmarks. */
const BASEMAP_GREEN_COLOR = '#2c3730'

/**
 * Land shading — residential blocks, glaciers, bare ground. These fills exist
 * to darken the ground a little, which is precisely what we just undid, so they
 * are flattened back into it instead of clawing the lift away.
 */
const GROUND_SOURCE_LAYERS = new Set(['earth', 'landcover', 'landuse', 'natural'])
const GREEN_LAYER_PATTERN = /park|wood|forest|grass|garden|scrub/i

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

/**
 * Repaints the loaded style's ground. Applied after `load` rather than baked
 * into the style so it works the same for the hosted OpenFreeMap style, which
 * arrives as a URL we never see the layers of.
 */
export function applyBasemapLandTone(
  map: Pick<MapLibreMap, 'getStyle' | 'setPaintProperty'>,
): void {
  for (const layer of map.getStyle().layers ?? []) {
    const sourceLayer = ('source-layer' in layer ? layer['source-layer'] : '') ?? ''
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', BASEMAP_LAND_COLOR)
        map.setPaintProperty(layer.id, 'background-opacity', 1)
      } else if (layer.type !== 'fill') {
        continue
      } else if (sourceLayer.startsWith('building')) {
        map.setPaintProperty(layer.id, 'fill-color', BASEMAP_BUILDING_COLOR)
        map.setPaintProperty(layer.id, 'fill-outline-color', BASEMAP_BUILDING_OUTLINE)
        map.setPaintProperty(layer.id, 'fill-opacity', 1)
      } else if (sourceLayer.startsWith('water')) {
        map.setPaintProperty(layer.id, 'fill-color', BASEMAP_WATER_COLOR)
      } else if (GROUND_SOURCE_LAYERS.has(sourceLayer)) {
        map.setPaintProperty(
          layer.id,
          'fill-color',
          GREEN_LAYER_PATTERN.test(layer.id) ? BASEMAP_GREEN_COLOR : BASEMAP_LAND_COLOR,
        )
      }
    } catch {
      // A style that paints its ground differently is not worth failing over.
    }
  }
}

export { BASEMAP_BUILDING_COLOR, BASEMAP_LAND_COLOR }
