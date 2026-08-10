/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import type { EclipseSnapshot } from '../types'
import { EclipseInfo } from './EclipseInfo'

const snapshot = {
  date: new Date('2026-08-12T18:17:00.000Z'),
  obscuration: 0.9203,
  sun: { azimuth: 283.77, altitude: 7.76 },
  sunAngularRadius: 0.263,
  moonAngularRadius: 0.272,
  moonOffset: { horizontal: -0.009, vertical: -0.044 },
} as EclipseSnapshot

afterEach(cleanup)

describe('EclipseInfo', () => {
  it('keeps the compact desktop figures scientific and legible', () => {
    render(<EclipseInfo snapshot={snapshot} cloudCover={12.4} />)

    expect(screen.getByText('92 %')).toBeInTheDocument()
    expect(screen.getByText('284°')).toBeInTheDocument()
    expect(screen.getByText('ONO')).toBeInTheDocument()
    expect(screen.getByText('7,8°')).toBeInTheDocument()
    expect(screen.getByText('12 %')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
      'href',
      'https://open-meteo.com/',
    )
  })
})
