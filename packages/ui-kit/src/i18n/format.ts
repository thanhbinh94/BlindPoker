import type { Language } from './index.js'

const LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-US' }

export function formatPoints(n: number, lang: Language): string {
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(n)
}

export function formatCompactPoints(n: number, lang: Language): string {
  const abs = Math.abs(n)
  if (abs < 1000) return formatPoints(n, lang)
  const [value, suffix] = abs >= 1_000_000 ? [n / 1_000_000, 'M'] : [n / 1000, 'K']
  const digits = Number.isInteger(value) ? 0 : 1
  return `${new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)}${suffix}`
}

/**
 * Dates go through `Intl` with the *language's* locale rather than the device's, because the language is a
 * deliberate choice a player made in this app and the device's is not — a Vietnamese player on an en-US phone
 * asked for `vi`, and 5/9 versus 9/5 is exactly the kind of thing that choice is about.
 */

/** The day alone — "member since", "acquired", "unlocked": things a clock reading would only clutter. */
export function formatDay(at: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium' }).format(new Date(at))
}

/**
 * Day and time — a hand, a ledger row, the next reset: things that happen at a moment. The clock first, then
 * the day in the same words `formatDay` uses — "08:46, 28 thg 9" / "08:46 AM, Sep 28" — with the year only when
 * it is not this one (layout audit C2, 2026-09-28: both editions used to print "28/9/26 08:46" beside
 * "28 thg 9, 2026", two spellings of one date on neighbouring screens).
 */
export function formatMoment(at: number, lang: Language, now: number = Date.now()): string {
  const date = new Date(at)
  const time = new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit' }).format(date)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const day = new Intl.DateTimeFormat(LOCALE[lang], sameYear ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium' }).format(date)
  return `${time}, ${day}`
}
