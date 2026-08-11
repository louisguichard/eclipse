import { describe, expect, it } from 'vitest'
import { normalizeSearchText, textMatchRank } from './normalize'

describe('search text normalization', () => {
  it('is accent-insensitive without discarding non-Latin place names', () => {
    expect(normalizeSearchText('  São-Paulo ')).toBe('sao paulo')
    expect(normalizeSearchText('東京都')).toBe('東京都')
  })

  it('ranks exact and prefix matches before loose token matches', () => {
    expect(textMatchRank('Paris', 'Paris')).toBeLessThan(textMatchRank('Paris', 'Paris 15e'))
    expect(textMatchRank('New', 'New York City')).toBeLessThan(
      textMatchRank('New', 'York New'),
    )
  })
})
