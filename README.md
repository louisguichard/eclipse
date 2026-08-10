# Éclipse 2026 — Où regarder ?

💡 Ce projet a été entièrement vibe-codé, principalement avec Codex (GPT 5.6 Sol). L'ensemble du code et de la documentation a été écrit par IA (à la seule exception de ce paragraphe).

Une application web mobile et desktop pour savoir **où regarder dans le ciel le mercredi 12 août 2026** depuis n’importe quel point du monde. Street View occupe la scène principale ; la carte, la simulation astronomique, la météo horaire et la chronologie restent accessibles dans des cartes compactes. Hors de l’empreinte de l’éclipse, l’interface l’indique explicitement au lieu d’afficher un événement futur.

Choisissez une adresse, cliquez sur la carte ou autorisez votre position : l’application cherche le panorama Street View le plus proche, calcule la position apparente du Soleil et de la Lune avec [`astronomy-engine`](https://github.com/cosinekitty/astronomy), puis oriente la caméra vers l’éclipse. Le viseur aide à juger visuellement si un bâtiment, un arbre ou le relief masque cette direction — sans prétendre analyser l’image.

> **Sécurité solaire :** ne regardez jamais directement le Soleil sans lunettes d’éclipse conformes **ISO 12312-2**. Des lunettes de soleil, un téléphone ou un filtre photographique ordinaire ne protègent pas les yeux.

## Aperçu

> Capture d’écran à ajouter après le premier déploiement : Paris à 20 h 17, Street View plein cadre, carte LiDAR flottante et prévision horaire.

Fonctions principales :

- recherche d’adresse avec `BasicPlaceAutocompleteElement` et résolution du lieu choisi avec `PlaceDetailsCompactElement`, sans Autocomplete legacy ;
- sélection par recherche, carte ou géolocalisation ;
- rayon d’azimut solaire mis à jour minute par minute ;
- panorama Street View réutilisé et automatiquement orienté vers le Soleil ;
- disque Soleil–Lune calculé à partir des positions et rayons angulaires apparents ;
- chronologie mondiale 15 h 30–20 h UTC avec lecture accélérée, contacts locaux observables et coucher du Soleil ;
- diagnostic honnête de visibilité, distance au panorama et niveau de confiance ;
- prévision horaire Open-Meteo pour le lieu et l’heure sélectionnés ;
- couche de visibilité active par défaut : Paris à 2 m, puis les sept autres départements franciliens à 5 m depuis R2 ;
- URL partageable (`lat`, `lng`, `time`) et mode diagnostic `?debug=true` ;
- interface française responsive et métadonnées PWA.

## Prérequis

- Node.js 22.x (22.12 ou plus récent recommandé) ;
- npm 10 ou plus récent ;
- un projet Google Cloud avec facturation activée ;
- une clé navigateur autorisée pour **Maps JavaScript API**, **Places UI Kit** et **Places API (New)**.

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
VITE_GOOGLE_MAPS_API_KEY=votre_cle_navigateur_google_maps
VITE_GOOGLE_MAP_ID=votre_map_id_optionnel
VITE_VISIBILITY_TILE_BASE_URL=https://cdn.example.fr/eclipse/visibility
VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=votre_token_de_site_optionnel
```

`VITE_GOOGLE_MAP_ID` est facultatif. Sans Map ID, l’application utilise le rendu cartographique standard. Avec un Map ID de type JavaScript, vous pouvez administrer un style dans Google Cloud sans changer le code.

`VITE_VISIBILITY_TILE_BASE_URL` est facultatif pour la seule couverture parisienne incluse sous `/visibility/paris-2026-max-v1/`. Il doit être défini pour charger les jeux régionaux publiés sur R2. Indiquez le dossier parent de tous les dossiers versionnés, sans ajouter un nom de version à la variable. Cette URL n’est pas un secret.

`VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` est facultatif et public. Lorsqu'il est renseigné, le beacon officiel Cloudflare Web Analytics est chargé uniquement dans le build de production. Il n'est jamais chargé avec `npm run dev`, ni lorsqu'aucun token n'est configuré.

Les variables `VITE_*` sont injectées dans le bundle client : **la clé est visible dans le navigateur par conception**. Sa protection repose sur les restrictions de domaine et d’API, pas sur son camouflage. Ne commitez jamais `.env.local` ni une vraie clé dans `.env.example`.

Lancez le développement :

```bash
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173). Sans clé, l’interface reste explicite et utilisable comme démonstration des calculs, mais les panneaux Google Maps, Places et Street View ne peuvent pas charger leurs données réelles.

