import { formatPoints, type Language } from '@bp/ui-kit'

/**
 * The two things every account screen has to print: a date, and a signed amount. The dates are the kit's —
 * `formatDay` and `formatMoment` live in `@bp/ui-kit` so both editions spell a date the same way — and are
 * re-exported here so the screens keep one import.
 */
export { formatDay, formatMoment } from '@bp/ui-kit'

/**
 * A movement, with its direction in front of it.
 *
 * `Intl` already writes the minus, so only the plus has to be added — and it does have to be: a ledger where
 * a credit and a debit differ by a character the reader has to go looking for is a ledger nobody trusts.
 */
export function formatSigned(amount: number, lang: Language): string {
  return `${amount > 0 ? '+' : ''}${formatPoints(amount, lang)}`
}
