import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCase' } },
  test: { name: 'ui-kit', environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test-setup.ts'], css: true },
})
