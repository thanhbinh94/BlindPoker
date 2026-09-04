import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Dev-only harness for `@bp/ui-kit`. `root` is resolved against the working directory, which
 * `pnpm --filter @bp/ui-kit playground` sets to the package root — no aliases needed, `@bp/core` and the sources are
 * plain workspace imports.
 */
export default defineConfig({
  root: 'playground',
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5175, fs: { allow: ['..', '../..'] } },
})
