# Third-party notices

This project includes or consumes third-party software, fonts, data, and services. The project license does not replace their respective terms.

## Fonts

- **IBM Plex Mono**, distributed through `@fontsource/ibm-plex-mono`, is licensed under the SIL Open Font License 1.1.
- **Schibsted Grotesk**, distributed through `@fontsource/schibsted-grotesk`, is licensed under the SIL Open Font License 1.1.
- **Instrument Serif**, distributed through `@fontsource/instrument-serif` and used by the farewell screen only, is licensed under the SIL Open Font License 1.1.

The complete font license texts are included in the corresponding npm packages installed from `package-lock.json`.

## Photograph

The farewell screen shows one photograph of the 12 August 2026 crowd, credited
on screen to **Mahaut Colliaut**. It is published here with permission and is
not covered by this project's licence.

## IGN LiDAR HD

The visibility tiles under `public/visibility/` are derived from IGN LiDAR HD MNT/MNS data:

> © IGN — LiDAR HD MNT/MNS, bloc KE, acquisition 03-03-2023, édition 06-06-2025, Licence Ouverte 2.0.

Licence: <https://www.etalab.gouv.fr/licence-ouverte-open-licence/>

## Astronomy Engine

Astronomical calculations use `astronomy-engine`, distributed under the MIT License: <https://github.com/cosinekitty/astronomy>.

## Map rendering

- **MapLibre GL JS**, **PMTiles** and **Protomaps Basemaps** are distributed under the BSD 3-Clause License. Their pinned versions and complete licence texts are included through `package-lock.json` and the installed npm packages.
- **Photo Sphere Viewer** is distributed under the MIT License and displays the assembled equirectangular panorama: <https://photo-sphere-viewer.js.org/>.
- Basemap data is derived from **OpenStreetMap**, available under the Open Database License (ODbL): <https://www.openstreetmap.org/copyright>.
- The keyless bootstrap style and tiles are served by **OpenFreeMap** and remain subject to its terms and attribution requirements: <https://openfreemap.org/>.

## Location search

- The bundled city index is derived from **GeoNames `cities15000`**, distributed under CC BY 4.0. Its attribution and licence reference are also shipped in `public/search/GEONAMES-LICENSE.txt`: <https://www.geonames.org/>.
- French address results are requested from the **Géoplateforme** geocoding service, and Spanish results from **CartoCiudad**. Their data and services are not redistributed under the project licence and remain subject to their respective terms: <https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage>, <https://www.cartociudad.es/>.

## Open-Meteo

Forecast data is provided by Open-Meteo under CC BY 4.0 and remains subject to the applicable Open-Meteo service terms: <https://open-meteo.com/en/terms>.

## Streetlevel protocol and Google Street View content

The TypeScript panorama implementation is derived from the protocol research
published by **Streetlevel**, distributed under the MIT License:
<https://github.com/sk-zk/streetlevel>.

It accesses undocumented Google metadata and Street View tile endpoints without
a Google Maps API key. These endpoints are not an official, supported or stable
Google API. Google Street View content is not covered by this project's licence;
its access, temporary in-memory assembly and display remain subject to the
applicable Google terms, privacy policy, attribution requirements and content
rights: <https://maps.google.com/help/terms_maps/>,
<https://policies.google.com/privacy>.

Apple Look Around is not accessed or included in this application.
