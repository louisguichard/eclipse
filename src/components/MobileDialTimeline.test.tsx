// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import type { EclipseSnapshot } from '../types'
import { MobileDialTimeline } from './MobileDialTimeline'

const snapshot = {
  date: new Date('2027-08-02T09:01:00.000Z'),
  circumstances: {
    visible: true,
    begin: { time: new Date('2027-08-02T08:01:00.000Z'), altitude: 34 },
    maximum: { time: new Date('2027-08-02T09:01:00.000Z'), altitude: 43 },
    end: { time: new Date('2027-08-02T10:05:00.000Z'), altitude: 52 },
    peakObscuration: 0.512,
    kind: 'partial',
  },
} as EclipseSnapshot

function playback(): TimelinePlaybackController {
  return {
    playing: false,
    stopPlayback: vi.fn(),
    togglePlayback: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MobileDialTimeline', () => {
  it('exposes local contacts and a keyboard-operable slider', () => {
    const onMinuteChange = vi.fn()
    render(
      <MobileDialTimeline
        minute={61}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        onMinuteChange={onMinuteChange}
        playback={playback()}
      />,
    )

    expect(screen.getByText('11:01')).toBeInTheDocument()
    expect(screen.getByText('10:01')).toBeInTheDocument()
    expect(screen.getByText('12:05')).toBeInTheDocument()

    const slider = screen.getByRole('slider', { name: 'Heure de l’éclipse' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onMinuteChange).toHaveBeenLastCalledWith(62)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onMinuteChange).toHaveBeenLastCalledWith(60)
  })

  it('delegates playback to the same shared controller as desktop', () => {
    const controller = playback()
    render(
      <MobileDialTimeline
        minute={61}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        onMinuteChange={vi.fn()}
        playback={controller}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Lire l’éclipse' }))
    expect(controller.togglePlayback).toHaveBeenCalledOnce()
  })

  it('removes the dial and playback from the tab order while a menu blocks it', () => {
    render(
      <MobileDialTimeline
        minute={61}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        blocked
        onMinuteChange={vi.fn()}
        playback={playback()}
      />,
    )

    expect(screen.getByRole('slider', { name: 'Heure de l’éclipse', hidden: true })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Lire l’éclipse' })).toBeDisabled()
  })

  it('does not expose simulation controls where the eclipse is not visible', () => {
    const invisible = {
      ...snapshot,
      circumstances: { ...snapshot.circumstances, visible: false, kind: 'none' },
    }
    render(
      <MobileDialTimeline
        minute={61}
        snapshot={invisible}
        timeZone="Australia/Sydney"
        onMinuteChange={vi.fn()}
        playback={playback()}
      />,
    )

    expect(screen.getByText('Éclipse non visible ici')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
