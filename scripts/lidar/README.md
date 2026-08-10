# Pipeline LiDAR — visibilité géométrique à Paris

Ce dossier permet de reconstruire la couche statique **« Visibilité estimée au maximum »** affichée sur la carte. Le calcul utilise le relief au sol (MNT) et la surface LiDAR (MNS : relief, bâtiments et végétation) de l’IGN pour estimer si le disque solaire dépasse l’horizon modélisé depuis chaque cellule de Paris.

Cette couche est une aide au repérage, pas une garantie d’observation. Elle n’utilise ni les images Google Maps ni Street View, ne fait aucune vision par ordinateur et ne prédit pas les nuages.

## Résultat publié

Le jeu fourni avec l’application est `paris-2026-max-v1` :

- emprise : commune administrative de Paris, masquée hors de son contour officiel ;
- instant fixe : `2026-08-12T18:17:11.916Z`, soit 20:17:11 à Paris ;
- Soleil apparent : azimut `283.804835°`, altitude `7.723762°` ;
- rayon angulaire solaire : `0.26296°` ;
- calcul : grille Lambert-93 à 2 m ;
- rendu : tuiles PNG RGBA XYZ de 256 px, zooms 10 à 16 ;
- sortie : `public/visibility/paris-2026-max-v1/` avec un `manifest.json`.

Le manifeste généré est la référence de publication : il contient l’emprise exacte, le millésime des sources, les paramètres solaires, le nombre de cellules par classe, les zooms disponibles et les mentions d’attribution.

## Sources et licence

### Altimétrie et modèle de surface

Le script interroge le service WMS public de la Géoplateforme IGN :

- endpoint : <https://data.geopf.fr/wms-r/wms> ;
- MNT : `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` ;
- MNS : `IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` ;
- bloc utilisé : KE ;
- acquisition indiquée par les métadonnées : 3 mars 2023 ;
- édition : 6 juin 2025.

Attribution à conserver avec les tuiles et dans l’interface :

> © IGN — LiDAR HD MNT/MNS, bloc KE, acquisition 03-03-2023, édition 06-06-2025, Licence Ouverte 2.0

Les données sont réutilisées sous la [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). Vérifiez les métadonnées IGN et les conditions de réutilisation avant de publier une nouvelle version ; ne retirez pas l’attribution des sorties dérivées.

Le pipeline demande des rasters float32 directement sur une grille de calcul à 2 m. Il ne télécharge ni ne commite les dalles source LiDAR HD à 50 cm.

### Contour administratif

Le masque de Paris provient de l’API officielle `geo.api.gouv.fr`, commune INSEE `75056` :

<https://geo.api.gouv.fr/communes/75056?format=geojson&geometry=contour>

Le GeoJSON est mis en cache dans `data/lidar/paris/paris-boundary.geojson` pour rendre les reprises déterministes.

## Prérequis

- Python 3.11 ou plus récent ;
- environ 1 Go d’espace disque libre pour le cache à la résolution par défaut ;
- une connexion réseau stable pour l’étape IGN WMS ;
- les paquets listés dans `scripts/lidar/requirements.txt` : NumPy, Pillow et pyproj.

Depuis la racine du projet :

```bash
python3 -m venv .venv-lidar
source .venv-lidar/bin/activate
python -m pip install --upgrade pip
python -m pip install -r scripts/lidar/requirements.txt
```

Sous Windows PowerShell, activez l’environnement avec `.venv-lidar\Scripts\Activate.ps1`, puis utilisez `python` directement si la commande `python3` n’existe pas.

## Tests du modèle

```bash
npm run lidar:test
```

Les tests synthétiques vérifient au minimum qu’un terrain plat est classé dégagé, qu’un obstacle situé vers le Soleil masque un observateur et qu’un pixel posé sur un toit n’est pas présenté comme un emplacement dégagé.

## Génération complète

La commande suivante télécharge les deux rasters, calcule les classes puis génère la pyramide XYZ :

