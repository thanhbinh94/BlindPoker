/**
 * The GM's way into a live room — a thin façade, so the routes never touch a `Room` and a test can hand in a stub
 * (spec 2026-10-18 §5).
 *
 * Rooms live in memory, so nothing here is transactional: the route writes the log line, this does the deed. A
 * player is told with a `GM_NOTICE` that carries the GM's reason; the room's own frames (`KICKED`, the closing
 * events, the cash-out) say what happened at the table.
 */
import type { AdminRoomSummary, GameServer } from '@bp/server-kit'
import { ServiceError } from '../errors.js'

/** What the server tells a room's `shutdown` — the GM's reason stays in the log, not in the broadcast. */
export const CLOSED_BY_GM = 'closed_by_gm'

export interface GmRoomService {
  /** Every live room, private ones included. A room already closed is not listed. */
  list(): AdminRoomSummary[]
  get(roomId: string): AdminRoomSummary | null
  /** Removes a human at once, or when their hand ends if they are inside it. Refuses a bot. */
  kick(roomId: string, playerId: string, reason: string): Promise<'now' | 'after_hand'>
  /** Closes the room: stacks and any carried pot go back through the room's own cash-out. `refunded` counts the humans. */
  close(roomId: string, reason: string): Promise<{ refunded: number }>
}

export function createGmRoomService(game: Pick<GameServer, 'rooms' | 'notify'>): GmRoomService {
  const live = (roomId: string) => {
    const room = game.rooms.get(roomId)
    return room === undefined || room.status === 'CLOSED' ? undefined : room
  }
  const must = (roomId: string) => {
    const room = live(roomId)
    if (room === undefined) throw new ServiceError('ROOM_NOT_FOUND')
    return room
  }
  const notice = (playerId: string, payload: Record<string, unknown>): void => {
    game.notify(playerId, { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload })
  }

  return {
    list: () => game.rooms.all().filter((r) => r.status !== 'CLOSED').map((r) => r.adminSummary()),
    get: (roomId) => live(roomId)?.adminSummary() ?? null,

    async kick(roomId, playerId, reason) {
      const room = must(roomId)
      if (!room.players.has(playerId)) throw new ServiceError('NOT_IN_ROOM')
      const effective = await room.adminKick(playerId).catch((err: { code?: string; message?: string }) => {
        throw new ServiceError(err.code ?? 'ILLEGAL_ACTION', err.message)
      })
      notice(playerId, { action: 'kick', reason })
      return effective
    },

    async close(roomId, reason) {
      const room = must(roomId)
      const humans = room.adminSummary().members.filter((m) => !m.isBot)
      for (const m of humans) notice(m.playerId, { action: 'close_room', reason })
      await room.shutdown(CLOSED_BY_GM)
      return { refunded: humans.length }
    },
  }
}
