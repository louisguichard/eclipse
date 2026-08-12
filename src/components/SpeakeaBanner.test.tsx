/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decideSpeakeaBannerShow } from '../lib/speakeaBanner'
import { SpeakeaBanner } from './SpeakeaBanner'

const STORAGE_KEY = 'speakea-banner-v1'
const NOW = new Date('2026-08-12T12:00:00.000Z')

function seedState(
  visits: number,
  phase: 'new' | 'closed' | 'clicked',
  lastVisitAt = NOW.getTime() - 5 * 60_000,
  cohort = 0,
) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    visits,
    lastVisitAt,
    phase,
    cohort,
  }))
}

function storedState() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    visits: number
    phase: string
    cohort: number
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0.25)
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty('--speakea-banner-h')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SpeakeaBanner', () => {
  it('waits ten seconds on the first visit and links both labels to Speakea', () => {
    render(<SpeakeaBanner percentage={100} />)

    expect(screen.queryByRole('region', { name: 'Un message du créateur' }))
      .not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(9_999))
    expect(screen.queryByRole('region', { name: 'Un message du créateur' }))
      .not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('region', { name: 'Un message du créateur' })).toHaveTextContent(
      'Je développe aussi Speakea, une application pour progresser en anglais en parlant vraiment : speakea.app',
    )
    expect(screen.getByRole('link', { name: 'Speakea' })).toHaveAttribute(
      'href',
      'https://speakea.app/?utm_source=eclipse',
    )
    expect(screen.getByRole('link', { name: /speakea\.app/ })).toHaveAttribute(
      'href',
      'https://speakea.app/?utm_source=eclipse',
    )
  })

  it('shows immediately on the second visit after five minutes away', () => {
    seedState(1, 'new')

    render(<SpeakeaBanner percentage={100} />)

    expect(screen.getByRole('region', { name: 'Un message du créateur' })).toBeInTheDocument()
    expect(storedState().visits).toBe(2)
  })

  it('does not count another visit before five minutes have elapsed', () => {
    seedState(1, 'new', NOW.getTime() - 5 * 60_000 + 1)

    render(<SpeakeaBanner percentage={100} />)

    expect(storedState().visits).toBe(1)
    expect(screen.queryByRole('region', { name: 'Un message du créateur' }))
      .not.toBeInTheDocument()
  })

  it('records clicks and dismissals for later frequency rules', () => {
    seedState(1, 'new')
    render(<SpeakeaBanner percentage={100} />)

    fireEvent.click(screen.getByRole('link', { name: 'Speakea' }))
    expect(storedState().phase).toBe('clicked')

    fireEvent.click(screen.getByRole('button', { name: 'Fermer la publicité Speakea' }))
    expect(storedState().phase).toBe('closed')
    expect(screen.getByRole('region', { name: 'Un message du créateur' })).toHaveClass('is-leaving')
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByRole('region', { name: 'Un message du créateur' }))
      .not.toBeInTheDocument()
  })

  it('keeps each browser in a stable rollout cohort', () => {
    seedState(0, 'new', 0, 75)

    render(<SpeakeaBanner percentage={50} />)
    act(() => vi.advanceTimersByTime(10_000))

    expect(screen.queryByRole('region', { name: 'Un message du créateur' }))
      .not.toBeInTheDocument()
    expect(storedState()).toMatchObject({ visits: 0, cohort: 75 })
  })
})

describe('Speakea banner frequency', () => {
  it.each([
    [1, 'new', 'delay'],
    [2, 'new', 'now'],
    [4, 'closed', false],
    [5, 'closed', 'now'],
    [10, 'closed', 'now'],
    [20, 'closed', 'now'],
    [5, 'clicked', false],
    [10, 'clicked', 'now'],
    [20, 'clicked', 'now'],
  ] as const)('returns %s / %s → %s', (visits, phase, decision) => {
    expect(decideSpeakeaBannerShow(visits, phase)).toBe(decision)
  })
})
