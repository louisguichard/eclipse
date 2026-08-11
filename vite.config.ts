import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // MapLibre creates its worker from `import.meta.url`. Vite's dependency
  // optimizer otherwise rewrites that URL to a non-existent
  // `maplibre-gl-worker.mjs` during local development.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Cost-control and emergency fixes must replace an older cached bundle
      // without waiting for every open tab to be closed manually.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The WebGL renderer is a lazy route-level dependency. Precaching its
        // ~1 MB chunk would download it on every mobile visit even when the
        // visitor never opens the Carte tab.
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
