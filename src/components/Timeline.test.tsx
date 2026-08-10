/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import type { EclipseSnapshot } from '../types'
import { Timeline } from './Timeline'

const snapshot = {
  date: new Date('2026-08-12T18:17:00.000Z'),
  obscuration: 0.92,
  phaseLabel: 'Maximum',
  circumstances: {
    begin: { time: new Date('2026-08-12T17:22:00.000Z'), altitude: 16 },
    maximum: { time: new Date('2026-08-12T18:17:00.000Z'), altitude: 8 },
    end: { time: new Date('2026-08-12T19:09:00.000Z'), altitude: 0 },
    peakObscuration: 0.92,
    kind: 'partial',
  },
} as EclipseSnapshot

function playback(playing = false): TimelinePlaybackController {
  return {
    playing,
    stopPlayback: vi.fn(),
    togglePlayback: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Timeline', () => {
  it('uses the local eclipse contacts as its visible range', () => {
    const onMinuteChange = vi.fn()
    render(
      <Timeline
        minute={62}
        snapshot={snapshot}
        onMinuteChange={onMinuteChange}
        playback={playback()}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Heure simulée' })
    expect(slider).toHaveAttribute('min', '7')
    expect(slider).toHaveAttribute('max', '114')
    expect(slider).toHaveAttribute('step', 'any')
    expect(screen.getByText('19:22')).toBeInTheDocument()
    expect(screen.getByText('21:09')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Aller au maximum, 20:17' }))
    expect(onMinuteChange).toHaveBeenCalledWith(62)
  })

  it('delegates playback to the shared controller', () => {
    const controller = playback()
    render(
      <Timeline
        minute={62}
        snapshot={snapshot}
        onMinuteChange={vi.fn()}
        playback={controller}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Lire l’éclipse' }))
    expect(controller.togglePlayback).toHaveBeenCalledOnce()
  })

  it('accepts fractional controlled values but rounds direct drag input', () => {
    const onMinuteChange = vi.fn()
    render(
      <Timeline
        minute={8.375}
        snapshot={snapshot}
        onMinuteChange={onMinuteChange}
        playback={playback(true)}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Heure simulée' })
    expect(slider).toHaveValue('8.375')
    fireEvent.change(slider, { target: { value: '8.7' } })
    expect(onMinuteChange).toHaveBeenLastCalledWith(9)
  })

  it('stops playback as soon as the desktop slider is grabbed', () => {
    const controller = playback(true)
    render(
      <Timeline
        minute={62}
        snapshot={snapshot}
        onMinuteChange={vi.fn()}
        playback={controller}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Heure simulée' }))
    expect(controller.stopPlayback).toHaveBeenCalledOnce()
  })
})
