import type { RoomConfig } from '@bp/core'
import type { HandSummary } from './repositories.js'

export type DomainEvent =
  | { type: 'ROOM_CREATED'; roomId: string; hostPlayerId: string; config: RoomConfig }
  | { type: 'ROOM_JOINED'; roomId: string; playerId: string }
  | { type: 'HAND_SETTLED'; summary: HandSummary }
