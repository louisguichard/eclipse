# Architecture Streetlevel d’urgence pour Éclipse 2026

Date de validation : 11 août 2026  
Base de départ : `a5d221f8eb719b944a8ba042ac577af9bf0175ff`

## Décision

Cette variante remplace les trois produits Google Maps Platform payants :

| Besoin | Implémentation |
| --- | --- |
| Panorama 360° | protocole Google interne porté depuis Streetlevel, tuiles assemblées dans le navigateur, Photo Sphere Viewer |
| Carte | MapLibre GL JS, style OpenFreeMap sans clé ou archive Protomaps/PMTiles auto-hébergée |
| Recherche | Géoplateforme/IGN (France), CartoCiudad (Espagne), index GeoNames statique (monde) |

Aucune clé Google Maps, aucune fonction serverless et aucun proxy d’image ne
sont nécessaires. Les appels de panorama partent directement du navigateur de
chaque visiteur. Cela retire le coût Google Maps Platform et le transfert
Streetlevel de Vercel, mais pas le trafic réseau chez les fournisseurs ni les
risques associés aux endpoints internes.

Cette solution est une mesure d’urgence à courte durée de vie. Elle ne doit pas
être présentée comme une API Google gratuite, officielle ou supportée.

## Fonctionnement du panorama

Le code TypeScript sous `src/lib/streetlevel/` reproduit uniquement la partie
Google Street View utile du projet Streetlevel :

1. il sérialise la requête protobuf dans l’URL ;
2. il appelle `GeoPhotoService.SingleImageSearch` en JSONP pour trouver le
   panorama officiel le plus proche et lire ses métadonnées ;
3. il télécharge les tuiles depuis
   `streetviewpixels-pa.googleapis.com/v1/tile` avec CORS ;
4. il assemble une image équirectangulaire JPEG dans un canvas du navigateur ;
5. il crée une URL `blob:` consommée par Photo Sphere Viewer.

Les tests effectués le 11 août 2026 depuis une page web ont confirmé que la
recherche JSONP et les tuiles répondaient sans clé ni proxy. Cette observation
est ponctuelle : Google peut modifier le protobuf, le callback, CORS, les hôtes,
le format des tuiles ou les contrôles d’accès à tout moment.

### Résolution et charge

Le niveau par défaut est `z3`. Sur le panorama parisien mesuré :

- image assemblée : `3328 × 1664` ;
- grille : 28 tuiles de `512 × 512` ;
- transfert observé : environ 0,8 Mo ;
- mémoire brute du canvas : environ 22 Mo, avant les autres objets du viewer.

Le niveau `z4` mesuré produisait `6656 × 3328`, 91 tuiles et environ 2,5 Mo de
transfert, avec une pression mémoire nettement supérieure. Il n’est donc pas le
choix par défaut pour le lancement.

À 24 000 sessions et un panorama `z3` par session, l’ordre de grandeur est
environ 19 Go transférés directement de Google vers les visiteurs et près de
700 000 requêtes de tuiles. Une navigation entre panoramas multiplie ces
valeurs. Ce trafic ne passe pas par Vercel, mais il peut déclencher une
limitation ou un blocage côté fournisseur.

### Cache et confidentialité

- les métadonnées de recherche sont mémorisées dans l’onglet par coordonnées ;
- les JPEG assemblés restent uniquement en mémoire sous forme d’URL `blob:` ;
- le cache applicatif est un LRU de trois images ; l’URL de l’image évincée est
  révoquée ;
- aucun panorama n’est écrit dans `localStorage`, IndexedDB, un fichier, une
  base de données ou un bucket ;
- aucun panorama n’est envoyé à Vercel ou à un backend du projet.

Le cache HTTP propre au navigateur reste régi par les en-têtes des réponses
Google. La position et l’adresse IP du visiteur sont nécessairement exposées à
Google lors de la recherche et du téléchargement des tuiles.

## Carte sans Google Maps

`MapView` utilise MapLibre GL JS. Deux configurations sont disponibles :

- `VITE_BASEMAP_STYLE_URL` : style distant ; OpenFreeMap est la valeur sans clé
  par défaut, sans SLA ;
