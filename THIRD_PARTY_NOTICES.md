# Third-party notices

This project includes or consumes third-party software, fonts, data, and services. The project license does not replace their respective terms.

## Fonts

- **IBM Plex Mono**, distributed through `@fontsource/ibm-plex-mono`, is licensed under the SIL Open Font License 1.1.
- **Schibsted Grotesk**, distributed through `@fontsource/schibsted-grotesk`, is licensed under the SIL Open Font License 1.1.

The complete font license texts are included in the corresponding npm packages installed from `package-lock.json`.

## IGN LiDAR HD

The visibility tiles under `public/visibility/` are derived from IGN LiDAR HD MNT/MNS data:

> © IGN — LiDAR HD MNT/MNS, bloc KE, acquisition 03-03-2023, édition 06-06-2025, Licence Ouverte 2.0.

Licence: <https://www.etalab.gouv.fr/licence-ouverte-open-licence/>

## Astronomy Engine

Astronomical calculations use `astronomy-engine`, distributed under the MIT License: <https://github.com/cosinekitty/astronomy>.

## Map rendering

- **MapLibre GL JS**, **PMTiles** and **Protomaps Basemaps** are distributed under the BSD 3-Clause License. Their pinned versions and complete licence texts are included through `package-lock.json` and the installed npm packages.
- Basemap data is derived from **OpenStreetMap**, available under the Open Database License (ODbL): <https://www.openstreetmap.org/copyright>.
- The keyless bootstrap style and tiles are served by **OpenFreeMap** and remain subject to its terms and attribution requirements: <https://openfreemap.org/>.

## Location search

- The bundled city index is derived from **GeoNames `cities15000`**, distributed under CC BY 4.0. Its attribution and licence reference are also shipped in `public/search/GEONAMES-LICENSE.txt`: <https://www.geonames.org/>.
- French address results are requested from the **Géoplateforme** geocoding service, and Spanish results from **CartoCiudad**. Their data and services are not redistributed under the project licence and remain subject to their respective terms: <https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage>, <https://www.cartociudad.es/>.

## Open-Meteo

Forecast data is provided by Open-Meteo under CC BY 4.0 and remains subject to the applicable Open-Meteo service terms: <https://open-meteo.com/en/terms>.

## Google Maps Platform

Google Street View Embed content is not redistributed under the project license. Its use is subject to the applicable Google Maps Platform terms, policies, and attribution requirements: <https://developers.google.com/maps/documentation/embed/policies>.
