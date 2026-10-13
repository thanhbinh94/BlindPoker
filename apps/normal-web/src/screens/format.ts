import { formatPoints, type Language } from '@bp/ui-kit'

/**
 * What the account screens print: a date, a signed amount, and a month the server names. The dates are the kit's —
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

/**
 * A month key from the server (`YYYY-MM`, the economy timezone's month) as a player reads it: `11/2026`. Not `Intl`:
 * there is no instant to format, only a label, and both languages write it the same way (spec 2026-10-12 §5.2).
 */
export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-')
  return `${month ?? ''}/${year ?? ''}`
}
