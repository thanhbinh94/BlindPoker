/**
 * The pure half of the economy: calendar arithmetic, the daily-reward schedule, relief eligibility.
 *
 * Nothing here touches a database or a clock it was not handed, so every rule of spec §13.1 is
 * decidable in a unit test from three strings and a number. `economy-service.ts` is then only
 * responsible for locking a row, writing what these functions decided, and telling the rest of the
 * server about it.
 *
 * The day-key approach is the one Lite already uses (`apps/lite/server/src/economy/daily.ts`),
 * reproduced rather than imported: the two editions must not depend on each other, and §13.3 has
 * them diverging on purpose — Lite pays the points column only, Normal also hands out cosmetics.
 */
import { dailyRewardPoints, ECONOMY } from '@bp/core'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** §13.1: a streak may not exceed the longest month, and days 29–31 all pay day 29's points. */
export const MAX_STREAK = 31

/** §13.2: what a day whose cosmetic tier has nothing unowned left pays instead. */
export const NO_ITEM_FALLBACK_POINTS = 10_000

/** §13.2, day 28: granted outright rather than drawn, so this pair is a promise the catalogue must keep. */
export const DAILY_FIXED_ITEM_IDS = ['badge_monthly', 'title_devoted'] as const

/** Renders `nowMs` as the calendar day (`YYYY-MM-DD`) it falls on in `timeZone`. */
export function dayKey(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}

/** The `YYYY-MM` of `nowMs` in `timeZone` — the key the monthly streak reset is decided on. */
export function monthKey(nowMs: number, timeZone: string): string {
  return dayKey(nowMs, timeZone).slice(0, 7)
}

/** The month prefix of a day key produced by `dayKey` (or any caller matching that shape). */
export function monthOfDayKey(key: string): string {
  return key.slice(0, 7)
}

interface DayParts {
  y: number
  m: number
  d: number
}

function parseDayKey(key: string): DayParts {
  const parts = key.split('-')
  return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) }
}

/** Calendar days from `a` to `b` (positive when `b` is later), via UTC arithmetic on the parsed keys. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDayKey(a)
  const pb = parseDayKey(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / MS_PER_DAY)
}

/** `key` shifted by whole calendar days, still as `YYYY-MM-DD`. */
export function addDaysKey(key: string, delta: number): string {
  const p = parseDayKey(key)
  return new Date(Date.UTC(p.y, p.m - 1, p.d + delta)).toISOString().slice(0, 10)
}

const OFFSET_FIELDS = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } as const

/**
 * How far `timeZone` is ahead of UTC at that instant, in milliseconds (positive east of Greenwich).
 *
 * Read out of `Intl` rather than from a table: the zone name comes from `ECONOMY_TIMEZONE`, an
 * operator-supplied string, and the only component that knows its rules — including the year the
 * offset last changed — is the one already formatting the day keys.
 */
function zoneOffsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', ...OFFSET_FIELDS }).formatToParts(new Date(atMs))
  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // `h23` should already give 0 for midnight, but an older ICU can still say 24; folding it here
  // costs nothing and turns a wrong-by-a-day answer into a right one.
  const hour = field('hour') % 24
  const asIfUtc = Date.UTC(field('year'), field('month') - 1, field('day'), hour, field('minute'), field('second'))
  return asIfUtc - Math.floor(atMs / 1000) * 1000
}

/**
 * The instant the next local day begins — what the client counts down to.
 *
 * The offset is read twice: once at `nowMs` to place the boundary, then again *at that boundary* in
 * case a DST transition falls between the two, which would otherwise put the answer an hour out.
 * (`Asia/Ho_Chi_Minh`, the default, has no DST at all — this is for the operator who sets something
 * that does.)
 */
export function nextDayStartMs(nowMs: number, timeZone: string): number {
  const tomorrowUtc = Date.parse(`${addDaysKey(dayKey(nowMs, timeZone), 1)}T00:00:00Z`)
  const first = tomorrowUtc - zoneOffsetMs(nowMs, timeZone)
  return tomorrowUtc - zoneOffsetMs(first, timeZone)
}

/** The stored half of a player's check-in state — the `daily_logins` row, as the rules see it. */
export interface DailyState {
  streak: number
  /** `YYYY-MM-DD` in the economy timezone; null before the first ever claim. */
  lastClaimDate: string | null
}

