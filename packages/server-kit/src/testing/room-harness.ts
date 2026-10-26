import { createBotStrategy, seededRng, type BotStrategy, type PlayerIdentity, type RoomConfig, type ServerMessage } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import type { Logger } from '../infra/logger.js'
import { createMemoryRepositories, type MemoryRepositories } from '../memory-repositories.js'
import { Room } from '../room/room.js'
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../room/types.js'
import { ManualClock } from './manual-clock.js'
import { createMemoryChaosPort, type MemoryChaosOptions } from './memory-chaos.js'

export interface RoomHarness {
  room: Room
  clock: ManualClock
  repos: MemoryRepositories
  sent: Map<string, ServerMessage[]>
  domainEvents: DomainEvent[]
  /** Everything the room logged (debug excluded), in order — so a test can assert a failure was not swallowed silently. */
  logs: HarnessLogLine[]
  identity(id: string): PlayerIdentity
  ofType<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }>[]
  last<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }> | undefined
}

export interface HarnessLogLine {
  level: 'info' | 'warn' | 'error'
  msg: string
  data?: object
}

export const TEST_ROOM_OPTIONS: RoomOptions = {
  ...DEFAULT_ROOM_OPTIONS,
  handIntervalMs: 100,
  revealDelayMs: 10,
  botDelayMs: [10, 10],
  reconnectWindowMs: 1_000,
  spectatorGraceMs: 2_000,
  emptyRoomCloseMs: 500,
  carryOverReleaseMs: 200,
  turnTimerMsOverride: 5_000,
}

export function createRoomHarness(
  config: RoomConfig,
  /** `bot` replaces the real strategy, for a test that needs the bots to make one particular move. */
  opts: {
    players?: [id: string, balance: number][]; options?: Partial<RoomOptions>; seed?: number; hostId?: string; bot?: BotStrategy
    /** A chaos port over the harness repos (`createMemoryChaosPort`), for a chaos table. */
    chaos?: true | Omit<MemoryChaosOptions, 'repos'>
  } = {},
): RoomHarness {
  const clock = new ManualClock()
  const repos = createMemoryRepositories()
  const chaos = opts.chaos === undefined ? undefined : createMemoryChaosPort({ ...(opts.chaos === true ? {} : opts.chaos), repos })
  const sent = new Map<string, ServerMessage[]>()
  const domainEvents: DomainEvent[] = []
  const logs: HarnessLogLine[] = []
  const record = (level: HarnessLogLine['level']) => (msg: string, data?: object) => { logs.push(data === undefined ? { level, msg } : { level, msg, data }) }
  const log: Logger = { debug: () => {}, info: record('info'), warn: record('warn'), error: record('error') }
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
      bot: opts.bot ?? createBotStrategy(),
      log,
      options: { ...TEST_ROOM_OPTIONS, ...opts.options },
      onDomainEvent: (e) => domainEvents.push(e),
      ...(chaos ? { chaos } : {}),
    },
  })
  const ofType = <T extends ServerMessage['t']>(playerId: string, t: T) => (sent.get(playerId) ?? []).filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t)
  return { room, clock, repos, sent, domainEvents, logs, identity, ofType, last: (playerId, t) => ofType(playerId, t).at(-1) }
}
