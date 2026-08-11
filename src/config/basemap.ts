function normalizedUrl(value: string | undefined): string | null {
  return value?.trim() || null
}

/**
 * Production target: a world-wide Protomaps-compatible vector archive hosted
 * by us (R2, another CDN, or the same origin). The URL is public, not a secret.
 */
export const BASEMAP_PMTILES_URL = normalizedUrl(
  import.meta.env.VITE_BASEMAP_PMTILES_URL,
)

/**
 * Keyless bootstrap while no PMTiles archive is configured. OpenFreeMap has no
 * SLA, so production should set VITE_BASEMAP_PMTILES_URL.
 */
export const BASEMAP_STYLE_URL = normalizedUrl(
  import.meta.env.VITE_BASEMAP_STYLE_URL,
) ?? 'https://tiles.openfreemap.org/styles/dark'

export function pmtilesSourceUrl(url: string): string {
  return url.startsWith('pmtiles://') ? url : `pmtiles://${url}`
}
