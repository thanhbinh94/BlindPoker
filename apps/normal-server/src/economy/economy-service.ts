/**
 * The two ways points arrive without a card being dealt: the daily check-in (§13) and relief (§12.4).
 *
 * Both are written the same way, and the shape is the point of the file:
 *
 * 1. **Everything happens in one transaction, and the decision is made inside it.** The eligibility
 *    read is a `SELECT … FOR UPDATE` on the row the write will change, so two requests that arrive
 *    together are serialised by the database rather than by hope. Checking outside and writing
 *    inside would leave exactly the window a double-tap on a phone finds.
 * 2. **Points move through `creditWithin`, never through an `UPDATE players SET balance`.** That is
 *    what keeps `Σ balances + Σ sinks` (§12.5) true and what puts every reward in the ledger under
 *    a reason an operator can total.
 * 3. **Nothing is announced until it is committed.** `bus.publish` and `onBalanceChanged` are called
 *    *after* the transaction returns: a rolled-back claim that had already told the stats module
 *    about a login day would leave a counter no row supports.
 */
import { ECONOMY } from '@bp/core'
import type { BalanceEntry } from '@bp/server-kit'
import { eq } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import type { AppEventBus } from '../events.js'
import { dailyLogins, players } from '../db/schema.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { DAILY_DRAW_SLOTS } from '../inventory/slots.js'
import { UnknownPlayerError, type NormalRepositories } from '../repos/index.js'
import { isUuid } from '../repos/util.js'
import {
  dailyCalendar,
  DAILY_FIXED_ITEM_IDS,
  dayKey,
  itemMarkerForDay,
  itemRuleForDay,
  monthKey,
  nextDayStartMs,
  nextStreak,
  NO_ITEM_FALLBACK_POINTS,
  reliefEligible,
  rewardForDay,
  type CalendarEntry,
  type ReliefRefusal,
} from './daily-rules.js'

export interface DailyStatus {
  /** False once today's claim has been made. */
  claimable: boolean
  /** The reward tier this claim is (or was) for. */
  day: number
  streak: number
  reward: number
  /** The day's item column as a label — a rarity for the random tiers, an id for day 28. */
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  calendar: CalendarEntry[]
}

export interface DailyClaimOk {
  ok: true
  day: number
  /** The day's scheduled reward. The fallback, when one was paid, is `fallbackPoints`. */
  points: number
  /** The first item granted, or null — `items` has all of them (day 28 grants two). */
  item: string | null
  items: string[]
  /** §13.2's substitute when a random tier had nothing unowned left; 0 otherwise. */
  fallbackPoints: number
  balance: number
  streak: number
}

export type DailyClaimResult = DailyClaimOk | { ok: false; code: 'ALREADY_CLAIMED' }

export interface ReliefStatus {
  eligible: boolean
  reason: ReliefRefusal | null
  retryAt: number | null
  threshold: number
  target: number
}

export type ReliefClaimResult = { ok: true; amount: number; balance: number } | { ok: false; reason: ReliefRefusal; retryAt: number | null }

export interface EconomyService {
  dailyStatus(playerId: string, now?: number): Promise<DailyStatus>
  claimDaily(playerId: string, now?: number): Promise<DailyClaimResult>
  reliefStatus(playerId: string, now?: number): Promise<ReliefStatus>
  claimRelief(playerId: string, now?: number): Promise<ReliefClaimResult>
}

export interface EconomyServiceDeps {
  db: AppDb
  repos: NormalRepositories
  inventory: InventoryService
  catalog: ItemCatalog
  bus: AppEventBus
  /** `ECONOMY_TIMEZONE`: the zone the day boundary is drawn in. */
  timezone: string
  /** Pushes the new balance to the player's live connection, if they have one. */
  onBalanceChanged: (playerId: string, balance: number) => void
  now?: () => number
  /** Injectable so a test can pin which unowned item the day-7 draw lands on. */
  rng?: () => number
  /**
   * Ids the random tiers must never hand out because something else has already promised them —
   * every achievement's `reward.itemId`. Task 6 passes them from the loaded definitions, so
   * `achievements.json` stays the only place a reward id is written down.
   *
   * The day-28 pair is excluded regardless: it is this module's own promise to keep.
   */
  reservedItemIds?: Iterable<string>
}

/** The `source` recorded in `inventory` for anything the check-in hands out. */
const DAILY_SOURCE = 'daily'

