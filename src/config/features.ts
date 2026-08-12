/**
 * Client-side build flags. Vite embeds these public values at build time, so a
 * Vercel environment change requires a redeployment before it takes effect.
 */
function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

function percentage(value: string | undefined): number {
  if (!value?.trim()) return 100

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 100
  return Math.min(100, Math.max(0, parsed))
}

export const MAINTENANCE_BANNER_ENABLED = enabled(
  import.meta.env.VITE_MAINTENANCE_BANNER_ENABLED,
)

/** Stable browser cohorts use this build-time percentage as their threshold. */
export const SPEAKEA_BANNER_PERCENTAGE = percentage(
  import.meta.env.VITE_SPEAKEA_BANNER_PERCENTAGE,
)

/**
 * The farewell print stands in front of the site now that the eclipse has
 * passed. It is the only flag that is on unless explicitly turned off, so the
 * post-event front door survives a deployment made without any environment.
 */
export const FAREWELL_ENABLED = !enabled(import.meta.env.VITE_FAREWELL_DISABLED)
