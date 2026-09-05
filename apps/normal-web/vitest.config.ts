import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  test: {
    name: 'normal-web',
    environment: 'jsdom',
    // `test/` holds the one suite that is not about the code but about the artefact the build emits
    // (`footprint.test.ts`), which is why it sits outside `src/`.
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    // …and it runs in Node, not jsdom: it reads files off disk, and under jsdom `import.meta.url` is not a
    // `file:` URL, so the one thing it needs — where it is on disk — is the one thing it cannot ask for.
    environmentMatchGlobs: [['test/**', 'node']],
    setupFiles: ['src/test-setup.ts'],
    globals: true,
  },
})
