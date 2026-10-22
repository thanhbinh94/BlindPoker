/**
 * Environment knobs for `e2e-entry.ts` that are worth a test of their own. Test-only like the entry: excluded from
 * `tsconfig.build.json`, imported by nothing in `src/` that ships, so it never reaches `dist/`.
 */

/** The window the shipped read bucket uses (`READ_RATE_LIMIT` in `http/routes.ts`); only the count is raised. */
const READ_WINDOW_MS = 60_000

/**
 * `E2E_READ_LIMIT` raises the per-address read bucket. The ops pack runs every browser from one loopback address, so
 * the shipped 240 a minute is shared by a dozen tabs and a boot probe can meet a 429 (the P-02 flake). Unset, empty,
 * zero or not a positive whole number: the shipped limit stays, which is what `pnpm e2e:normal` runs against.
 */
export function readRateLimitFromEnv(env: Record<string, string | undefined>): { readRateLimit?: { limit: number; windowMs: number } } {
  const raw = env['E2E_READ_LIMIT']
  if (raw === undefined || raw === '') return {}
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit <= 0) return {}
  return { readRateLimit: { limit, windowMs: READ_WINDOW_MS } }
}