export interface StreakOutcome {
  /** True when `lastClaimDate` is already today: there is nothing to claim. */
  alreadyClaimed: boolean
  /** The streak after this claim (or the current one, when already claimed). */
  streak: number
  /** The reward tier, i.e. the streak capped at 31. */
  day: number
  /** `dailyRewardPoints(day)`. */
  points: number
}

/**
 * §13.1, in one function: yesterday → +1, today → already claimed, anything else → 1; and a claim
 * whose month differs from the previous claim's always restarts at 1, even when it is otherwise
 * consecutive (the 1st of a month is always streak 1).
 */
export function nextStreak(state: DailyState, todayKey: string): StreakOutcome {
  const { streak, lastClaimDate } = state

  if (lastClaimDate === todayKey) {
    const day = Math.min(Math.max(streak, 1), MAX_STREAK)
    return { alreadyClaimed: true, streak, day, points: dailyRewardPoints(day) }
  }

  const consecutive =
    lastClaimDate !== null && daysBetween(lastClaimDate, todayKey) === 1 && monthOfDayKey(lastClaimDate) === monthOfDayKey(todayKey)
  // The cap is defensive rather than reachable: a month has at most 31 days and a new month resets
  // the streak, so `streak + 1` can only exceed 31 if a stored row already did.
  const next = Math.min(consecutive ? streak + 1 : 1, MAX_STREAK)
  return { alreadyClaimed: false, streak: next, day: next, points: dailyRewardPoints(next) }
}

/** The points for a reward tier. Days beyond 31 fold to 31 — see `dailyRewardPoints`. */
export function rewardForDay(day: number): number {
  return dailyRewardPoints(day)
}

export type DailyItemRule =
  | { kind: 'randomUnowned'; rarity: 'common' }
  | { kind: 'randomUnowned'; rarity: 'rare' }
  | { kind: 'fixed'; itemIds: readonly string[] }

/** §13.2's item column: day 7 a common, days 14 and 21 a rare, day 28 the month's badge and title. */
export function itemRuleForDay(day: number): DailyItemRule | null {
  if (day === 7) return { kind: 'randomUnowned', rarity: 'common' }
  if (day === 14 || day === 21) return { kind: 'randomUnowned', rarity: 'rare' }
  if (day === 28) return { kind: 'fixed', itemIds: DAILY_FIXED_ITEM_IDS }
  return null
}

/**
 * The calendar's item column as a label, for a client drawing the 31-day grid.
 *
 * A random tier cannot name its item in advance — that is decided against the player's inventory at
 * the moment of the claim — so what a day advertises is the *rarity* it will draw; day 28, which
 * draws nothing, advertises the badge by id.
 */
export function itemMarkerForDay(day: number): string | null {
  const rule = itemRuleForDay(day)
  if (rule === null) return null
  return rule.kind === 'fixed' ? (rule.itemIds[0] ?? null) : rule.rarity
}

export interface CalendarEntry {
  day: number
  points: number
  item: string | null
}

/** The whole month's schedule, days 1…31 — constant, and the same for every player. */
export function dailyCalendar(): CalendarEntry[] {
  return Array.from({ length: MAX_STREAK }, (_, i) => {
    const day = i + 1
    return { day, points: rewardForDay(day), item: itemMarkerForDay(day) }
  })
}

export type ReliefRefusal = 'balance' | 'cooldown'

export interface ReliefOutcome {
  eligible: boolean
  reason: ReliefRefusal | null
  /** When a cooldown is what refused, the instant it lifts; null otherwise. */
  retryAt: number | null
}

/**
 * §12.4: a balance *below* `reliefThreshold` may be topped up to `reliefTarget`, once every
 * `reliefCooldownHours`. A player who has never claimed has no cooldown to serve.
 *
 * `reason: 'balance'` for a player who is not poor enough is deliberate rather than an odd name for
 * "not eligible": the two refusals are answered differently by the client — one is "you still have
 * points", the other "come back at `retryAt`".
 */
export function reliefEligible(balance: number, lastReliefAtMs: number | null, nowMs: number): ReliefOutcome {
  if (balance >= ECONOMY.reliefThreshold) return { eligible: false, reason: 'balance', retryAt: null }
  if (lastReliefAtMs !== null) {
    const retryAt = lastReliefAtMs + ECONOMY.reliefCooldownHours * 60 * 60 * 1000
    if (nowMs < retryAt) return { eligible: false, reason: 'cooldown', retryAt }
  }
  return { eligible: true, reason: null, retryAt: null }
}
