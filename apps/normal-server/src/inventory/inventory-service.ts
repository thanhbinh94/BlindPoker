/**
 * What a player owns.
 *
 * The two write paths — the daily reward and an achievement — both grant items from inside a
 * transaction that is also moving points, so `grant` takes the caller's `AppTx` rather than opening
 * one. That is not an optimisation: a player must never end up with the item but not the ledger row
 * that explains where it came from, or the other way round.
 *
 * `grant` answers "was this newly granted" from the database rather than from a prior `SELECT`.
 * `ON CONFLICT DO NOTHING … RETURNING` is one statement whose result *is* the answer, so two claims
 * racing for the same item cannot both be told they were the first.
 *
 * **Aliases run both ways here.** `inventory.item_id` rows are never rewritten (Plan 11's `aliases.ts`
 * comment), so a player who owns `hat_crown` from before this plan already owns `head_crown_gold01`
 * in every sense that matters — `owns` and `missingOf` widen every id they are asked about to its
 * whole alias *class* (itself, plus every old id `item-aliases.json` renamed to it) before touching
 * the database, so an avatar or an outfit naming the new id is satisfied by the old row.
 */
import { and, asc, eq, inArray, notExists, notInArray } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { inventory, items } from '../db/schema.js'
import { isUuid } from '../repos/util.js'
import { loadAliases } from './aliases.js'
import type { Rarity } from './items.js'
import type { ItemSlot } from './slots.js'

/**
 * What a draw must not reach.
 *
 * A pool is "every item of this rarity the player does not own", and that is one query — but not
 * every item of a rarity is *drawable*. Some are promised elsewhere as fixed rewards, some belong to
 * slots the draw is not about, and — `withinSlots` — a caller may want *only* a known, current set
 * of slots. Expressing all three as one exclusion keeps the decision at the caller, where the
 * reasons live, rather than hard-coding a policy into the query.
 */
export interface ItemExclusion {
  /** Ids that are spoken for — a fixed daily reward, an achievement's item. */
  ids?: readonly string[]
  /** Whole slots the draw does not cover. */
  slots?: readonly ItemSlot[]
  /**
   * An allow-list rather than a deny-list: when given, only these slots are considered at all.
   *
   * `items` still carries rows a withdrawn v2 slot left behind (`0001_avatar_v2.sql` always inserts
   * four of them; `inventory.player_id`'s foreign key needs the rows to exist forever) — a value
   * that is not even a current `ItemSlot`, so `slots` above can never name it to exclude it. The
   * daily draw passes `DAILY_DRAW_SLOTS` here for exactly that reason: it is the one caller that
   * must never surface a row belonging to a slot the current catalogue no longer offers.
   */
  withinSlots?: readonly ItemSlot[]
}

export interface OwnedItem {
  itemId: string
  /** How it was acquired: `default`, `daily`, `achievement`. */
  source: string
  /** Epoch milliseconds. */
  acquiredAt: number
}

export interface InventoryService {
  /** Everything this player owns, oldest first. */
  list(playerId: string): Promise<OwnedItem[]>
  /** Grants inside the caller's transaction. Returns false when the player already had it. */
  grant(tx: AppTx, playerId: string, itemId: string, source: string): Promise<boolean>
  owns(playerId: string, itemId: string): Promise<boolean>
  /**
   * The ids of every catalogue item of `rarity` this player does *not* own and `exclude` does not
   * rule out, in id order.
   *
   * Ordered so the caller's random pick is reproducible from a seeded rng: an unordered result
   * would make the daily reward's "which common did I get" depend on the planner's mood.
   */
  unownedOfRarity(tx: AppTx, playerId: string, rarity: Rarity, exclude?: ItemExclusion): Promise<string[]>
  /**
   * Which of `itemIds` this player does not own — `[]` means they own them all.
   *
   * One query for the whole avatar rather than nine calls to `owns`, and the missing ids come back
   * so the refusal can say which item was the problem.
   */
  missingOf(playerId: string, itemIds: string[]): Promise<string[]>
}

