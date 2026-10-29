/**
 * Poker hỗn loạn on the Normal edition (Plan 37, spec 2026-10-26 §6): which cards are in play, the settings, and the
 * ledgered payment of the new points a card earns.
 *
 * - **Cards.** `data/chaos-cards.json` says what a card does and whether it is on by default; `chaos_card_rules` is a GM's
 *   override per card — on/off, a draw weight (0 = never) and an optional date window. A rule counts only inside its window
 *   (`starts_at <= now < ends_at`, a null bound is open); outside it the file's `enabled` applies, with weight 1. Every
 *   call reads the rows afresh: one draft is one call, and a GM's edit is seen by the next draft with no cache to clear.
 * - **Settings.** `chaos_config` key `chaos` is merged over `DEFAULT_CHAOS_CONFIG`, field by field, so a row written before
 *   a field existed (or damaged by hand) still yields a whole, valid config. Every chaos room reads it after each hand (the
 *   result time, BP-39), so `config()` keeps what it read for `CONFIG_CACHE_MS`; `setConfig` drops it at once, and a read
 *   that began before the drop never stores its older answer. A row edited by hand is seen within `CONFIG_CACHE_MS`. The
 *   credit path reads the row afresh inside its own transaction.
 * - **Credit.** The only place a chaos card creates points. One transaction per credit: the player row is locked, the
 *   economy day's chaos credits are summed, the amount is cut to what the daily cap (and, for Cấp cứu, the daily count)
 *   leaves, the key is claimed in `ledger_keys`, and two rows are written under it through `creditWithin` — the source
 *   (`chaos_rescue|chaos_crit|chaos_fortune|chaos_jackpot`, +n) and `chaos_to_table` (−n). They cancel on the balance: the points were
 *   never in the account, they go straight to the table stack, which the room raises by `credited`. A source row with no
 *   matching transfer would put the points in the account as well, and the stack would be paid twice.
 */
import { CHAOS_MODES, CHAOS_TIERS, DEFAULT_CHAOS_CONFIG, MIN_CARDS_PER_TIER, type ChaosCardDef, type ChaosConfig, type ChaosCreditReason, type ChaosMode, type ChaosTier } from '@bp/core'
import { and, eq, sql } from 'drizzle-orm'
import { rowsOf, type AppDb, type AppTx } from '../db/client.js'
import { chaosCardRules, chaosConfig, ledgerKeys, pointTransactions } from '../db/schema.js'
import { dayKey, dayStartMs, nextDayStartMs } from '../economy/daily-rules.js'
import { ServiceError } from '../errors.js'
import { creditWithin, UnknownPlayerError } from '../repos/balance-repo.js'
import { isUuid } from '../repos/util.js'

/** The one `chaos_config` row. */
export const CHAOS_CONFIG_KEY = 'chaos'

/** How long `config()` keeps the row it read (M5): `setConfig` drops it sooner; this bounds a hand edit or a lost race. */
export const CONFIG_CACHE_MS = 10_000

/** One catalogue card as the GM tab shows it: the file's facts, the GM's rule if there is one, and whether it is drawn now. */
export interface GmChaosCard {
  id: string
  tier: ChaosTier
  family: string
  effect: ChaosCardDef['effect']
  modes: readonly ChaosMode[]
  /** `enabled` in `data/chaos-cards.json`: what applies with no rule, or outside the rule's window. */
  fileEnabled: boolean
  rule: { enabled: boolean; weight: number; startsAt: number | null; endsAt: number | null } | null
  /** On now, by the rule inside its window or else by the file (a weight of 0 still counts: the card is on, but never drawn). */
  activeNow: boolean
}

export type ChaosRuleChange =
  | { cardId: string; enabled: boolean; weight: number; startsAt: number | null; endsAt: number | null }
  | { cardId: string; clear: true }

export interface ChaosService {
  /** The cards on now (each marked `enabled: true`) and every one's draw weight; a rule's weight, else 1. Read fresh. */
  active(nowMs?: number): Promise<{ cards: ChaosCardDef[]; weights: Map<string, number> }>
  /** The settings, kept for `CONFIG_CACHE_MS` after a read; `setConfig` drops them at once. */
  config(): Promise<ChaosConfig>
  /**
   * Drops the kept settings. The caller of `setConfig` calls it once its transaction has committed: a read between the
   * write and the commit still sees the old row, and would otherwise keep it for `CONFIG_CACHE_MS`.
   */
  forgetConfig(): void
  rules(nowMs?: number): Promise<GmChaosCard[]>
  /** Throws `ServiceError('INVALID_CHAOS_RULES')`. Meant to run inside the caller's transaction, which rolls back with it. */
  setRules(tx: AppTx, changes: readonly ChaosRuleChange[], updatedBy: string): Promise<void>
  /** Throws `ServiceError('INVALID_CHAOS_CONFIG')`. */
  setConfig(tx: AppTx, config: ChaosConfig, updatedBy: string): Promise<void>
  credit(c: { playerId: string; roomId: string; amount: number; reason: ChaosCreditReason; key: string }): Promise<{ credited: number; capped: boolean }>
}

