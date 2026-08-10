import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
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
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
  },
})
