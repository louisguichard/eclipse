import { Eye } from 'lucide-react'
import { PROVENANCE, SAFETY_STANDARD } from '../config/site'

type SceneFooterProps = {
  onAbout: () => void
}

/**
 * The permanent credibility line: what protects the reader's eyes, and where
 * every figure on screen comes from.
 *
 * Desktop has a spare band under the instruments, so both fit on one row,
 * gathered on a single translucent bar: a shadow alone could not hold the line
 * readable over sunlit pavement without shouting. Phones keep the photograph
 * edge to edge, so only the safety reminder stays on the scene, under the view
 * switcher — the sources live one tap away, in the title menu.
 */
export function SceneFooter({ onAbout }: SceneFooterProps) {
  return (
    <>
      <footer className="scene-footer" aria-label="Sécurité et sources">
        <div className="scene-footer__bar">
          <button type="button" className="scene-footer__safety" onClick={onAbout}>
            <Eye aria-hidden="true" size={12} />
            Ne regardez jamais le Soleil sans lunettes <b>{SAFETY_STANDARD}</b>
          </button>

          <span className="scene-footer__rule" aria-hidden="true" />

          <p className="provenance">
            {PROVENANCE.map((source) => (
              <span className="provenance__item" key={source.name}>
                <span>{source.label}</span>
                <a href={source.href} target="_blank" rel="noreferrer">{source.name}</a>
              </span>
            ))}
          </p>

          <span className="scene-footer__rule" aria-hidden="true" />

          <button type="button" className="scene-footer__about" onClick={onAbout}>
            Méthode
          </button>
        </div>
      </footer>

      <button type="button" className="safety-chip" onClick={onAbout}>
        <Eye aria-hidden="true" size={11} />
        Lunettes <b>{SAFETY_STANDARD}</b> obligatoires
      </button>
    </>
  )
}
