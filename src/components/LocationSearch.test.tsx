/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../lib/search'
import type { ObserverLocation } from '../types'
import { LocationSearch } from './LocationSearch'

const searchMocks = vi.hoisted(() => ({
  resolveSearchResult: vi.fn(),
  searchLocations: vi.fn(),
}))

vi.mock('../lib/search', () => ({
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  MIN_SEARCH_CHARACTERS: 3,
  SEARCH_DEBOUNCE_MS: 320,
  resolveSearchResult: searchMocks.resolveSearchResult,
  searchLocations: searchMocks.searchLocations,
}))

const OBSERVER: ObserverLocation = {
  lat: 48.8566,
  lng: 2.3522,
  label: 'Paris, France',
  source: 'default',
}

const RESULTS: SearchResult[] = [
  {
    id: 'fr:paris',
    label: 'Paris',
    detail: 'France · Géoplateforme',
    provider: 'geoplateforme',
    lat: 48.859,
    lng: 2.347,
    rank: 0,
  },
  {
    id: 'world:2643743',
    label: 'London, Royaume-Uni',
    detail: 'Ville · GeoNames',
    provider: 'geonames',
    lat: 51.50853,
    lng: -0.12574,
    rank: 1,
  },
]

describe('LocationSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    searchMocks.searchLocations.mockResolvedValue(RESULTS)
    searchMocks.resolveSearchResult.mockImplementation(async (result: SearchResult) => ({
      lat: result.lat,
      lng: result.lng,
      label: result.label,
      source: 'search',
    }))
  })

  afterEach(() => {
    cleanup()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('waits for three characters and debounces the free providers', async () => {
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Pa' } })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(searchMocks.searchLocations).not.toHaveBeenCalled()
    expect(view.getByText('Saisissez encore 1 caractère.')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Paris' } })
    await act(async () => vi.advanceTimersByTimeAsync(319))
    expect(searchMocks.searchLocations).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))

    expect(searchMocks.searchLocations).toHaveBeenCalledOnce()
    expect(searchMocks.searchLocations.mock.calls[0]?.[0]).toBe('Paris')
    expect(view.getAllByRole('option')).toHaveLength(2)
  })

  it('isolates dynamic results from browser translation DOM rewrites', async () => {
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox')
    const search = view.container.querySelector('.location-search-wrap')

    expect(search?.getAttribute('translate')).toBe('no')
    expect(search?.classList.contains('notranslate')).toBe(true)

    fireEvent.change(input, { target: { value: 'Pa' } })
    const originalPopup = view.container.querySelector('.location-search__popup')
    const notice = view.getByText('Saisissez encore 1 caractère.')
    const translatedWrapper = document.createElement('font')
    originalPopup?.insertBefore(translatedWrapper, notice)
    translatedWrapper.appendChild(notice)

    expect(() => {
      fireEvent.change(input, { target: { value: 'Paris' } })
    }).not.toThrow()

    const replacementPopup = view.container.querySelector('.location-search__popup')
    expect(replacementPopup).not.toBe(originalPopup)
    expect(view.container.contains(translatedWrapper)).toBe(false)

    await act(async () => vi.advanceTimersByTimeAsync(320))
    expect(view.getAllByRole('option')).toHaveLength(2)
  })

  it('aborts an obsolete request as soon as the query changes', async () => {
    let firstSignal: AbortSignal | undefined
    searchMocks.searchLocations.mockImplementationOnce(
      (_query: string, options: { signal?: AbortSignal }) => {
        firstSignal = options.signal
        return new Promise(() => {})
      },
    )
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Paris' } })
    await act(async () => vi.advanceTimersByTimeAsync(320))
    expect(firstSignal?.aborted).toBe(false)

    fireEvent.change(input, { target: { value: 'Madrid' } })
    expect(firstSignal?.aborted).toBe(true)
  })

  it('reports a provider timeout instead of spinning forever', async () => {
    searchMocks.searchLocations.mockImplementationOnce(() => new Promise(() => {}))
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    fireEvent.change(view.getByRole('combobox'), { target: { value: 'Paris' } })

    await act(async () => vi.advanceTimersByTimeAsync(320 + 8_000))

    expect(view.getByText('Recherche momentanément indisponible.')).toBeTruthy()
    expect(view.getByRole('combobox').getAttribute('aria-busy')).toBe('false')
  })

  it('exposes a listbox and supports arrow/enter selection', async () => {
    const onSelect = vi.fn()
    const view = render(<LocationSearch observer={OBSERVER} onSelect={onSelect} />)
    const input = view.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'ville' } })
    await act(async () => vi.advanceTimersByTimeAsync(320))

    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(searchMocks.resolveSearchResult).toHaveBeenCalledWith(
      RESULTS[1],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(onSelect).toHaveBeenCalledWith({
      lat: 51.50853,
      lng: -0.12574,
      label: 'London, Royaume-Uni',
      source: 'search',
    })
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes suggestions with Escape and preserves the query', async () => {
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Paris' } })
    await act(async () => vi.advanceTimersByTimeAsync(320))

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('Paris')
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not leave the resolver busy when the selected label equals the query', async () => {
    searchMocks.searchLocations.mockResolvedValue([RESULTS[0]])
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Paris' } })
    await act(async () => vi.advanceTimersByTimeAsync(320))
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })
    expect(view.container.querySelector('.search-spinner')).toBeNull()

    fireEvent.change(input, { target: { value: 'Madrid' } })
    await act(async () => vi.advanceTimersByTimeAsync(320))
    expect(searchMocks.searchLocations).toHaveBeenCalledTimes(2)
  })

  it('focuses the native input when the mobile search opens', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const view = render(
      <LocationSearch observer={OBSERVER} onSelect={vi.fn()} autoFocus />,
    )
    expect(document.activeElement).toBe(view.getByRole('combobox'))
  })

  it('releases focus when the pointer goes to the scene, so the caret stops blinking', async () => {
    const scene = document.createElement('div')
    document.body.append(scene)
    const view = render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    const input = view.getByRole('combobox') as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)

    // Inside the field the caret stays where the reader put it.
    fireEvent.pointerDown(input)
    expect(document.activeElement).toBe(input)

    // The panorama swallows the event to turn the view, so the blur is ours.
    fireEvent.pointerDown(scene)
    expect(document.activeElement).not.toBe(input)
    scene.remove()
  })
})
