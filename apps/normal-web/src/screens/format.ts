import { formatPoints, type Language } from '@bp/ui-kit'

/**
 * The two things every account screen has to print and the kit does not: a date, and a signed amount.
 *
 * Dates go through `Intl` with the *language's* locale rather than the device's, because the language is a
 * deliberate choice a player made in this app and the device's is not — a Vietnamese player on an en-US phone
 * asked for `vi`, and 5/9 versus 9/5 is exactly the kind of thing that choice is about.
 */
const LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-US' }

/** Day and time — a hand, a ledger row: things that happened at a moment. */
export function formatMoment(at: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at))
}

/** The day alone — "member since", "acquired", "unlocked": things a clock reading would only clutter. */
export function formatDay(at: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium' }).format(new Date(at))
}

/**
 * A movement, with its direction in front of it.
 *
 * `Intl` already writes the minus, so only the plus has to be added — and it does have to be: a ledger where
 * a credit and a debit differ by a character the reader has to go looking for is a ledger nobody trusts.
 */
export function formatSigned(amount: number, lang: Language): string {
  return `${amount > 0 ? '+' : ''}${formatPoints(amount, lang)}`
}
