import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
let configured = false

export const hasGoogleMapsApiKey = Boolean(apiKey)

function configureGoogleMaps(): void {
  if (configured || !apiKey) return
  setOptions({
    key: apiKey,
    v: '3.65',
    language: 'fr',
    authReferrerPolicy: 'origin',
  })
  configured = true
}

export async function loadGoogleLibrary<T extends Parameters<typeof importLibrary>[0]>(
  library: T,
) {
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY manquante')
  }
  configureGoogleMaps()
  return importLibrary(library)
}

export function googleMapId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_MAP_ID?.trim() || undefined
}
