# Publication des tuiles sur Cloudflare R2

Ce dossier contient l’outillage de publication. Les identifiants R2 sont des
secrets d’administration : ils restent dans le terminal local et ne doivent
jamais être placés dans une variable `VITE_*`, dans Vercel ou dans Git.

## Préparation Cloudflare

1. Créer un bucket R2 nommé `eclipse-visibility`.
2. Dans **R2 > Manage API Tokens**, créer un jeton **Object Read & Write** limité
   à ce bucket, puis conserver l’Access Key ID et la Secret Access Key.
3. Appliquer la politique CORS :

   ```bash
   npx wrangler r2 bucket cors set eclipse-visibility --file scripts/r2/cors.json
   npx wrangler r2 bucket cors list eclipse-visibility
   ```

### Attention au DNS de louisguichard.fr

Au moment de la rédaction, les serveurs DNS autoritaires de
`louisguichard.fr` sont ceux d’OVH (`dns104.ovh.net` et `ns104.ovh.net`) et
`eclipse.louisguichard.fr` est un CNAME vers Vercel. Sur l’offre Cloudflare
Free, connecter un domaine personnalisé R2 exige que la zone DNS complète soit
gérée par Cloudflare ; le mode CNAME partiel est réservé aux offres Business et
Enterprise.

Ne changez donc pas les nameservers uniquement pour R2 sans préparation :

1. exporter la zone DNS complète depuis OVH ;
2. inventorier et vérifier tous les enregistrements, en particulier `MX`, SPF,
   DKIM, DMARC, les sous-domaines, validations et éventuels `SRV` ;
3. ajouter la zone à Cloudflare et comparer l’import ligne par ligne à l’export ;
4. conserver exactement le CNAME Vercel de `eclipse` ;
5. seulement après cette vérification, remplacer chez OVH les nameservers par
   ceux fournis par Cloudflare ;
6. attendre que la zone soit Active et tester le site, les e-mails et les autres
   sous-domaines ;
7. connecter enfin `tiles.louisguichard.fr` dans **R2 > bucket >
   Settings > Custom Domains**.

L’URL publique `r2.dev` peut servir à valider temporairement les fichiers avant
une migration DNS, mais Cloudflare la limite et la réserve au développement :
elle ne doit pas devenir l’URL de production. Cloudflare Web Analytics reste,
de son côté, indépendant du DNS et n’impose aucune migration.

## Publication locale

Installer AWS CLI, puis créer le fichier local déjà ignoré par Git :

```bash
cp scripts/r2/r2.env.template .env.r2.local
chmod 600 .env.r2.local
```

Renseigner dans `.env.r2.local` l’identifiant du compte, l’Access Key ID et la
Secret Access Key. Le script lit ce fichier sans l’exécuter comme du shell.

Valider d’abord le plan local, puis demander à AWS CLI un dry-run :

```bash
npm run r2:plan
npm run r2:publish -- --dry-run
```

Lorsque la destination affichée est correcte :

```bash
npm run r2:publish
```

Le script envoie uniquement les PNG présents et `manifest.json` sous
`visibility/paris-2026-max-v1/`. Il ne contient jamais `--delete` et applique
`Cache-Control: public,max-age=31536000,immutable` à ce dossier versionné.

Vérifier ensuite le domaine public et CORS :

```bash
npm run r2:verify -- https://tiles.louisguichard.fr/visibility
```

Enfin, configurer dans Vercel, pour **Production** :

```dotenv
VITE_VISIBILITY_TILE_BASE_URL=https://tiles.louisguichard.fr/visibility
```

Après redéploiement, inspecter l’onglet Réseau du navigateur. Les requêtes PNG
doivent provenir de `tiles.louisguichard.fr`. Une tuile absente est une
zone entièrement transparente et le composant cartographique masque proprement
l’erreur d’image.

## Fond MapLibre PMTiles

Le même bucket peut contenir une archive cartographique sous un préfixe séparé.
Placez l’archive à publier dans `data/basemap/eclipse-2026.pmtiles`, puis
contrôlez la destination avant tout envoi :

```bash
npm run r2:basemap:plan
npm run r2:basemap:publish -- --dry-run
npm run r2:basemap:publish
```

La clé par défaut est `basemap/eclipse-2026-v1.pmtiles`. Elle peut être changée
avec `CLOUDFLARE_R2_BASEMAP_KEY` dans `.env.r2.local`, à condition de conserver
une extension `.pmtiles`. La publication est immutable et ne supprime aucun
objet.

Après vérification des réponses `206 Partial Content`, configurez le build :

```dotenv
VITE_BASEMAP_PMTILES_URL=https://tiles.louisguichard.fr/basemap/eclipse-2026-v1.pmtiles
```

Le client PMTiles utilise des requêtes HTTP Range. La politique CORS du domaine
doit donc autoriser `GET` et `HEAD`; testez aussi que `Content-Length`, `ETag`
et `Content-Range` sont accessibles au navigateur. Tant que l’archive n’est pas
publiée, l’application utilise le style gratuit OpenFreeMap configuré par
`VITE_BASEMAP_STYLE_URL`.
