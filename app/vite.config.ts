import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Matched against the full URL by Workbox, so anchor on the path after the host.
const BACKEND_PATHS = /^https?:\/\/[^/]+\/(rest|auth|realtime|storage|functions)\/v\d+\//
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let supabaseHost = ''
  try {
    supabaseHost = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).hostname : ''
  } catch {
    // An invalid URL is reported by the app itself; the path rule below still applies.
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Swiper: baby names together',
          short_name: 'Swiper',
          description: 'Swipe on baby names together and find the ones you both love.',
          theme_color: '#e11d48',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          // Never serve the app shell for backend routes.
          navigateFallbackDenylist: [/^\/(rest|auth|realtime|storage|functions)\//],
          cleanupOutdatedCaches: true,
          // Supabase traffic is network only: never precached, never runtime cached.
          runtimeCaching: [
            // Patterns must be RegExp literals: they are serialised into sw.js, so closures break.
            ...(supabaseHost
              ? [{ urlPattern: new RegExp(`^https?://${escapeRe(supabaseHost)}(:\\d+)?/`), handler: 'NetworkOnly' as const }]
              : []),
            { urlPattern: /^https?:\/\/[^/]+\.supabase\.(co|in)\//, handler: 'NetworkOnly' as const },
            { urlPattern: BACKEND_PATHS, handler: 'NetworkOnly' as const },
          ],
        },
      }),
    ],
  }
})
