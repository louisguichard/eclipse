/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationSearch } from './LocationSearch'
import type { ObserverLocation } from '../types'

const googleMapsMocks = vi.hoisted(() => ({
  loadGoogleLibrary: vi.fn(),
}))

vi.mock('../lib/googleMaps', () => ({
  hasGoogleMapsApiKey: true,
  loadGoogleLibrary: googleMapsMocks.loadGoogleLibrary,
}))

const OBSERVER: ObserverLocation = {
  lat: 48.8566,
  lng: 2.3522,
  label: 'Paris, France',
  source: 'default',
}

/** A Places `Place` whose fields only exist once `fetchFields` has resolved. */
function placeStub(overrides: Record<string, unknown> = {}) {
  const resolved = {
    id: 'place-louvre',
    location: { lat: () => 48.860611, lng: () => 2.337644 },
    ...overrides,
  }
  const place: Record<string, unknown> = { id: resolved.id }
  let settle: (() => void) | null = null
  place.fetchFields = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = () => {
          Object.assign(place, resolved)
          resolve()
        }
      }),
  )
  return { place, resolve: () => settle?.() }
}

describe('LocationSearch', () => {
  let autocompleteElement: HTMLElement | null
  let autocompleteOptions: Record<string, unknown> | null

  beforeEach(() => {
    autocompleteElement = null
    autocompleteOptions = null
    googleMapsMocks.loadGoogleLibrary.mockResolvedValue({
      BasicPlaceAutocompleteElement: function BasicPlaceAutocompleteElement(
        options: Record<string, unknown>,
      ) {
        autocompleteOptions = options
        autocompleteElement = document.createElement('gmp-basic-place-autocomplete')
        return autocompleteElement
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  async function mountAndSelect(
    onSelect: (location: ObserverLocation) => void,
    stub: ReturnType<typeof placeStub>,
  ) {
    const view = render(<LocationSearch observer={OBSERVER} onSelect={onSelect} />)
    await waitFor(() => expect(autocompleteElement).not.toBeNull())
    await waitFor(() => expect(view.container.querySelector('.search-spinner')).toBeNull())

    const selectEvent = new Event('gmp-select')
    Object.defineProperty(selectEvent, 'place', { value: stub.place })
    act(() => {
      autocompleteElement?.dispatchEvent(selectEvent)
    })
    return view
  }

  it('keeps the French interface without restricting suggestions to France', async () => {
    render(<LocationSearch observer={OBSERVER} onSelect={vi.fn()} />)
    await waitFor(() => expect(autocompleteOptions).not.toBeNull())

    expect(autocompleteOptions).toMatchObject({
      requestedLanguage: 'fr',
      description: 'Rechercher un lieu d’observation dans le monde',
    })
    expect(autocompleteOptions).not.toHaveProperty('includedRegionCodes')
    expect(autocompleteOptions).not.toHaveProperty('requestedRegion')
  })

  it('resolves the selected place using only EEA-permitted map fields', async () => {
    const onSelect = vi.fn()
    const stub = placeStub()
    const { container } = await mountAndSelect(onSelect, stub)

    expect(stub.place.fetchFields).toHaveBeenCalledWith({
      fields: ['location'],
    })
    expect(container.querySelector('.search-spinner')).not.toBeNull()

    await act(async () => {
      stub.resolve()
    })

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith({
        lat: 48.860611,
        lng: 2.337644,
        label: 'Adresse sélectionnée',
        source: 'search',
        placeId: 'place-louvre',
      })
    })
    expect(container.querySelector('.search-spinner')).toBeNull()
  })

  it('leaves no panel behind — the details host is gone for good', async () => {
    const stub = placeStub()
    const { container } = await mountAndSelect(vi.fn(), stub)
    await act(async () => {
      stub.resolve()
    })
    expect(container.querySelector('.place-details-host')).toBeNull()
  })

  it('names the missing Google Cloud product when Place Details is denied', async () => {
    // The failure that looks like a bug in the app: suggestions come from
    // Places UI Kit, so they appear, and only the details call is refused.
    const stub = placeStub()
    stub.place.fetchFields = vi.fn(() =>
      Promise.reject(
        new Error(
          'PLACES_GET_PLACE: PERMISSION_DENIED: Places API (New) has not been used in project 1 before or it is disabled.',
        ),
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = await mountAndSelect(vi.fn(), stub)

    await waitFor(() => {
      expect(container.querySelector('.search-error')?.textContent).toContain('Places API (New)')
    })
  })

  it('falls back to the generic message for an ordinary failure', async () => {
    const stub = placeStub()
    stub.place.fetchFields = vi.fn(() => Promise.reject(new Error('NETWORK_ERROR')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = await mountAndSelect(vi.fn(), stub)

    await waitFor(() => {
      expect(container.querySelector('.search-error')?.textContent).toContain('Cliquez sur la carte')
    })
  })

  it('surfaces an error when the place carries no location', async () => {
    const onSelect = vi.fn()
    const stub = placeStub({ location: undefined })
    const { container } = await mountAndSelect(onSelect, stub)

    await act(async () => {
      stub.resolve()
    })

    expect(onSelect).not.toHaveBeenCalled()
    await waitFor(() => expect(container.querySelector('.search-error')).not.toBeNull())
  })
})
