/**
 * Client-side build flags. Vite embeds these public values at build time, so a
 * Vercel environment change requires a redeployment before it takes effect.
 */
function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export const MAINTENANCE_BANNER_ENABLED = enabled(
  import.meta.env.VITE_MAINTENANCE_BANNER_ENABLED,
)
