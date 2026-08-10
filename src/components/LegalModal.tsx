import { X } from 'lucide-react'

type LegalModalProps = {
  type: 'privacy' | 'terms' | null
  onClose: () => void
}

export function LegalModal({ type, onClose }: LegalModalProps) {
  if (!type) return null
  const privacy = type === 'privacy'
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        <span className="eyebrow">Éclipse 2026</span>
        <h2 id="legal-title">{privacy ? 'Confidentialité' : 'Conditions d’utilisation'}</h2>
        {privacy ? (
          <>
            <p>L’application traite la position choisie dans votre navigateur pour calculer la direction du Soleil. Elle ne possède ni compte utilisateur, ni serveur applicatif, ni base de données.</p>
            <p>Votre position précise n’est demandée qu’après action sur « Ma position ». Elle n’est transmise à Google Maps que pour afficher la carte, rechercher un panorama ou effectuer une recherche de lieu. Le lien de partage ne contient les coordonnées qu’après votre action explicite.</p>
            <p>Les coordonnées arrondies sont également envoyées à Open-Meteo pour obtenir la prévision horaire. Google peut traiter des données conformément à sa <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">politique de confidentialité</a>. Aucun contenu Street View n’est analysé ni mis en cache par cette application.</p>
            <p>Lorsque la mesure d’audience est activée, Cloudflare Web Analytics reçoit son beacon standard de visite et de performance. Cette application ne lui envoie aucun événement personnalisé ; Cloudflare indique ne pas journaliser les paramètres de l’URL. Consultez la <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">politique de confidentialité Cloudflare</a>.</p>
          </>
        ) : (
          <>
            <p>Cette application fournit une simulation astronomique à titre informatif. Vérifiez les conditions météo, l’horizon et l’emplacement sur place. Ne vous placez jamais sur une chaussée pour reproduire le point de vue d’un panorama.</p>
            <p>La météo est une prévision Open-Meteo susceptible d’évoluer jusqu’à l’événement. Elle ne garantit ni l’absence de nuages ni la visibilité réelle.</p>
            <p>Les fonctionnalités et contenus Google Maps sont soumis aux <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">conditions supplémentaires Google Maps</a> et à la <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">politique de confidentialité Google</a>.</p>
            <p>Street View est une approximation : la photo peut être ancienne, prise depuis la chaussée et légèrement décalée ou inclinée. L’altitude du Soleil est convertie dans le repère de la caméra sans correction de pente inaccessible à l’API.</p>
          </>
        )}
      </section>
    </div>
  )
}
