/**
 * The one-shot title-set backfill (Plan 43): the three Thần titles (`title_god`, `title_demigod`, `title_godslayer`)
 * each gained a wardrobe set — outfit, head, aura, frame — handed over in the same unlock. Whoever earned a title
 * before that shipped holds the title alone; this gives them the set that came after it.
 *
 * For every achievement whose reward has `setItems`, every player who owns its `reward.itemId` — from any source: the
 * unlock itself, a GM's `grant_item`, a wardrobe grant — gets each set item they lack, through `inventory.grant` with
 * the `achievement` source, exactly as a fresh unlock would have granted it.
 *
 * **Inventory rows only.** No points, no ledger row, no reputation event: the unlock already paid those once.
 * **Idempotent.** `inventory.grant` is `ON CONFLICT DO NOTHING`, so a rerun grants 0, and a holder who owns some of the
 * set (or all) is topped up, never duplicated. One transaction per player; a dry run counts the missing rows with a
 * select and writes nothing.
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { ACHIEVEMENT_SOURCE } from '../achievements/achievement-service.js'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb } from '../db/client.js'
import { inventory } from '../db/schema.js'
import { createInventoryService } from './inventory-service.js'

export interface TitleSetBackfillOptions {
  /** Count and report, write nothing. */
  dryRun: boolean
  /** The achievement catalogue: the entries carrying `reward.setItems` decide what is handed over. */
  defs: readonly AchievementDef[]
}

export interface TitleSetBackfillResult {
  /** Distinct players who own at least one set-bearing title. */
  players: number
  /** Inventory rows inserted (or, in a dry run, that would be). */
  granted: number
}

/** What the CLI prints, with exit 2, for an argument it does not know. */
export const TITLE_SET_USAGE = 'usage: node dist/title-set-backfill-cli.js [--dry-run]'

/** The CLI's arguments: none, or `--dry-run`; anything else is `null` — a typo of the flag must not run the real grant. */
export function parseTitleSetArgs(argv: readonly string[]): { dryRun: boolean } | null {
  if (argv.some((arg) => arg !== '--dry-run')) return null
  return { dryRun: argv.length > 0 }
}

export async function backfillTitleSets(db: AppDb, opts: TitleSetBackfillOptions): Promise<TitleSetBackfillResult> {
  const inventoryService = createInventoryService(db)
  // Which set items each owner should end up with, over every set-bearing title they hold.
  const wanted = new Map<string, Set<string>>()
  for (const def of opts.defs) {
    const titleId = def.reward.itemId
    const setItems = def.reward.setItems
    if (titleId === undefined || setItems === undefined) continue
    const owners = await db.select({ playerId: inventory.playerId }).from(inventory).where(eq(inventory.itemId, titleId))
    for (const { playerId } of owners) {
      const set = wanted.get(playerId) ?? new Set<string>()
      for (const id of setItems) set.add(id)
      wanted.set(playerId, set)
    }
  }

  let granted = 0
  for (const [playerId, items] of [...wanted].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const ids = [...items]
    if (opts.dryRun) {
      const have = await db
        .select({ itemId: inventory.itemId })
        .from(inventory)
        .where(and(eq(inventory.playerId, playerId), inArray(inventory.itemId, ids)))
        .orderBy(asc(inventory.itemId))
      granted += ids.length - have.length
      continue
    }
    granted += await db.transaction(async (tx) => {
      let n = 0
      for (const id of ids) if (await inventoryService.grant(tx, playerId, id, ACHIEVEMENT_SOURCE)) n += 1
      return n
    })
  }
  return { players: wanted.size, granted }
}
