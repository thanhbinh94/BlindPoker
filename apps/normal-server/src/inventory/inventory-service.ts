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
 * in every sense that matters — `owns`, `missingOf` and `unownedOfRarity` all widen every id they
 * touch to its whole alias *class* (itself, plus every old id `item-aliases.json` renamed to it)
 * before comparing against the database, so an avatar or an outfit naming the new id is satisfied by
 * the old row, and the daily draw's unowned pool never re-offers, under its current id, a cosmetic a
 * legacy player already owns under its old one.
 */
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { avatarOutfits, inventory, items, players } from '../db/schema.js'
import { isUuid } from '../repos/util.js'
import { loadAliases } from './aliases.js'
import type { Rarity } from './items.js'
import { OPTIONAL_SLOTS, type ItemSlot } from './slots.js'

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
  /**
   * Grants inside the caller's transaction. Returns false when the player already had it.
   * `ref` names the claim the item came from (`daily:<playerId>:<date>`), so a GM can take back exactly that claim.
   */
  grant(tx: AppTx, playerId: string, itemId: string, source: string, ref?: string): Promise<boolean>
  /**
   * The items of the **latest** claim carrying `ref`: the rows with that ref whose `acquired_at` is the newest one.
   * A reclaim after a GM's undo reuses the same ref, so only the newest claim counts as "today's".
   */
  findByRef(tx: AppTx, playerId: string, ref: string): Promise<string[]>
  /**
   * Takes an item back inside the caller's transaction: out of every optional slot of the worn figure, out of the
   * equipped title and badge, out of every saved outfit — and only then the row itself. Returns false when the player
   * did not own it.
   */
  revoke(tx: AppTx, playerId: string, itemId: string): Promise<boolean>
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

/**
 * `config` without every optional slot that names `itemId`, or `null` when none does. The required slots (hairstyle,
 * outfit) are never touched: a GM can only take back what a daily draw or a fixed gift can hand out.
 */
function stripItem(config: Record<string, unknown>, itemId: string): Record<string, unknown> | null {
  const keys = OPTIONAL_SLOTS.filter((slot) => config[slot] === itemId)
  if (keys.length === 0) return null
  const next = { ...config }
  for (const key of keys) delete next[key]
  return next
}

/**
 * `freeIds` (design §3.2): ids every player owns without a row. Aliases and free ids are two
 * independent kinds of "owned without asking the database" — an alias still needs *some* row (the
 * old one), a free id needs none at all — so they are checked separately rather than folded into one
 * table, and a free id is never itself given an alias.
 */
export function createInventoryService(
  db: AppDb,
  aliases: ReadonlyMap<string, string> = loadAliases(),
  freeIds: ReadonlySet<string> = new Set(),
): InventoryService {
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
      const owned = rows.map((r) => ({ itemId: r.itemId, source: r.source, acquiredAt: r.acquiredAt.getTime() }))
      // Free items were never written to `inventory` (design §3.2: "không ghi hàng inventory nào"),
      // so they are appended here rather than found by the query above — after every owned row, since
      // `list` is otherwise oldest-first and a free item was never "acquired" at any particular time.
      const ownedIds = new Set(owned.map((o) => o.itemId))
      const free = [...freeIds].filter((id) => !ownedIds.has(id)).map((itemId) => ({ itemId, source: 'free', acquiredAt: 0 }))
      return [...owned, ...free]
    },

    async grant(tx, playerId, itemId, source, ref) {
      const granted = await tx
        .insert(inventory)
        .values({ playerId, itemId, source, ...(ref === undefined ? {} : { ref }) })
        .onConflictDoNothing({ target: [inventory.playerId, inventory.itemId] })
        .returning({ itemId: inventory.itemId })
      return granted.length > 0
    },

    async findByRef(tx, playerId, ref) {
      if (!isUuid(playerId)) return []
      const rows = await tx
        .select({ itemId: inventory.itemId })
        .from(inventory)
        .where(
          and(
            eq(inventory.playerId, playerId),
            eq(inventory.ref, ref),
            sql`${inventory.acquiredAt} = (select max(i2.acquired_at) from inventory i2 where i2.player_id = ${playerId} and i2.ref = ${ref})`,
          ),
        )
        .orderBy(asc(inventory.itemId))
      return rows.map((r) => r.itemId)
    },

    async revoke(tx, playerId, itemId) {
      if (!isUuid(playerId)) return false
      const [worn] = await tx.select({ config: players.avatarConfig }).from(players).where(eq(players.id, playerId))
      const strippedConfig = worn === undefined ? null : stripItem(worn.config, itemId)
      if (strippedConfig !== null) {
        // The denormalised title and badge are written in the same statement as the config they mirror.
        await tx
          .update(players)
          .set({
            avatarConfig: strippedConfig,
            equippedTitle: typeof strippedConfig.title === 'string' ? strippedConfig.title : null,
            equippedBadge: typeof strippedConfig.badge === 'string' ? strippedConfig.badge : null,
          })
          .where(eq(players.id, playerId))
      }
      const outfits = await tx.select({ slot: avatarOutfits.slot, config: avatarOutfits.config }).from(avatarOutfits).where(eq(avatarOutfits.playerId, playerId))
      for (const outfit of outfits) {
        const stripped = stripItem(outfit.config, itemId)
        if (stripped !== null) await tx.update(avatarOutfits).set({ config: stripped }).where(and(eq(avatarOutfits.playerId, playerId), eq(avatarOutfits.slot, outfit.slot)))
      }
      const removed = await tx
        .delete(inventory)
        .where(and(eq(inventory.playerId, playerId), eq(inventory.itemId, itemId)))
        .returning({ itemId: inventory.itemId })
      return removed.length > 0
    },

    async owns(playerId, itemId) {
      // Free before the uuid check: "every player owns a free item" holds for the id itself, not
      // for any particular player row.
      if (freeIds.has(itemId)) return true
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
      if (rows.length === 0) return []
      // Alias-aware, the same widening `owns`/`missingOf` do below: an inventory row under an old id
      // already satisfies the new id it resolves to, so it must keep that new id out of the draw
      // pool too — otherwise a legacy player could be "re-offered", under its current id, a cosmetic
      // they already own under its old one. Fetched separately (rather than folded into the query
      // above as a correlated `notExists`) because the widening is per-row through a JS map, not
      // something a single SQL predicate can express without recompiling one per call.
      const owned = await tx.select({ itemId: inventory.itemId }).from(inventory).where(eq(inventory.playerId, playerId))
      const ownedIds = new Set(owned.map((r) => r.itemId))
      return rows
        .map((r) => r.id)
        .filter((id) => !classOf(id).some((candidate) => ownedIds.has(candidate)))
        // A `free` colour is drawable geometry-wise (it is in `items` at `rarity`), but design §3.2
        // is explicit: "món free không bao giờ vào bể quà hằng ngày" — it is never a prize because
        // nobody ever has to earn it.
        .filter((id) => !freeIds.has(id))
    },

    async missingOf(playerId, itemIds) {
      // Free ids are dropped before anything else: `missingOf` must never report one, for any
      // player — including one whose id is not even a valid uuid, below.
      const wanted = [...new Set(itemIds)].filter((id) => !freeIds.has(id))
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