export function createEconomyService(deps: EconomyServiceDeps): EconomyService {
  const now = deps.now ?? Date.now
  const rng = deps.rng ?? Math.random
  const calendar = dailyCalendar()
  /**
   * What the random tiers may not draw, settled once at wiring time.
   *
   * `DAILY_FIXED_ITEM_IDS` first: a day-14 draw that took `badge_monthly` would leave day 28 with
   * nothing to grant and — correctly, since the fallback belongs to the random tiers only — nothing
   * to pay in its place, so a full 28-day streak would quietly be worth less than the schedule says.
   * The same argument covers every achievement reward: an item handed out by chance is one a player
   * can no longer earn.
   */
  const excludedIds: readonly string[] = [...new Set([...DAILY_FIXED_ITEM_IDS, ...(deps.reservedItemIds ?? [])])]
  /**
   * `withinSlots: DAILY_DRAW_SLOTS` rather than excluding `title`/`badge`/`outfit` by name: an
   * allow-list also keeps out anything `items` still carries for a slot the current catalogue no
   * longer offers (`0001_avatar_v2.sql`'s four v2 rows, kept forever for `inventory`'s foreign key)
   * — a deny-list could never name those, because they are not even a current `ItemSlot`.
   */
  const drawExclusion = { ids: excludedIds, withinSlots: DAILY_DRAW_SLOTS }

  /** The `daily_logins` row, locked for the duration of the caller's transaction. */
  async function lockDaily(tx: AppTx, playerId: string): Promise<{ streak: number; lastClaimDate: string | null; month: string; claimedDays: number }> {
    const [row] = await tx
      .select({ streak: dailyLogins.streak, lastClaimDate: dailyLogins.lastClaimDate, month: dailyLogins.month, claimedDays: dailyLogins.claimedDays })
      .from(dailyLogins)
      .where(eq(dailyLogins.playerId, playerId))
      .for('update')
    // Registration writes this row inside the same transaction as the `players` row, so its absence
    // means the player is not there — not that they have never checked in.
    if (row === undefined) throw new UnknownPlayerError(playerId)
    return row
  }

  async function balanceOf(tx: AppTx, playerId: string): Promise<number> {
    const [row] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, playerId))
    if (row === undefined) throw new UnknownPlayerError(playerId)
    return Number(row.balance)
  }

  /**
   * Applies the day's item column, appending a fallback credit to `entries` when a random tier had
   * nothing left to draw. Returns the ids actually granted.
   *
   * The fallback belongs to the *random* tiers only. Day 28 grants two named items and grants
   * nothing extra when the player already has them — a fixed reward that has already been given is
   * not a catalogue running dry, and paying 10,000 for it every year would be a slow leak.
   */
  async function applyItemRule(
    tx: AppTx,
    playerId: string,
    day: number,
    refId: string,
    entries: BalanceEntry[],
  ): Promise<{ items: string[]; fallbackPoints: number }> {
    const rule = itemRuleForDay(day)
    if (rule === null) return { items: [], fallbackPoints: 0 }

    if (rule.kind === 'fixed') {
      const granted: string[] = []
      for (const itemId of rule.itemIds) {
        // Guard rather than trust: `loadItemCatalog` already refuses a catalogue missing these, so
        // this only fires for a hand-built catalog, and a missing row would be a foreign-key error.
        if (deps.catalog.get(itemId) === undefined) continue
        if (await deps.inventory.grant(tx, playerId, itemId, DAILY_SOURCE)) granted.push(itemId)
      }
      return { items: granted, fallbackPoints: 0 }
    }

    // `items` keeps every row it was ever seeded with (inventory's foreign key needs them), so an item the
    // catalogue has since withdrawn — `head_hood_black01`, bug 6 — is still a row of the right slot and
    // rarity. Only what the catalogue still offers is a prize.
    const unowned = (await deps.inventory.unownedOfRarity(tx, playerId, rule.rarity, drawExclusion)).filter((id) => deps.catalog.get(id) !== undefined)
    if (unowned.length === 0) {
      // A second ledger entry under its own reason, sharing the claim's refId: one claim, two rows,
      // and §12.5's report can see how often the catalogue is failing to keep up.
      entries.push({ playerId, delta: NO_ITEM_FALLBACK_POINTS, reason: 'daily_item_fallback', refId })
      return { items: [], fallbackPoints: NO_ITEM_FALLBACK_POINTS }
    }
    const pick = unowned[Math.min(Math.floor(rng() * unowned.length), unowned.length - 1)]!
    await deps.inventory.grant(tx, playerId, pick, DAILY_SOURCE)
    return { items: [pick], fallbackPoints: 0 }
  }

  return {
    async dailyStatus(playerId, at) {
      const nowMs = at ?? now()
      const today = dayKey(nowMs, deps.timezone)
      // A malformed id reads as "has never claimed" rather than reaching the driver as a `22P02`:
      // this is a status read, and the caller above answers 404 on the profile, not 500 here.
      const [row] = isUuid(playerId)
        ? await deps.db
            .select({ streak: dailyLogins.streak, lastClaimDate: dailyLogins.lastClaimDate })
            .from(dailyLogins)
            .where(eq(dailyLogins.playerId, playerId))
        : []
      const state = row ?? { streak: 0, lastClaimDate: null }
      const outcome = nextStreak(state, today)
      return {
        claimable: !outcome.alreadyClaimed,
        day: outcome.day,
        streak: outcome.streak,
        reward: outcome.points,
        item: itemMarkerForDay(outcome.day),
        nextResetAt: nextDayStartMs(nowMs, deps.timezone),
        // A copy per call. The schedule is constant, so it is built once — but handing every
        // response the same array means one caller decorating an entry (a per-player "claimed"
        // marker, say) would rewrite the calendar for every other player.
        calendar: calendar.map((entry) => ({ ...entry })),
      }
    },

    async claimDaily(playerId, at) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = at ?? now()
      const today = dayKey(nowMs, deps.timezone)
      const month = monthKey(nowMs, deps.timezone)

      const result = await deps.db.transaction(async (tx): Promise<DailyClaimResult> => {
        const state = await lockDaily(tx, playerId)
        const outcome = nextStreak(state, today)
        if (outcome.alreadyClaimed) return { ok: false, code: 'ALREADY_CLAIMED' }

        const points = rewardForDay(outcome.day)
        const refId = `daily:${playerId}:${today}`
        const entries: BalanceEntry[] = [{ playerId, delta: points, reason: 'daily_login', refId }]
        const { items, fallbackPoints } = await applyItemRule(tx, playerId, outcome.day, refId, entries)

        await deps.repos.balances.creditWithin(tx, entries)
        await tx
          .update(dailyLogins)
          .set({
            streak: outcome.streak,
            lastClaimDate: today,
            month,
            // `claimed_days` counts check-ins inside the current month, which is not the streak: a
            // player who misses a day and comes back has claimed twice with a streak of 1.
            claimedDays: state.month === month ? state.claimedDays + 1 : 1,
          })
          .where(eq(dailyLogins.playerId, playerId))

        return {
          ok: true,
          day: outcome.day,
          points,
          item: items[0] ?? null,
          items,
          fallbackPoints,
          balance: await balanceOf(tx, playerId),
          streak: outcome.streak,
        }
      })

      if (result.ok) {
        await deps.bus.publish({ type: 'DAILY_CLAIMED', playerId, day: result.day, streak: result.streak })
        deps.onBalanceChanged(playerId, result.balance)
      }
      return result
    },

    async reliefStatus(playerId, at) {
      const nowMs = at ?? now()
      const row = await deps.repos.players.findByIdFull(playerId)
      const outcome =
        row === null
          ? { eligible: false, reason: 'balance' as const, retryAt: null }
          : reliefEligible(row.balance, row.lastReliefAt?.getTime() ?? null, nowMs)
      return { ...outcome, threshold: ECONOMY.reliefThreshold, target: ECONOMY.reliefTarget }
    },

    async claimRelief(playerId, at) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = at ?? now()

      const result = await deps.db.transaction(async (tx): Promise<ReliefClaimResult> => {
        // The lock and the eligibility read are the same row: a second request arriving mid-claim
        // waits here and then reads the balance and cooldown this one just wrote.
        const [row] = await tx
          .select({ balance: players.balance, lastReliefAt: players.lastReliefAt })
          .from(players)
          .where(eq(players.id, playerId))
          .for('update')
        if (row === undefined) throw new UnknownPlayerError(playerId)

        const balance = Number(row.balance)
        const outcome = reliefEligible(balance, row.lastReliefAt?.getTime() ?? null, nowMs)
        if (!outcome.eligible) return { ok: false, reason: outcome.reason ?? 'balance', retryAt: outcome.retryAt }

        const amount = ECONOMY.reliefTarget - balance
        await deps.repos.balances.creditWithin(tx, [{ playerId, delta: amount, reason: 'relief', refId: `relief:${playerId}:${nowMs}` }])
        // Written through the transaction rather than `repos.players.setLastRelief`, which opens a
        // connection of its own and would deadlock against the `FOR UPDATE` held two lines up.
        await tx.update(players).set({ lastReliefAt: new Date(nowMs) }).where(eq(players.id, playerId))
        return { ok: true, amount, balance: balance + amount }
      })

      if (result.ok) deps.onBalanceChanged(playerId, result.balance)
      return result
    },
  }
}
