import { dailyRewardPoints, ECONOMY } from '@bp/core'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Renders `nowMs` as the calendar day ('YYYY-MM-DD') it falls on in `timeZone`. */
export function dayKey(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}

interface DayParts {
  y: number
  m: number
  d: number
}

/** `key` is always a well-formed 'YYYY-MM-DD' produced by `dayKey` (or a caller matching that shape). */
function parseDayKey(key: string): DayParts {
  const parts = key.split('-')
  return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) }
}

function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

function addDaysKey(key: string, delta: number): string {
  const p = parseDayKey(key)
  const iso = new Date(Date.UTC(p.y, p.m - 1, p.d + delta)).toISOString()
  return iso.slice(0, 10)
}

/** Calendar days from `a` to `b` (positive when `b` is later), via UTC arithmetic on the parsed keys. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDayKey(a)
  const pb = parseDayKey(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / MS_PER_DAY)
}

export interface DailyClaimResult {
  allowed: boolean
  alreadyClaimed: boolean
  day: number
  points: number
  nextDay: number
  nextPoints: number
  streak: number
  lastClaim: string | null
}

/** What claiming on the calendar day after `baseDay` would look like, continuing from `streakAtBase`. */
function previewNext(baseDay: string, streakAtBase: number): { nextDay: number; nextPoints: number } {
  const tomorrow = addDaysKey(baseDay, 1)
  const tomorrowStreak = sameMonth(tomorrow, baseDay) ? streakAtBase + 1 : 1
  const nextDay = Math.min(tomorrowStreak, 31)
  return { nextDay, nextPoints: dailyRewardPoints(nextDay) }
}

/**
 * Evaluates the daily-reward claim for `nowMs` against a player's stored streak state (spec §13.1).
 *
 * A claim is allowed once per calendar day in `timeZone`. The streak continues (+1) only when the
 * previous claim was exactly yesterday *and* still in the same calendar month as today — a claim on
 * the 1st of a new month always restarts the streak at 1, even if it is otherwise consecutive. The
 * reward tier is the streak day capped at 31 (`dailyRewardPoints`); days 29–31 share day 29's value.
 */
export function evaluateDaily(record: { streak: number; lastDailyClaim: string | null }, nowMs: number, timeZone: string): DailyClaimResult {
  const today = dayKey(nowMs, timeZone)
  const { streak, lastDailyClaim } = record

  if (lastDailyClaim === today) {
    const { nextDay, nextPoints } = previewNext(today, streak)
    return { allowed: false, alreadyClaimed: true, day: streak, points: 0, nextDay, nextPoints, streak, lastClaim: lastDailyClaim }
  }

  const consecutive = lastDailyClaim !== null && daysBetween(lastDailyClaim, today) === 1 && sameMonth(today, lastDailyClaim)
  const newStreak = consecutive ? streak + 1 : 1
  const day = Math.min(newStreak, 31)
  const points = dailyRewardPoints(day)
  const { nextDay, nextPoints } = previewNext(today, newStreak)

  return { allowed: true, alreadyClaimed: false, day, points, nextDay, nextPoints, streak: newStreak, lastClaim: lastDailyClaim }
}

/**
 * Relief eligibility (spec §12.4): a balance below `ECONOMY.reliefThreshold` may be topped up once
 * every `ECONOMY.reliefCooldownHours` hours. `lastReliefAt === null` means relief has never been
 * granted, so the cooldown never applies.
 */
export function reliefEligible(balance: number, lastReliefAt: number | null, nowMs: number): { eligible: boolean; reason: 'ok' | 'balance' | 'cooldown'; retryAt: number | null } {
  if (balance >= ECONOMY.reliefThreshold) return { eligible: false, reason: 'balance', retryAt: null }

  if (lastReliefAt !== null) {
    const retryAt = lastReliefAt + ECONOMY.reliefCooldownHours * 60 * 60 * 1000
    if (nowMs < retryAt) return { eligible: false, reason: 'cooldown', retryAt }
  }

  return { eligible: true, reason: 'ok', retryAt: null }
}
