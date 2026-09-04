import { defineConfig } from 'vitest/config'

// Every database test spins up its own in-process PGlite and runs the migrations against it, which
// is seconds rather than milliseconds — hence the raised timeouts.
export default defineConfig({
  test: { name: 'normal-server', include: ['src/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000 },
})
