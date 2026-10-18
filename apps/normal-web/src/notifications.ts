import type { ClientNotification, Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { achievementName, itemName } from './catalog-i18n.js'
import { formatSigned } from './screens/format.js'

/** The one notification kind whose payload names something this edition has a name for. */
export const ACHIEVEMENT_UNLOCKED = 'ACHIEVEMENT_UNLOCKED'

/**
 * A game master did something to this player's account (spec 2026-10-18 §5). The payload is
 * `{ action, reason, amount?, itemId? }`, and the kit's string is only `Quản trị viên: {{reason}}` — it knows
 * neither what a point is worth in this language nor what an item is called, so this app writes both into the
 * `reason` the kit prints.
 */
export const GM_NOTICE = 'GM_NOTICE'

/**
 * The kit's `notify.ACHIEVEMENT_UNLOCKED` string interpolates `{{id}}`, and `Toasts` fills it from the
 * payload's `id` field — which the server sends as the achievement's *id* (`login_days_7`). The kit cannot
 * translate that: achievement names live in this app's `normal` namespace, which the kit knows nothing about.
 */
interface AchievementPayload {
  id: string
}

function payloadId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('id' in payload)) return null
  const { id } = payload as { id: unknown }
  return typeof id === 'string' ? id : null
}

/** What a `GM_NOTICE` carries that this app rewrites; every field is untrusted until it has been checked. */
function gmFields(payload: unknown): { action: string | null; reason: string | null; amount: number | null; itemId: string | null } {
  const bag = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const text = (key: string): string | null => (typeof bag[key] === 'string' ? (bag[key] as string) : null)
  return {
    action: text('action'),
    reason: text('reason'),
    amount: typeof bag.amount === 'number' && Number.isFinite(bag.amount) ? bag.amount : null,
    itemId: text('itemId'),
  }
}

/**
 * A GM's notice with the reason the player should read: `+12.000 điểm — thưởng` for points, `Mũ vương miện — tặng`
 * for an item. Any other action (a lock, a kick, a promotion) says only what the GM wrote, so it comes back
 * unchanged — and so does a points notice that lost its amount, because "0 điểm" would be a lie.
 */
function gmNoticeText(n: ClientNotification, t: TFunction, lang: Language): ClientNotification {
  const { action, reason, amount, itemId } = gmFields(n.payload)
  if (reason === null) return n
  let written: string | null = null
  if ((action === 'grant_points' || action === 'adjust_points') && amount !== null) {
    written = t('gm.notice.points', { amount: formatSigned(amount, lang), reason })
  } else if (action === 'grant_item' && itemId !== null) {
    written = t('gm.notice.item', { item: itemName(itemId, t), reason })
  }
  return written === null ? n : { ...n, payload: { ...(n.payload as object), reason: written } }
}

/**
 * The notification list as the player should read it: `payload.id` replaced by the achievement's name, and a
 * game master's notice given the amount or the item it is about.
 *
 * Rewriting the payload rather than the rendered string is what keeps this out of the kit: `Toasts` still owns
 * the sentence, the icon and the dismissal timer, and this app only supplies the words the kit could not
 * have known. An id the bundle has no name for falls back to the id itself, so a server-side addition reads as
 * something rather than as an empty gap.
 *
 * The array's identity is preserved when there is nothing to rewrite, so the common case — no achievement or
 * GM notice in the stack — hands `Toasts` the very same list and re-renders nothing.
 */
export function mapNotifications(notifications: ClientNotification[], t: TFunction, lang: Language): ClientNotification[] {
  const rewritable = (n: ClientNotification): boolean =>
    (n.kind === ACHIEVEMENT_UNLOCKED && payloadId(n.payload) !== null) || n.kind === GM_NOTICE
  if (!notifications.some(rewritable)) return notifications
  return notifications.map((n) => {
    if (n.kind === GM_NOTICE) return gmNoticeText(n, t, lang)
    const id = n.kind === ACHIEVEMENT_UNLOCKED ? payloadId(n.payload) : null
    if (id === null) return n
    const named: AchievementPayload = { id: achievementName(id, t) }
    return { ...n, payload: { ...(n.payload as object), ...named } }
  })
}