/** `newId -> every old id that now means it`, the mirror of `loadAliases`'s old-to-new map. */
function reverseAliases(aliases: ReadonlyMap<string, string>): Map<string, string[]> {
  const reverse = new Map<string, string[]>()
  for (const [oldId, newId] of aliases) {
    const list = reverse.get(newId)
    if (list === undefined) reverse.set(newId, [oldId])
    else list.push(oldId)
  }
  return reverse
}

export function createInventoryService(db: AppDb, aliases: ReadonlyMap<string, string> = loadAliases()): InventoryService {
  const reverse = reverseAliases(aliases)
  /** `id` and every old id that aliases to it — what a caller asking about `id` is really asking about. */
  const classOf = (id: string): string[] => [id, ...(reverse.get(id) ?? [])]

  return {
    async list(playerId) {
      if (!isUuid(playerId)) return []
      const rows = await db
        .select({ itemId: inventory.itemId, source: inventory.source, acquiredAt: inventory.acquiredAt })
        .from(inventory)
        .where(eq(inventory.playerId, playerId))
        .orderBy(asc(inventory.acquiredAt), asc(inventory.itemId))
      return rows.map((r) => ({ itemId: r.itemId, source: r.source, acquiredAt: r.acquiredAt.getTime() }))
    },

    async grant(tx, playerId, itemId, source) {
      const granted = await tx
        .insert(inventory)
        .values({ playerId, itemId, source })
        .onConflictDoNothing({ target: [inventory.playerId, inventory.itemId] })
        .returning({ itemId: inventory.itemId })
      return granted.length > 0
    },

    async owns(playerId, itemId) {
      if (!isUuid(playerId)) return false
      const rows = await db
        .select({ itemId: inventory.itemId })
        .from(inventory)
        .where(and(eq(inventory.playerId, playerId), inArray(inventory.itemId, classOf(itemId))))
      return rows.length > 0
    },

    async unownedOfRarity(tx, playerId, rarity, exclude) {
      if (!isUuid(playerId)) return []
      const rows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.rarity, rarity),
            notExists(
              tx
                .select({ one: inventory.itemId })
                .from(inventory)
                .where(and(eq(inventory.playerId, playerId), eq(inventory.itemId, items.id))),
            ),
            // Guarded on length: `notInArray(col, [])` is `col <> all('{}')`, which Postgres reads
            // as unknown for every row and would empty the pool rather than exclude nothing. The
            // same guard applies to `withinSlots`, the other way round: `inArray(col, [])` is
            // `col = any('{}')`, always false, which would empty the pool rather than allow nothing
            // — so an empty (or absent) `withinSlots` means "every slot", not "no slot".
            exclude?.ids !== undefined && exclude.ids.length > 0 ? notInArray(items.id, [...exclude.ids]) : undefined,
            exclude?.slots !== undefined && exclude.slots.length > 0 ? notInArray(items.slot, [...exclude.slots]) : undefined,
            exclude?.withinSlots !== undefined && exclude.withinSlots.length > 0 ? inArray(items.slot, [...exclude.withinSlots]) : undefined,
          ),
        )
        .orderBy(asc(items.id))
      return rows.map((r) => r.id)
    },

    async missingOf(playerId, itemIds) {
      const wanted = [...new Set(itemIds)]
      if (wanted.length === 0) return []
      // An id that is not a uuid owns nothing, so every requested item is missing — the caller gets
      // a `NOT_OWNED` rather than the driver's `22P02` for a malformed uuid.
      if (!isUuid(playerId)) return wanted
      const candidates = [...new Set(wanted.flatMap(classOf))]
      const rows = await db
        .select({ itemId: inventory.itemId })
        .from(inventory)
        .where(and(eq(inventory.playerId, playerId), inArray(inventory.itemId, candidates)))
      const owned = new Set(rows.map((r) => r.itemId))
      return wanted.filter((id) => !classOf(id).some((candidate) => owned.has(candidate)))
    },
  }
}
