# Index mondial de villes

`public/search/world-cities-geonames-20260811.min.json` est une version compacte
de `cities15000.zip`, publiée par GeoNames sous licence CC BY 4.0. Elle reste
hors du bundle JavaScript et n’est téléchargée qu’après une recherche.

Pour reconstruire l’asset depuis la source officielle courante :

```bash
npm run search:cities:build
```

Pour une construction reproductible sans nouveau téléchargement :

```bash
npm run search:cities:build -- --source /chemin/vers/cities15000.zip
```

Le nom de sortie est versionné. Après une mise à jour de date, modifiez aussi
`WORLD_CITIES_URL` dans `src/lib/search/worldCities.ts` afin que les navigateurs
ne conservent pas l’ancien fichier immutable. Ne retirez ni le lien GeoNames
affiché sous les résultats, ni `public/search/GEONAMES-LICENSE.txt`.
