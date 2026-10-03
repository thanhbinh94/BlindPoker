/**
 * Five saved outfits per player (design §5.3, same contract Plan 10 §5.4 speced for v2).
 *
 * A saved outfit is a config a player set aside — the same `AvatarConfigV4` shape `players.avatar_config`
 * holds (Plan 19), under a name, in one of five slots. Ownership is re-checked on both `save` and `apply`
 * rather than trusted from the save: an item can be lost (it cannot be, today, but nothing here
 * should assume that stays true) and an outfit saved while an item was owned must not let a player
 * wear it once it is not.
 *
 * Shape validation of what is *saved* is the route's job, the same way it is for `PUT /api/me/avatar`
 * (`avatar.ts`'s own header: validation needs no database; ownership needs the database, so it lives in
 * `applyAvatarConfig`): `registerOutfitRoutes` runs `validateAvatarConfig` before `save` ever sees a config.
 *
 * What is *read back* is another matter: a row saved before Plan 19 holds a v3 config (a base), and a v4
 * one can go stale when the catalogue changes. So `list` and `apply` never hand a row's raw jsonb on — they
 * pass it through `read`, which `app.ts` binds to `readAvatarConfig` (spec §4.5, R6). `list` answers the v4
 * a row reads as; `apply` checks ownership of that v4 and wears it, so `players.avatar_config` only ever
 * receives v4. The row itself is left as it was: the table is written by `save` alone, when the player
 * presses Save (spec §4.5, "chỉ khi người chơi bấm Lưu").
 */
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { avatarOutfits } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfigV4, AvatarView } from './avatar.js'
import { applyAvatarConfig, itemIdsOf } from './avatar.js'
import type { InventoryService } from './inventory-service.js'

/** The number of outfit slots a player has — the bar's own length. */
export const OUTFIT_SLOTS = 5
/** A saved outfit's name, trimmed, may be at most this many characters. */
export const OUTFIT_NAME_MAX = 24

export interface OutfitView {
  slot: number
  name: string
  /** Always v4: what the row reads as (`list`), or exactly what was just saved (`save`). */
  config: AvatarConfigV4
  /** Epoch milliseconds. */
  updatedAt: number
}

export interface OutfitsService {
  /** Length `OUTFIT_SLOTS`, index `slot - 1`; an empty slot is `null`. Each config is the v4 its row reads as. */
  list(playerId: string): Promise<(OutfitView | null)[]>
  /** `ServiceError('INVALID_SLOT')` outside 1..5, `('INVALID_NAME')` empty or too long, `('ITEM_NOT_OWNED')` unowned. */
  save(playerId: string, slot: number, name: string, config: AvatarConfigV4): Promise<OutfitView>
  /** True when a saved outfit was there to remove. */
  remove(playerId: string, slot: number): Promise<boolean>
  /**
   * Reads the saved config as v4, re-checks ownership of that v4, then applies it as the player's avatar.
   * `('NOT_FOUND')` on an empty slot.
   */
  apply(playerId: string, slot: number): Promise<AvatarView>
}

/**
 * How a saved row's jsonb becomes the v4 the player sees — `readAvatarConfig` with the server's catalogue,
 * aliases and bodies bound in (`app.ts`). A parameter rather than an import so this module needs none of those
 * three, and so a test can see exactly which reader it runs against.
 */
export type ReadSavedConfig = (stored: Record<string, unknown>) => AvatarConfigV4

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= OUTFIT_SLOTS
}

async function checkOwnership(inventory: InventoryService, playerId: string, config: AvatarConfigV4): Promise<void> {
  const missing = await inventory.missingOf(playerId, itemIdsOf(config))
  if (missing.length > 0) throw new ServiceError('ITEM_NOT_OWNED', `not owned: ${missing.join(', ')}`)
}

function toView(row: { slot: number; name: string; updatedAt: Date }, config: AvatarConfigV4): OutfitView {
  return { slot: row.slot, name: row.name, config, updatedAt: row.updatedAt.getTime() }
}

export function createOutfitsService(db: AppDb, inventory: InventoryService, read: ReadSavedConfig): OutfitsService {
  return {
    async list(playerId) {
      const rows = await db.select().from(avatarOutfits).where(eq(avatarOutfits.playerId, playerId))
      const bySlot = new Map(rows.map((r) => [r.slot, toView(r, read(r.config))]))
      return Array.from({ length: OUTFIT_SLOTS }, (_, i) => bySlot.get(i + 1) ?? null)
    },

    async save(playerId, slot, name, config) {
      if (!isValidSlot(slot)) throw new ServiceError('INVALID_SLOT', `slot must be between 1 and ${String(OUTFIT_SLOTS)}`)
      const trimmed = name.trim()
      if (trimmed === '' || trimmed.length > OUTFIT_NAME_MAX) throw new ServiceError('INVALID_NAME', `name must be 1 to ${String(OUTFIT_NAME_MAX)} characters`)
      await checkOwnership(inventory, playerId, config)

      const [row] = await db
        .insert(avatarOutfits)
        .values({ playerId, slot, name: trimmed, config: config as unknown as Record<string, unknown> })
        .onConflictDoUpdate({
          target: [avatarOutfits.playerId, avatarOutfits.slot],
          set: { name: trimmed, config: config as unknown as Record<string, unknown>, updatedAt: new Date() },
        })
        .returning()
      // The route validated `config` as v4 and it is stored exactly as given, so it is also what the row reads as.
      return toView(row!, config)
    },

    async remove(playerId, slot) {
      if (!isValidSlot(slot)) throw new ServiceError('INVALID_SLOT', `slot must be between 1 and ${String(OUTFIT_SLOTS)}`)
      const removed = await db
        .delete(avatarOutfits)
        .where(and(eq(avatarOutfits.playerId, playerId), eq(avatarOutfits.slot, slot)))
        .returning({ slot: avatarOutfits.slot })
      return removed.length > 0
    },

    async apply(playerId, slot) {
      if (!isValidSlot(slot)) throw new ServiceError('INVALID_SLOT', `slot must be between 1 and ${String(OUTFIT_SLOTS)}`)
      const [row] = await db
        .select()
        .from(avatarOutfits)
        .where(and(eq(avatarOutfits.playerId, playerId), eq(avatarOutfits.slot, slot)))
      if (row === undefined) throw new ServiceError('NOT_FOUND', `no outfit saved in slot ${String(slot)}`)
      // Never the raw row: a v3 one would write an old base back into `players.avatar_config` (R6). The v4 it
      // reads as is what ownership is asked of — a repair may have added free items and dropped withdrawn ones.
      const config = read(row.config)
      await checkOwnership(inventory, playerId, config)
      return applyAvatarConfig(db, inventory, playerId, config)
    },
  }
}
