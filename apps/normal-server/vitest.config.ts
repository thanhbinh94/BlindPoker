import { defineConfig } from 'vitest/config'

// Every database test spins up its own in-process PGlite and runs the migrations against it, which
// is seconds rather than milliseconds — hence the raised timeouts. `test/` holds the one suite that
// is not about the code but about the artefact: `build.test.ts` runs the real build and boots what
// it produced, which is slower again and skippable with `CI_SKIP_BUILD`.
export default defineConfig({
  test: { name: 'normal-server', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], testTimeout: 60000, hookTimeout: 240000 },
})
