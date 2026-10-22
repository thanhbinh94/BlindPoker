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
import { and, eq, isNull } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import type { AppEventBus } from '../events.js'
import { dailyLogins, newcomerProgress, players } from '../db/schema.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { DAILY_DRAW_SLOTS } from '../inventory/slots.js'
import { UnknownPlayerError, type NormalRepositories } from '../repos/index.js'
import { isUuid } from '../repos/util.js'
import type { ReputationGrant, ReputationService } from '../reputation/reputation-service.js'
import type { DailyGiftNotice, DailyGiftSchedule } from './daily-gifts.js'
import {
  dailyCalendar,
  dayKey,
  itemMarker,
  monthKey,
  NEWCOMER_DAYS,
  newcomerGiftFor,
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
  /** The month's claim count this claim makes (or made) — §13.1 as amended by Plan 27 Part G; `day` is it, capped at 31. */
  streak: number
  /** The run of consecutive calendar days this claim makes (or made), across month boundaries. */
  consecutive: number
  reward: number
  /** The tier's item column as a marker — a rarity for a draw, the first id for a fixed gift (its calendar row's `items` has them all). */
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  /** `YYYY-MM` in the economy timezone: the month `calendar` describes, and the one a claim made now is paid from. */
  month: string
  calendar: CalendarEntry[]
  /** Plan 27 C2: the newcomer calendar while it runs; absent with no welcome claim, and once it has finished. */
  newcomer?: NewcomerStatus
}

/** The newcomer calendar as `GET /api/rewards/daily` reports it. */
export interface NewcomerStatus {
  /**
   * The newcomer day today's claim is (or was) for — as `DailyStatus.day` is for the month: the last counted day while
   * today has already counted (the welcome day, or after today's claim), the next one otherwise. In `claimedDays` means
   * done; not in it, the one today's claim would reach.
   */
  day: number
  /** The newcomer days (1…7) already counted, ascending. Day 1 is the welcome claim. */
  claimedDays: number[]
  /** Always false while the calendar is reported: a finished one is left out. */
  finished: boolean
  /**
   * What day 7 pays now (`newcomer_day7`, Plan 27 fix wave), so the panel's day-7 tile follows a GM's change. Absent only
   * where the service runs without reputation (some tests).
   */
  day7Reputation?: number
}

/** What a claim added to the newcomer calendar: present only when it advanced it. */
export interface NewcomerClaim {
  /** The newcomer day this claim reached, 2…7. */
  day: number
  /** The item day 3 or day 7 handed out, or null (another day, or nothing unowned left — see `fallbackPoints`). */
  item: string | null
  /** `NO_ITEM_FALLBACK_POINTS` when day 3 or 7 had nothing unowned to give; 0 otherwise. Included in `balance`. */
  fallbackPoints: number
  /** The reputation day 7 added (`newcomer_day7`); 0 on every other day. */
  reputation: number
  /** True when this claim completed day 7. */
  finished: boolean
}

export interface DailyClaimOk {
  ok: true
  day: number
  /** The day's scheduled reward. The fallback, when one was paid, is `fallbackPoints`. */
  points: number
  /** The first item granted, or null — `items` has all of them (a fixed tier may grant several). */
  item: string | null
  items: string[]
  /** §13.2's substitute when a random tier had nothing unowned left; 0 otherwise. */
  fallbackPoints: number
  balance: number
  /** The month's claim count after this claim (§13.1 as amended by Plan 27 Part G). */
  streak: number
  /** The run of consecutive calendar days after this claim — what the login-streak achievements count. */
  consecutive: number
  /** Plan 27 C2: present only when this claim advanced the newcomer calendar. */
  newcomer?: NewcomerClaim
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
  /** The items the gift schedule names from this month on, for the wardrobe's hint (spec 2026-10-12 §4.4). The same for everyone. */
  dailyGiftNotices(now?: number): DailyGiftNotice[]
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
   * Every id the gift schedule names is excluded regardless: it is this module's own promise to keep.
   */
  reservedItemIds?: Iterable<string>
  /**
   * The check-in's item column (spec 2026-10-12): what each tier draws or grants, month by month. A getter, because a
   * GM may replace a month while the server runs (Plan 26): each operation calls it **once** and keeps that copy, so a
   * claim never sees two schedules.
   */
  gifts: () => DailyGiftSchedule
  /** Plan 27: a claim also adds `daily_login` reputation, inside the claim's transaction. Optional for tests not about it. */
  reputation?: ReputationService
}

/** The `source` recorded in `inventory` for anything the check-in hands out. */
const DAILY_SOURCE = 'daily'
/** The `source` recorded for the newcomer calendar's items (spec C2). */
const NEWCOMER_SOURCE = 'newcomer'

