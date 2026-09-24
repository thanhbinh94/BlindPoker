import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { players, users } from '../db/schema.js'
import { createInventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'

/** The `inventory.source` a test grant carries, so a granted wardrobe is distinguishable from an earned one. */
export const GRANT_SOURCE = 'dev-grant'

export class UnknownAccountError extends Error {
  constructor(email: string) {
    super(`no account with the email ${email}`)
    this.name = 'UnknownAccountError'
  }
}

export interface GrantWardrobeResult {
  playerId: string
  displayName: string
  /** Catalogue size — what the player owns once this returns (unless `dryRun`). */
  total: number
  /** Ids granted by this call, in catalogue order. */
  granted: string[]
  /** Items the player already had. */
  alreadyOwned: number
}

/**
 * Gives one account every item in the catalogue — the test account's "full wardrobe" (bug-log CR1 §8).
 *
 * A tool for operators, never reachable from the API: it writes no ledger row because no points move,
 * and it marks every row `dev-grant` so a report can tell a granted wardrobe from an earned one. The
 * catalogue is seeded first, the way the server does at boot, so a freshly migrated database — or one
 * behind the JSON by an item or two — cannot fail the foreign key. Idempotent: a second run grants
 * nothing and says so.
 */
export async function grantWardrobe(db: AppDb, catalog: ItemCatalog, email: string, opts: { dryRun?: boolean } = {}): Promise<GrantWardrobeResult> {
  const normalised = email.trim().toLowerCase()
  const [account] = await db
    .select({ id: users.id, displayName: players.displayName })
    .from(users)
    .innerJoin(players, eq(players.id, users.id))
    .where(eq(users.email, normalised))
  if (!account) throw new UnknownAccountError(normalised)

  const inventory = createInventoryService(db, undefined, catalog.freeIds())
  // Free items (design §3.2) are owned by everyone already and never get an `inventory` row — "every
  // catalogue item" here means every item a grant can actually give.
  const all = catalog
    .all()
    .filter((d) => !d.free)
    .map((d) => d.id)
  const missing = await inventory.missingOf(account.id, all)
  const granted = all.filter((id) => missing.includes(id))
  if (opts.dryRun !== true && granted.length > 0) {
    await catalog.seed(db)
    await db.transaction(async (tx) => {
      for (const id of granted) await inventory.grant(tx, account.id, id, GRANT_SOURCE)
    })
  }
  return { playerId: account.id, displayName: account.displayName, total: all.length, granted, alreadyOwned: all.length - granted.length }
}
