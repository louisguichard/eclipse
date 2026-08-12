import { Check, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  CONTACT_EMAIL,
  IGN_ATTRIBUTION,
  PROVENANCE,
  SAFETY_STANDARD,
  SITE_AUTHOR,
  SITE_AUTHOR_URL,
  SITE_HOST,
  SITE_REPOSITORY,
} from '../config/site'

type AboutModalProps = {
  open: boolean
  onClose: () => void
}

/**
 * One panel for everything a reader may reasonably ask of this application:
 * how to look at the Sun without harm, how the figures are produced, what the
 * application cannot know, and who publishes it.
 *
 * Terms and privacy used to be two separate dialogs. They are sections here —
 * fewer entry points, and the limits are read alongside the method rather than
 * filed away under legalese.
 */
export function AboutModal({ open, onClose }: AboutModalProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, open])

  useEffect(() => {
    if (!copied) return undefined
    const timeout = window.setTimeout(() => setCopied(false), 2_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copyEmail = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setCopied(true)
    } catch (error) {
      console.error('Copy failed', error)
    }
  }, [])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <span className="eyebrow">Éclipse 2026</span>
        <h2 id="about-title">À propos</h2>

        <div className="legal-modal__safety">
          <strong>Ne regardez jamais le Soleil sans lunettes {SAFETY_STANDARD}.</strong>
          <p>
            Une éclipse partielle n’offre aucun instant sûr à l’œil nu : même à 99 % masqué, le
            Soleil brûle la rétine sans douleur ni signal d’alerte. Les lunettes de soleil, les
            verres fumés et les films photographiques ne protègent pas. Seul un filtre certifié{' '}
            {SAFETY_STANDARD}, intact et non rayé, convient.
          </p>
        </div>

        <h3>Méthode</h3>
        <p>
          Les positions du Soleil et de la Lune sont calculées dans votre navigateur avec{' '}
          <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer">Astronomy Engine</a>,
          à partir des coordonnées que vous choisissez. L’application en déduit l’azimut, la
          hauteur et la fraction du disque solaire masquée, minute par minute. Aucun calcul n’est
          effectué sur un serveur, et l’application ne possède ni compte, ni base de données.
        </p>
        <p>
          Le panorama est une photographie Google Street View, réorientée vers la direction
          calculée. Elle peut dater de plusieurs années, avoir été prise depuis la chaussée et
          être légèrement décalée ou inclinée par rapport à votre point d’observation réel. La
          végétation, les travaux et les constructions récentes n’y figurent pas.
        </p>
        <p>
          La couche de relief indiquant les vues dégagées est calculée à partir des données{' '}
          <a href="https://geoservices.ign.fr/lidarhd" target="_blank" rel="noreferrer">IGN LiDAR HD</a>{' '}
          et <strong>ne couvre aujourd’hui que les 20 plus grandes agglomérations de France</strong>.
          Partout ailleurs, la carte n’analyse pas le relief : seule la direction du Soleil est
          fournie.
        </p>
        <p>
          La météo est une prévision horaire{' '}
          <a href="https://www.weatherapi.com/" target="_blank" rel="noreferrer">WeatherAPI.com</a>,
          susceptible d’évoluer jusqu’à l’événement. Elle ne garantit ni l’absence de nuages, ni la
          visibilité réelle.
        </p>

        <h3>Ce que l’application ne fait pas</h3>
        <p>
          Elle n’analyse pas l’image du panorama : le viseur vous aide à juger vous-même si un
          bâtiment, un arbre ou le relief masque la direction du Soleil, sans prétendre le
          déterminer à votre place. Vérifiez toujours l’horizon sur place. Ne vous placez jamais
          sur une chaussée pour reproduire le point de vue d’un panorama.
        </p>

        <h3>Sources</h3>
        <ul className="legal-modal__sources">
          {PROVENANCE.map((source) => (
            <li key={source.name}>
              <span>{source.label}</span>
              <a href={source.href} target="_blank" rel="noreferrer">{source.name}</a>
            </li>
          ))}
        </ul>
        <p className="legal-modal__credit">{IGN_ATTRIBUTION}</p>
        <p>
          Le code de l’application est public :{' '}
          <a href={SITE_REPOSITORY} target="_blank" rel="noreferrer">github.com/louisguichard/eclipse</a>.
        </p>

        <h3>Données personnelles</h3>
        <p>
          Ni compte, ni base de données, ni traceur publicitaire. Votre position précise n’est lue
          qu’après une action sur « Ma position », et le lien de partage ne contient vos
          coordonnées que si vous le demandez.
        </p>
        <p>
          Pour afficher une vue, le point choisi est envoyé à Google Street View — qui peut traiter
          votre adresse IP et ces coordonnées selon sa{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">politique de confidentialité</a>{' '}
          — puis, arrondi, à WeatherAPI.com pour la prévision, qui peut aussi traiter votre adresse
          IP selon sa{' '}
          <a href="https://www.weatherapi.com/privacy.aspx" target="_blank" rel="noreferrer">
            politique de confidentialité
          </a>. Vos recherches d’adresse partent vers la Géoplateforme (France) ou CartoCiudad
          (Espagne), ou sont traitées localement. Les panoramas sont assemblés en mémoire dans le
          navigateur et ne transitent par aucun serveur du projet.
        </p>
        <p>
          La mesure d’audience, lorsqu’elle est active, se limite au beacon standard de{' '}
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare Web Analytics</a>{' '}
          : pas de cookie, aucun événement personnalisé.
        </p>

        <h3>Conditions d’utilisation</h3>
        <p>
          Simulation fournie à titre informatif, sans garantie d’exactitude ni de disponibilité :
          vérifiez toujours l’horizon sur place. Les panoramas proviennent d’endpoints Google non
          documentés, qui peuvent changer ou cesser de répondre sans préavis ; leur usage reste
          soumis aux{' '}
          <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">conditions Google Maps</a>.
        </p>
        <p>
          Les informations météorologiques sont fournies à titre général. Les prévisions sont
          probabilistes et peuvent être inexactes pour un lieu ou une heure précise. Elles ne
          doivent pas être la seule base d’une décision concernant la sécurité des personnes,
          l’aviation, la navigation maritime ou la gestion d’une urgence : consultez toujours les
          services météorologiques officiels et les autorités compétentes dans ces situations.
        </p>

        <h3>Mentions légales</h3>
        <p>
          Éditeur et directeur de la publication :{' '}
          <a href={SITE_AUTHOR_URL} target="_blank" rel="noreferrer">{SITE_AUTHOR}</a> — projet
          personnel, non commercial, sans publicité. Hébergeur&nbsp;: {SITE_HOST}
          {/* SITE_HOST carries its own final period — "Vercel Inc." */}
        </p>

        <div className="legal-modal__contact">
          <span>Une erreur, une question&nbsp;?</span>
          <button type="button" onClick={copyEmail}>
            {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
            {copied ? 'Adresse copiée' : CONTACT_EMAIL}
          </button>
        </div>
      </section>
    </div>
  )
}
