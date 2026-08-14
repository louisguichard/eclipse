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
    label: 'Carte',
    name: 'OpenStreetMap',
    href: 'https://www.openstreetmap.org/copyright',
  },
]

/** The eye-safety line, worded once and reused everywhere it appears. */
export const SAFETY_STANDARD = 'ISO 12312-2'
