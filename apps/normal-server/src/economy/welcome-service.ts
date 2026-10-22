/**
 * The welcome gift (Plan 27, spec §4 C1, R6, R8, R17): on a player's first visit to the lobby — new account or old,
 * there is no character-creation step — one of three rare items (`ShopService.welcomeChoices()`), worn at once, with
 * what the `welcome` reputation rule pays (100 by default) and day 1 of the newcomer calendar (C2). Once per account.
 *
 * No points move here: the starting balance is still what registration gives. Reputation is not points and is not a
 * `TxReason` (spec A1); it goes through `ReputationService.grantRuleWithin` with `ref_id = 'welcome'`, whose unique key
 * would also refuse a second grant were the `welcome_claimed_at` guard ever bypassed.
 *
 * **One transaction, guard first.** `UPDATE players SET welcome_claimed_at … WHERE welcome_claimed_at IS NULL
 * RETURNING id` is the first statement: two tabs claiming at once serialise on the row, and the loser sees no row and
 * is `WELCOME_CLAIMED` before anything is granted. Every later refusal throws inside the transaction, so the guard's
 * write is rolled back with it and a refused claim leaves the column null.
 *
 * **What is read before the transaction.** The choices (`shop_config`) and which of them the player owns
 * (`inventory.missingOf`, alias-aware) are read on `db`, because on PGlite a query on `db` while a transaction holds
 * the one connection waits forever. A grant racing in between (a daily draw landing the same hat) is caught by
 * `inventory.grant` answering false, which refuses `ALREADY_OWNED` and rolls back.
 *
 * **Reputation only (R17).** When every choice is already owned, `claim(pid, null)` grants the reputation and the
 * newcomer day without an item; `null` while any choice is still unowned is `NOT_A_CHOICE`.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { newcomerProgress, players } from '../db/schema.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { UnknownPlayerError } from '../repos/index.js'
import { isUuid } from '../repos/util.js'
import type { ReputationService } from '../reputation/reputation-service.js'
import type { ShopService } from '../shop/shop-service.js'
import { dayKey } from './daily-rules.js'

export interface WelcomeStatus {
  claimed: boolean
  /** The configured choices, in their configured order; `owned` ones cannot be picked (R17). */
  choices: { itemId: string; owned: boolean }[]
}

export type WelcomeRefusal = 'WELCOME_CLAIMED' | 'NOT_A_CHOICE' | 'ALREADY_OWNED'

export type WelcomeClaimResult =
  | { ok: true; itemId: string | null; reputation: number; rank: number; rankUp: boolean }
  | { ok: false; code: WelcomeRefusal }

export interface WelcomeService {
  status(playerId: string): Promise<WelcomeStatus>
  /** `itemId` is one of the choices the player does not own, or `null` only when they own every choice. */
  claim(playerId: string, itemId: string | null): Promise<WelcomeClaimResult>
}

export interface WelcomeServiceDeps {
  db: AppDb
  inventory: Pick<InventoryService, 'grant' | 'missingOf'>
  catalog: ItemCatalog
  shop: Pick<ShopService, 'welcomeChoices'>
  reputation: Pick<ReputationService, 'grantRuleWithin' | 'announceRankUp'>
  /** Puts the item on the figure inside `tx` — `wearItemWithin` in `app.ts`. */
  avatars: { wearWithin(tx: AppTx, playerId: string, itemId: string): Promise<unknown> }
  /** The economy's time zone: newcomer day 1 is today's `dayKey` there, so C2's next day is a different one. */
  timezone: string
  now?: () => number
}

/** A refusal raised inside the transaction, so the guard's write is rolled back with everything else. */
class Refusal extends Error {
  constructor(readonly code: WelcomeRefusal) {
    super(code)
    this.name = 'WelcomeRefusal'
  }
}

export function createWelcomeService(deps: WelcomeServiceDeps): WelcomeService {
  const clock = deps.now ?? Date.now

  /** The choices that exist in the catalogue, and the ones of them this player does not own. */
  async function choicesFor(playerId: string): Promise<{ choices: string[]; missing: Set<string> }> {
    const choices = (await deps.shop.welcomeChoices()).filter((id) => deps.catalog.get(id) !== undefined)
    return { choices, missing: new Set(await deps.inventory.missingOf(playerId, choices)) }
  }

  return {
    async status(playerId) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const [row] = await deps.db.select({ claimedAt: players.welcomeClaimedAt }).from(players).where(eq(players.id, playerId))
      if (row === undefined) throw new UnknownPlayerError(playerId)
      const { choices, missing } = await choicesFor(playerId)
      return { claimed: row.claimedAt !== null, choices: choices.map((itemId) => ({ itemId, owned: !missing.has(itemId) })) }
    },

    async claim(playerId, itemId) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = clock()
      const { choices, missing } = await choicesFor(playerId)

      let result: Extract<WelcomeClaimResult, { ok: true }>
      try {
        result = await deps.db.transaction(async (tx) => {
          const guarded = await tx
            .update(players)
            .set({ welcomeClaimedAt: new Date(nowMs) })
            .where(and(eq(players.id, playerId), isNull(players.welcomeClaimedAt)))
            .returning({ id: players.id })
          if (guarded.length === 0) throw new Refusal('WELCOME_CLAIMED')

          if (itemId === null) {
            if (missing.size > 0) throw new Refusal('NOT_A_CHOICE')
          } else {
            if (!choices.includes(itemId)) throw new Refusal('NOT_A_CHOICE')
            if (!missing.has(itemId)) throw new Refusal('ALREADY_OWNED')
            if (!(await deps.inventory.grant(tx, playerId, itemId, 'welcome', 'welcome'))) throw new Refusal('ALREADY_OWNED')
            await deps.avatars.wearWithin(tx, playerId, itemId)
          }

          const grant = await deps.reputation.grantRuleWithin(tx, playerId, 'welcome', 'welcome', 'welcome')
          // Day 1 of the newcomer calendar (C2). `do nothing` rather than a throw: a row already there means the
          // calendar was started some other way, and the welcome gift must not be refused for it.
          await tx
            .insert(newcomerProgress)
            .values({ playerId, day: 1, claimedDays: [1], lastDayKey: dayKey(nowMs, deps.timezone) })
            .onConflictDoNothing({ target: newcomerProgress.playerId })
          return { ok: true as const, itemId, reputation: grant.reputation, rank: grant.rank, rankUp: grant.rankUp }
        })
      } catch (err) {
        if (err instanceof Refusal) return { ok: false, code: err.code }
        throw err
      }
      if (result.rankUp) deps.reputation.announceRankUp(playerId, result.rank)
      return result
    },
  }
}
