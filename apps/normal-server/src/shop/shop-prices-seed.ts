/**
 * The shop's starting price list and settings (Plan 27, spec B1, C1), written by code at boot rather than by the
 * migration: `shop_prices` has one row per catalogue item, and the catalogue grows with `data/items.json`, which a
 * migration cannot read. Both seeds only insert a row that is missing (`ON CONFLICT DO NOTHING`), so a GM's edit is
 * never overwritten and a second boot inserts nothing.
 *
 * A gift of the check-in schedule is **not** disabled here: whether it sells depends on the live schedule and on the
 * month (spec R20), so the shop asks the schedule at every read and every purchase instead (`shop-service.ts`).
 */
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb, AppTx } from '../db/client.js'
import { shopConfig, shopPrices } from '../db/schema.js'
import type { ItemCatalog, ItemDef, Rarity } from '../inventory/items.js'

/** The seed's price and rank per rarity (spec B1): a rare a week of steady play away, an epic a month (Q1). */
export const SEED_PRICES: Readonly<Record<Rarity, { pricePoints: number; minRank: number }>> = {
  common: { pricePoints: 10_000, minRank: 1 },
  rare: { pricePoints: 30_000, minRank: 3 },
  epic: { pricePoints: 150_000, minRank: 4 },
}

/** `shop_config.welcome_choices`'s seed — the migration's too (spec C1, R6): two rare outfits and a rare hat. */
export const DEFAULT_WELCOME_CHOICES: readonly string[] = ['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01']

export const WELCOME_CHOICES_KEY = 'welcome_choices'

/** Every item an achievement rewards: never for sale (spec B1). */
export function achievementItemIds(defs: readonly AchievementDef[]): Set<string> {
  return new Set(defs.flatMap((def) => (def.reward.itemId === undefined ? [] : [def.reward.itemId])))
}

/** The seed row of one item: the rarity's price and rank, off sale when every player already has it or earns it. */
export function seedRowOf(def: ItemDef, rewards: ReadonlySet<string>): { itemId: string; pricePoints: number; minRank: number; enabled: boolean } {
  const { pricePoints, minRank } = SEED_PRICES[def.rarity]
  return { itemId: def.id, pricePoints, minRank, enabled: !def.isDefault && def.free !== true && !rewards.has(def.id) }
}

/** Inserts a price row for every catalogue item that has none; resolves how many it inserted. */
export async function seedPrices(db: AppDb | AppTx, catalog: ItemCatalog, defs: readonly AchievementDef[]): Promise<number> {
  const rewards = achievementItemIds(defs)
  const rows = catalog.all().map((def) => seedRowOf(def, rewards))
  if (rows.length === 0) return 0
  const inserted = await db.insert(shopPrices).values(rows).onConflictDoNothing().returning({ itemId: shopPrices.itemId })
  return inserted.length
}

/** Puts `welcome_choices` back where the row is missing (a hand-cleared table); never overwrites a GM's choice. */
export async function seedConfig(db: AppDb | AppTx): Promise<void> {
  await db
    .insert(shopConfig)
    .values({ key: WELCOME_CHOICES_KEY, value: [...DEFAULT_WELCOME_CHOICES] })
    .onConflictDoNothing()
}
