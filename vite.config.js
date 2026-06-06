import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serve i project site da /<nome-repo>/.
// `base` DEVE coincidere col nome esatto del repository, altrimenti in
// produzione gli asset non vengono trovati e la pagina resta bianca.
// Il componente legge graph.json via import.meta.env.BASE_URL, quindi
// questo valore vale sia in dev sia in build.
const base = '/new-release-atlas/'

export default defineConfig({
  base,
  plugins: [
    react(),
    // PWA: genera manifest + service worker (Workbox) e inietta da solo la
    // registrazione nel bundle. Rispetta `base`, quindi scope/start_url e i
    // path degli asset restano sotto /new-release-atlas/.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        id: base,
        name: 'New Release Atlas',
        short_name: 'Atlas',
        description: 'Interactive force-directed map of my music archive.',
        lang: 'en',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#2b2724',
        background_color: '#f4f1ea',
        categories: ['music', 'entertainment'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precarica l'app shell e i dati: graph.json incluso così la mappa
        // funziona anche offline dopo la prima visita.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,webmanifest,woff2}'],
        // La vista 3D (three.js, ~1MB) è sperimentale e caricata on-demand:
        // fuori dal precache, così non pesa sulla prima visita di tutti.
        globIgnores: ['**/Graph3D-*.js'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // I font Google sono cross-origin: cache-first a runtime.
        runtimeCaching: [
          {
            // Il chunk 3D viene messo in cache solo quando lo si apre davvero.
            urlPattern: ({ url }) => /\/assets\/Graph3D-.*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'graph3d-chunk',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
