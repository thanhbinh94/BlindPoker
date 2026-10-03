/**
 * Five saved outfits per player (design §5.3, same contract Plan 10 §5.4 speced for v2).
 *
 * A saved outfit is a config a player set aside — the same `AvatarConfigV3` shape `players.avatar_config`
 * holds, under a name, in one of five slots. Ownership is re-checked on both `save` and `apply`
 * rather than trusted from the save: an item can be lost (it cannot be, today, but nothing here
 * should assume that stays true) and an outfit saved while an item was owned must not let a player
 * wear it once it is not.
 *
 * Shape validation is the *route's* job, the same way it is for `PUT /api/me/avatar`
 * (`avatar.ts`'s own header: "validation ... needs no database; ownership ... needs the database, so
 * it lives in `applyAvatarConfig`"): `registerOutfitRoutes` runs `validateAvatarConfig` before this
 * service ever sees a config, so nothing here re-validates the catalogue — only ownership, which is
 * this module's whole reason to exist.
 */
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { avatarOutfits } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfigV3 } from './avatar-migrate.js'
import type { AvatarViewV3 } from './avatar-v3-wire.js'
import { applyAvatarConfigV3, itemIdsOfV3 } from './avatar-v3-wire.js'
import type { InventoryService } from './inventory-service.js'

/** The number of outfit slots a player has — the bar's own length. */
export const OUTFIT_SLOTS = 5
/** A saved outfit's name, trimmed, may be at most this many characters. */
export const OUTFIT_NAME_MAX = 24

export interface OutfitView {
  slot: number
  name: string
  config: AvatarConfigV3
  /** Epoch milliseconds. */
  updatedAt: number
}

export interface OutfitsService {
  /** Length `OUTFIT_SLOTS`, index `slot - 1`; an empty slot is `null`. */
  list(playerId: string): Promise<(OutfitView | null)[]>
  /** `ServiceError('INVALID_SLOT')` outside 1..5, `('INVALID_NAME')` empty or too long, `('ITEM_NOT_OWNED')` unowned. */
  save(playerId: string, slot: number, name: string, config: AvatarConfigV3): Promise<OutfitView>
  /** True when a saved outfit was there to remove. */
  remove(playerId: string, slot: number): Promise<boolean>
  /** Re-checks ownership, then applies the saved config as the player's avatar. `('NOT_FOUND')` on an empty slot. */
  apply(playerId: string, slot: number): Promise<AvatarViewV3>
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= OUTFIT_SLOTS
}

async function checkOwnership(inventory: InventoryService, playerId: string, config: AvatarConfigV3): Promise<void> {
  const missing = await inventory.missingOf(playerId, itemIdsOfV3(config))
  if (missing.length > 0) throw new ServiceError('ITEM_NOT_OWNED', `not owned: ${missing.join(', ')}`)
}

function toView(row: { slot: number; name: string; config: Record<string, unknown>; updatedAt: Date }): OutfitView {
  return { slot: row.slot, name: row.name, config: row.config as unknown as AvatarConfigV3, updatedAt: row.updatedAt.getTime() }
}

export function createOutfitsService(db: AppDb, inventory: InventoryService): OutfitsService {
  return {
    async list(playerId) {
      const rows = await db.select().from(avatarOutfits).where(eq(avatarOutfits.playerId, playerId))
      const bySlot = new Map(rows.map((r) => [r.slot, toView(r)]))
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
      return toView(row!)
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
      const config = row.config as unknown as AvatarConfigV3
      await checkOwnership(inventory, playerId, config)
      return applyAvatarConfigV3(db, inventory, playerId, config)
    },
  }
}
