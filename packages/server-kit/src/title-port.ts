import type { EntranceTitle } from '@bp/core'

/**
 * What a room needs from its edition to herald a Thần title (BP-42): the title a player has equipped. Normal backs it with the
 * wardrobe; Lite has none, so a server without a port announces nobody.
 */
export interface TitlePort {
  /** The Thần title the player wears now, or `null` for none (another title, or nothing equipped). A lookup, never a ledger write. */
  equippedTitle(playerId: string): Promise<EntranceTitle | null>
}
