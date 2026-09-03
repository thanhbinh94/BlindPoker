import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'tooling', include: ['arch/**/*.test.ts'], passWithNoTests: true } })
