// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLOUDFLARE_ANALYTICS_SCRIPT_URL,
  installCloudflareWebAnalytics,
} from './cloudflareAnalytics'

describe('installCloudflareWebAnalytics', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  it('does not install the beacon when analytics are disabled', () => {
    expect(
      installCloudflareWebAnalytics({
        document,
        enabled: false,
        token: 'site-token',
      }),
    ).toBe(false)
    expect(document.scripts).toHaveLength(0)
  })

  it('does not install the beacon without a configured token', () => {
    expect(
      installCloudflareWebAnalytics({ document, enabled: true, token: '   ' }),
    ).toBe(false)
    expect(document.scripts).toHaveLength(0)
  })

  it('installs the official beacon with only the site token', () => {
    expect(
      installCloudflareWebAnalytics({
        document,
        enabled: true,
        token: '  site-token  ',
      }),
    ).toBe(true)

    const script = document.querySelector<HTMLScriptElement>(
      '#cloudflare-web-analytics',
    )

    expect(script).not.toBeNull()
    expect(script?.type).toBe('module')
    expect(script?.defer).toBe(true)
    expect(script?.src).toBe(CLOUDFLARE_ANALYTICS_SCRIPT_URL)
    expect(script?.getAttribute('data-cf-beacon')).toBe(
      JSON.stringify({ token: 'site-token' }),
    )
  })

  it('never installs the beacon more than once', () => {
    const options = { document, enabled: true, token: 'site-token' }

    expect(installCloudflareWebAnalytics(options)).toBe(true)
    expect(installCloudflareWebAnalytics(options)).toBe(false)
    expect(document.scripts).toHaveLength(1)
  })
})