export interface ChaosServiceDeps {
  db: AppDb
  catalogue: readonly ChaosCardDef[]
  /** The economy's zone: the daily cap and the daily Cấp cứu count are cut at its midnight. */
  timezone: string
  now?: () => number
}

interface RuleRow {
  cardId: string
  enabled: boolean
  weight: number
  startsAt: Date | null
  endsAt: Date | null
}

/** The bounds of `config`, checked by `setConfig` (spec §6.3). */
const LIMITS = {
  pointsThreshold: [1, 100],
  draftMs: [5_000, 60_000],
  resultMs: [5_000, 15_000],
  dailyCapPoints: [0, 10_000_000],
  dailyRescues: [0, 20],
} as const

const CREDIT_REASONS: readonly ChaosCreditReason[] = ['chaos_rescue', 'chaos_crit', 'chaos_fortune', 'chaos_jackpot']

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Whether `rule` governs at `nowMs`: inside `[starts_at, ends_at)`, a null bound being open. */
function inWindow(rule: RuleRow, nowMs: number): boolean {
  return (rule.startsAt === null || nowMs >= rule.startsAt.getTime()) && (rule.endsAt === null || nowMs < rule.endsAt.getTime())
}

/** Each catalogue card that is on at `nowMs`, with its weight: the rule inside its window, else the file's default at 1. */
function activeAt(catalogue: readonly ChaosCardDef[], rules: ReadonlyMap<string, RuleRow>, nowMs: number): Map<string, { def: ChaosCardDef; weight: number }> {
  const out = new Map<string, { def: ChaosCardDef; weight: number }>()
  for (const def of catalogue) {
    const rule = rules.get(def.id)
    const governed = rule !== undefined && inWindow(rule, nowMs)
    const on = governed ? rule.enabled : def.enabled
    if (on) out.set(def.id, { def, weight: governed ? rule.weight : 1 })
  }
  return out
}

/** Spec §6.2: every tier keeps three cards that can actually be drawn (weight > 0) for each kind of table. */
function tierShortfall(active: ReadonlyMap<string, { def: ChaosCardDef; weight: number }>): string | null {
  for (const tier of CHAOS_TIERS) {
    for (const mode of CHAOS_MODES) {
      let n = 0
      for (const { def, weight } of active.values()) if (def.tier === tier && def.modes.includes(mode) && weight > 0) n += 1
      if (n < MIN_CARDS_PER_TIER) return `${tier} would keep ${String(n)} drawable cards for mode ${mode}, it needs ${String(MIN_CARDS_PER_TIER)}`
    }
  }
  return null
}

async function readRules(db: AppDb | AppTx): Promise<Map<string, RuleRow>> {
  const rows = await db.select().from(chaosCardRules)
  return new Map(rows.map((r) => [r.cardId, { cardId: r.cardId, enabled: r.enabled, weight: r.weight, startsAt: r.startsAt, endsAt: r.endsAt }]))
}

/** The stored config merged over the defaults, a field at a time; a field of the wrong shape falls back to its default. */
function mergeConfig(stored: unknown): ChaosConfig {
  const d = DEFAULT_CHAOS_CONFIG
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return { ...d, tierWeights: { ...d.tierWeights } }
  const s = stored as Record<string, unknown>
  const tw = typeof s.tierWeights === 'object' && s.tierWeights !== null ? (s.tierWeights as Record<string, unknown>) : {}
  const weight = (tier: ChaosTier): number => (isInt(tw[tier]) && tw[tier] >= 0 ? tw[tier] : d.tierWeights[tier])
  const tierWeights = { silver: weight('silver'), gold: weight('gold'), diamond: weight('diamond') }
  const pick = (key: keyof typeof LIMITS): number => {
    const v = s[key]
    const [min, max] = LIMITS[key]
    return isInt(v) && v >= min && v <= max ? v : d[key]
  }
  return {
    // A stored set that sums to nothing would leave `drawTier` no tier to draw.
    tierWeights: tierWeights.silver + tierWeights.gold + tierWeights.diamond > 0 ? tierWeights : { ...d.tierWeights },
    pointsThreshold: pick('pointsThreshold'),
    draftMs: pick('draftMs'),
    resultMs: pick('resultMs'),
    dailyCapPoints: pick('dailyCapPoints'),
    dailyRescues: pick('dailyRescues'),
  }
}

