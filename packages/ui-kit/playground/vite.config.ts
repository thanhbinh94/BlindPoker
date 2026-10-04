import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Dev-only harness for `@bp/ui-kit`. `root` is resolved against the working directory, which
 * `pnpm --filter @bp/ui-kit playground` sets to the package root — no aliases needed, `@bp/core` and the sources are
 * plain workspace imports.
 */
export default defineConfig({
  root: 'playground',
  // The avatar2d page needs real PNGs to draw its `Chibi`s and Normal is the only place T1 put any — pointing
  // the playground's own static dir at Normal's `public/` makes `/avatar/...` resolve without copying a byte.
  // Relative to `root` (`packages/ui-kit/playground`), not to this package: three levels up is the repo root.
  // (2026-10-04, Plan 19: it said two, which resolved to a `packages/apps/…` that does not exist, so every layer
  // fell through to `index.html` and the page drew nothing.)
  publicDir: '../../../apps/normal-web/public',
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5175, fs: { allow: ['..', '../..'] } },
})
