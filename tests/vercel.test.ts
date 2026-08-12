import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface VercelHeader {
  key: string
  value: string
}

interface VercelConfig {
  rewrites?: unknown[]
  headers?: Array<{ source: string, headers: VercelHeader[] }>
}

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig

describe('Vercel routing safety', () => {
  it('does not turn missing files into the SPA document', () => {
    expect(config.rewrites).toBeUndefined()
  })

  it('does not attach immutable browser caching to every asset response', () => {
    const immutableStaticRules = (config.headers ?? []).filter(({ source, headers }) =>
      (source.startsWith('/assets/') || source.startsWith('/search/')) &&
      headers.some(({ key, value }) =>
        key.toLowerCase() === 'cache-control' && /immutable|max-age=31536000/i.test(value),
      ),
    )

    expect(immutableStaticRules).toEqual([])
  })
})
