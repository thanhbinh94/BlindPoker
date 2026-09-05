import type { TFunction } from 'i18next'
import { ApiError, NETWORK_ERROR_CODE } from '../api.js'

/**
 * How every screen turns a rejected request into a sentence.
 *
 * It lives here rather than on the sign-in card because it is not about signing in: the profile's rename, the
 * wardrobe's save, the daily claim and the relief claim all print refusals, and each one importing
 * `AuthScreen.js` for a string formatter would tie every route's chunk to the one screen a signed-in player
 * never sees. The strings still sit under `auth.errors.*` — that is where the server's shared codes are named,
 * and moving them would be a locale churn for no reader's benefit.
 */

/** Refusals this app has words for; anything else falls back to the kit's generic error. */
export const KNOWN_CODES = new Set([
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'INVALID_NAME',
  'EMAIL_TAKEN',
  'DISPLAY_NAME_TAKEN',
  'BAD_CREDENTIALS',
  'RATE_LIMITED',
  'FORBIDDEN',
])

/**
 * A refusal in the player's language.
 *
 * `RATE_LIMITED` is the one code that carries a number: the server puts `retryAfterSec` beside the envelope,
 * `ApiError` keeps it, and the message says how long rather than merely that it was too often. The fallback
 * when the server sent no number is one minute, which is the width of every limiter's window (§19.2).
 */
export function refusalText(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError) {
    if (cause.code === NETWORK_ERROR_CODE) return t('auth.errors.NETWORK')
    if (cause.code === 'RATE_LIMITED') return t('auth.errors.RATE_LIMITED', { seconds: cause.retryAfterSec ?? 60 })
    if (KNOWN_CODES.has(cause.code)) return t(`auth.errors.${cause.code}`)
  }
  return t('common:errors.INTERNAL')
}
