/**
 * The achievement catalogue (spec §14).
 *
 * Like `items.json`, this is data: adding an achievement is a line of JSON, and adding a *metric*
 * is a `player_stats` column plus counting logic in `stats-service.ts`. Nothing here is registered
 * in code, and no achievement id appears in a `switch`.
 *
 * `loadAchievements` validates against both of the things a definition can lie about. A metric that
 * is not a counter would be an achievement that silently never unlocks — the worst kind of failure,
 * because it looks exactly like one nobody has earned yet. An item reward that is not in the
 * catalogue would be a foreign-key violation months later, at the moment a player finally qualifies.
 * Both are caught at boot, where they are cheap.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'
import type { ItemCatalog } from '../inventory/items.js'
import { isStatMetric, type StatMetric } from '../stats/player-stats.js'

export type AchievementCategory = 'login' | 'holdem' | 'blind' | 'social'

export interface AchievementReward {
  points?: number
  itemId?: string
}

export interface AchievementDef {
  id: string
  category: AchievementCategory
  /** A `player_stats` counter, by its camelCase name. */
  metric: StatMetric
  /** Unlocked when the metric reaches this value. */
  threshold: number
  reward: AchievementReward
}

const CATEGORIES = new Set<string>(['login', 'holdem', 'blind', 'social'])

function defaultAchievementsPath(): string {
  return join(packageRoot(), 'data', 'achievements.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid achievement catalogue ${path}: ${problem}`)
}

function parseDef(path: string, raw: unknown, at: number, catalog: ItemCatalog): AchievementDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `entry ${at} is not an object`)
  const r = raw as Record<string, unknown>

  const id = r['id']
  if (typeof id !== 'string' || id === '') fail(path, `entry ${at} has no id`)
  const category = r['category']
  if (typeof category !== 'string' || !CATEGORIES.has(category)) fail(path, `${id} has unknown category ${String(category)}`)
  const metric = r['metric']
  if (typeof metric !== 'string' || !isStatMetric(metric)) fail(path, `${id} names ${String(metric)}, which is not a player_stats metric`)
  const threshold = r['threshold']
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) fail(path, `${id} has no positive threshold`)

  const rawReward = r['reward']
  if (typeof rawReward !== 'object' || rawReward === null || Array.isArray(rawReward)) fail(path, `${id} has no reward`)
  const rw = rawReward as Record<string, unknown>
  const reward: AchievementReward = {}
  if (rw['points'] !== undefined) {
    const points = rw['points']
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) fail(path, `${id} has a non-positive points reward`)
    reward.points = points
  }
  if (rw['itemId'] !== undefined) {
    const itemId = rw['itemId']
    if (typeof itemId !== 'string' || itemId === '') fail(path, `${id} has a malformed itemId reward`)
    if (catalog.get(itemId) === undefined) fail(path, `${id} rewards ${itemId}, which is not in the item catalogue`)
    reward.itemId = itemId
  }
  // An achievement that grants nothing is almost certainly a typo in the reward key, and it would
  // otherwise be a row that unlocks silently and pays nobody.
  if (reward.points === undefined && reward.itemId === undefined) fail(path, `${id} grants neither points nor an item`)

  return { id, category: category as AchievementCategory, metric, threshold, reward }
}

/**
 * Reads and validates `data/achievements.json`.
 *
 * The catalogue is a required argument rather than an option: half of what this function checks is
 * "does the reward exist", and a call that skipped it would return definitions nobody had verified.
 */
export function loadAchievements(catalog: ItemCatalog, path: string = defaultAchievementsPath()): AchievementDef[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read achievement catalogue ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Array.isArray(parsed)) fail(path, 'the file is not a JSON array')

  const defs = parsed.map((raw, at) => parseDef(path, raw, at, catalog))
  const seen = new Set<string>()
  for (const def of defs) {
    if (seen.has(def.id)) fail(path, `duplicate achievement id ${def.id}`)
    seen.add(def.id)
  }
  return defs
}

/** The definitions grouped by the metric that drives them — how the achievement service indexes them. */
export function byMetric(defs: AchievementDef[]): Map<StatMetric, AchievementDef[]> {
  const index = new Map<StatMetric, AchievementDef[]>()
  for (const def of defs) {
    const bucket = index.get(def.metric)
    if (bucket === undefined) index.set(def.metric, [def])
    else bucket.push(def)
  }
  return index
}