- `VITE_BASEMAP_PMTILES_URL` : archive vectorielle Protomaps compatible,
  auto-hébergée, prioritaire lorsqu’elle est renseignée.

Les interactions existantes sont conservées : clic pour choisir un lieu,
marqueur, trajectoire solaire et couches raster LiDAR. Le fournisseur du fond
doit conserver une attribution visible et être dimensionné pour le trafic réel.

## Recherche sans Places

La saisie attend trois caractères, temporise les requêtes et fusionne au plus
huit résultats provenant de :

- la Géoplateforme pour les adresses et lieux français ;
- CartoCiudad pour l’Espagne ;
- `public/search/world-cities.min.json`, index GeoNames mondial servi comme
  ressource statique et chargé paresseusement.

Les deux services distants ont leur propre disponibilité, capacité et politique
d’usage. Le fichier GeoNames d’environ 2,3 Mo garantit un repli mondial au
niveau ville, pas une recherche d’adresse exhaustive. À 1 000 nouveaux
visiteurs par heure, une absence de cache CDN ou navigateur sur ce fichier
représenterait environ 2,3 Go par heure ; son cache statique et sa compression
doivent donc être vérifiés après déploiement.

## Apple Look Around

Streetlevel contient aussi un fournisseur Apple Look Around, mais il s’agit
d’un protocole, de métadonnées et de tuiles distincts. L’implémentation présente
ne l’inclut pas et n’effectue aucune recherche agrégée « Google ou Apple, prendre
l’image la plus proche ».

Les panoramas demandés ici sont limités à la couverture Google Street View
officielle. Les photosphères tierces du système Google sont également exclues,
car leur projection et leurs conditions peuvent varier.

## Risques assumés

### Opérationnels

- aucun contrat de compatibilité, quota documenté, support ou SLA ;
- blocage possible par origine, IP, volume ou mécanisme anti-automatisation ;
- changement possible du protobuf ou du format de réponse sans préavis ;
- CORS peut fonctionner aujourd’hui et être retiré demain ;
- l’assemblage `z3` peut dépasser la mémoire disponible sur un mobile ancien ;
- la couverture et l’âge des images ne sont pas garantis.

### Conditions et droits

Ces endpoints ne constituent pas une voie documentée de Google Maps Platform.
L’extraction et l’assemblage de tuiles hors du viewer officiel peuvent entrer en
conflit avec les conditions relatives à l’accès, au téléchargement, au cache et
à l’affichage de contenu Google. L’absence de clé ou de facturation ne vaut ni
autorisation ni licence.

Références à relire avant publication :

- Streetlevel : <https://github.com/sk-zk/streetlevel>
- conditions Google Maps : <https://maps.google.com/help/terms_maps/>
- conditions Google Maps Platform EEE : <https://cloud.google.com/terms/maps-platform/eea>
- conditions Google Maps Platform hors EEE : <https://cloud.google.com/maps-platform/terms>
- politique de confidentialité Google : <https://policies.google.com/privacy>

Ce document est un constat technique, pas un avis juridique.

## Vérification de lancement

Depuis le domaine de production et sur au moins un navigateur Chromium, Safari
et Firefox :

1. rechercher une adresse française, espagnole puis une ville mondiale ;
2. choisir un point sur la carte et confirmer le déplacement du marqueur ;
3. charger un panorama, le faire pivoter, zoomer et suivre un lien voisin ;
4. confirmer que le viseur solaire reste synchronisé après recentrage ;
5. vérifier dans l’onglet Réseau qu’aucun appel Maps JS/Places payant ni aucune
   fonction Vercel de panorama n’est déclenché ;
6. confirmer les attributions Google, OpenStreetMap/OpenFreeMap, IGN, GeoNames
   et Open-Meteo ;
7. tester les états de repli en bloquant successivement le service de
   métadonnées, les tuiles Street View et le fond de carte.

Le projet doit garder un repli activable pendant l’événement. Une validation la
veille ne réduit pas le risque de casse des endpoints internes pendant les
24 heures critiques.
