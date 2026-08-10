/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SunDisc } from './SunDisc'
import type { EclipseSnapshot } from '../types'

function snapshot(overrides: Partial<EclipseSnapshot> = {}): EclipseSnapshot {
  return {
    date: new Date('2026-08-12T18:17:00.000Z'),
    sun: { azimuth: 283.8, altitude: 7.7 },
    moon: { azimuth: 283.9, altitude: 7.8 },
    sunAngularRadius: 0.2629,
    moonAngularRadius: 0.2712,
    moonOffset: { horizontal: 0, vertical: 0 },
    obscuration: 0.92,
    magnitude: 0.95,
    phaseLabel: 'Maximum',
    circumstances: {
      begin: { time: new Date('2026-08-12T17:22:00.000Z'), obscuration: 0 },
      maximum: { time: new Date('2026-08-12T18:17:00.000Z'), obscuration: 0.92 },
      end: { time: new Date('2026-08-12T19:09:00.000Z'), obscuration: 0 },
    },
    sunset: new Date('2026-08-12T19:11:00.000Z'),
    ...overrides,
  } as EclipseSnapshot
}

function offsets(node: Element) {
  const style = node.getAttribute('style') ?? ''
  return {
    x: /--moon-x:\s*([^;]+)/.exec(style)?.[1]?.trim(),
    y: /--moon-y:\s*([^;]+)/.exec(style)?.[1]?.trim(),
    scale: /--moon-scale:\s*([^;]+)/.exec(style)?.[1]?.trim(),
  }
}

describe('SunDisc', () => {
  afterEach(cleanup)

  it('centres the Moon at maximum coverage', () => {
    const { container } = render(<SunDisc snapshot={snapshot()} />)
    const disc = container.querySelector('.readout__disc')!
    expect(offsets(disc)).toMatchObject({ x: '0%', y: '0%' })
  })

  it('expresses the offset in percent so one badge geometry serves every size', () => {
    const { container } = render(
      <SunDisc snapshot={snapshot({ moonOffset: { horizontal: 0.2629, vertical: 0 } })} />,
    )
    const { x } = offsets(container.querySelector('.readout__disc')!)
    // One solar radius of separation moves the Moon by the badge fraction, and
    // by nothing measured in pixels — that is what keeps it size-independent.
    expect(x?.endsWith('%')).toBe(true)
    expect(Number.parseFloat(x!)).toBeCloseTo((15.5 / 46) * 100, 4)
  })

  it('flips the vertical sign, because the sky is measured upward and CSS downward', () => {
    const { container } = render(
      <SunDisc snapshot={snapshot({ moonOffset: { horizontal: 0, vertical: 0.2629 } })} />,
    )
    const { y } = offsets(container.querySelector('.readout__disc')!)
    expect(Number.parseFloat(y!)).toBeCloseTo(-(15.5 / 46) * 100, 4)
  })

  it('scales the lunar disc by the true radius ratio', () => {
    const { container } = render(<SunDisc snapshot={snapshot()} />)
    const { scale } = offsets(container.querySelector('.readout__disc')!)
    expect(Number(scale)).toBeCloseTo(0.2712 / 0.2629, 6)
  })

  it('takes the class name it is given, so the phone summary can be smaller', () => {
    const { container } = render(
      <SunDisc snapshot={snapshot()} className="scene-readout__disc" />,
    )
    expect(container.querySelector('.scene-readout__disc')).not.toBeNull()
    expect(container.querySelector('.readout__disc')).toBeNull()
  })
})
