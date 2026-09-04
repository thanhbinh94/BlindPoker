import type { HandSummary, PublicRoomConfig } from './repositories.js'

export type DomainEvent =
  /** `config` never carries the room password. */
  | { type: 'ROOM_CREATED'; roomId: string; hostPlayerId: string; config: PublicRoomConfig }
  | { type: 'ROOM_JOINED'; roomId: string; playerId: string }
  | { type: 'HAND_SETTLED'; summary: HandSummary }
