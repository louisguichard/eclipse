# Éclipse 2027 — Où regarder ?

💡 Ce projet a été entièrement vibe-codé, principalement avec Codex (GPT 5.6 Sol). L'ensemble du code et de la documentation a été écrit par IA (à la seule exception de ce paragraphe).

Une application web mobile et desktop pour préparer l’éclipse solaire du **lundi 2 août 2027**. Street View occupe la scène principale ; la carte, la simulation astronomique et la chronologie permettent de choisir un lieu puis de repérer la direction exacte du Soleil.

Le site calcule l’événement 2027 pour n’importe quelles coordonnées avec [`astronomy-engine`](https://github.com/cosinekitty/astronomy). Hors de son empreinte observable, l’interface l’indique explicitement au lieu d’afficher une autre éclipse future.

> **Sécurité solaire :** ne regardez jamais directement le Soleil sans lunettes d’éclipse conformes **ISO 12312-2**. Des lunettes de soleil, un téléphone ou un filtre photographique ordinaire ne protègent pas les yeux.

> [!WARNING]
> Le panorama repose sur des endpoints Google Street View internes, non documentés et non supportés. Ils peuvent changer, être limités ou bloqués sans préavis. Voir [docs/streetlevel-feasibility.md](docs/streetlevel-feasibility.md).

## Fonctionnalités

- recherche d’adresse en France, en Espagne et dans le monde ;
- sélection par recherche, carte ou géolocalisation ;
- panorama Street View orienté vers le Soleil ;
- écran-souvenir d’accueil avec la photo de 2026, le rendez-vous du 2 août 2027 et un accès à la simulation depuis toute la page ;
- position apparente du Soleil et de la Lune, occultation et contacts locaux ;
- carte MapLibre avec direction et trajectoire solaires ;
- chronologie accélérée de l’éclipse 2027 ;
- URL partageable (`lat`, `lng`, `time`) et mode diagnostic `?debug=true` ;
- interface française responsive et installable comme PWA.

Les anciens calques jaunes LiDAR calculés pour 2026 et la météo ont été retirés de l’interface : ils ne décrivaient pas l’événement 2027. Les scripts de calcul restent dans le dépôt à titre d’archive technique, mais les anciennes tuiles ne sont plus publiées par le site.

## Auteur

Ce projet a été créé par [Louis Guichard](https://louisguichard.fr/), également créateur de [Speakea](https://speakea.app/), une application pour pratiquer l’anglais à l’oral avec l’intelligence artificielle.

## Installation locale

Prérequis : Node.js 22.x et npm 10 ou plus récent.

```bash
git clone https://github.com/louisguichard/eclipse.git
cd eclipse-2026
npm ci
cp .env.example .env.local
npm run dev
```

Ouvrez ensuite [http://localhost:5173](http://localhost:5173).

Variables facultatives :

```dotenv
VITE_BASEMAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
VITE_BASEMAP_PMTILES_URL=
VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=
VITE_SENTRY_DSN=
VITE_MAINTENANCE_BANNER_ENABLED=false
VITE_SPEAKEA_BANNER_PERCENTAGE=100
```

Les variables `VITE_*` sont intégrées au bundle client et sont donc publiques.

## Vérifications

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` exécute l’ensemble de ces contrôles.

## Déploiement

Le projet est une application Vite statique. Sur Vercel, utilisez la racine du dépôt, la commande `npm run build` et le dossier de sortie `dist`. Redéployez après chaque modification d’une variable `VITE_*`.

Le fichier `vercel.json` configure les principaux en-têtes de sécurité. Le service worker s’actualise automatiquement afin qu’une ancienne installation de la PWA ne conserve pas les contenus 2026.

## Référence astronomique 2027

La simulation cible l’éclipse totale du 2 août 2027. D’après la [fiche NASA](https://eclipse.gsfc.nasa.gov/SEsearch/SEdata.php?Ecl=20270802), le maximum global se produit vers 10:06:35 UTC. La totalité traverse notamment le sud de l’Espagne et l’Afrique du Nord ; Paris observe une éclipse partielle, avec un maximum calculé vers 09:01 UTC et environ 51 % du disque solaire masqué.

Les calculs sont réalisés dans le navigateur. Les heures de l’interface sont provisoirement affichées en UTC afin de rester non ambiguës sans dépendre d’un service météo ou de fuseau horaire.

## Limites et confidentialité

- Street View est une photographie ancienne et peut être décalée par rapport au point réel ; l’application n’analyse pas les bâtiments, les arbres ou le relief.
- La carte montre la direction du Soleil, pas une garantie de visibilité. Vérifiez toujours l’horizon sur place et restez hors des chaussées.
- Aucune prévision météo n’est chargée ou affichée.
- Aucune couche de visibilité LiDAR 2026 n’est chargée ou affichée.
- La géolocalisation n’est lue qu’après une action explicite. Les recherches d’adresse et les panoramas sont demandés directement aux fournisseurs indiqués dans le panneau « À propos ».

## Licence

Voir [LICENSE](LICENSE) et [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
