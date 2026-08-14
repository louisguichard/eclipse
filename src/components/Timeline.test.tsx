/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelinePlaybackController } from '../hooks/useTimelinePlayback'
import type { EclipseSnapshot } from '../types'
import { Timeline } from './Timeline'

const snapshot = {
  date: new Date('2027-08-02T09:01:00.000Z'),
  obscuration: 0.512,
  phaseLabel: 'Maximum',
  circumstances: {
    visible: true,
    begin: { time: new Date('2027-08-02T08:01:00.000Z'), altitude: 34 },
    maximum: { time: new Date('2027-08-02T09:01:00.000Z'), altitude: 43 },
    end: { time: new Date('2027-08-02T10:05:00.000Z'), altitude: 52 },
    peakObscuration: 0.512,
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
        minute={61}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        onMinuteChange={onMinuteChange}
        playback={playback()}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Heure simulée' })
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '125')
    expect(slider).toHaveAttribute('step', 'any')
    expect(screen.getByText('10:01')).toBeInTheDocument()
    expect(screen.getByText('12:05')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Aller au maximum, 11:01' }))
    expect(onMinuteChange).toHaveBeenCalledWith(61)
  })

  it('delegates playback to the shared controller', () => {
    const controller = playback()
    render(
      <Timeline
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

  it('preserves fractional contact times and direct drag input', () => {
    const onMinuteChange = vi.fn()
    render(
      <Timeline
        minute={8.375}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        onMinuteChange={onMinuteChange}
        playback={playback(true)}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Heure simulée' })
    expect(slider).toHaveValue('8.375')
    fireEvent.change(slider, { target: { value: '8.7' } })
    expect(onMinuteChange).toHaveBeenLastCalledWith(8.7)
  })

  it('stops playback as soon as the desktop slider is grabbed', () => {
    const controller = playback(true)
    render(
      <Timeline
        minute={61}
        snapshot={snapshot}
        timeZone="Europe/Paris"
        onMinuteChange={vi.fn()}
        playback={controller}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Heure simulée' }))
    expect(controller.stopPlayback).toHaveBeenCalledOnce()
  })

  it('formats every contact in the selected location time zone', () => {
    render(
      <Timeline
        minute={61}
        snapshot={snapshot}
        timeZone="America/New_York"
        onMinuteChange={vi.fn()}
        playback={playback()}
      />,
    )

    expect(screen.getAllByText('05:01')).toHaveLength(2)
    expect(screen.getByText('04:01')).toBeInTheDocument()
    expect(screen.getByText('06:05')).toBeInTheDocument()
  })

  it('replaces controls with an honest message outside the eclipse footprint', () => {
    const invisible = {
      ...snapshot,
      circumstances: { ...snapshot.circumstances, visible: false, kind: 'none' },
    }
    render(
      <Timeline
        minute={61}
        snapshot={invisible}
        timeZone="Asia/Tokyo"
        onMinuteChange={vi.fn()}
        playback={playback()}
      />,
    )

    expect(screen.getByText('Éclipse non visible depuis ce lieu')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})
