import { useCallback, useState, type ReactNode } from 'react'
import { FAREWELL_ENABLED } from '../config/features'
import farewellPhoto from '../assets/farewell-2026.jpg'

/**
 * The eclipse has happened. What the site computed is now a memory, so the
 * photograph comes first and the instrument waits behind it: a single print,
 * two lines, and a way through for whoever still wants to look around.
 *
 * Nothing is remembered between loads. The bare address is the photograph —
 * every time, for everyone. What tells the two apart is the query string: a
 * shared link carries `lat`/`lng`, a debug session carries `debug`, and the
 * app itself writes the observer back into the URL seconds after it opens. So
 * a visitor who steps through and then uses the site can refresh, share or
 * come back on that address without meeting the print again; typing the plain
 * address returns to it.
 */
function deepLinked(): boolean {
  return window.location.search.length > 0
}

export function Farewell({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="farewell">
      <figure className="farewell__print">
        <div className="farewell__frame">
          <img
            className="farewell__photo"
            src={farewellPhoto}
            alt="Une foule d’observateurs lunettes aux yeux devant l’Institut de France, à Paris, pendant l’éclipse du 12 août 2026."
            width={1600}
            height={1200}
            fetchPriority="high"
          />
          {/* Set along the right edge of the print, the way a photographer
              signs the mount rather than the image. */}
          <figcaption className="farewell__credit">
            Photo <span aria-hidden="true">·</span> Mahaut Colliaut
          </figcaption>
        </div>
        <p className="farewell__words">
          <span className="farewell__lead">C’est terminé.</span>
          <span className="farewell__next">Rendez-vous le 2 août 2027 !</span>
        </p>
      </figure>

      {/* The only way back in. It arrives once the photograph has been seen,
          and stays quiet enough that nobody reads it before the two lines. */}
      <button type="button" className="farewell__enter" onClick={onEnter}>
        Revenir au site
      </button>
    </div>
  )
}

/**
 * Keeps the application unmounted while the farewell is on screen: no map, no
 * panorama, no weather call for a visitor who only came to read one sentence.
 */
export function FarewellGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(
    () => !FAREWELL_ENABLED || deepLinked(),
  )

  const enter = useCallback(() => setEntered(true), [])

  if (entered) return children
  return <Farewell onEnter={enter} />
}
