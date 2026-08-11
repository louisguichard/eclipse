import type { AddLayerObject, Map as MapLibreMap } from 'maplibre-gl'
import { visibilityManifestIssue } from './visibilityTiles'
import { visibilityProtocolUrl } from './mapLibreVisibilityProtocol'
import type { VisibilityDatasetManifest } from '../types/visibility'

type MapSourceDefinition = Parameters<MapLibreMap['addSource']>[1]

export type VisibilityRasterDefinition = {
  datasetId: string
  sourceId: string
  layerId: string
  source: MapSourceDefinition
  layer: AddLayerObject
}

function safeStyleId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function visibilitySourceId(datasetId: string): string {
  return `visibility-source-${safeStyleId(datasetId)}`
}

export function visibilityLayerId(datasetId: string): string {
  return `visibility-layer-${safeStyleId(datasetId)}`
}

/** Build the native MapLibre XYZ source/layer pair for one LiDAR pyramid. */
export function createVisibilityRasterDefinition(
  manifest: VisibilityDatasetManifest,
  opacity: number,
): VisibilityRasterDefinition | null {
  if (visibilityManifestIssue(manifest) || !manifest.tiles) return null

  const sourceId = visibilitySourceId(manifest.id)
  const layerId = visibilityLayerId(manifest.id)
  const sourceTileUrl = manifest.tiles.urlTemplate.replaceAll(
    '{version}',
    encodeURIComponent(manifest.version),
  )
  const tileUrl = visibilityProtocolUrl(sourceTileUrl)

  return {
    datasetId: manifest.id,
    sourceId,
    layerId,
    source: {
      type: 'raster',
      tiles: [tileUrl],
      scheme: manifest.tiles.scheme,
      tileSize: manifest.tiles.tileSize,
      minzoom: manifest.tiles.minZoom,
      maxzoom: manifest.tiles.maxZoom,
      bounds: [
        manifest.coverage.west,
        manifest.coverage.south,
        manifest.coverage.east,
        manifest.coverage.north,
      ],
      attribution: manifest.attribution,
    },
    layer: {
      id: layerId,
      type: 'raster',
      source: sourceId,
      layout: { visibility: 'none' },
      paint: {
        'raster-opacity': Math.max(0, Math.min(1, opacity)),
        'raster-fade-duration': 0,
        'raster-resampling': 'nearest',
      },
    },
  }
}
