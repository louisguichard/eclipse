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
            <p>Votre position précise n’est demandée qu’après action sur « Ma position ». La position choisie apparaît dans l’URL afin que la vue puisse être partagée. Elle est envoyée à Google uniquement pour charger le panorama Street View Embed ; aucune API Google Maps ou Places facturable n’est utilisée.</p>
            <p>Les coordonnées arrondies sont envoyées à Open-Meteo pour obtenir la prévision horaire. Une recherche d’adresse peut interroger les géocodeurs publics français ou espagnol ; la recherche mondiale de villes utilise un index GeoNames téléchargé par le navigateur. Le fond de carte provient de données OpenStreetMap servies par le fournisseur configuré. Google peut traiter les données de l’iframe conformément à sa <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">politique de confidentialité</a>. Aucun contenu Street View n’est analysé ni mis en cache par cette application.</p>
            <p>Lorsque la mesure d’audience est activée, Cloudflare Web Analytics reçoit son beacon standard de visite et de performance. Cette application ne lui envoie aucun événement personnalisé ; Cloudflare indique ne pas journaliser les paramètres de l’URL. Consultez la <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">politique de confidentialité Cloudflare</a>.</p>
          </>
        ) : (
          <>
            <p>Cette application fournit une simulation astronomique à titre informatif. Vérifiez les conditions météo, l’horizon et l’emplacement sur place. Ne vous placez jamais sur une chaussée pour reproduire le point de vue d’un panorama.</p>
            <p>La météo est une prévision Open-Meteo susceptible d’évoluer jusqu’à l’événement. Elle ne garantit ni l’absence de nuages ni la visibilité réelle.</p>
            <p>Le panorama Google Street View Embed est soumis aux <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">conditions supplémentaires Google Maps</a>. La carte repose sur MapLibre et des données OpenStreetMap ; les résultats de recherche peuvent provenir de l’IGN, de CartoCiudad et de GeoNames, selon la zone.</p>
            <p>Street View est une approximation : la photo peut être ancienne, prise depuis la chaussée et légèrement décalée ou inclinée. L’altitude du Soleil est convertie dans le repère de la caméra sans correction de pente inaccessible à l’API.</p>
          </>
        )}
      </section>
    </div>
  )
}
