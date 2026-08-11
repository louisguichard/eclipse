import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = resolve(import.meta.dirname, '../..')

function productionSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return productionSources(path)
    return /\.(?:ts|tsx)$/.test(entry) && !/\.test\.(?:ts|tsx)$/.test(entry) ? [path] : []
  })
}

describe('Google cost guard', () => {
  it('does not ship a Maps JavaScript or Places loader', () => {
    const packageJson = readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')
    expect(packageJson).not.toContain('@googlemaps/js-api-loader')

    const forbidden = [
      /google\.maps\./,
      /importLibrary\s*\(/,
      /maps\.googleapis\.com\/maps\/api\/js/,
      /places\.googleapis\.com/,
      /StreetViewPanorama/,
      /StreetViewService/,
    ]
    const violations = productionSources(join(PROJECT_ROOT, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relative(PROJECT_ROOT, path)}: ${pattern.source}`)
    })

    expect(violations).toEqual([])
  })
})
