import { useLayoutEffect, useRef } from 'react'

const MAINTENANCE_MESSAGE = '🚧 Une mise à jour de l’application est en cours. En cas de problème, revenez d’ici une heure !'

export function MaintenanceBanner() {
  const bannerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const banner = bannerRef.current
    if (!banner) return undefined

    const root = document.documentElement
    const updateHeight = () => {
      root.style.setProperty(
        '--maintenance-banner-h',
        `${Math.ceil(banner.getBoundingClientRect().height)}px`,
      )
    }

    updateHeight()
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateHeight)
    resizeObserver?.observe(banner)
    window.addEventListener('resize', updateHeight)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateHeight)
      root.style.removeProperty('--maintenance-banner-h')
    }
  }, [])

  return (
    <div
      ref={bannerRef}
      className="maintenance-banner"
      role="status"
      aria-live="polite"
    >
      <p>{MAINTENANCE_MESSAGE}</p>
    </div>
  )
}
