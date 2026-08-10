import { useEffect, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { hasGoogleMapsApiKey, loadGoogleLibrary } from '../lib/googleMaps'
import type { ObserverLocation } from '../types'

type LocationSearchProps = {
  observer: ObserverLocation
  onSelect: (location: ObserverLocation) => void
  autoFocus?: boolean
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-enabled'

const SEARCH_MESSAGES: Record<'error' | 'not-enabled', string> = {
  error: 'Recherche indisponible. Cliquez sur la carte.',
  // Autocomplete is served by Places UI Kit, but resolving the chosen
  // prediction to coordinates is a Place Details call — a different product
  // that has to be enabled separately. Suggestions appear, selection fails.
  'not-enabled': 'Activez « Places API (New) » dans Google Cloud pour la recherche.',
}

/**
 * A denied Place Details call is a project-configuration problem, not a
 * transient one, so it earns its own message rather than the generic failure.
 */
function isApiNotEnabled(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /PERMISSION_DENIED|has not been used in project|is disabled/i.test(text)
}

export function LocationSearch({ observer, onSelect, autoFocus = false }: LocationSearchProps) {
  const autocompleteHostRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef(observer)
  const [status, setStatus] = useState<SearchStatus>(
    hasGoogleMapsApiKey ? 'loading' : 'idle',
  )

  observerRef.current = observer

  useEffect(() => {
    if (!hasGoogleMapsApiKey) return
    let cancelled = false
    let autocomplete: google.maps.places.BasicPlaceAutocompleteElement | null = null

    async function initialize() {
      try {
        const places = await loadGoogleLibrary('places')
        if (cancelled || !autocompleteHostRef.current) return

        autocomplete = new places.BasicPlaceAutocompleteElement({
          requestedLanguage: 'fr',
          placeholder: 'Rechercher un lieu…',
          description: 'Rechercher un lieu d’observation dans le monde',
          noInputIcon: true,
        })
        autocomplete.className = 'places-autocomplete'
        autocomplete.style.colorScheme = 'dark'
        autocomplete.origin = observerRef.current

        // Resolving the place directly beats mounting a PlaceDetailsCompact
        // element: that one has to be visible before it will fetch, which left
        // a details panel parked over the map with no way to dismiss it.
        autocomplete.addEventListener('gmp-select', (event) => {
          const place = event.place
          if (!place) return
          setStatus('loading')

          // For an EEA-billed project, Places API content used with a map is
          // limited to coordinates and the Place ID. The autocomplete itself
          // remains a Places UI Kit component, but the direct Place Details
          // request must not retrieve a Google display name or address.
          place
            .fetchFields({ fields: ['location'] })
            .then(() => {
              if (cancelled) return
              const location = place.location
              if (!location) {
                setStatus('error')
                return
              }
              onSelect({
                lat: location.lat(),
                lng: location.lng(),
                label: 'Adresse sélectionnée',
                source: 'search',
                placeId: place.id,
              })
              setStatus('ready')
            })
            .catch((error: unknown) => {
              console.error('Place lookup failed', error)
              if (!cancelled) setStatus(isApiNotEnabled(error) ? 'not-enabled' : 'error')
            })
        })
        const handleAutocompleteError = () => setStatus('error')
        autocomplete.addEventListener('gmp-error', handleAutocompleteError)
        autocomplete.addEventListener('gmp-requesterror', handleAutocompleteError)

        autocompleteHostRef.current.replaceChildren(autocomplete)
        setStatus('ready')
      } catch (error) {
        console.error('Places UI Kit failed to load', error)
        if (!cancelled) setStatus('error')
      }
    }

    void initialize()
    return () => {
      cancelled = true
      autocomplete?.remove()
    }
  }, [onSelect])

  useEffect(() => {
    const element = autocompleteHostRef.current?.firstElementChild
    if (element instanceof HTMLElement && 'origin' in element) {
      ;(element as google.maps.places.BasicPlaceAutocompleteElement).origin = observer
    }
  }, [observer])

  useEffect(() => {
    if (!autoFocus) return undefined
    const frame = window.requestAnimationFrame(() => {
      const element = autocompleteHostRef.current?.firstElementChild
      if (element instanceof HTMLElement) element.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])

  if (!hasGoogleMapsApiKey) {
    return (
      <div className="location-search-wrap">
        <div className="location-search location-search--fallback" title="Ajoutez la clé Google Maps pour activer la recherche">
          <Search aria-hidden="true" size={16} />
          <input aria-label="Recherche d’adresse indisponible" disabled placeholder="Rechercher un lieu…" />
          <span className="api-chip">Démo</span>
        </div>
      </div>
    )
  }

  return (
    <div className="location-search-wrap">
      <div className="location-search">
        <Search aria-hidden="true" size={16} />
        <div className="places-host" ref={autocompleteHostRef} />
        {status === 'loading' && <span className="search-spinner" aria-label="Chargement" />}
      </div>
      {(status === 'error' || status === 'not-enabled') && (
        <div className="search-error" role="status">
          <MapPin size={13} /> {SEARCH_MESSAGES[status]}
        </div>
      )}
    </div>
  )
}
