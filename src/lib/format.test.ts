import { describe, expect, it } from 'vitest'
import { formatLocalDateTime, formatLocalTime } from './format'

const INSTANT = new Date('2026-08-12T18:17:00.000Z')

describe('local date and time formatting', () => {
  it.each([
    ['Europe/Paris', '20:17'],
    ['America/New_York', '14:17'],
    ['Atlantic/Reykjavik', '18:17'],
    ['Asia/Kathmandu', '00:02'],
  ])('formats the observation instant in %s', (timeZone, expected) => {
    expect(formatLocalTime(INSTANT, timeZone)).toBe(expected)
  })

  it('falls back explicitly to UTC for an absent or invalid IANA zone', () => {
    expect(formatLocalTime(INSTANT, null)).toBe('18:17')
    expect(formatLocalTime(INSTANT, 'Not/A_Zone')).toBe('18:17')
    expect(formatLocalDateTime(INSTANT, 'Not/A_Zone')).toContain('18:17:00')
  })
})
