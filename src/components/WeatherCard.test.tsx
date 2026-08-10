/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeatherCard } from './WeatherCard'
import type { WeatherResult } from '../types/weather'

afterEach(cleanup)

const refresh = vi.fn()

describe('WeatherCard', () => {
  it('renders only the useful forecast values and attribution', () => {
    const weather: WeatherResult = {
      status: 'ready',
      error: null,
      refresh,
      snapshot: {
        forecastTime: new Date('2026-08-12T18:00:00Z'),
        temperatureCelsius: 34.2,
        apparentTemperatureCelsius: 32.7,
        precipitationProbability: 0,
        weatherCode: 0,
        cloudCover: 8,
        visibilityMeters: 53_560,
        windSpeedKmh: 8.4,
        condition: { label: 'Ciel dégagé', icon: 'clear' },
      },
    }

    render(<WeatherCard weather={weather} />)

    expect(screen.getByText('34°')).toBeInTheDocument()
    expect(screen.getByText('Ciel dégagé')).toBeInTheDocument()
    expect(screen.getByText('20:00 · 8 % nuages')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Données Open-Meteo/ })).toHaveAttribute('href', 'https://open-meteo.com/')
  })

  it('shows a compact error instead of a blank card', () => {
    render(<WeatherCard weather={{ status: 'error', snapshot: null, error: 'Météo indisponible', refresh }} />)
    expect(screen.getByText('Météo indisponible')).toBeInTheDocument()
  })
})
