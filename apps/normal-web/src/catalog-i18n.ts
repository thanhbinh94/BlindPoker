import type { TFunction } from 'i18next'

/**
 * Names for catalogue rows the bundle may not know about.
 *
 * The server publishes the item and achievement catalogues; this bundle ships the names for them. The two
 * artefacts are deployed separately, so a browser holding yesterday's bundle (or a CDN/service-worker copy of
 * it) will meet ids it has no key for — and i18next's answer to a missing key is to print the key, so a
 * wardrobe tile would read `items.hat_lunar_2027` and a screen reader would announce
 * `achievements.hand_royal_flush.name`.
 *
 * Every `items.<id>` / `achievements.<id>.*` lookup in this app goes through here so that never happens. The
 * id is the fallback: it is not a name, but it is a *thing the player and a bug report can both point at*.
 */

/**
 * The name of a catalogue item.
 *
 * `fallback` defaults to the id. Callers that draw the name as decoration — the seat caption's title and
 * badge, where an unnamed mark is worse than no mark — pass `''` and drop the element instead.
 */
export function itemName(id: string, t: TFunction, fallback: string = id): string {
  return t(`items.${id}`, { defaultValue: fallback })
}

/** The name of an achievement. */
export function achievementName(id: string, t: TFunction): string {
  return t(`achievements.${id}.name`, { defaultValue: id })
}

/**
 * The one-line description under an achievement's name.
 *
 * It falls back to nothing rather than to the id: the name above it already carries the id in that case, and
 * a second copy of the same string would read as a description that happens to repeat the title.
 */
export function achievementDesc(id: string, t: TFunction): string {
  return t(`achievements.${id}.desc`, { defaultValue: '' })
}
