import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  test: {
    name: 'lite',
    include: ['server/src/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['web/src/**', 'jsdom']],
    setupFiles: ['web/src/test-setup.ts'],
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
