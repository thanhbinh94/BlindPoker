import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  test: {
    name: 'lite',
    include: ['server/src/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['web/src/**', 'jsdom']],
    setupFiles: ['server/src/test-setup.ts', 'web/src/test-setup.ts'],
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    // Vitest blanks every stylesheet import by default, `?raw` included. A contrast test reads a stylesheet's text
    // (`lite.contrast.test.ts`, and `@bp/ui-kit/testing`'s own `tokens.css?raw`), so the raw text is let through;
    // a CSS module imported for its class names is still the usual stand-in.
    css: { include: [/\.css\?raw$/] },
  },
})