async function readConfig(db: AppDb | AppTx): Promise<ChaosConfig> {
  const [row] = await db.select({ value: chaosConfig.value }).from(chaosConfig).where(eq(chaosConfig.key, CHAOS_CONFIG_KEY))
  return mergeConfig(row?.value)
}

function checkChange(known: ReadonlySet<string>, change: ChaosRuleChange): void {
  const bad = (why: string): never => {
    throw new ServiceError('INVALID_CHAOS_RULES', why)
  }
  if (typeof change !== 'object' || change === null || typeof change.cardId !== 'string' || !known.has(change.cardId)) bad(`not a chaos card: ${String((change as { cardId?: unknown } | null)?.cardId)}`)
  if ('clear' in change) return
  if (typeof change.enabled !== 'boolean') bad(`${change.cardId}: enabled must be true or false`)
  if (!isInt(change.weight) || change.weight < 0 || change.weight > 100) bad(`${change.cardId}: the weight must be a whole number from 0 to 100`)
  for (const key of ['startsAt', 'endsAt'] as const) {
    const v = change[key]
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) bad(`${change.cardId}: ${key} must be a time or null`)
  }
  if (change.startsAt !== null && change.endsAt !== null && change.endsAt <= change.startsAt) bad(`${change.cardId}: the window must end after it starts`)
}

