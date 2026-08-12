import { MapPin, Search } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  isAbortError,
  MIN_SEARCH_CHARACTERS,
  resolveSearchResult,
  SEARCH_DEBOUNCE_MS,
  searchLocations,
} from '../lib/search'
import type { SearchResult } from '../lib/search'
import type { ObserverLocation } from '../types'

type LocationSearchProps = {
  observer: ObserverLocation
  onSelect: (location: ObserverLocation) => void
  autoFocus?: boolean
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'resolving' | 'error'
const SEARCH_TIMEOUT_MS = 8_000

function optionDomId(listboxId: string, result: SearchResult): string {
  return `${listboxId}-${result.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function liveMessage(status: SearchStatus, results: SearchResult[]): string {
  if (status === 'loading') return 'Recherche en cours'
  if (status === 'resolving') return 'Localisation du résultat en cours'
  if (status === 'error') return 'La recherche est momentanément indisponible'
  if (status !== 'ready') return ''
  if (results.length === 0) return 'Aucun résultat'
  return `${results.length} résultat${results.length > 1 ? 's' : ''} disponible${results.length > 1 ? 's' : ''}`
}

export function LocationSearch({ observer, onSelect, autoFocus = false }: LocationSearchProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionControllerRef = useRef<AbortController | null>(null)
  const skipNextSearchRef = useRef(false)
  const listboxId = `location-results-${useId().replace(/:/g, '')}`
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    if (!autoFocus) return undefined
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      setStatus('idle')
      return undefined
    }

    const trimmedQuery = query.trim()
    const controller = new AbortController()
    if (trimmedQuery.length < MIN_SEARCH_CHARACTERS) {
      setResults([])
      setActiveIndex(-1)
      setStatus('idle')
      setOpen(trimmedQuery.length > 0)
      return () => controller.abort()
    }

    setStatus('loading')
    setOpen(true)
    let requestTimeout: number | null = null
    const timer = window.setTimeout(() => {
      requestTimeout = window.setTimeout(() => {
        controller.abort('timeout')
        setResults([])
        setActiveIndex(-1)
        setStatus('error')
      }, SEARCH_TIMEOUT_MS)
      void searchLocations(trimmedQuery, { signal: controller.signal })
        .then((nextResults) => {
          if (controller.signal.aborted) return
          setResults(nextResults)
          setActiveIndex(nextResults.length > 0 ? 0 : -1)
          setStatus('ready')
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return
          setResults([])
          setActiveIndex(-1)
          setStatus('error')
        })
        .finally(() => {
          if (requestTimeout !== null) window.clearTimeout(requestTimeout)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      if (requestTimeout !== null) window.clearTimeout(requestTimeout)
      controller.abort()
    }
  }, [query])

  useEffect(() => () => selectionControllerRef.current?.abort(), [])

  /**
   * Dragging the panorama swallows the pointer event to turn the view, which
   * also stops the browser from moving focus — so the caret went on blinking in
   * a field nobody was typing in. Releasing focus ourselves is what makes it go
   * away when attention moves elsewhere on the page.
   */
  useEffect(() => {
    const release = (event: PointerEvent) => {
      const input = inputRef.current
      if (!input || document.activeElement !== input) return
      const { target } = event
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      input.blur()
    }
    document.addEventListener('pointerdown', release, true)
    return () => document.removeEventListener('pointerdown', release, true)
  }, [])

  const selectResult = useCallback(async (result: SearchResult) => {
    selectionControllerRef.current?.abort()
    const controller = new AbortController()
    selectionControllerRef.current = controller
    setStatus('resolving')
    const timeout = window.setTimeout(() => {
      controller.abort('timeout')
      if (selectionControllerRef.current === controller) {
        setStatus('error')
        setOpen(true)
      }
    }, SEARCH_TIMEOUT_MS)
    try {
      const location = await resolveSearchResult(result, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (location.label !== query) {
        skipNextSearchRef.current = true
        setQuery(location.label)
      }
      setResults([])
      setActiveIndex(-1)
      setOpen(false)
      setStatus('idle')
      onSelect(location)
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return
      setStatus('error')
      setOpen(true)
    } finally {
      window.clearTimeout(timeout)
    }
  }, [onSelect, query])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (results.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => index >= results.length - 1 ? 0 : index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => index <= 0 ? results.length - 1 : index - 1)
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(results.length - 1)
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      const result = results[activeIndex]
      if (result) void selectResult(result)
    }
  }

  const showPopup = open && query.trim().length > 0
  const listboxOpen = showPopup && results.length > 0
  const busy = status === 'loading' || status === 'resolving'
  const activeResult = activeIndex >= 0 ? results[activeIndex] : null
  const popupContentKey = query.trim().length < MIN_SEARCH_CHARACTERS
    ? 'hint'
    : status === 'error'
      ? 'error'
      : status === 'ready' && results.length === 0
        ? 'empty'
        : results.length > 0
          ? 'results'
          : 'pending'

  return (
    <div
      ref={wrapRef}
      // Browser translators replace React-owned text nodes and attributes. This
      // control rerenders on every keystroke, so an external rewrite can make
      // React remove or insert relative to a node that has already been moved.
      className="location-search-wrap notranslate"
      translate="no"
      title={`Position actuelle : ${observer.label}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <div className="location-search">
        <Search aria-hidden="true" size={16} />
        <input
          ref={inputRef}
          className="location-search__input"
          type="search"
          value={query}
          placeholder="Rechercher une adresse ou une ville…"
          aria-label="Rechercher une adresse ou une ville"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listboxOpen}
          aria-controls={listboxOpen ? listboxId : undefined}
          aria-activedescendant={activeResult ? optionDomId(listboxId, activeResult) : undefined}
          aria-busy={busy}
          autoComplete="off"
          spellCheck="false"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (query.trim().length > 0) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {busy && <span className="search-spinner" aria-hidden="true" />}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage(status, results)}
      </span>

      {showPopup && (
        <div key={popupContentKey} className="location-search__popup">
          {query.trim().length < MIN_SEARCH_CHARACTERS ? (
            <p className="location-search__notice">
              Saisissez encore {MIN_SEARCH_CHARACTERS - query.trim().length} caractère{query.trim().length === MIN_SEARCH_CHARACTERS - 1 ? '' : 's'}.
            </p>
          ) : status === 'error' ? (
            <p className="location-search__notice location-search__notice--error">
              <MapPin aria-hidden="true" size={13} /> Recherche momentanément indisponible.
            </p>
          ) : status === 'ready' && results.length === 0 ? (
            <p className="location-search__notice">Aucun lieu trouvé.</p>
          ) : results.length > 0 ? (
            <ul id={listboxId} className="location-search__results" role="listbox">
              {results.map((result, index) => (
                <li key={result.id} role="presentation">
                  <button
                    id={optionDomId(listboxId, result)}
                    className="location-search__option"
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => void selectResult(result)}
                  >
                    <MapPin aria-hidden="true" size={14} />
                    <span>
                      <strong>{result.label}</strong>
                      <small>{result.detail}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="location-search__sources">
            Sources :{' '}
            <a href="https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/" target="_blank" rel="noreferrer">Géoplateforme</a>
            {' · '}
            <a href="https://www.cartociudad.es/" target="_blank" rel="noreferrer">CartoCiudad</a>
            {' · '}
            <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>
          </p>
        </div>
      )}
    </div>
  )
}