```bash
npm run lidar:generate
```

Les valeurs par défaut équivalent à :

```bash
python scripts/lidar/generate_paris_visibility.py \
  --stage all \
  --resolution 2 \
  --chunk-size 2000 \
  --min-zoom 10 \
  --max-zoom 16 \
  --data-dir data/lidar/paris \
  --public-dir public/visibility/paris-2026-max-v1
```

Le téléchargement est volontairement limité à environ une requête par seconde, réessaie chaque bloc jusqu’à cinq fois et enregistre les blocs terminés. Après une interruption, relancez la même commande : les blocs validés ne seront pas demandés à nouveau.

## Exécuter les étapes séparément

```bash
# 1. Contour officiel, grille, MNT et MNS
npm run lidar:generate -- --stage download

# 2. Classification géométrique à partir des rasters locaux
npm run lidar:generate -- --stage classify

# 3. PNG XYZ et manifest.json à partir des classes locales
npm run lidar:generate -- --stage tiles
```

`--stage classify` exige `mnt.f32` et `mns.f32`. `--stage tiles` exige `paris-visibility-classes.npy`. Les fichiers `*-download.json` contiennent la signature de la grille et la progression des téléchargements.

La grille existante est protégée : si la résolution ou un autre paramètre structurel change, le script refuse de mélanger les données. Utilisez alors de nouveaux dossiers explicites :

```bash
npm run lidar:generate -- \
  --resolution 4 \
  --data-dir data/lidar/paris-4m \
  --public-dir public/visibility/paris-2026-max-4m
```

Cette commande crée un autre jeu ; elle ne remplace pas silencieusement la version publiée.

## Volumes observés

Pour la génération de référence à 2 m :

| Élément | Volume approximatif |
| --- | ---: |
| `mnt.f32` | 335,7 Mo (320 Mio) |
| `mns.f32` | 335,7 Mo (320 Mio) |
| `paris-visibility-classes.npy` | 43,3 Mo (41 Mio) |
| cache `data/lidar/` complet | environ 682 Mo sur disque |
| 1 561 tuiles + manifeste | environ 6,4 Mo |

Le volume varie avec la résolution, l’emprise, les zooms et la compression PNG. `data/lidar/` est ignoré par Git ; les tuiles destinées au navigateur vivent dans `public/visibility/`.

Avec des blocs de 2 000 px, la grille actuelle produit 24 requêtes par raster, soit 48 requêtes WMS complètes pour le MNT et le MNS. La durée réelle dépend du débit IGN, du processeur et du stockage.

### Ordre de grandeur France entière

Une extrapolation à la France métropolitaine représente environ 17,5 To d’entrées MNT+MNS au pas natif de 50 cm, avant les halos, fichiers intermédiaires et pyramides de tuiles. Une version nationale dérivée à 2 m resterait de l’ordre du téraoctet d’entrées et demanderait un traitement découpé, reprenable et parallélisé ainsi qu’un stockage objet/CDN.

Sur une seule machine robuste, il faut prévoir plusieurs jours de téléchargement et de calcul à 2 m, puis du temps de validation. Industrialiser et vérifier scientifiquement la France entière représente plutôt deux à quatre semaines de travail ; conserver la résolution native fait basculer le projet vers plusieurs semaines de traitement distribué et six à dix semaines d’ingénierie/contrôle qualité. Ces estimations sont des ordres de grandeur, pas un engagement de délai.

## Algorithme, sans promesse excessive

