/**
 * Environment knobs for `e2e-entry.ts` that are worth a test of their own. Test-only like the entry: excluded from
 * `tsconfig.build.json`, imported by nothing in `src/` that ships, so it never reaches `dist/`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseChaosCatalogue, type ChaosCardDef } from '@bp/core'
import { loadChaosCatalogue } from './chaos/chaos-catalogue.js'

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

/** One card's change in an `E2E_CHAOS_CARDS` file: whether it is on by default, and params laid over the shipped ones. */
interface ChaosCardOverride {
  enabled?: boolean
  params?: Record<string, number>
}

/**
 * BP-41 (A-ops): `E2E_CHAOS_CARDS` names a JSON file of changes to the shipped chaos cards, `{ "<card id>": { "enabled"?,
 * "params"? } }`, laid over `data/chaos-cards.json` and checked again by `parseChaosCatalogue`. The ops pack's file
 * (`apps/normal-web/e2e/ops/chaos-cards.ops.json`) starts Cá chép hóa rồng at 100 % energy and turns it off by default, so
 * only a GM rule that turns it on — the Thần case's — deals a seat that becomes the Thần at once. A file of changes rather
 * than a copy of the 86 cards, so the pack plays the cards that ship. Unset or empty: the shipped file as it is (`{}`).
 * A path is read from the server's working directory; an unknown card id, a bad file or a result the catalogue check
 * refuses throws, naming the file — the e2e server then does not start.
 */
export function chaosCardsFromEnv(
  env: Record<string, string | undefined>,
  shipped: () => ChaosCardDef[] = () => loadChaosCatalogue(),
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { chaosCatalogue?: ChaosCardDef[] } {
  const raw = env['E2E_CHAOS_CARDS']
  if (raw === undefined || raw === '') return {}
  const path = resolve(raw)
  let changes: Record<string, ChaosCardOverride>
  try {
    changes = JSON.parse(read(path)) as Record<string, ChaosCardOverride>
  } catch (err) {
    throw new Error(`E2E_CHAOS_CARDS ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) throw new Error(`E2E_CHAOS_CARDS ${path}: expected an object of card ids`)
  const cards = shipped()
  const known = new Set(cards.map((c) => c.id))
  for (const [id, change] of Object.entries(changes as Record<string, unknown>)) {
    if (!known.has(id)) throw new Error(`E2E_CHAOS_CARDS ${path}: not a chaos card: ${id}`)
    // Each entry is an object (`null`, a number or a list would fail later with a bare TypeError that names no file).
    if (typeof change !== 'object' || change === null || Array.isArray(change)) throw new Error(`E2E_CHAOS_CARDS ${path}: ${id}: expected an object`)
    const { enabled, params } = change as { enabled?: unknown; params?: unknown }
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error(`E2E_CHAOS_CARDS ${path}: ${id}.enabled: expected true or false`)
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) throw new Error(`E2E_CHAOS_CARDS ${path}: ${id}.params: expected an object`)
  }
  const merged = cards.map((c) => {
    const change = changes[c.id]
    if (change === undefined) return c
    return { ...c, ...(change.enabled === undefined ? {} : { enabled: change.enabled }), params: { ...c.params, ...(change.params ?? {}) } }
  })
  try {
    return { chaosCatalogue: parseChaosCatalogue(merged) }
  } catch (err) {
    throw new Error(`E2E_CHAOS_CARDS ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
