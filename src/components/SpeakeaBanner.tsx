import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { SPEAKEA_BANNER_PERCENTAGE } from '../config/features'
import {
  decideSpeakeaBannerShow,
  type SpeakeaBannerPhase,
} from '../lib/speakeaBanner'

const SPEAKEA_URL = 'https://speakea.app/?utm_source=eclipse'
const STORAGE_KEY = 'speakea-banner-v1'
const SHOW_AFTER_MS = 10_000
const VISIT_GAP_MS = 5 * 60_000
const LEAVE_MS = 300

type BannerState = {
  visits: number
  lastVisitAt: number
  phase: SpeakeaBannerPhase
  cohort: number
}

const DEFAULT_STATE: BannerState = {
  visits: 0,
  lastVisitAt: 0,
  phase: 'new',
  cohort: -1,
}

function validPhase(value: unknown): value is SpeakeaBannerPhase {
  return value === 'new' || value === 'closed' || value === 'clicked'
}

function readState(): BannerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }

    const value = JSON.parse(raw) as Partial<BannerState>
    return {
      visits: Number.isFinite(value.visits) && (value.visits ?? 0) >= 0
        ? Math.floor(value.visits ?? 0)
        : 0,
      lastVisitAt: Number.isFinite(value.lastVisitAt) && (value.lastVisitAt ?? 0) >= 0
        ? value.lastVisitAt ?? 0
        : 0,
      phase: validPhase(value.phase) ? value.phase : 'new',
      cohort: Number.isFinite(value.cohort)
        && (value.cohort ?? -1) >= 0
        && (value.cohort ?? 100) < 100
        ? value.cohort ?? -1
        : -1,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function writeState(state: BannerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Frequency capping is best-effort when browser storage is unavailable.
  }
}

type SpeakeaBannerProps = {
  percentage?: number
}

export function SpeakeaBanner({
  percentage = SPEAKEA_BANNER_PERCENTAGE,
}: SpeakeaBannerProps) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const bannerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = readState()
    const cohort = previous.cohort >= 0 ? previous.cohort : Math.random() * 100
    const allocatedState = { ...previous, cohort }
    writeState(allocatedState)

    if (cohort >= percentage) return undefined

    const now = Date.now()
    const isNewVisit = previous.visits === 0
      || now - previous.lastVisitAt >= VISIT_GAP_MS
    const visits = isNewVisit ? previous.visits + 1 : previous.visits
    writeState({ ...allocatedState, visits, lastVisitAt: now })

    const decision = decideSpeakeaBannerShow(visits, previous.phase)
    if (!decision) return undefined
    if (decision === 'now') {
      setVisible(true)
      return undefined
    }

    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [percentage])

  useLayoutEffect(() => {
    if (!visible) return undefined

    const root = document.documentElement
    const updateHeight = () => {
      root.style.setProperty(
        '--speakea-banner-h',
        `${Math.ceil(bannerRef.current?.getBoundingClientRect().height ?? 0)}px`,
      )
    }

    updateHeight()
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateHeight)
    if (bannerRef.current) resizeObserver?.observe(bannerRef.current)
    window.addEventListener('resize', updateHeight)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateHeight)
      root.style.removeProperty('--speakea-banner-h')
    }
  }, [visible])

  if (!visible) return null

  const setPhase = (phase: SpeakeaBannerPhase) => writeState({ ...readState(), phase })
  const dismiss = () => {
    setPhase('closed')
    setLeaving(true)
    window.setTimeout(() => setVisible(false), LEAVE_MS)
  }
  const onVisit = () => setPhase('clicked')

  return (
    <div
      ref={bannerRef}
      className={`speakea-banner${leaving ? ' is-leaving' : ''}`}
      role="region"
      aria-label="Un message du créateur"
    >
      <p>
        Je développe aussi{' '}
        <a href={SPEAKEA_URL} target="_blank" rel="noreferrer" onClick={onVisit}>
          Speakea
        </a>
        , une application pour progresser en anglais en parlant vraiment :{' '}
        <a href={SPEAKEA_URL} target="_blank" rel="noreferrer" onClick={onVisit}>
          speakea.app
        </a>
      </p>
      <button type="button" onClick={dismiss} aria-label="Fermer la publicité Speakea">
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  )
}
