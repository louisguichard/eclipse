import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // MapLibre crée son worker depuis `import.meta.url`. L'exclure de
  // l'optimisation évite une URL de worker invalide en développement.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The eclipse rollout is time-sensitive: an already installed PWA must
      // activate the new build without waiting for every old tab to close.
      registerType: 'autoUpdate',
      // Registration is handled in main.tsx so permission failures cannot
      // surface as unhandled promise rejections.
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Éclipse 2026 — Où regarder ?',
        short_name: 'Éclipse 2026',
        description: 'Visualisez l’éclipse solaire du 12 août 2026 depuis n’importe quel lieu dans le monde.',
        theme_color: '#07101f',
        background_color: '#07101f',
        display: 'standalone',
        orientation: 'any',
        lang: 'fr',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // La carte est chargée à la demande : ne pas précacher ses gros chunks
        // sur les mobiles qui n'ouvrent jamais l'onglet Carte.
        globIgnores: [
          'assets/maplibre-gl-*',
          'assets/pmtiles-*.js',
          'assets/protomaps-basemap-*.js',
        ],
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/pmtiles/') || id.includes('/node_modules/fflate/')) {
            return 'pmtiles'
          }
          if (id.includes('/node_modules/@protomaps/basemaps/')) {
            return 'protomaps-basemap'
          }
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
