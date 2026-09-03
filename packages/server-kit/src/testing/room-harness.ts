import { createBotStrategy, seededRng, type PlayerIdentity, type RoomConfig, type ServerMessage } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories, type MemoryRepositories } from '../memory-repositories.js'
import { Room } from '../room/room.js'
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../room/types.js'
import { ManualClock } from './manual-clock.js'

export interface RoomHarness {
  room: Room
  clock: ManualClock
  repos: MemoryRepositories
  sent: Map<string, ServerMessage[]>
  domainEvents: DomainEvent[]
  identity(id: string): PlayerIdentity
  ofType<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }>[]
  last<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }> | undefined
}

export const TEST_ROOM_OPTIONS: RoomOptions = {
  ...DEFAULT_ROOM_OPTIONS,
  handIntervalMs: 100,
  revealDelayMs: 10,
  botDelayMs: [10, 10],
  reconnectWindowMs: 1_000,
  spectatorGraceMs: 2_000,
  emptyRoomCloseMs: 500,
  turnTimerMsOverride: 5_000,
}

export function createRoomHarness(
  config: RoomConfig,
  opts: { players?: [id: string, balance: number][]; options?: Partial<RoomOptions>; seed?: number; hostId?: string } = {},
): RoomHarness {
  const clock = new ManualClock()
  const repos = createMemoryRepositories()
  const sent = new Map<string, ServerMessage[]>()
  const domainEvents: DomainEvent[] = []
  const players = opts.players ?? [['h', 100_000], ['a', 100_000], ['b', 100_000]]
  for (const [id, balance] of players) repos.addPlayer(id, id.toUpperCase(), balance)
  const identity = (id: string): PlayerIdentity => ({ playerId: id, displayName: id.toUpperCase(), isBot: false })
  const room = new Room({
    roomId: 'room-1',
    code: 'ABC234',
    config,
    host: identity(opts.hostId ?? players[0]![0]),
    deps: {
      clock,
      rng: seededRng(opts.seed ?? 1),
      repos,
      outbox: { send: (playerId, msg) => { (sent.get(playerId) ?? sent.set(playerId, []).get(playerId)!).push(msg) } },
      bot: createBotStrategy(),
      log: silentLogger,
      options: { ...TEST_ROOM_OPTIONS, ...opts.options },
      onDomainEvent: (e) => domainEvents.push(e),
    },
  })
  const ofType = <T extends ServerMessage['t']>(playerId: string, t: T) => (sent.get(playerId) ?? []).filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t)
  return { room, clock, repos, sent, domainEvents, identity, ofType, last: (playerId, t) => ofType(playerId, t).at(-1) }
}
