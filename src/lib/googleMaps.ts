import { buildGoogleStreetViewEmbedUrl } from './googleMapsEmbed'
import type { LatLng, StreetViewCamera } from '../types'

const configuredEmbedApiKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim()
// Backward-compatible migration path for an existing local/Vercel variable.
// The value is used only in an Embed URL: this module contains no Maps
// JavaScript loader and cannot initialize a billable Maps or Places SKU.
const legacyEmbedApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
const embedApiKey = configuredEmbedApiKey || legacyEmbedApiKey

export const hasGoogleMapsEmbedApiKey = Boolean(embedApiKey)

export function googleStreetViewEmbedUrl(
  location: LatLng,
  camera: StreetViewCamera,
): string | null {
  if (!embedApiKey) return null
  return buildGoogleStreetViewEmbedUrl(embedApiKey, location, camera)
}
