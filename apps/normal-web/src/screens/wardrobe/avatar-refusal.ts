import type { TFunction } from 'i18next'
import { ApiError } from '../../api.js'

/** Refusals of an avatar write that the app has words for; anything else is the kit's generic failure. */
const KNOWN_CODES = new Set(['NOT_OWNED', 'WRONG_CATEGORY', 'MISSING_LAYER', 'INVALID_ITEM', 'INVALID_BASE', 'WRONG_GENDER'])

/**
 * The words for a refused `PUT /api/me/avatar`. Its own module (Plan 27 fix wave) because the wardrobe's save and the
 * shop's "Mặc luôn" both need it, and the shop importing it from `WardrobeScreen` tied the two lazy chunks together.
 */
export function avatarRefusal(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && KNOWN_CODES.has(cause.code)) return t(`avatar.errors.${cause.code}`)
  return t('common:errors.INTERNAL')
}
