import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DEV_SERVER = 'http://localhost:8080'

/**
 * The build's own version number, read from `package.json` rather than retyped.
 *
 * The settings screen prints it so that a bug report names a build, which only works if it cannot drift: a
 * hand-maintained constant beside a `package.json` that moves is a version string that lies exactly when it
 * matters. Vitest does not apply this define, so the app falls back to a marker (see `src/globals.d.ts`).
 */
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

/**
 * The Normal web build: static files under `apps/normal-web/dist`, which the Normal server serves as its
 * `PUBLIC_DIR` (spec §19.2, the `GET /*` row) and Caddy caches in front of.
 *
 * `base: '/'` rather than Lite's `'./'`: this bundle is served from the root of a domain, never from inside an
 * exe or from a file path, and an absolute base is what lets `index.html` be returned for a deep link
 * (`/lobby`) without every asset URL then resolving against that deeper path.
 *
 * `root` comes from this file rather than the working directory, so `vite build` finds the same `index.html`
 * however it is invoked.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  define: { __NORMAL_VERSION__: JSON.stringify(version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    // Dev only: the Normal server runs on 8080 while Vite serves the UI. The session cookie is set by the API
    // through this proxy, so it lands on the Vite origin and `credentials: 'same-origin'` sends it back.
    proxy: {
      '/api': DEV_SERVER,
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
