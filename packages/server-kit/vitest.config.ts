import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'server-kit', include: ['src/**/*.test.ts'], testTimeout: 15000, hookTimeout: 15000 } })
