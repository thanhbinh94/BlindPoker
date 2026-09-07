import { defineConfig } from 'vitest/config'

/**
 * The deployment kits are not a workspace package — there is nothing to install and nothing to
 * build — but the files under them are checked all the same: `oracle/bootstrap.test.ts` parses the
 * Oracle bootstrap script and greps its idempotency guards, and `normal-windows/run.test.ts` does
 * the equivalent for the Windows LAN kit. One config here puts both into the root `pnpm test`.
 *
 * `passWithNoTests`, like `tooling`'s: a checkout that has one of these kits and not the other must
 * not fail the suite.
 */
export default defineConfig({ test: { name: 'deploy', include: ['**/*.test.ts'], passWithNoTests: true } })
