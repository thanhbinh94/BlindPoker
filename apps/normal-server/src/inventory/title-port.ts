/**
 * The Normal edition's `TitlePort` (server-kit): what a room asks of its edition when a human sits down, answered by
 * the equipped title on the player's row (BP-42). Only the three Thần titles (BP-41) are heralded; any other title, no
 * title, or a player who is gone answers `null`. The room calls this off its queue, so a slow or failing read never holds
 * up a sit.
 */
import type { EntranceTitle } from '@bp/core'
import type { TitlePort } from '@bp/server-kit'
import type { NormalPlayerRepository } from '../repos/player-repo.js'

const ENTRANCE_TITLES: Readonly<Record<string, EntranceTitle>> = {
  title_god: 'god',
  title_demigod: 'demigod',
  title_godslayer: 'godslayer',
}

export function createTitlePort(players: Pick<NormalPlayerRepository, 'findByIdFull'>): TitlePort {
  return {
    async equippedTitle(playerId) {
      const row = await players.findByIdFull(playerId)
      const id = row?.equippedTitle
      if (id === null || id === undefined) return null
      return Object.hasOwn(ENTRANCE_TITLES, id) ? (ENTRANCE_TITLES[id] ?? null) : null
    },
  }
}
