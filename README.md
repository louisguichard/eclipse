# Éclipse 2026 — Où regarder ?

💡 Ce projet a été entièrement vibe-codé, principalement avec Codex (GPT 5.6 Sol). L'ensemble du code et de la documentation a été écrit par IA (à la seule exception de ce paragraphe).

Une application web mobile et desktop pour savoir **où regarder dans le ciel le mercredi 12 août 2026** depuis n’importe quel point du monde. Street View occupe la scène principale ; la carte, la simulation astronomique, la météo horaire et la chronologie restent accessibles dans des cartes compactes. Hors de l’empreinte de l’éclipse, l’interface l’indique explicitement au lieu d’afficher un événement futur.

Choisissez une adresse, cliquez sur la carte ou autorisez votre position : l’application demande à Street View Embed une vue extérieure proche, calcule la position apparente du Soleil et de la Lune avec [`astronomy-engine`](https://github.com/cosinekitty/astronomy), puis oriente la caméra vers l’éclipse. Le viseur aide à juger visuellement si un bâtiment, un arbre ou le relief masque cette direction — sans prétendre analyser l’image.

> **Sécurité solaire :** ne regardez jamais directement le Soleil sans lunettes d’éclipse conformes **ISO 12312-2**. Des lunettes de soleil, un téléphone ou un filtre photographique ordinaire ne protègent pas les yeux.

## Aperçu

> Capture d’écran à ajouter après le premier déploiement : Paris à 20 h 17, Street View plein cadre, carte LiDAR flottante et prévision horaire.

Fonctions principales :

- recherche d’adresse gratuite avec la Géoplateforme française et CartoCiudad en Espagne, complétée par un index mondial GeoNames chargé à la demande ;
- sélection par recherche, carte ou géolocalisation ;
- rayon d’azimut solaire mis à jour minute par minute ;
- panorama Street View Embed gratuit orienté vers le Soleil ;
- carte vectorielle MapLibre fondée sur OpenStreetMap, sans Maps JavaScript ni facturation par vue ;
- disque Soleil–Lune calculé à partir des positions et rayons angulaires apparents ;
- chronologie mondiale 15 h 30–20 h UTC avec lecture accélérée, contacts locaux observables et coucher du Soleil ;
- diagnostic honnête de visibilité sans prétendre analyser l’image Street View ;
- prévision horaire Open-Meteo pour le lieu et l’heure sélectionnés ;
- couche de visibilité active par défaut : Paris à 2 m, puis les sept autres départements franciliens à 5 m depuis R2 ;
- URL partageable (`lat`, `lng`, `time`) et mode diagnostic `?debug=true` ;
- interface française responsive et métadonnées PWA.

## Prérequis

- Node.js 22.x (22.12 ou plus récent recommandé) ;
- npm 10 ou plus récent ;
- un projet Google Cloud avec **Maps Embed API** activée ;
- une clé navigateur limitée à cette seule API et aux référents du site.

Python 3.11 ou plus récent n’est nécessaire que pour **régénérer** la couche LiDAR ; les tuiles prêtes à servir sont déjà incluses dans `public/visibility/`.

Aucun serveur applicatif ni base de données n’est nécessaire. Les calculs astronomiques et l’état de l’interface restent dans le navigateur.

La météo utilise l’API Forecast Open-Meteo sans clé. Son offre gratuite est réservée aux usages non commerciaux et impose l’attribution ; pour une exploitation commerciale, utilisez leur offre adaptée et vérifiez les [conditions Open-Meteo](https://open-meteo.com/en/terms).

## Installation locale

```bash
git clone https://github.com/louisguichard/eclipse.git
cd eclipse-2026
npm ci
cp .env.example .env.local
```

Renseignez ensuite `.env.local` :

```dotenv
VITE_GOOGLE_MAPS_EMBED_API_KEY=votre_cle_navigateur_maps_embed
VITE_BASEMAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
# Cible recommandée après publication de l’archive sur R2 :
VITE_BASEMAP_PMTILES_URL=https://tiles.example.fr/basemap/eclipse-2026-v1.pmtiles
VITE_VISIBILITY_TILE_BASE_URL=https://cdn.example.fr/eclipse/visibility
VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=votre_token_de_site_optionnel
```

`VITE_GOOGLE_MAPS_EMBED_API_KEY` est la seule clé Google utilisée. Il n’existe aucun chargeur Maps JavaScript, Places ou Dynamic Street View, ni aucun interrupteur permettant de les réactiver. Pour ne pas casser immédiatement un ancien `.env.local`, `VITE_GOOGLE_MAPS_API_KEY` peut temporairement servir de clé Embed de compatibilité, mais il ne déclenche aucun appel Google JavaScript.

La carte préfère `VITE_BASEMAP_PMTILES_URL` lorsqu’elle est définie. Sinon elle utilise `VITE_BASEMAP_STYLE_URL`, avec le style sombre public OpenFreeMap comme valeur par défaut. Ce service gratuit permet un démarrage immédiat, mais ne fournit pas de SLA : une archive PMTiles versionnée sur R2 reste la cible de production maîtrisée.

`VITE_VISIBILITY_TILE_BASE_URL` est facultatif pour la seule couverture parisienne incluse sous `/visibility/paris-2026-max-v1/`. Il doit être défini pour charger les jeux régionaux publiés sur R2. Indiquez le dossier parent de tous les dossiers versionnés, sans ajouter un nom de version à la variable. Cette URL n’est pas un secret.

`VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` est facultatif et public. Lorsqu'il est renseigné, le beacon officiel Cloudflare Web Analytics est chargé uniquement dans le build de production. Il n'est jamais chargé avec `npm run dev`, ni lorsqu'aucun token n'est configuré.

Les variables `VITE_*` sont injectées dans le bundle client : **la clé est visible dans le navigateur par conception**. Sa protection repose sur les restrictions de domaine et d’API, pas sur son camouflage. Ne commitez jamais `.env.local` ni une vraie clé dans `.env.example`.

Lancez le développement :

```bash
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173). La carte et la recherche fonctionnent sans clé Google ; seule la vue Street View exige la clé Embed.

## Carte et recherche sans API Google payante

### Fond MapLibre et PMTiles

[`maplibre-gl`](https://maplibre.org/maplibre-gl-js/docs/) assure le rendu et les interactions dans le navigateur. Le mode auto-hébergé utilise [`pmtiles`](https://docs.protomaps.com/pmtiles/) et le thème sombre [`@protomaps/basemaps`](https://docs.protomaps.com/basemaps/). L’attribution OpenStreetMap reste visible dans la carte.

Pour basculer sur R2 :

1. préparez une archive Protomaps sous `data/basemap/eclipse-2026.pmtiles` ;
2. vérifiez sans réseau avec `npm run r2:basemap:plan` ;
3. lancez `npm run r2:basemap:publish -- --dry-run` ;
4. publiez avec `npm run r2:basemap:publish` ;
5. placez l’URL publique versionnée dans `VITE_BASEMAP_PMTILES_URL` et redéployez.

Le fichier est envoyé par défaut sous `basemap/eclipse-2026-v1.pmtiles` avec un cache immutable d’un an. Le script n’efface aucun objet. Le domaine R2 doit accepter `GET`, `HEAD` et les requêtes HTTP Range avec CORS.

### Recherche hybride

Le champ attend plusieurs caractères, applique un délai avant les appels, annule les recherches obsolètes et met les résultats en cache :

- France : géocodeur officiel de la [Géoplateforme](https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage) ;
- Espagne : service REST [CartoCiudad](https://www.cartociudad.es/) ;
- autres pays : index statique GeoNames chargé uniquement lors de la première recherche.

L’index mondial permet de chercher des villes sans requête par frappe, mais ne couvre pas chaque adresse postale hors France et Espagne. Le clic sur la carte reste le repli universel. Le Nominatim public n’est volontairement pas utilisé : sa politique interdit l’autocomplétion cliente et impose une limite globale trop faible pour ce site.

Le script reproductible et l’attribution CC BY 4.0 de l’asset GeoNames sont documentés dans `scripts/search/`.

## Configuration de Street View Embed

Dans Google Cloud :

1. activez uniquement **Maps Embed API** pour cette intégration ;
2. créez une clé dédiée ;
3. limitez-la aux référents exacts du site dans **Application restrictions → Websites** ;
4. limitez-la à **Maps Embed API** dans **API restrictions** ;
5. placez-la dans `VITE_GOOGLE_MAPS_EMBED_API_KEY`.

La clé est visible dans l’URL de l’iframe par conception. Sa protection repose sur ces restrictions. N’activez pas Maps JavaScript API, Places UI Kit, Places API ou Dynamic Street View pour cette clé. Pour les previews Vercel, préférez une clé séparée limitée à un domaine de staging stable. Consultez les [bonnes pratiques de sécurité Google Maps Platform](https://developers.google.com/maps/api-security-best-practices).

## Commandes de qualité

```bash
# Vérification TypeScript sans émission
npm run typecheck

# Analyse statique
npm run lint

# Tests déterministes Vitest
npm test

# Bundle de production (inclut la vérification TypeScript)
npm run build

# Servir localement le bundle dist/
npm run preview

# Tester le modèle géométrique LiDAR (Python facultatif)
npm run lidar:test

# Générer les sept départements franciliens, étape par étape et avec reprise
npm run lidar:idf -- --stage prepare
npm run lidar:idf -- --stage download
npm run lidar:idf -- --stage classify
npm run lidar:idf -- --stage tiles

# Préparer les contours des 19 plus grandes unités urbaines hors Paris
npm run lidar:urban-boundaries

# Calculer ce lot à 5 m, avec une barrière entre chaque étape
npm run lidar:urban-units -- --stage prepare
npm run lidar:urban-units -- --stage download
npm run lidar:urban-units -- --stage classify
npm run lidar:urban-units -- --stage tiles
```

Le lot national reprend la composition officielle des unités urbaines 2020 de
l’INSEE au 1er janvier 2026 et assemble les contours communaux Etalab 2026 à
5 m. Paris est volontairement exclue de ces 19 calculs, car l’Île-de-France
dispose déjà de ses jeux à 2 m et 5 m. Les grilles préparées totalisent
`1.984 Gpx`, soit `14.79 GiB` de MNT + MNS ; les classes produites occupent
`1.10 GiB` car elles sont limitées aux emprises de sortie. Ces
commandes produisent des sorties locales reprenables ; la publication R2 reste
une étape séparée. La génération locale du 10 août 2026 a produit 25 402 PNG
non vides (32,14 Mo de contenu) et en a omis 35 500 entièrement transparents.
Les 19 jeux ont été publiés et vérifiés sous
`https://tiles.louisguichard.fr/visibility/uu-<code>-2026-max-v1/`.
Les six halos plafonnés à 15 km — Marseille–Aix, Nice, Toulon, Avignon,
Grenoble et Saint-Étienne — restent signalés dans leurs manifestes et devront
passer en `v2` si une validation du relief impose un halo supérieur.

Pour reproduire exactement une installation CI, utilisez `npm ci` plutôt que `npm install` lorsque `package-lock.json` est présent.

## Déploiement sur Vercel

### Depuis l’interface Vercel

1. importez le dépôt dans Vercel ;
2. si le dépôt contient plusieurs projets, définissez **Root Directory** sur `eclipse-2026` ;
3. gardez le preset **Vite**, la commande `npm run build` et le dossier de sortie `dist` ;
4. ajoutez `VITE_GOOGLE_MAPS_EMBED_API_KEY` et, si utilisés, `VITE_BASEMAP_PMTILES_URL`, `VITE_BASEMAP_STYLE_URL`, `VITE_VISIBILITY_TILE_BASE_URL` et `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` dans **Project Settings → Environment Variables** ;
5. choisissez explicitement les environnements Production/Preview/Development voulus ;
6. déployez, puis ajoutez le domaine final aux restrictions HTTP de la clé Google ;
7. redéployez après toute modification d’une variable `VITE_*`, car elle est incorporée à la compilation.

Le fichier `vercel.json` fournit le fallback SPA vers `index.html` pour les URLs partagées et pose les en-têtes `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` et `X-Frame-Options`.

### Depuis la CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

N’insérez pas la clé en argument de commande ni dans l’historique du shell ; configurez-la dans le tableau de bord ou avec `vercel env add`.

## Cloudflare Web Analytics facultatif

Le site peut utiliser [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/about/) tout en restant hébergé sur Vercel et sans déplacer son DNS chez Cloudflare.

1. créez un compte Cloudflare, puis ouvrez **Analytics & Logs → Web Analytics** ;
2. sélectionnez **Add a site** et saisissez `eclipse.louisguichard.fr` ;
3. dans **Manage site**, copiez uniquement la valeur `token` du snippet proposé ;
4. dans Vercel, ajoutez cette valeur sous `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN`, pour l'environnement **Production** seulement ;
5. redéployez le site, ouvrez-le sans bloqueur de contenu, puis vérifiez après quelques minutes que des visites apparaissent dans Cloudflare.

L'intégration envoie uniquement le beacon standard, sans événement personnalisé et sans transmettre volontairement les coordonnées de l'URL. Cloudflare indique que Web Analytics n'enregistre pas les chaînes de requête ; les paramètres `lat`, `lng` et `time` ne doivent donc pas apparaître dans ses rapports. Le beacon mesure néanmoins les visites et les performances réelles : mentionnez Cloudflare Web Analytics dans la politique de confidentialité du site. Voir les [questions fréquentes Cloudflare](https://developers.cloudflare.com/web-analytics/faq/) et la [documentation sur la collecte](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/).

## Cloudflare R2 pour les tuiles de visibilité

Les tuiles peuvent être servies par un bucket R2 public plutôt que par Vercel.
Les identifiants d’écriture R2 sont privés : ne les ajoutez jamais à Vercel et
ne les préfixez jamais par `VITE_`. Seule l’URL publique des tuiles est placée
dans `VITE_VISIBILITY_TILE_BASE_URL`.

Le workflow reproductible est fourni dans [`scripts/r2/DEPLOYMENT.md`](scripts/r2/DEPLOYMENT.md) :

```bash
# Fichier local ignoré par Git
cp scripts/r2/r2.env.template .env.r2.local
chmod 600 .env.r2.local

# Vérification, simulation AWS CLI, puis publication
npm run r2:plan
npm run r2:publish -- --dry-run
npm run r2:publish

# Contrôle via le domaine public
npm run r2:verify -- https://tiles.louisguichard.fr/visibility
```

Pour une sortie régionale, passez explicitement son dossier au même outil :

```bash
npm run r2:plan -- --source data/lidar/publish/idf-92-2026-max-v1
npm run r2:publish -- --source data/lidar/publish/idf-92-2026-max-v1
npm run r2:verify -- https://tiles.louisguichard.fr/visibility \
  --source data/lidar/publish/idf-92-2026-max-v1
```

Le script réalise un `aws s3 sync` S3-compatible vers le dossier versionné,
sans `--delete`, et applique un cache immuable d’un an. La politique CORS
Cloudflare prête à appliquer se trouve dans `scripts/r2/cors.json`.

Attention : Cloudflare Web Analytics fonctionne sans déplacer le DNS, mais ce
n’est pas le cas d’un domaine personnalisé R2 sur l’offre Free. Actuellement,
`louisguichard.fr` utilise les nameservers OVH et `eclipse` pointe vers Vercel.
Le mode CNAME partiel étant réservé aux offres Business/Enterprise, une URL R2
comme `tiles.louisguichard.fr` exige une migration complète de la zone
DNS vers Cloudflare. Exportez et comparez auparavant **tous** les enregistrements
OVH, notamment MX, SPF, DKIM, DMARC, sous-domaines et validations, puis vérifiez
le site et les e-mails avant de connecter R2. L’URL `r2.dev` convient seulement
à un test temporaire et est limitée par Cloudflare. Voir les documentations
[Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/) et
[S3 API](https://developers.cloudflare.com/r2/get-started/s3/).

## Architecture

```text
src/
├── components/       # carte, Street View, recherche, overlay, timeline, infos
├── hooks/            # position observateur, éclipse, cycle de vie Street View
├── config/           # date, timeline, seuils et lieux prédéfinis ajustables
├── lib/
│   ├── astronomy.ts  # Soleil/Lune, contacts locaux, obscuration, coucher
│   ├── geometry.ts   # azimut, POV, distances et différences angulaires
│   ├── googleMaps.ts # construction de l’unique URL Street View Embed
│   ├── mapLibreBasemap.ts # style gratuit ou archive PMTiles
│   ├── mapLibreVisibility.ts # couches raster LiDAR dans MapLibre
│   ├── search/       # Géoplateforme, CartoCiudad et GeoNames
│   └── format.ts     # dates, heures et directions françaises
└── types/            # contrats TypeScript partagés
scripts/lidar/         # génération reproductible de la couche IGN
public/visibility/    # tuiles XYZ statiques prêtes à déployer
```

La séparation importante est la suivante :

- `astronomy.ts` ne dépend ni de React ni du moteur cartographique et reste testable de façon déterministe ;
- les changements de minute recalculent l’astronomie et déplacent le repère solaire sans recharger l’iframe ;
- une nouvelle position reconstruit une seule URL Street View Embed après temporisation, sans appel de recherche Street View JavaScript ;
- la simulation graphique est une surcouche déclarée comme telle et ne modifie pas l’imagerie Google.

## Validation astronomique

La référence par défaut est le centre de Paris (`48.8566, 2.3522`). Les instants sont stockés en UTC et les heures sont affichées dans le fuseau IANA du lieu demandé, renvoyé par Open-Meteo ; le 12 août 2026, Paris est ainsi en UTC+2. La fenêtre mondiale couvre les contacts observables d’Anchorage à Dakar, et le maximum affiché est ramené au lever ou au coucher lorsque le pic théorique se trouve sous l’horizon.

Résultats obtenus avec `astronomy-engine` pour un observateur à altitude 0 m, coordonnées apparentes avec réfraction atmosphérique normale :

| Événement | Heure Paris | Heure UTC | Résultat calculé |
| --- | ---: | ---: | --- |
| Premier contact partiel | 19:22:06 | 17:22:06 | Soleil à environ 16,62° |
| Maximum local | 20:17:11 | 18:17:11 | obscuration 92,03 %, Soleil à environ 7,72° |
| À 20:17 pile | 20:17:00 | 18:17:00 | azimut 283,77°, altitude 7,76° |
| Fin partielle | 21:09:17 | 19:09:17 | Soleil à environ 0,05° |
| Coucher calculé | 21:11:24 | 19:11:24 | horizon local théorique |

Ces valeurs concordent avec la référence [NASA pour Paris](https://science.nasa.gov/eclipses/future-eclipses/total-solar-eclipse-on-august-12-2026/) : début 19 h 22, maximum 20 h 17, couverture 92 %, fin 21 h 09. Les tests utilisent des tolérances réalistes, pas une égalité à la seconde ou au centième de degré. L’altitude réelle apparente près de l’horizon peut varier avec la pression, la température, le relief et la réfraction locale.

## Couche de visibilité IGN à Paris et en Île-de-France

La carte peut superposer une estimation géométrique indépendante de Google fondée sur le **LiDAR HD IGN**. Elle compare un œil placé 1,7 m au-dessus du MNT au profil du MNS — relief, bâti et végétation — dans la direction du Soleil au maximum central parisien (`20:17:11`, azimut `283,804835°`, altitude apparente `7,723762°`).

La version fournie, `paris-2026-max-v1`, couvre la commune administrative de Paris sur une grille Lambert-93 à 2 m. Elle contient 940 tuiles PNG XYZ indexées sur 1 bit, zooms 10 à 16, pour environ 0,59 Mo de contenu. Les 634 tuiles entièrement transparentes sont omises ; la carte transforme proprement leur réponse absente en transparence. Les fichiers navigateur sont dans `public/visibility/paris-2026-max-v1/`; le cache de calcul local d’environ 682 Mo est volontairement ignoré par Git.

Les sept départements périphériques sont calculés séparément à 5 m et publiés
dans `idf-{77,78,91,92,93,94,95}-2026-max-v1`. Pour chaque département, le
pipeline récupère le contour officiel, calcule avec Astronomy Engine le maximum
local au centroïde, transforme l’azimut vrai dans la grille Lambert-93 et adapte
automatiquement le halo amont à l’altitude solaire et au relief. La couverture
LiDAR HD disponible est prioritaire ; ses lacunes sont complétées cellule par
cellule par le MNS Correl et RGE ALTI. Si le profil vers le Soleil traverse
encore une donnée absente, le pixel est marqué inconnu plutôt que jaune.
La publication francilienne obtenue contient 26 243 PNG visibles pour environ
25,9 Mo ; 18 020 tuiles entièrement transparentes sont omises. Les rasters et
classes intermédiaires restent dans `data/lidar/`, ignoré par Git, tandis que
seules les petites pyramides dérivées sont envoyées vers R2.

MapLibre monte chaque pyramide LiDAR comme source raster XYZ, avec ses bornes et
ses zooms natifs. Le moteur assure le surzoom sans inventer de détail et ne
charge que les sources qui recoupent le point ou la vue courante. Le jaune reste
ainsi aligné avec le fond vectoriel pendant les déplacements et changements de
zoom.

Le modèle calcule toujours quatre classes, mais la carte n’en peint qu’une : le **dégagement probable**, en jaune. « Horizon sensible », « incertain » et « masquage probable » restent transparents, pour que la carte réponde à une seule question au lieu d’imposer une légende à décoder. Les zones jaunes sont par ailleurs **élargies au rendu** — une rue dégagée de 10 m serait invisible au zoom ville — donc leurs contours sont indicatifs et non métriques ; la classification enregistrée, elle, conserve son étendue exacte.

L’élargissement suit le zoom. Les tuiles sont échantillonnées au point, si bien qu’un motif plus fin qu’un pixel n’est touché que par hasard : la couche disparaissait quand on dézoomait. Chaque niveau grossit donc le masque d’un demi-pixel de terrain — 4 m au plus près, 52 m au zoom 10 — ce qui revient à demander « une cellule dégagée existe-t-elle dans ce pixel ». La bande jaune s’amincit en s’éloignant au lieu de s’évanouir, sans jamais déborder du pixel qui la porte. Le détail par zoom figure dans `tiles.renderDilationMetersByZoom` du manifeste.

Sur les ponts, l’observateur est placé sur le tablier détecté et non sur l’eau : le MNT sous un pont est la surface de la Seine, ce qui plaçait auparavant l’œil sous le tablier et classait tout l’ouvrage comme masqué.

Ces classes décrivent uniquement une ligne de visée modélisée. Le MNS date de mars 2023, peut sous-estimer le feuillage d’août et ne connaît ni les travaux récents, ni l’accessibilité, ni la météo. Street View et une vérification sur place restent indispensables.

Source Paris : **© IGN — LiDAR HD MNT/MNS, bloc KE, acquisition 03-03-2023,
édition 06-06-2025, Licence Ouverte 2.0**. Attribution régionale : **© IGN —
LiDAR HD, MNS Correl et RGE ALTI · Licence Ouverte 2.0**. La procédure complète,
les commandes par étape, les volumes, l’algorithme et ses limites sont
documentés dans [`scripts/lidar/README.md`](scripts/lidar/README.md).

Pour régénérer la version par défaut après installation des dépendances Python :

```bash
npm run lidar:test
npm run lidar:generate
npm run lidar:idf -- --stage all
```

Le téléchargement IGN est repris bloc par bloc. Pour modifier la résolution ou l’emprise, utilisez un nouveau `--data-dir` et un nouveau `--public-dir` afin de ne pas mélanger deux versions scientifiques.

## Prévision météo

Le navigateur demande à [Open-Meteo Forecast API](https://open-meteo.com/en/docs) les valeurs horaires autour du 12 août pour les coordonnées arrondies : température, code météo, couverture nuageuse, probabilité de pluie, visibilité et vent. `timezone=auto` fournit le fuseau IANA local et `timeformat=unixtime` garde des instants UTC non ambigus ; une enveloppe de trois dates civiles couvre aussi les lieux situés de l’autre côté de la ligne de changement de date. Le composant affiche l’heure disponible la plus proche de la timeline.

Une seule requête est envoyée par position : quand la date de l’éclipse entre dans la fenêtre de prévision, sa réponse fournit à la fois les valeurs horaires et le fuseau IANA ; hors de cette fenêtre, une requête légère de métadonnées conserve l’heure locale sans demander une prévision indisponible. Les réponses sont mises en cache 15 minutes en mémoire. Déplacer la timeline ne relance pas de requête ; changer de position déclenche une requête temporisée et annule l’ancienne. Une prévision reste incertaine et évolutive : elle ne constitue jamais une garantie de ciel dégagé.

Open-Meteo publie les données sous [CC BY 4.0](https://open-meteo.com/en/license). L’attribution visible à côté des nuages doit être conservée.

## Géométrie Street View

Google définit `StreetViewPov.heading` en degrés depuis le nord vrai : nord `0°`, est `90°`, sud `180°`, ouest `270°`. `pitch` varie de `-90°` vers le bas à `+90°` vers le haut et est défini relativement au véhicule Street View. Le projet transforme donc :

```text
heading = azimut solaire normalisé dans [0°, 360°)
pitch   = altitude solaire, limitée à [-90°, +90°]
```

À Paris vers le maximum, le point de vue attendu est donc environ `heading: 284`, `pitch: +7.7` : ouest-nord-ouest et légèrement au-dessus de l’horizon. Le mode `?debug=true` expose les valeurs source et les paramètres finaux pour repérer une inversion de signe ou une erreur de convention. Référence : [paramètres Street View Embed](https://developers.google.com/maps/documentation/embed/embedding-map#street_view_mode).

Ces valeurs configurent la caméra initiale de l’iframe **Maps Embed Street View**. L’application dessine ensuite le repère solaire calculé au-dessus de cette image, sans charger de panorama Maps JavaScript et sans proposer de mode alternatif. Comme Embed ne transmet pas ses mouvements de caméra à la page, le panorama reste verrouillé sur cette orientation connue : sinon le repère deviendrait faux après un panoramique. La timeline déplace le Soleil calculé sans recharger l’iframe.

L’imagerie Street View n’est pas recolorée. Un filtre crépusculaire modifierait aussi les contrôles et attributions Google et n’est pas une intégration documentée ; l’ambiance du projet vient uniquement du cadre et des composants de l’application. Voir les [règles Maps Embed](https://developers.google.com/maps/documentation/embed/policies) et les [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/).

## Maîtrise des appels et des coûts

Le cycle de vie est volontairement conservateur :

- Maps JavaScript, Places et Dynamic Street View sont absents du code et des dépendances, en local comme en production ;
- Street View utilise exclusivement Maps Embed ;
- l’URL Embed ne change qu’après un changement de lieu temporisé, jamais pendant la timeline ;
- MapLibre n’est initialisé sur mobile que lorsque l’onglet Carte est ouvert et conserve ensuite sa même instance ;
- le fond de carte vient soit du service gratuit OpenFreeMap, soit d’une archive PMTiles sur R2 ;
- GeoNames n’est téléchargé qu’à la première recherche et les géocodeurs ne sont jamais appelés sans saisie ;
- déplacer la timeline ne déclenche aucune opération Street View ;
- la couche LiDAR utilise des PNG statiques locaux ou R2 et ne crée aucun appel Google lors du déplacement de la timeline.

Le mode Embed est actuellement annoncé gratuit et sans limite d’usage. La définition des produits peut évoluer : consultez la [facturation Maps Embed API](https://developers.google.com/maps/documentation/embed/usage-and-billing) avant le lancement. Le test `noPaidGoogleApis.test.ts` empêche la réintroduction accidentelle d’un chargeur Google Maps/Places dans le bundle.

## Confidentialité, conditions EEE et limites connues

### Données et conformité

- L’application n’a pas de backend applicatif et ne crée pas de compte utilisateur.
- La géolocalisation n’est demandée qu’après une action explicite et reste révocable via le navigateur.
- Une URL partagée contient les coordonnées choisies en clair ; évitez de partager une position privée précise.
- Google reçoit les informations nécessaires au seul panorama Street View Embed, notamment adresse IP et coordonnées.
- Le fournisseur du fond OpenStreetMap reçoit les requêtes de carte correspondant à la zone regardée. En mode PMTiles R2, ce fournisseur est l’infrastructure Cloudflare du projet.
- La Géoplateforme et CartoCiudad reçoivent le texte des recherches qui leur sont envoyées. La recherche mondiale GeoNames reste locale après le téléchargement de l’index statique.
- Open-Meteo reçoit des coordonnées arrondies afin de servir la prévision horaire ; aucune position n’est conservée par l’application.
- Conservez les attributions Google Street View, OpenStreetMap, GeoNames, IGN et CartoCiudad affichées par l’application.
- La couche LiDAR conserve séparément l’attribution IGN et sa Licence Ouverte 2.0 ; elle n’est pas dérivée de contenu Google.

Relisez les [conditions utilisateur Google Maps](https://maps.google.com/help/terms_maps/), la [politique de confidentialité Google](https://policies.google.com/privacy) et les conditions de chaque fournisseur public avant la mise en production. Ce README décrit l’intégration technique ; il ne constitue pas un avis juridique.

### Ce que le diagnostic ne peut pas garantir

- Street View n’est pas une vue en direct. La photo peut être ancienne, saisonnière ou prise depuis la chaussée.
- La position du panorama diffère souvent du point choisi. Embed n’expose ni cette position ni sa distance à l’application.
- `source=outdoor` exclut les vues intérieures, mais ne garantit pas une image produite par Google plutôt qu’un contenu public Street View.
- La hauteur de caméra Street View n’est pas celle des yeux de l’utilisateur ; un obstacle proche peut donc changer la visibilité.
- La couche IGN estime le relief, le bâti et la végétation à partir de millésimes hétérogènes. Hors Paris, la résolution est 5 m et les lacunes LiDAR utilisent des modèles de complément moins fins ; elle ne prédit ni les constructions récentes, ni l’état réel du feuillage, ni la réfraction locale. La météo affichée est une prévision séparée et évolutive.
- Le viseur répond seulement à « dans quelle direction regarder ? ». S’il tombe dans le ciel de la photo, la vue **semble** dégagée ; s’il tombe sur un obstacle, cherchez un autre emplacement et vérifiez sur place.
- Aucune vision par ordinateur, extraction de profondeur, capture automatisée, scraping ni modèle dérivé de l’imagerie Street View n’est utilisé. Cela évite une promesse scientifique trompeuse et respecte les restrictions d’usage du contenu Google Maps.
- Les contacts et pourcentages changent avec la position ; les repères parisiens du design ne remplacent jamais les circonstances locales calculées.

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Carte vide ou fond indisponible | testez `VITE_BASEMAP_STYLE_URL`; en PMTiles, contrôlez URL, CORS et réponse HTTP `206` aux requêtes Range |
| Street View Embed vide ou en erreur | Maps Embed API activée, clé Embed présente et référent autorisé |
| `RefererNotAllowedMapError` | domaine, protocole et port présents dans les restrictions Websites |
| Recherche française indisponible | testez `https://data.geopf.fr/geocodage/search` et vérifiez l’absence de 429 |
| Recherche espagnole indisponible | testez les endpoints `candidates` puis `find` de CartoCiudad |
| Villes mondiales absentes | vérifiez `/search/world-cities-geonames-20260811.min.json` et son type JSON |
| Aucun panorama | essayez un point routier voisin ; Embed ne permet pas de rechercher automatiquement plusieurs rayons |
| Géolocalisation refusée | autorisation du navigateur, contexte HTTPS en production |
| URL partagée incorrecte | `lat`, `lng` valides et `time` compris dans la timeline |
| Heures décalées | vérifiez le fuseau IANA renvoyé par Open-Meteo dans `?debug=true` ; le repli avant chargement est UTC |
| « Éclipse non visible ici » | le lieu est hors de l’empreinte observable du 12 août 2026 ; essayez l’Europe, l’Afrique du Nord ou le nord de l’Amérique du Nord |

## Mise en production : l’unique étape manuelle indispensable

**Créez une seule clé limitée à Maps Embed API, placez-la dans `VITE_GOOGLE_MAPS_EMBED_API_KEY`, et vérifiez dans Google Cloud que Maps JavaScript, Places et Dynamic Street View restent à zéro.** Configurez ensuite `VITE_BASEMAP_PMTILES_URL` lorsque l’archive R2 est disponible ; jusque-là OpenFreeMap fournit le fond gratuit sans clé.