export function createChaosService(deps: ChaosServiceDeps): ChaosService {
  const { db, catalogue, timezone } = deps
  const now = deps.now ?? Date.now
  const known: ReadonlySet<string> = new Set(catalogue.map((c) => c.id))

  async function active(nowMs: number = now()): ReturnType<ChaosService['active']> {
    const on = activeAt(catalogue, await readRules(db), nowMs)
    const cards: ChaosCardDef[] = []
    const weights = new Map<string, number>()
    for (const { def, weight } of on.values()) {
      // `enabled: true` because that is what the card is now: the draw (`cardWeight`) skips a card whose own flag is off.
      cards.push({ ...def, enabled: true })
      weights.set(def.id, weight)
    }
    return { cards, weights }
  }

  // `generation` moves on every drop: a read that started under an older generation answers its caller but stores nothing,
  // so a read racing a GM's save cannot put the old settings back in the cache.
  let cached: { value: ChaosConfig; at: number } | null = null
  let generation = 0
  const dropConfig = (): void => {
    cached = null
    generation += 1
  }
  const copy = (c: ChaosConfig): ChaosConfig => ({ ...c, tierWeights: { ...c.tierWeights } })

  return {
    active,

    async config() {
      const at = now()
      if (cached && at - cached.at >= 0 && at - cached.at < CONFIG_CACHE_MS) return copy(cached.value)
      const gen = generation
      const value = await readConfig(db)
      if (gen === generation) cached = { value: copy(value), at }
      return value
    },

    forgetConfig: dropConfig,

    async rules(nowMs = now()) {
      const rules = await readRules(db)
      const on = activeAt(catalogue, rules, nowMs)
      return catalogue.map((def): GmChaosCard => {
        const rule = rules.get(def.id)
        return {
          id: def.id,
          tier: def.tier,
          family: def.family,
          effect: def.effect,
          modes: def.modes,
          fileEnabled: def.enabled,
          rule: rule === undefined ? null : { enabled: rule.enabled, weight: rule.weight, startsAt: rule.startsAt?.getTime() ?? null, endsAt: rule.endsAt?.getTime() ?? null },
          activeNow: on.has(def.id),
        }
      })
    },

    async setRules(tx, changes, updatedBy) {
      for (const change of changes) checkChange(known, change)
      for (const change of changes) {
        if ('clear' in change) {
          await tx.delete(chaosCardRules).where(eq(chaosCardRules.cardId, change.cardId))
          continue
        }
        const values = {
          enabled: change.enabled,
          weight: change.weight,
          startsAt: change.startsAt === null ? null : new Date(change.startsAt),
          endsAt: change.endsAt === null ? null : new Date(change.endsAt),
          updatedBy,
          updatedAt: new Date(now()),
        }
        await tx.insert(chaosCardRules).values({ cardId: change.cardId, ...values }).onConflictDoUpdate({ target: chaosCardRules.cardId, set: values })
      }
      // Judged on the rows as they now stand in this transaction, at the moment of the edit and at every later moment a
      // window opens or closes (ledger ruling, Plan 37 final wave): between two of those the active set cannot change, so
      // no season edited today can leave a tier short next month either (spec §6.2).
      const rules = await readRules(tx)
      const at = now()
      const moments = new Set<number>([at])
      for (const rule of rules.values()) {
        for (const edge of [rule.startsAt, rule.endsAt]) if (edge !== null && edge.getTime() > at) moments.add(edge.getTime())
      }
      for (const moment of [...moments].sort((a, b) => a - b)) {
        const short = tierShortfall(activeAt(catalogue, rules, moment))
        if (short === null) continue
        const when = moment === at ? '' : ` from ${new Date(moment).toISOString()}`
        throw new ServiceError('INVALID_CHAOS_RULES', `${short}${when}`)
      }
    },

    async setConfig(tx, config, updatedBy) {
      const bad = (why: string): never => {
        throw new ServiceError('INVALID_CHAOS_CONFIG', why)
      }
      const tw = (config as Partial<ChaosConfig> | null)?.tierWeights
      if (typeof tw !== 'object' || tw === null) return bad('tierWeights is missing')
      for (const tier of CHAOS_TIERS) if (!isInt(tw[tier]) || tw[tier] < 0) bad(`the ${tier} weight must be a whole number of 0 or more`)
      if (tw.silver + tw.gold + tw.diamond <= 0) bad('the tier weights must add up to more than 0')
      for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
        const [min, max] = LIMITS[key]
        const v: unknown = config[key]
        if (!isInt(v) || v < min || v > max) bad(`${key} must be a whole number from ${String(min)} to ${String(max)}`)
      }
      const value: ChaosConfig = {
        tierWeights: { silver: tw.silver, gold: tw.gold, diamond: tw.diamond },
        pointsThreshold: config.pointsThreshold,
        draftMs: config.draftMs,
        resultMs: config.resultMs,
        dailyCapPoints: config.dailyCapPoints,
        dailyRescues: config.dailyRescues,
      }
      const set = { value, updatedBy, updatedAt: new Date(now()) }
      // Dropped before and after the write: a rolled-back save costs one fresh read, never a stale answer.
      dropConfig()
      await tx.insert(chaosConfig).values({ key: CHAOS_CONFIG_KEY, ...set }).onConflictDoUpdate({ target: chaosConfig.key, set })
      dropConfig()
    },

    async credit({ playerId, amount, reason, key }) {
      if (!CREDIT_REASONS.includes(reason)) throw new ServiceError('INVALID_CHAOS_REASON', `not a chaos credit: ${String(reason)}`)
      if (!Number.isInteger(amount) || amount <= 0) return { credited: 0, capped: false }
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = now()
      const today = dayKey(nowMs, timezone)
      const from = new Date(dayStartMs(today, timezone))
      const to = new Date(nextDayStartMs(nowMs, timezone))

      return db.transaction(async (tx) => {
        // The lock first: two credits of one player (a Bạo kích and a Thần tài of the same hand, or of two tables) read
        // the day's total one after the other, so neither can spend what the other has just taken.
        const locked = rowsOf<{ id: string }>(await tx.execute(sql`select id from players where id = ${playerId}::uuid for update`))
        if (locked.length === 0) throw new UnknownPlayerError(playerId)

        const claimed = await tx.insert(ledgerKeys).values({ key }).onConflictDoNothing().returning({ key: ledgerKeys.key })
        if (claimed.length === 0) {
          // A replay (the room retries a credit whose answer it lost): nothing is written, and the amount that was is returned.
          const [written] = await tx
            .select({ amount: pointTransactions.amount })
            .from(pointTransactions)
            .where(and(eq(pointTransactions.playerId, playerId), eq(pointTransactions.reason, reason), eq(pointTransactions.refId, key)))
          const credited = Number(written?.amount ?? 0)
          return { credited, capped: credited < amount }
        }

        const config = await readConfig(tx)
        const [sums] = rowsOf<{ paid: string | number; rescues: string | number }>(
          await tx.execute(sql`
            select coalesce(sum(amount), 0) as paid, count(*) filter (where reason = 'chaos_rescue') as rescues
            from ${pointTransactions}
            where player_id = ${playerId}::uuid
              and reason in ('chaos_rescue', 'chaos_crit', 'chaos_fortune', 'chaos_jackpot')
              and created_at >= ${from} and created_at < ${to}`),
        )
        const paid = Number(sums?.paid ?? 0)
        const rescued = Number(sums?.rescues ?? 0)
        const allowed = reason === 'chaos_rescue' && rescued >= config.dailyRescues ? 0 : Math.max(0, config.dailyCapPoints - paid)
        const credited = Math.min(amount, allowed)
        if (credited > 0) {
          await creditWithin(tx, [
            { playerId, delta: credited, reason, refId: key },
            { playerId, delta: -credited, reason: 'chaos_to_table', refId: key },
          ])
        }
        return { credited, capped: credited < amount }
      })
    },
  }
}
