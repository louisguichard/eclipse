# Éclipse 2026 — Où regarder ?

💡 Ce projet a été entièrement vibe-codé, principalement avec Codex (GPT 5.6 Sol). L'ensemble du code et de la documentation a été écrit par IA (à la seule exception de ce paragraphe).

Une application web mobile et desktop pour savoir **où regarder dans le ciel le mercredi 12 août 2026** depuis n’importe quel point du monde. Street View occupe la scène principale ; la carte, la simulation astronomique, la météo horaire et la chronologie restent accessibles dans des cartes compactes. Hors de l’empreinte de l’éclipse, l’interface l’indique explicitement au lieu d’afficher un événement futur.

Choisissez une adresse, cliquez sur la carte ou autorisez votre position : l’application cherche le panorama Street View le plus proche, calcule la position apparente du Soleil et de la Lune avec [`astronomy-engine`](https://github.com/cosinekitty/astronomy), puis oriente la caméra vers l’éclipse. Le viseur aide à juger visuellement si un bâtiment, un arbre ou le relief masque cette direction — sans prétendre analyser l’image.

> **Sécurité solaire :** ne regardez jamais directement le Soleil sans lunettes d’éclipse conformes **ISO 12312-2**. Des lunettes de soleil, un téléphone ou un filtre photographique ordinaire ne protègent pas les yeux.

> [!WARNING]
> **Variante d’urgence, sans API Google Maps payante.** Le panorama repose sur
> des endpoints Google internes, non documentés et non supportés, dont le
> protocole a été porté depuis Streetlevel. Ils peuvent changer, être limités ou
> bloqués sans préavis, et leur utilisation doit être évaluée au regard des
> conditions Google applicables. Voir
> [docs/streetlevel-feasibility.md](docs/streetlevel-feasibility.md).

## Aperçu

> Capture d’écran à ajouter après le premier déploiement : Paris à 20 h 17, Street View plein cadre, carte LiDAR flottante et prévision horaire.

Fonctions principales :

- recherche sans clé : Géoplateforme/IGN en France, CartoCiudad en Espagne et index GeoNames mondial en repli ;
- sélection par recherche, carte ou géolocalisation ;
- rayon d’azimut solaire mis à jour minute par minute ;
- panorama Street View assemblé dans le navigateur à partir des tuiles Google de niveau `z3`, puis affiché avec Photo Sphere Viewer et automatiquement orienté vers le Soleil ;
- carte MapLibre avec OpenFreeMap par défaut ou archive PMTiles auto-hébergée ;
- disque Soleil–Lune calculé à partir des positions et rayons angulaires apparents ;
- chronologie mondiale 15 h 30–20 h UTC avec lecture accélérée, contacts locaux observables et coucher du Soleil ;
- diagnostic honnête de visibilité, distance au panorama et niveau de confiance ;
- prévision horaire WeatherAPI.com pour le lieu et l’heure sélectionnés ;
- couche de visibilité active par défaut : Paris à 2 m, puis les sept autres départements franciliens à 5 m depuis R2 ;
- URL partageable (`lat`, `lng`, `time`) et mode diagnostic `?debug=true` ;
- interface française responsive et métadonnées PWA.

## Prérequis

- Node.js 22.x (22.12 ou plus récent recommandé) ;
- npm 10 ou plus récent.

Python 3.11 ou plus récent n’est nécessaire que pour **régénérer** la couche LiDAR ; les tuiles prêtes à servir sont déjà incluses dans `public/visibility/`.

Aucun serveur applicatif ni base de données n’est nécessaire. Les calculs astronomiques et l’état de l’interface restent dans le navigateur.

La météo utilise l’API Forecast de WeatherAPI.com avec une clé client temporaire.
Cette clé est volontairement publique et doit être révoquée après l’événement. Le
forfait gratuit autorise 100 000 appels mensuels et impose l’attribution ; vérifiez
les [conditions WeatherAPI.com](https://www.weatherapi.com/terms.aspx).

## Installation locale

```bash
git clone https://github.com/louisguichard/eclipse.git
cd eclipse-2026
npm ci
cp .env.example .env.local
```

Renseignez ensuite `.env.local` :

```dotenv
VITE_BASEMAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
VITE_BASEMAP_PMTILES_URL=
VITE_VISIBILITY_TILE_BASE_URL=https://cdn.example.fr/eclipse/visibility
VITE_WEATHERAPI_KEY=votre_cle_jetable
VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=votre_token_de_site_optionnel
VITE_MAINTENANCE_BANNER_ENABLED=false
VITE_SPEAKEA_BANNER_PERCENTAGE=100
```

`VITE_BASEMAP_STYLE_URL` configure le style MapLibre. Le style OpenFreeMap par
défaut fonctionne sans clé, mais ne fournit pas de SLA. Pour maîtriser le trafic
et la disponibilité, fournissez une archive Protomaps compatible via
`VITE_BASEMAP_PMTILES_URL` ; lorsqu’elle est définie, elle prend la priorité.

`VITE_VISIBILITY_TILE_BASE_URL` est facultatif pour la seule couverture parisienne incluse sous `/visibility/paris-2026-max-v1/`. Il doit être défini pour charger les jeux régionaux publiés sur R2. Indiquez le dossier parent de tous les dossiers versionnés, sans ajouter un nom de version à la variable. Cette URL n’est pas un secret.

`VITE_WEATHERAPI_KEY` authentifie les appels météo effectués directement par le
navigateur. Comme toute variable Vite, elle est intégrée au JavaScript public :
utilisez exclusivement une clé jetable et révoquez-la après l’éclipse.

`VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` est facultatif et public. Lorsqu'il est renseigné, le beacon officiel Cloudflare Web Analytics est chargé uniquement dans le build de production. Il n'est jamais chargé avec `npm run dev`, ni lorsqu'aucun token n'est configuré.

`VITE_MAINTENANCE_BANNER_ENABLED` affiche le bandeau de maintenance uniquement
lorsque sa valeur est exactement `true` (casse et espaces ignorés). Utilisez
`false` ou supprimez la variable pour le masquer, puis redéployez : comme tous
les flags `VITE_*`, sa valeur est intégrée au bundle lors du build.

`VITE_SPEAKEA_BANNER_PERCENTAGE` contrôle la part des navigateurs auxquels le
bandeau Speakea peut être présenté. La valeur, comprise entre `0` et `100`, vaut
`100` par défaut. Chaque navigateur reçoit une cohorte stable conservée dans
son stockage local : diminuer le pourcentage conserve donc un sous-ensemble
stable des visiteurs. Toute modification nécessite un redéploiement.

Les variables `VITE_*` sont injectées dans le bundle client et sont publiques.
La clé WeatherAPI.com constitue ici une exception volontaire et temporaire.

Lancez le développement :

```bash
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173). Aucune clé Google Maps
n’est nécessaire. Le navigateur contacte directement les services tiers :

- MapLibre charge OpenFreeMap ou l’archive PMTiles configurée ;
- la recherche interroge Géoplateforme et CartoCiudad, puis utilise l’index
  GeoNames statique chargé à la première recherche de trois caractères ;
- Streetlevel interroge `GeoPhotoService.SingleImageSearch` en JSONP, charge les
  tuiles depuis `streetviewpixels-pa.googleapis.com`, puis assemble le panorama
  en mémoire dans un canvas.

Il n’existe aucun proxy Streetlevel, aucune fonction Vercel pour les panoramas
et aucune clé Google Maps Platform. Cette architecture évite les SKU Maps JS et
Places, mais ne transforme pas les endpoints internes en API officielle ou
garantie : préparez un repli et testez le parcours réel avant l’ouverture.

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
2. laissez **Root Directory** à la racine du dépôt (`.`) ;
3. gardez le preset **Vite**, la commande `npm run build` et le dossier de sortie `dist` ;
4. configurez, si utilisés, `VITE_BASEMAP_PMTILES_URL`, `VITE_VISIBILITY_TILE_BASE_URL`, `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN`, `VITE_MAINTENANCE_BANNER_ENABLED` et `VITE_SPEAKEA_BANNER_PERCENTAGE` dans **Project Settings → Environment Variables** ;
5. choisissez explicitement les environnements Production/Preview/Development voulus ;
6. déployez, puis testez depuis le domaine final le chargement CORS du fond, de la recherche et des tuiles Street View ;
7. redéployez après toute modification d’une variable `VITE_*`, car elle est incorporée à la compilation.

Le fichier `vercel.json` fournit le fallback SPA vers `index.html` pour les URLs partagées et pose les en-têtes `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` et `X-Frame-Options`.

### Depuis la CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

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
│   ├── streetlevel/  # métadonnées, protobuf, tuiles et cache des panoramas
│   ├── search/       # Géoplateforme, CartoCiudad et index GeoNames
│   └── format.ts     # dates, heures et directions françaises
└── types/            # contrats TypeScript partagés
scripts/lidar/         # génération reproductible de la couche IGN
public/visibility/    # tuiles XYZ statiques prêtes à déployer
```

La séparation importante est la suivante :

- `astronomy.ts` ne dépend ni de React ni du fournisseur cartographique et reste testable de façon déterministe ;
- les changements de minute recalculent l’astronomie et mettent à jour le POV, sans rechercher ni recréer le panorama ;
- une nouvelle position déclenche, elle, une recherche Street View progressive et met à jour la distance réelle au panorama ;
- la simulation graphique est une surcouche déclarée comme telle et ne modifie pas l’imagerie Google.

## Validation astronomique

La référence par défaut est le centre de Paris (`48.8566, 2.3522`). Les instants sont stockés en UTC et les heures sont affichées dans le fuseau IANA du lieu demandé, renvoyé par WeatherAPI.com ; le 12 août 2026, Paris est ainsi en UTC+2. La fenêtre mondiale couvre les contacts observables d’Anchorage à Dakar, et le maximum affiché est ramené au lever ou au coucher lorsque le pic théorique se trouve sous l’horizon.

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

La carte conserve la plage de zoom Web Mercator de MapLibre, sans lui imposer
de borne liée aux données. La couche reste disponible sur toute la plage
utile (zooms 0 à 30) : sous le premier zoom publié, elle compose uniquement les
tuiles source qui recoupent l’emprise ; au-delà du dernier, elle agrandit la
dernière tuile et en recadre le quadrant correspondant. Le jaune reste ainsi
aligné lors d’un zoom avant comme arrière, sans prétendre ajouter du détail
LiDAR absent de la pyramide. Le rendu se fait dans un canvas de taille fixe :
cela évite les transformations géantes au surzoom et, lorsqu’une tuile jaune
non vide tomberait sous deux pixels au dézoom mondial, conserve un repère de
présence indicatif de 2 × 2 px.

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

Le navigateur demande à [WeatherAPI.com Forecast API](https://www.weatherapi.com/docs/) trois jours de valeurs horaires pour les coordonnées arrondies : température, code météo, couverture nuageuse, probabilité de pluie, visibilité et vent. La réponse fournit le fuseau IANA local et des instants Unix non ambigus. Le composant affiche l’heure disponible la plus proche de la timeline.

Une seule requête est envoyée par position : quand la date de l’éclipse entre dans la fenêtre de prévision, sa réponse fournit à la fois les valeurs horaires et le fuseau IANA ; hors de cette fenêtre, une requête légère à l’endpoint de fuseau horaire conserve l’heure locale sans demander une prévision indisponible. Les réponses sont mises en cache 15 minutes en mémoire. Déplacer la timeline ne relance pas de requête ; changer de position déclenche une requête temporisée et annule l’ancienne.

L’attribution WeatherAPI.com visible à côté des nuages doit être conservée. Les
prévisions sont probabilistes et peuvent être inexactes pour un lieu ou une
heure précise. Elles ne doivent jamais constituer l’unique source d’une décision
concernant la sécurité : consultez les services météorologiques officiels.

## Géométrie Street View

Le Soleil est exprimé en azimut vrai — nord `0°`, est `90°`, sud `180°`,
ouest `270°` — et en altitude. Les métadonnées internes fournissent le cap du
centre de l’image équirectangulaire ; le viewer convertit donc le cap solaire
en lacet relatif au panorama :

```text
yaw   = angle signé(azimut solaire - cap du centre du panorama)
pitch = altitude solaire, limitée à [-90°, +90°]
```

À Paris vers le maximum, la direction attendue reste environ `284°` et
`+7,7°` : ouest-nord-ouest et légèrement au-dessus de l’horizon. Le mode
`?debug=true` expose les valeurs source et la caméra finale.

Cette transformation vise une direction angulaire, pas un pixel garanti :
nivellement, distorsion, recadrage, altitude de prise de vue et métadonnées de
cap peuvent introduire un écart. Photo Sphere Viewer conserve les gestes de
rotation et de zoom ; le bouton de recentrage réactive le suivi solaire.

L’imagerie Street View n’est ni analysée ni recolorée. Elle est téléchargée et
assemblée uniquement pour l’affichage dans l’onglet courant.

## Maîtrise des appels et des coûts

Le cycle de vie limite les téléchargements sans ajouter de serveur :

- la recherche de panorama est déclenchée uniquement quand l’observateur change ;
- les métadonnées sont mémorisées par coordonnées pendant la durée de l’onglet ;
- chaque panorama est assemblé au niveau `z3` (typiquement 28 tuiles pour
  `3328 × 1664`) avec au plus huit téléchargements simultanés ;
- les JPEG assemblés sont des URL `blob:` gardées uniquement en mémoire ; le
  cache LRU contient au maximum trois images et révoque l’URL évincée ;
- déplacer la timeline ne recharge ni les métadonnées ni l’image ;
- MapLibre, la recherche et les tuiles LiDAR n’appellent aucun produit Google
  Maps Platform payant.

Le cache HTTP du navigateur peut conserver des réponses selon les en-têtes des
services tiers. L’application ne persiste et ne republie toutefois aucun
panorama : pas de stockage local, de base de données, de bucket ni de proxy.

## Confidentialité, conditions EEE et limites connues

### Données et conformité

- L’application n’a pas de backend applicatif et ne crée pas de compte utilisateur.
- La géolocalisation n’est demandée qu’après une action explicite et reste révocable via le navigateur.
- Une URL partagée contient les coordonnées choisies en clair ; évitez de partager une position privée précise.
- Google reçoit l’adresse IP, les coordonnées recherchées et les requêtes de
  tuiles Street View ; OpenFreeMap, Géoplateforme et CartoCiudad reçoivent aussi
  l’adresse IP et les termes ou coordonnées nécessaires à leur service. GeoNames
  est un fichier statique servi avec l’application.
- WeatherAPI.com reçoit des coordonnées arrondies afin de servir la prévision horaire ; aucune position n’est conservée par l’application.
- Conservez les attributions visibles de chaque fournisseur et relisez leurs
  conditions avant publication.
- La couche LiDAR conserve séparément l’attribution IGN et sa Licence Ouverte 2.0 ; elle n’est pas dérivée de contenu Google.

L’accès Streetlevel n’est pas une intégration Google Maps Platform documentée.
Il ne bénéficie d’aucun quota publié, support ou SLA, et peut ne pas être
conforme aux conditions applicables à l’accès, au téléchargement ou à
l’affichage du contenu Street View. Relisez les
[conditions Google Maps](https://maps.google.com/help/terms_maps/), la
[politique de confidentialité Google](https://policies.google.com/privacy) et
les règles des autres fournisseurs. Ce README décrit l’intégration technique ;
il ne constitue pas un avis juridique.

### Ce que le diagnostic ne peut pas garantir

- Street View n’est pas une vue en direct. La photo peut être ancienne, saisonnière ou prise depuis la chaussée.
- La position du panorama diffère souvent du point choisi. L’interface affiche cette distance et réduit clairement la confiance au-delà d’environ 30 m.
- La hauteur de caméra Street View n’est pas celle des yeux de l’utilisateur ; un obstacle proche peut donc changer la visibilité.
- La couche IGN estime le relief, le bâti et la végétation à partir de millésimes hétérogènes. Hors Paris, la résolution est 5 m et les lacunes LiDAR utilisent des modèles de complément moins fins ; elle ne prédit ni les constructions récentes, ni l’état réel du feuillage, ni la réfraction locale. La météo affichée est une prévision séparée et évolutive.
- Le viseur répond seulement à « dans quelle direction regarder ? ». S’il tombe dans le ciel de la photo, la vue **semble** dégagée ; s’il tombe sur un obstacle, cherchez un autre emplacement et vérifiez sur place.
- Aucune vision par ordinateur, extraction de profondeur ni modèle dérivé de
  l’imagerie Street View n’est utilisé. L’assemblage automatisé des tuiles reste
  néanmoins un usage d’endpoint interne à évaluer séparément.
- Cette variante demande uniquement la couverture Google Street View officielle.
  Elle ne cherche pas Apple Look Around. Streetlevel sait aussi dialoguer avec
  Apple via un protocole distinct, mais il n’existe pas de recherche unifiée
  « Google ou Apple, prendre l’image la plus proche » dans cette application.
- Les contacts et pourcentages changent avec la position ; les repères parisiens du design ne remplacent jamais les circonstances locales calculées.

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Carte vide | accès au style OpenFreeMap, URL PMTiles et console CORS ; conservez les attributions |
| Champ d’adresse indisponible | accès à Géoplateforme/CartoCiudad et chargement de `/search/world-cities.min.json` |
| Aucun panorama | endpoint interne ou tuiles bloqués, protocole modifié, couverture absente ; essayez un point routier voisin |
| Panorama noir/incomplet | mémoire disponible, support canvas/blob et réponses CORS des tuiles `z3` |
| Géolocalisation refusée | autorisation du navigateur, contexte HTTPS en production |
| URL partagée incorrecte | `lat`, `lng` valides et `time` compris dans la timeline |
| Heures décalées | vérifiez le fuseau IANA renvoyé par WeatherAPI.com dans `?debug=true` ; le repli avant chargement est UTC |
| « Éclipse non visible ici » | le lieu est hors de l’empreinte observable du 12 août 2026 ; essayez l’Europe, l’Afrique du Nord ou le nord de l’Amérique du Nord |

## Mise en production : vérification indispensable

Retirez les anciennes variables de clé Google Maps du projet Vercel : elles ne
sont pas utilisées par cette variante. Vérifiez depuis le domaine final la
recherche, le chargement du panorama, la rotation, la navigation, la carte et
les attributions. Gardez un repli activable : une validation locale ne garantit
pas que les endpoints Streetlevel fonctionneront pendant l’événement.

Pour servir toutes les couches LiDAR publiées et déporter leurs requêtes hors
de Vercel, configurez en production
`VITE_VISIBILITY_TILE_BASE_URL=https://tiles.louisguichard.fr/visibility`.
Après le déploiement urgent, purgez au minimum `/sw.js` et `/registerSW.js` dans
le cache Cloudflare afin que les visiteurs déjà contrôlés par l’ancien service
worker détectent immédiatement la nouvelle version.