export function createEconomyService(deps: EconomyServiceDeps): EconomyService {
  const now = deps.now ?? Date.now
  const rng = deps.rng ?? Math.random
  /**
   * What the random tiers may not draw, settled per claim from the schedule that claim holds (Plan 26: a GM can change
   * the schedule while the server runs, so it is no longer fixed at wiring time).
   *
   * Every id the gift schedule names first — in any month, past or future (spec Q8): a day-14 draw that took
   * `badge_monthly` would leave day 28 with nothing to grant and — correctly, since the fallback belongs to the random
   * tiers only — nothing to pay in its place, so a full 28-day streak would quietly be worth less than the schedule
   * says. The same argument covers every achievement reward: an item handed out by chance is one a player can no
   * longer earn.
   *
   * `withinSlots: DAILY_DRAW_SLOTS` rather than excluding `title`/`badge`/`outfit` by name: an
   * allow-list also keeps out anything `items` still carries for a slot the current catalogue no
   * longer offers (`0001_avatar_v2.sql`'s four v2 rows, kept forever for `inventory`'s foreign key)
   * — a deny-list could never name those, because they are not even a current `ItemSlot`.
   */
  const drawExclusionOf = (gifts: DailyGiftSchedule) => ({
    ids: [...new Set([...gifts.fixedItemIds(), ...(deps.reservedItemIds ?? [])])] as readonly string[],
    withinSlots: DAILY_DRAW_SLOTS,
  })

  /** The `daily_logins` row, locked for the duration of the caller's transaction. */
  async function lockDaily(
    tx: AppTx,
    playerId: string,
  ): Promise<{ streak: number; consecutive: number; lastClaimDate: string | null; month: string; claimedDays: number }> {
    const [row] = await tx
      .select({
        streak: dailyLogins.streak,
        consecutive: dailyLogins.consecutive,
        lastClaimDate: dailyLogins.lastClaimDate,
        month: dailyLogins.month,
        claimedDays: dailyLogins.claimedDays,
      })
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
   * The fallback belongs to the *random* tiers only. A fixed tier grants its named items and grants
   * nothing extra when the player already has them — a fixed reward that has already been given is
   * not a catalogue running dry, and paying 10,000 for it every year would be a slow leak.
   */
  async function applyItemRule(
    tx: AppTx,
    playerId: string,
    day: number,
    month: string,
    refId: string,
    entries: BalanceEntry[],
    gifts: DailyGiftSchedule,
  ): Promise<{ items: string[]; fallbackPoints: number }> {
    // The month of the claim, not of whatever calendar the player last looked at (spec 2026-10-12 §4.2).
    const rule = gifts.itemRuleForDay(day, month)
    if (rule === null) return { items: [], fallbackPoints: 0 }

    if (rule.kind === 'fixed') {
      const granted: string[] = []
      for (const itemId of rule.itemIds) {
        // Guard rather than trust: `loadDailyGifts` already refuses a schedule naming an id the catalogue lacks, so
        // this only fires for a hand-built catalog, and a missing row would be a foreign-key error.
        if (deps.catalog.get(itemId) === undefined) continue
        if (await deps.inventory.grant(tx, playerId, itemId, DAILY_SOURCE, refId)) granted.push(itemId)
      }
      return { items: granted, fallbackPoints: 0 }
    }

    const pick = await drawUnowned(tx, playerId, rule.rarity, gifts)
    if (pick === null) {
      // A second ledger entry under its own reason, sharing the claim's refId: one claim, two rows,
      // and §12.5's report can see how often the catalogue is failing to keep up.
      entries.push({ playerId, delta: NO_ITEM_FALLBACK_POINTS, reason: 'daily_item_fallback', refId })
      return { items: [], fallbackPoints: NO_ITEM_FALLBACK_POINTS }
    }
    await deps.inventory.grant(tx, playerId, pick, DAILY_SOURCE, refId)
    return { items: [pick], fallbackPoints: 0 }
  }

  /**
   * One random unowned item of `rarity`, or null when there is none — the monthly draw's pool and rng, which the
   * newcomer calendar's day 3 and day 7 share (amendment P26).
   */
  async function drawUnowned(tx: AppTx, playerId: string, rarity: 'common' | 'rare', gifts: DailyGiftSchedule): Promise<string | null> {
    // `items` keeps every row it was ever seeded with (inventory's foreign key needs them), so an item the
    // catalogue has since withdrawn — `head_hood_black01`, bug 6 — is still a row of the right slot and
    // rarity. Only what the catalogue still offers is a prize.
    const unowned = (await deps.inventory.unownedOfRarity(tx, playerId, rarity, drawExclusionOf(gifts))).filter((id) => deps.catalog.get(id) !== undefined)
    if (unowned.length === 0) return null
    return unowned[Math.min(Math.floor(rng() * unowned.length), unowned.length - 1)]!
  }

  /**
   * Spec C2: advances the newcomer calendar by one day inside the claim's transaction, when it runs and today has not
   * counted yet (the welcome day already has). Day 3 and day 7 draw an item, or append the fallback to `entries` — the
   * claim's own credit batch — under `newcomer:<player>:<day>`, a ref outside the GM undo's reach (`latestClaim` reads
   * `daily:` refs only), so undoing a check-in leaves the calendar and its gifts alone. Day 7's reputation is the
   * caller's, after the credit. Returns null when nothing advanced. When the month's draw and this one fall in the same
   * claim, the month's consumes `rng` first and this one second, and this one reads the month's grant through `tx`, so
   * the two never pick the same item.
   */
  async function advanceNewcomer(
    tx: AppTx,
    playerId: string,
    today: string,
    nowMs: number,
    entries: BalanceEntry[],
    gifts: DailyGiftSchedule,
  ): Promise<Omit<NewcomerClaim, 'reputation'> | null> {
    const [row] = await tx
      .select({ day: newcomerProgress.day, claimedDays: newcomerProgress.claimedDays, lastDayKey: newcomerProgress.lastDayKey })
      .from(newcomerProgress)
      .where(and(eq(newcomerProgress.playerId, playerId), isNull(newcomerProgress.finishedAt)))
      .for('update')
    // Amendment P2: one economy day advances it once — the welcome day counts as day 1, so its own claim adds nothing.
    if (row === undefined || row.lastDayKey === today) return null

    const day = row.day + 1
    const finished = day >= NEWCOMER_DAYS
    const refId = `newcomer:${playerId}:${day}`
    let item: string | null = null
    let fallbackPoints = 0
    const rarity = newcomerGiftFor(day)
    if (rarity !== null) {
      const pick = await drawUnowned(tx, playerId, rarity, gifts)
      if (pick !== null && (await deps.inventory.grant(tx, playerId, pick, NEWCOMER_SOURCE, refId))) {
        item = pick
      } else {
        entries.push({ playerId, delta: NO_ITEM_FALLBACK_POINTS, reason: 'daily_item_fallback', refId })
        fallbackPoints = NO_ITEM_FALLBACK_POINTS
      }
    }
    await tx
      .update(newcomerProgress)
      .set({
        day,
        claimedDays: [...row.claimedDays.filter((d) => d !== day), day],
        lastDayKey: today,
        ...(finished ? { finishedAt: new Date(nowMs) } : {}),
      })
      .where(eq(newcomerProgress.playerId, playerId))
    return { day, item, fallbackPoints, finished }
  }

  /** The running newcomer calendar for `dailyStatus`, or undefined (none, or finished). A plain read: no lock. */
  async function newcomerStatus(playerId: string, today: string): Promise<NewcomerStatus | undefined> {
    if (!isUuid(playerId)) return undefined
    const [row] = await deps.db
      .select({ day: newcomerProgress.day, claimedDays: newcomerProgress.claimedDays, lastDayKey: newcomerProgress.lastDayKey })
      .from(newcomerProgress)
      .where(and(eq(newcomerProgress.playerId, playerId), isNull(newcomerProgress.finishedAt)))
    if (row === undefined) return undefined
    const day = row.lastDayKey === today ? row.day : Math.min(row.day + 1, NEWCOMER_DAYS)
    const status: NewcomerStatus = { day, claimedDays: [...row.claimedDays].sort((a, b) => a - b), finished: false }
    if (deps.reputation !== undefined) status.day7Reputation = (await deps.reputation.rules()).newcomer_day7
    return status
  }

  return {
    async dailyStatus(playerId, at) {
      const nowMs = at ?? now()
      const today = dayKey(nowMs, deps.timezone)
      const month = monthKey(nowMs, deps.timezone)
      const gifts = deps.gifts()
      // A malformed id reads as "has never claimed" rather than reaching the driver as a `22P02`:
      // this is a status read, and the caller above answers 404 on the profile, not 500 here.
      const [row] = isUuid(playerId)
        ? await deps.db
            .select({ streak: dailyLogins.streak, consecutive: dailyLogins.consecutive, lastClaimDate: dailyLogins.lastClaimDate })
            .from(dailyLogins)
            .where(eq(dailyLogins.playerId, playerId))
        : []
      const state = row ?? { streak: 0, consecutive: 0, lastClaimDate: null }
      const outcome = nextStreak(state, today)
      const newcomer = await newcomerStatus(playerId, today)
      return {
        claimable: !outcome.alreadyClaimed,
        day: outcome.day,
        streak: outcome.streak,
        consecutive: outcome.consecutive,
        reward: outcome.points,
        item: itemMarker(gifts.itemRuleForDay(outcome.day, month)),
        nextResetAt: nextDayStartMs(nowMs, deps.timezone),
        month,
        // Built per call, for this month: the schedule may differ month to month, and a fresh array also means one
        // caller decorating an entry can never rewrite the calendar another response carries.
        calendar: dailyCalendar(gifts, month),
        ...(newcomer === undefined ? {} : { newcomer }),
      }
    },

    async claimDaily(playerId, at) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = at ?? now()
      const today = dayKey(nowMs, deps.timezone)
      const month = monthKey(nowMs, deps.timezone)
      // Once, before the transaction: a `setMonth` that commits while this claim runs applies to the next claim.
      const gifts = deps.gifts()
      let reputation: ReputationGrant | null = null
      let newcomerReputation: ReputationGrant | null = null

      const result = await deps.db.transaction(async (tx): Promise<DailyClaimResult> => {
        const state = await lockDaily(tx, playerId)
        const outcome = nextStreak(state, today)
        if (outcome.alreadyClaimed) return { ok: false, code: 'ALREADY_CLAIMED' }

        const points = rewardForDay(outcome.day)
        const refId = `daily:${playerId}:${today}`
        const entries: BalanceEntry[] = [{ playerId, delta: points, reason: 'daily_login', refId }]
        const { items, fallbackPoints } = await applyItemRule(tx, playerId, outcome.day, month, refId, entries, gifts)
        // Spec C2: the newcomer calendar rides on the same claim, lock and credit batch — one transaction for both.
        const newcomer = await advanceNewcomer(tx, playerId, today, nowMs, entries, gifts)

        await deps.repos.balances.creditWithin(tx, entries)
        await tx
          .update(dailyLogins)
          .set({
            // §13.1 as amended by Plan 27 Part G: `streak` is the month's claim count, so it now moves with
            // `claimed_days`; the run of calendar days the two login-streak achievements read is `consecutive`.
            streak: outcome.streak,
            consecutive: outcome.consecutive,
            lastClaimDate: today,
            month,
            claimedDays: state.month === month ? state.claimedDays + 1 : 1,
          })
          .where(eq(dailyLogins.playerId, playerId))
        // Spec A2: the day's reputation, flat (not by tier), under the claim's own ref — so a reclaim after a GM undo,
        // which reuses that ref, adds nothing a second time. Read through `tx` (one PGlite connection).
        const daily = (await deps.reputation?.grantRuleWithin(tx, playerId, 'daily_login', 'daily_login', refId)) ?? null
        reputation = daily
        // Day 7's reputation, once per account under its own key (amendment P26) — after the credit, so a failure here
        // takes the whole claim back with it.
        let newcomerDelta = 0
        if (newcomer?.finished === true) {
          const grant = (await deps.reputation?.grantRuleWithin(tx, playerId, 'newcomer_day7', 'newcomer_day', `newcomer:${playerId}:${NEWCOMER_DAYS}`)) ?? null
          newcomerReputation = grant
          if (grant?.applied === true) newcomerDelta = grant.reputation - (daily?.reputation ?? grant.reputation)
        }

        return {
          ok: true,
          day: outcome.day,
          points,
          item: items[0] ?? null,
          items,
          fallbackPoints,
          balance: await balanceOf(tx, playerId),
          streak: outcome.streak,
          consecutive: outcome.consecutive,
          ...(newcomer === null ? {} : { newcomer: { ...newcomer, reputation: newcomerDelta } }),
        }
      })

      if (result.ok) {
        await deps.bus.publish({ type: 'DAILY_CLAIMED', playerId, day: result.day, streak: result.streak, consecutive: result.consecutive })
        deps.onBalanceChanged(playerId, result.balance)
        // Assigned inside the transaction's callback, which control-flow narrowing cannot see (it still reads `null`).
        // Two grants may land in one claim: one announcement, with the rank the later one left.
        const grants = [reputation as ReputationGrant | null, newcomerReputation as ReputationGrant | null].filter((g): g is ReputationGrant => g !== null)
        const last = grants.at(-1)
        if (last !== undefined && grants.some((g) => g.rankUp)) deps.reputation?.announceRankUp(playerId, last.rank)
      }
      return result
    },

    dailyGiftNotices(at) {
      return deps.gifts().noticesFrom(monthKey(at ?? now(), deps.timezone))
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