1. Le contour WGS84 de Paris est projeté en Lambert-93 (`EPSG:2154`).
2. La grille de sortie est échantillonnée à 2 m. La grille d’entrée est prolongée vers l’ouest-nord-ouest afin de conserver les obstacles situés dans la direction du Soleil.
3. Le cap vrai `283.804835°` est converti dans la grille Lambert-93 ; le rayon discret résultant vaut environ `284.274702°` dans cette projection.
4. Pour chaque cellule candidate, l’œil est placé à `MNT + 1,7 m`.
5. Un passage linéaire suit un rayon discret vers l’ouest-nord-ouest et propage le maximum du MNS rencontré. Le coût est linéaire dans le nombre de pixels plutôt que quadratique dans la longueur de chaque ligne de visée.
6. Trois pentes sont testées : bord inférieur du Soleil moins une marge de `0,5°`, bord inférieur physique, puis bord supérieur.
7. Une cellule dont le MNS local dépasse le MNT d’au moins 2,5 m est classée masquée : elle correspond probablement à un bâtiment, un arbre ou une autre surface non praticable au niveau du sol.
8. Les résultats hors du contour administratif sont rendus transparents, puis reprojetés par voisin le plus proche en tuiles Web Mercator XYZ.

Les classes signifient :

- **dégagement probable** : le disque entier dépasse le profil avec 0,5° de marge supplémentaire ;
- **horizon sensible** : le bord inférieur dépasse le profil, mais avec moins de 0,5° de marge ;
- **incertain** : seul le bord supérieur pourrait dépasser ;
- **masquage probable** : même le bord supérieur est masqué, ou la cellule contient un obstacle local ;
- **pas de données** : altitude invalide ou point hors Paris.

Le mot « probable » est intentionnel. Une cellule de couleur favorable ne dispense jamais de consulter Street View puis de vérifier l’endroit sur place.

## Limites connues

- Le calcul correspond au maximum central parisien fixe, pas au maximum local recalculé pour chaque pixel. L’écart à l’intérieur de Paris est faible mais non nul.
- Le MNS a été acquis en mars 2023. Il ne contient pas les constructions plus récentes et peut sous-estimer le feuillage présent en août 2026.
- Le modèle de surface ne distingue pas toujours un toit, une canopée, une grue ou un objet temporaire.
- La grille à 2 m et le rayon numérique simplifient les arêtes fines, les ouvertures entre bâtiments et la largeur angulaire horizontale du Soleil.
- La courbure terrestre, les variations locales de réfraction, la hauteur réelle des yeux et les erreurs verticales du modèle ne sont pas affinées pour chaque point.
- Le modèle ne connaît ni l’accessibilité, ni le domaine public, ni les risques routiers du pixel choisi.
- Les nuages, la brume, la pluie et la transparence atmosphérique ne sont pas prévus.
- Le résultat ne provient pas de Street View : un panorama récent et une visite sur place restent indispensables.

## Publication locale ou CDN

Par défaut, Vite sert les tuiles incluses dans :

```text
public/visibility/paris-2026-max-v1/{z}/{x}/{y}.png
```

Pour déléguer les fichiers à un CDN, définissez la base qui **contient** le dossier versionné :

```dotenv
VITE_VISIBILITY_TILE_BASE_URL=https://cdn.example.fr/eclipse/visibility
```

Le navigateur demandera alors :

```text
https://cdn.example.fr/eclipse/visibility/paris-2026-max-v1/{z}/{x}/{y}.png
```

N’ajoutez donc pas `paris-2026-max-v1` dans la variable. Utilisez une URL HTTPS, configurez les en-têtes de cache immuables sur les dossiers versionnés et autorisez les origines nécessaires si le CDN applique une politique CORS. Le manifeste et l’attribution doivent être publiés avec les tuiles.

## Avant de publier une nouvelle version

1. exécuter `npm run lidar:test` ;
2. utiliser un nouvel identifiant de dossier/version si les données ou paramètres changent ;
3. vérifier `manifest.json`, les comptes de classes et plusieurs tuiles aux bords de l’emprise ;
4. contrôler visuellement des points plats, des parcs, des rues encaissées et des grands bâtiments ;
5. conserver l’attribution IGN et actualiser le millésime ;
6. tester le fallback hors Paris et lorsque les tuiles sont indisponibles ;
7. rappeler dans l’interface que le résultat est une estimation et qu’il faut vérifier sur place.
