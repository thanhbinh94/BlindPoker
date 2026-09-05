import type { RoomPlayerView } from '@bp/core'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type { PlayerAvatarDto } from '../api.js'
import { Avatar } from '../avatar/Avatar.js'
import { BOT_MARK } from '../avatar/parts.js'
import a from '../avatar/avatar.module.css'

/**
 * What the Normal edition hangs on the kit's seat plates: a face, and one quiet line under the name.
 *
 * `PokerTable` takes both as functions of a `RoomPlayerView` rather than as data, so this module is two
 * factories over an already-fetched cache. Neither of them may fetch: they run inside the table's render,
 * once per seat, on every card that turns.
 */

/** The glyph and rarity for each badge in `apps/normal-server/data/items.json`. */
const BADGES: Record<string, { glyph: string; rarity: 'common' | 'rare' | 'epic' }> = {
  badge_bronze: { glyph: '●', rarity: 'common' },
  badge_silver: { glyph: '◆', rarity: 'common' },
  badge_gold: { glyph: '★', rarity: 'rare' },
  badge_monthly: { glyph: '✦', rarity: 'rare' },
  badge_veteran: { glyph: '✪', rarity: 'epic' },
}

/** An id this bundle does not know yet still earns a mark, the way an unknown `assetKey` still draws a face. */
const UNKNOWN_BADGE = { glyph: '●', rarity: 'common' } as const

export type AvatarCache = Map<string, PlayerAvatarDto | null>

/**
 * The seat's face.
 *
 * A bot gets a mark rather than an avatar and — the point of the branch — is never looked up: bots have no
 * account, so `GET /api/players/<botId>/avatar` is a 404 for every bot at every table, forever. A human whose
 * avatar has not arrived (or has none) gets the neutral silhouette, which is also what the kit's own initial
 * disc would have shown.
 */
export function makeAvatarFor(avatars: AvatarCache): (player: RoomPlayerView) => ReactNode {
  return (player) => {
    if (player.isBot) {
      return (
        <svg className={a.avatar} data-size="sm" data-avatar="bot" viewBox="0 0 64 64" role="img" aria-hidden="true">
          {BOT_MARK}
        </svg>
      )
    }
    return <Avatar config={avatars.get(player.playerId)?.avatar ?? null} size="sm" />
  }
}

/**
 * The seat's caption: the equipped title, and a glyph for the equipped badge.
 *
 * `Seat` gives this one truncated line under the name and hides it entirely on a crowded table, so it says
 * only what a player chose to say about themselves. Nothing equipped means nothing rendered — `undefined`,
 * not an empty span, so the plate keeps its two-line shape.
 */
export function makeCaptionFor(avatars: AvatarCache, t: TFunction<'normal'>): (player: RoomPlayerView) => ReactNode {
  return (player) => {
    if (player.isBot) return null
    const config = avatars.get(player.playerId)?.avatar
    if (config === undefined) return null

    // One narrowing, not two: `mark` exists exactly when a badge is equipped, and it carries the id along so
    // the name can be looked up without re-proving that the id is there.
    const mark =
      config.badge === undefined ? null : { id: config.badge, ...(BADGES[config.badge] ?? UNKNOWN_BADGE) }

    // An item this bundle has no words for is dropped rather than printed as its own i18n key: the server can
    // publish an item before the browser bundle that names it, and `items.title_from_the_future` under a
    // player's name is worse than no title at all. (`Avatar` skips an unknown `assetKey` for the same reason.)
    const title = config.title === undefined ? '' : t(`items.${config.title}`, { defaultValue: '' })
    const markName = mark === null ? '' : t(`items.${mark.id}`, { defaultValue: '' })

    if (mark === null && title === '') return null

    // `role="img"` is what makes `aria-label` a name at all — a bare `<span>` has no role, so a screen reader
    // would announce the glyph itself ("black star") and `title` would never be promoted to a name. An
    // unnameable badge is hidden instead: an unnamed `role="img"` is worse than no image, and it is the same
    // call `Avatar` makes when it is given no label.
    const naming = markName === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': markName, title: markName }

    return (
      <span className={a.caption}>
        {mark === null ? null : (
          <span className={a.badge} data-rarity={mark.rarity} {...naming}>
            {mark.glyph}
          </span>
        )}
        {title === '' ? null : <span className={a.title}>{title}</span>}
      </span>
    )
  }
}
