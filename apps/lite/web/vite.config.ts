import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DEV_SERVER = 'http://localhost:8080'

/**
 * The Lite web build: static files under `apps/lite/dist/public`, which `scripts/build.mjs` then folds into the
 * SEA blob. `base: './'` keeps every asset reference relative, so the same bundle works from the exe, from disk
 * and from any base path a reverse proxy puts it behind.
 *
 * `root` is derived from this file rather than the working directory: the config is loaded as `-c
 * web/vite.config.ts` from `apps/lite`, and a build run from anywhere else must still find the same `index.html`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    // Dev only: `pnpm dev:server` runs the Fastify app on 8080 while Vite serves the UI.
    proxy: {
      '/api': DEV_SERVER,
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
