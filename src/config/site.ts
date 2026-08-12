/**
 * Site identity and the provenance of every figure the interface displays.
 *
 * The list below is the single source of truth for both the on-screen
 * provenance strip and the About panel, so a source can never be credited in
 * one place and forgotten in the other.
 */

/** Published as-is in the About panel. Change it here for a dedicated inbox. */
export const CONTACT_EMAIL = 'hello@louisguichard.fr'

export const SITE_AUTHOR = 'Louis Guichard'
export const SITE_AUTHOR_URL = 'https://louisguichard.fr'
export const SITE_URL = 'https://eclipse.louisguichard.fr'
export const SITE_REPOSITORY = 'https://github.com/louisguichard/eclipse'
export const SITE_HOST = 'Vercel Inc.'

export type ProvenanceEntry = {
  /** What the source is used for, in the reader's terms. */
  label: string
  name: string
  href: string
}

export const PROVENANCE: readonly ProvenanceEntry[] = [
  {
    label: 'Calculs',
    name: 'Astronomy Engine',
    href: 'https://github.com/cosinekitty/astronomy',
  },
  {
    label: 'Vue',
    name: 'Google Street View',
    href: 'https://maps.google.com/help/terms_maps/',
  },
  {
    label: 'Relief',
    name: 'IGN LiDAR HD',
    href: 'https://geoservices.ign.fr/lidarhd',
  },
  {
    label: 'Carte',
    name: 'OpenStreetMap',
    href: 'https://www.openstreetmap.org/copyright',
  },
  {
    label: 'Météo',
    name: 'WeatherAPI.com',
    href: 'https://www.weatherapi.com/',
  },
]

/** The eye-safety line, worded once and reused everywhere it appears. */
export const SAFETY_STANDARD = 'ISO 12312-2'

/**
 * The Licence Ouverte requires the IGN products to be credited. The credit used
 * to sit on the map card, where it covered the map for everyone to serve a line
 * almost nobody reads; it belongs in the About panel, which is one tap away.
 */
export const IGN_ATTRIBUTION =
  '© IGN — LiDAR HD MNT/MNS 2023, édition 2025 · Licence Ouverte 2.0 · résolution 2 m'
