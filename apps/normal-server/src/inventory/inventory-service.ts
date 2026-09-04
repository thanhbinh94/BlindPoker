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
 */
import { and, asc, eq, inArray, notExists } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { inventory, items } from '../db/schema.js'
import { isUuid } from '../repos/util.js'
import type { Rarity } from './items.js'

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
   * The ids of every catalogue item of `rarity` this player does *not* own, in id order.
   *
   * Ordered so the caller's random pick is reproducible from a seeded rng: an unordered result
   * would make the daily reward's "which common did I get" depend on the planner's mood.
   */
  unownedOfRarity(tx: AppTx, playerId: string, rarity: Rarity): Promise<string[]>
  /**
   * Which of `itemIds` this player does not own — `[]` means they own them all.
   *
   * One query for the whole avatar rather than nine calls to `owns`, and the missing ids come back
   * so the refusal can say which item was the problem.
   */
  missingOf(playerId: string, itemIds: string[]): Promise<string[]>
}

export function createInventoryService(db: AppDb): InventoryService {
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
        .where(and(eq(inventory.playerId, playerId), eq(inventory.itemId, itemId)))
      return rows.length > 0
    },

    async unownedOfRarity(tx, playerId, rarity) {
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
      const rows = await db
        .select({ itemId: inventory.itemId })
        .from(inventory)
        .where(and(eq(inventory.playerId, playerId), inArray(inventory.itemId, wanted)))
      const owned = new Set(rows.map((r) => r.itemId))
      return wanted.filter((id) => !owned.has(id))
    },
  }
}
