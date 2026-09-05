import type { ClientNotification } from '@bp/ui-kit'
import type { TFunction } from 'i18next'

/** The one notification kind whose payload names something this edition has a name for. */
export const ACHIEVEMENT_UNLOCKED = 'ACHIEVEMENT_UNLOCKED'

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

/**
 * The notification list as the player should read it: `payload.id` replaced by the achievement's name.
 *
 * Rewriting the payload rather than the rendered string is what keeps this out of the kit: `Toasts` still owns
 * the sentence, the icon and the dismissal timer, and this app only supplies the one word the kit could not
 * have known. An id the bundle has no name for falls back to the id itself, so a server-side addition reads as
 * something rather than as an empty gap.
 *
 * The array's identity is preserved when there is nothing to rewrite, so the common case — no achievement in
 * the stack — hands `Toasts` the very same list and re-renders nothing.
 */
export function mapNotifications(notifications: ClientNotification[], t: TFunction): ClientNotification[] {
  if (!notifications.some((n) => n.kind === ACHIEVEMENT_UNLOCKED && payloadId(n.payload) !== null)) return notifications
  return notifications.map((n) => {
    const id = n.kind === ACHIEVEMENT_UNLOCKED ? payloadId(n.payload) : null
    if (id === null) return n
    const named: AchievementPayload = { id: t(`achievements.${id}.name`, { defaultValue: id }) }
    return { ...n, payload: { ...(n.payload as object), ...named } }
  })
}
