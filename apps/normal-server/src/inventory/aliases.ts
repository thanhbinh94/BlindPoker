/**
 * Old wardrobe ids, kept readable (design §5.2).
 *
 * Plan 11 replaces the whole slot vocabulary — `hair`/`top`/`bottom`/`shoes`/`hat`/`accessory`/
 * `jewelry` become `head`/`face`/`outfit`/`aura`/`frame` — but nothing about what a player already
 * *owns* changes: `inventory.item_id` rows are never rewritten, and every reward the daily calendar
 * and the achievements already promised was written down by its v2 id. `data/item-aliases.json` is
 * the one place that old-to-new mapping lives, so a v2 config, an old inventory row and a reward id
 * from `achievements.json`'s history all resolve through the same table rather than three copies of
 * it drifting apart.
 *
 * An id the new wardrobe drops outright — an accessory headband, a ring, a pair of jeans — maps to
 * `null` in the JSON and simply is not a key in the map this loads: `resolveItemId` then returns it
 * unchanged, which is indistinguishable from an id nobody ever aliased, and `catalog.get()` on either
 * comes back `undefined`. That is deliberate — "dropped" and "never existed" should behave the same
 * to every caller downstream, and only this file needs to know which one it actually was.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'

function defaultAliasesPath(): string {
  return join(packageRoot(), 'data', 'item-aliases.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid item aliases ${path}: ${problem}`)
}

/** The chain of ids `resolveItemId` would need in turn, if the map's values were themselves keys. */
function cycleFrom(start: string, map: ReadonlyMap<string, string>): string[] | null {
  const seen: string[] = [start]
  let at = start
  for (let hops = 0; hops <= map.size; hops++) {
    const next = map.get(at)
    if (next === undefined) return null
    if (next === start) return [...seen, next]
    seen.push(next)
    at = next
  }
  // Every id in the map visited without closing a loop back to `start`: not a cycle, just a long chain.
  return null
}

/**
 * Reads and validates `data/item-aliases.json`: an object of old id → new id, or `null` for an id
 * the new wardrobe no longer offers. Returns only the non-null entries — `resolveItemId` handles the
 * rest by falling through unchanged.
 */
export function loadAliases(path: string = defaultAliasesPath()): ReadonlyMap<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read item aliases ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail(path, 'the file is not a JSON object')

  const map = new Map<string, string>()
  for (const [oldId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null) continue
    if (typeof value !== 'string' || value === '') fail(path, `${oldId} aliases to something other than a string or null`)
    if (oldId === value) fail(path, `${oldId} aliases to itself`)
    map.set(oldId, value)
  }

  for (const oldId of map.keys()) {
    const cycle = cycleFrom(oldId, map)
    if (cycle !== null) fail(path, `alias cycle: ${cycle.join(' -> ')}`)
  }

  return map
}

/** `aliases.get(id) ?? id` — the new id an old one now means, or the id itself when nothing renamed it. */
export function resolveItemId(id: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(id) ?? id
}