## Configuration Google Maps Platform

La documentation officielle évolue ; vérifiez les pages liées ci-dessous avant une mise en production.

### 1. Créer le projet et activer la facturation

1. Créez ou sélectionnez un projet dans la [console Google Cloud](https://console.cloud.google.com/projectcreate).
2. Associez un compte de facturation. Maps JavaScript API exige une facturation active, même lorsque l’usage reste dans les plafonds gratuits applicables.
3. Suivez le guide officiel [Set up the Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/get-api-key).

### 2. N’activer que les services nécessaires

Dans **APIs & Services → Library**, activez :

- **Maps JavaScript API** — carte et Street View dynamique ;
- **Places UI Kit** — champ `BasicPlaceAutocompleteElement` qui produit les suggestions ;
- **Places API (New)** — `place.fetchFields()`, l’appel qui convertit la suggestion choisie en coordonnées.

Les deux dernières sont bien **deux produits distincts**, et l’oubli de la seconde produit une panne trompeuse : les suggestions s’affichent normalement, puis la sélection échoue avec `PLACES_GET_PLACE: PERMISSION_DENIED`. L’application détecte ce cas précis et affiche « Activez « Places API (New) » dans Google Cloud » plutôt qu’un message d’indisponibilité générique.

Il n’est pas nécessaire d’activer **Street View Static API** : ce projet utilise `StreetViewService` et `StreetViewPanorama`, fournis par Maps JavaScript API. N’activez pas Places API legacy.

Consultez [Get Started with Places UI Kit](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started) et [Basic Place Autocomplete Element](https://developers.google.com/maps/documentation/javascript/places-ui-kit/basic-autocomplete).

> **Stade de lancement :** au 9 août 2026, Google classe Places UI Kit comme **Experimental (pré-GA)**. Le support est limité, des incompatibilités ou changements peuvent survenir et les garanties de stabilité des services GA ne s’appliquent pas de la même manière. Consultez l’[aperçu Places UI Kit](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview) et les [launch stages](https://developers.google.com/maps/launch-stages) avant chaque publication. Si cette dépendance devient inadaptée, migrez vers une solution moderne GA documentée par Google — jamais vers le widget legacy.

### 3. Créer et restreindre la clé navigateur

Dans **Google Maps Platform → Credentials** :

1. créez une clé API dédiée à cette application web ;
2. dans **Application restrictions**, choisissez **Websites** ;
3. ajoutez uniquement les référents nécessaires, par exemple :

   ```text
   http://localhost:5173
   https://eclipse-2026.example.fr
   https://eclipse-2026.vercel.app
   ```

4. dans **API restrictions**, choisissez **Restrict key**, puis seulement **Maps JavaScript API**, **Places UI Kit** et **Places API (New)** ;
5. enregistrez et attendez quelques minutes le temps de la propagation.

Le chargeur utilise `authReferrerPolicy: "origin"` : enregistrez donc les origines exactes, sans chemin final. Évitez un joker global comme `https://*.vercel.app`. Pour les previews Vercel, préférez une clé séparée limitée à un domaine de staging stable, ou n’injectez pas de clé dans ces environnements. Google recommande une clé distincte par application et par plateforme. Voir les [bonnes pratiques de sécurité Google Maps Platform](https://developers.google.com/maps/api-security-best-practices).

### 4. Map ID facultatif

Pour un style administré dans le cloud, créez un **Map ID** pour JavaScript dans **Google Maps Platform → Map Management**, associez-lui éventuellement un style, puis copiez l’identifiant dans `VITE_GOOGLE_MAP_ID`. Ce n’est pas une clé et il n’a pas à rester secret.

### 5. Facturation, budgets et quotas

Google facture séparément les principaux événements : chargement de carte dynamique, chargement réussi de panorama Street View dynamique, session d’autocomplétion Places UI Kit et requête de détails du lieu choisi. Les prix et plafonds gratuits peuvent changer ; vérifiez toujours la [tarification Google Maps Platform](https://developers.google.com/maps/billing-and-pricing/overview) et le [détail des SKU](https://developers.google.com/maps/billing-and-pricing/sku-details).

Protection recommandée :

1. créez un budget mensuel et plusieurs alertes (par exemple 25 %, 50 %, 75 %, 90 % et 100 %) dans [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets) ;
2. ajoutez les destinataires opérationnels et, si utile, une notification Pub/Sub ;
3. dans [Google Maps Platform → Quotas](https://console.cloud.google.com/google/maps-apis/quotas), abaissez les quotas des seuls services activés à un trafic réaliste ;
4. surveillez séparément Dynamic Maps, Dynamic Street View et Places UI Kit ;
5. configurez des alertes de quota et contrôlez régulièrement les métriques par référent.

**Un budget envoie des alertes mais ne bloque pas automatiquement les dépenses.** Les quotas constituent la barrière opérationnelle : lorsqu’ils sont atteints, des requêtes échouent et l’application doit afficher ses états d’erreur. Consultez [Budgets and budget alerts](https://cloud.google.com/billing/docs/how-to/budgets) et [Capping API usage](https://cloud.google.com/apis/docs/capping-api-usage).

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
4. ajoutez `VITE_GOOGLE_MAPS_API_KEY` et, si utilisés, `VITE_GOOGLE_MAP_ID`, `VITE_VISIBILITY_TILE_BASE_URL` et `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` dans **Project Settings → Environment Variables** ;
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
│   ├── googleMaps.ts # chargeur unique et options Google Maps
│   └── format.ts     # dates, heures et directions françaises
└── types/            # contrats TypeScript partagés
scripts/lidar/         # génération reproductible de la couche IGN
public/visibility/    # tuiles XYZ statiques prêtes à déployer
```

La séparation importante est la suivante :

- `astronomy.ts` ne dépend ni de React ni de Google Maps et reste testable de façon déterministe ;
- les changements de minute recalculent l’astronomie et mettent à jour le POV, sans rechercher ni recréer le panorama ;
- une nouvelle position déclenche, elle, une recherche Street View progressive et met à jour la distance réelle au panorama ;
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

Les réponses sont mises en cache 15 minutes en mémoire. Déplacer la timeline ne relance pas de requête ; changer de position déclenche une requête temporisée et annule l’ancienne. Une prévision reste incertaine et évolutive : elle ne constitue jamais une garantie de ciel dégagé.

Open-Meteo publie les données sous [CC BY 4.0](https://open-meteo.com/en/license). L’attribution visible à côté des nuages doit être conservée.

## Géométrie Street View

Google définit `StreetViewPov.heading` en degrés depuis le nord vrai : nord `0°`, est `90°`, sud `180°`, ouest `270°`. `pitch` varie de `-90°` vers le bas à `+90°` vers le haut et est défini relativement au véhicule Street View. Le projet transforme donc :

```text
heading = azimut solaire normalisé dans [0°, 360°)
pitch   = altitude solaire, limitée à [-90°, +90°]
```

À Paris vers le maximum, le POV attendu est donc environ `heading: 284`, `pitch: +7.7` : ouest-nord-ouest et légèrement au-dessus de l’horizon. Le mode `?debug=true` expose les valeurs source et le POV final pour repérer une inversion de signe ou une erreur de convention. Référence : [StreetViewPov](https://developers.google.com/maps/documentation/javascript/reference/street-view#StreetViewPov).

Cette transformation vise une direction angulaire, pas un pixel garanti : nivellement du panorama, distorsion, recadrage, champ de vue, altitude de prise de vue et capteurs du véhicule peuvent introduire un petit écart visuel.

L’imagerie Street View n’est pas recolorée. Un filtre crépusculaire modifierait aussi les contrôles et attributions Google et n’est pas une intégration documentée ; l’ambiance du projet vient uniquement du cadre et des composants de l’application. Voir les [règles d’attribution Maps JavaScript](https://developers.google.com/maps/documentation/javascript/policies) et les [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/).

## Maîtrise des appels et des coûts

Le cycle de vie est volontairement conservateur :

- le chargeur Maps est configuré une seule fois ;
- chaque panneau conserve sa même instance `Map` ou `StreetViewPanorama` ;
- la recherche de panorama est déclenchée uniquement quand l’observateur change, après temporisation ;
- les recherches proches sont mises en cache par zone pendant la session ;
- les rayons de recherche augmentent progressivement seulement en cas d’échec ;
- déplacer la timeline ne fait que recalculer les corps célestes et appeler `setPov` ;
- aucune requête Places ou Street View n’est lancée à chaque minute de lecture ;
- la saisie d’adresse est gérée par une session d’autocomplétion du composant Google.
- la couche LiDAR utilise des PNG statiques locaux ou un CDN et ne crée aucun appel Google Maps supplémentaire lors du déplacement de la timeline.

Ce comportement compte car Google associe le SKU **Dynamic Street View** à l’instanciation du panorama, et non au simple déplacement du POV. La définition exacte des événements facturables peut évoluer : consultez les [règles de facturation Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/usage-and-billing) avant le lancement.

## Confidentialité, conditions EEE et limites connues

### Données et conformité

- L’application n’a pas de backend applicatif et ne crée pas de compte utilisateur.
- La géolocalisation n’est demandée qu’après une action explicite et reste révocable via le navigateur.
- Une URL partagée contient les coordonnées choisies en clair ; évitez de partager une position privée précise.
- Google reçoit nécessairement certaines données pour servir Maps/Places/Street View, notamment requêtes, adresse IP et coordonnées. Avant publication publique, fournissez une politique de confidentialité et, si nécessaire, une gestion du consentement adaptée au public visé.
- Open-Meteo reçoit des coordonnées arrondies afin de servir la prévision horaire ; aucune position n’est conservée par l’application.
- Conservez les attributions, liens, mentions et commandes imposés par Google ; ne masquez pas le logo ni les mentions Street View.
- La couche LiDAR conserve séparément l’attribution IGN et sa Licence Ouverte 2.0 ; elle n’est pas dérivée de contenu Google.

Pour un compte de facturation domicilié dans l’Espace économique européen, les [Google Maps Platform EEA Terms](https://cloud.google.com/terms/maps-platform/eea) s’appliquent depuis le 8 juillet 2025 aux nouvelles intégrations, avec des fonctionnalités susceptibles de varier selon la région. Relisez également les [EEA Service Specific Terms](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms), les [conditions utilisateur Google Maps](https://maps.google.com/help/terms_maps/) et la [politique de confidentialité Google](https://policies.google.com/privacy). Ce README décrit l’intégration technique ; il ne constitue pas un avis juridique.

### Ce que le diagnostic ne peut pas garantir

- Street View n’est pas une vue en direct. La photo peut être ancienne, saisonnière ou prise depuis la chaussée.
- La position du panorama diffère souvent du point choisi. L’interface affiche cette distance et réduit clairement la confiance au-delà d’environ 30 m.
- La hauteur de caméra Street View n’est pas celle des yeux de l’utilisateur ; un obstacle proche peut donc changer la visibilité.
- La couche IGN estime le relief, le bâti et la végétation à partir de millésimes hétérogènes. Hors Paris, la résolution est 5 m et les lacunes LiDAR utilisent des modèles de complément moins fins ; elle ne prédit ni les constructions récentes, ni l’état réel du feuillage, ni la réfraction locale. La météo affichée est une prévision séparée et évolutive.
- Le viseur répond seulement à « dans quelle direction regarder ? ». S’il tombe dans le ciel de la photo, la vue **semble** dégagée ; s’il tombe sur un obstacle, cherchez un autre emplacement et vérifiez sur place.
- Aucune vision par ordinateur, extraction de profondeur, capture automatisée, scraping ni modèle dérivé de l’imagerie Street View n’est utilisé. Cela évite une promesse scientifique trompeuse et respecte les restrictions d’usage du contenu Google Maps.
- Les contacts et pourcentages changent avec la position ; les repères parisiens du design ne remplacent jamais les circonstances locales calculées.

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Carte grise ou « for development purposes only » | facturation active, clé valide, Maps JavaScript API activée |
| `RefererNotAllowedMapError` | domaine, protocole et port présents dans les restrictions Websites |
| Champ d’adresse indisponible | Places UI Kit activé et autorisé dans les restrictions de la clé |
| Suggestions affichées mais la sélection échoue (`PERMISSION_DENIED`) | **Places API (New)** activée : c’est un produit distinct de Places UI Kit |
| Aucun panorama | élargissement progressif terminé ; essayez un point routier voisin |
| Géolocalisation refusée | autorisation du navigateur, contexte HTTPS en production |
| URL partagée incorrecte | `lat`, `lng` valides et `time` compris dans la timeline |
| Heures décalées | vérifiez le fuseau IANA renvoyé par Open-Meteo dans `?debug=true` ; le repli avant chargement est UTC |
| « Éclipse non visible ici » | le lieu est hors de l’empreinte observable du 12 août 2026 ; essayez l’Europe, l’Afrique du Nord ou le nord de l’Amérique du Nord |

La [liste officielle des erreurs Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/error-messages) détaille les codes affichés dans la console du navigateur.

## Mise en production : l’unique étape manuelle indispensable

**Créez une vraie clé Google Maps Platform facturée et strictement restreinte, puis placez-la dans `VITE_GOOGLE_MAPS_API_KEY` sur Vercel.** Tout le reste du projet peut être construit et testé localement sans secret ; seule cette clé permet de valider en conditions réelles la carte, Places UI Kit et Street View sur le domaine final.
