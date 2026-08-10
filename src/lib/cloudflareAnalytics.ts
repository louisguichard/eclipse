export const CLOUDFLARE_ANALYTICS_SCRIPT_URL =
  'https://static.cloudflareinsights.com/beacon.min.js'

const SCRIPT_ID = 'cloudflare-web-analytics'

interface InstallCloudflareAnalyticsOptions {
  document?: Document
  enabled?: boolean
  token?: string
}

/**
 * Installs Cloudflare's official Web Analytics beacon once in production.
 * The token is a public site identifier, not a secret.
 */
export function installCloudflareWebAnalytics(
  options: InstallCloudflareAnalyticsOptions = {},
): boolean {
  const analyticsDocument =
    options.document ?? (typeof document === 'undefined' ? undefined : document)
  const enabled = options.enabled ?? import.meta.env.PROD
  const token =
    options.token?.trim() ??
    import.meta.env.VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN?.trim()

  if (!analyticsDocument || !enabled || !token) {
    return false
  }

  const existingScript = analyticsDocument.querySelector(
    `#${SCRIPT_ID}, script[src^="${CLOUDFLARE_ANALYTICS_SCRIPT_URL}"]`,
  )

  if (existingScript) {
    return false
  }

  const script = analyticsDocument.createElement('script')
  script.id = SCRIPT_ID
  script.type = 'module'
  script.defer = true
  script.src = CLOUDFLARE_ANALYTICS_SCRIPT_URL
  script.setAttribute('data-cf-beacon', JSON.stringify({ token }))
  analyticsDocument.head.append(script)

  return true
}
