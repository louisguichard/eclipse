import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLocalDateTime, formatLocalTime, formatObscuration } from './format'

const INSTANT = new Date('2026-08-12T18:17:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

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

describe('obscuration formatting', () => {
  it('distinguishes first measurable contact from a truly clear disc', () => {
    expect(formatObscuration(0)).toBe('0 %')
    expect(formatObscuration(0.00095)).toBe('< 1 %')
    expect(formatObscuration(0.92)).toBe('92\u00a0%')
  })
})

describe('Intl resilience', () => {
  it('reuses formatters throughout animated timeline renders', async () => {
    vi.resetModules()
    const dateTimeConstructor = vi.spyOn(Intl, 'DateTimeFormat')
    const numberConstructor = vi.spyOn(Intl, 'NumberFormat')
    const formatting = await import('./format')

    formatting.formatLocalTime(INSTANT, 'Europe/Paris')
    const dateTimeConstructions = dateTimeConstructor.mock.calls.length
    for (let frame = 1; frame < 120; frame += 1) {
      formatting.formatLocalTime(INSTANT, 'Europe/Paris')
    }
    expect(dateTimeConstructions).toBeGreaterThan(0)
    expect(dateTimeConstructor).toHaveBeenCalledTimes(dateTimeConstructions)

    formatting.formatPercent(0.9234, 2)
    const numberConstructions = numberConstructor.mock.calls.length
    for (let frame = 1; frame < 120; frame += 1) {
      formatting.formatPercent(0.9234, 2)
    }
    expect(numberConstructions).toBeGreaterThan(0)
    expect(numberConstructor).toHaveBeenCalledTimes(numberConstructions)
  })

  it('falls back without throwing when WebKit refuses Intl initialization', async () => {
    vi.resetModules()
    const dateTimeConstructor = vi.spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(() => {
        throw new TypeError('failed to initialize DateTimeFormat')
      })
    const numberConstructor = vi.spyOn(Intl, 'NumberFormat')
      .mockImplementation(() => {
        throw new TypeError('Failed to initialize NumberFormat')
      })
    const formatting = await import('./format')

    expect(formatting.formatLocalTime(INSTANT, 'Europe/Paris')).toBe('18:17')
    expect(formatting.formatLocalDateTime(INSTANT, 'Europe/Paris'))
      .toBe('12/08/2026 18:17:00 UTC')
    expect(formatting.formatPercent(0.9234, 2)).toBe('92,34 %')

    formatting.formatLocalTime(INSTANT, 'Europe/Paris')
    formatting.formatPercent(0.9234, 2)
    expect(dateTimeConstructor).toHaveBeenCalledTimes(4)
    expect(numberConstructor).toHaveBeenCalledOnce()
  })
})
