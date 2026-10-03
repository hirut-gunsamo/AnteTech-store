import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import pkg from './package.json' with { type: 'json' }

// Public files the installed app needs offline. Everything the bundler emits
// is added automatically; these come from public/ and are copied as-is.
//
// The paths match index.html and the manifest exactly: the worker saves what
// the page asks for, so a different spelling would never be found. Icons
// change by getting a new file name under /brand, never new contents at an
// old name, so a saved copy is never a stale picture.
const PUBLIC_SHELL = [
  '/index.html',
  '/manifest.webmanifest?v=9',
  '/brand/at-blue-favicon.ico',
  '/brand/at-blue-favicon-32.png',
  '/brand/at-blue-mark-256.png',
  '/brand/at-v3-icon-192.png',
  '/brand/at-v3-icon-512.png',
  '/brand/at-v3-icon-maskable-512.png',
  '/brand/at-v3-apple-touch-180.png',
]

/**
 * Emits sw.js with this build's id and the exact list of built files.
 *
 * A new id means a byte-different worker on every deploy, which is what makes
 * the browser notice the update and lets the app offer a reload. Build only:
 * in dev there is no worker, so nothing can serve a stale file while coding.
 */
function serviceWorker(): Plugin {
  return {
    name: 'sim-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map') && file !== 'index.html')
        .map((file) => `/${file}`)

      const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace('__BUILD_ID__', `${pkg.version}-${Date.now().toString(36)}`)
        .replace('__PRECACHE__', JSON.stringify([...PUBLIC_SHELL, ...built]))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
// Where the API listens (apps/api PORT). API_TARGET overrides it.
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), serviceWorker()],

  // The Sync page reports the running version. Taking it from package.json
  // means it cannot drift from what was actually built.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // AnteTech's own ports, clear of the common defaults (web 5173, API 3000)
  // that other apps on the same computer may use: the web app on 5175, its
  // API on 3001.
  // strictPort stops Vite drifting to another port if 5175 is taken, so the
  // address never changes under anyone.
  server: {
    port: 5175,
    strictPort: true,
    // The API runs separately in dev; proxying keeps the browser same-origin
    // so there are no CORS preflights and the token header passes straight
    // through.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },

  // `vite preview` serves the production build, worker included, so the
  // installed-app behaviour can be checked locally before deploying.
  preview: {
    port: 4175,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
