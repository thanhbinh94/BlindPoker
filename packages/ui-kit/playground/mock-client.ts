import {
  ECONOMY,
  applyCommand,
  createBotStrategy,
  createHand,
  filterEvent,
  legalActions,
  playerView,
  type GameEvent,
  type HandState,
  type PlayerAction,
  type Rng,
  type RoomPlayerView,
  type RoomSummary,
  type RoomView,
  type Ruleset,
  type SeatInput,
  type ServerMessage,
} from '@bp/core'
import type { AckOrError } from '../src/client/connection.js'
import { initialClientState, reduceClient } from '../src/client/reducer.js'
import type { ClientState } from '../src/client/types.js'
import type { GameClientApi } from '../src/client/useGameClient.js'

export type PlaygroundMode = 'holdem' | 'blindA' | 'blindB'

export const PLAYGROUND_MODES: readonly PlaygroundMode[] = ['holdem', 'blindA', 'blindB']

const MY_ID = 'me'
const MY_SEAT = 0
const BOTS = ['Bảo', 'Chi', 'Dũng']
const SEATS = 1 + BOTS.length
const START_STACK = 40_000
const SMALL_BLIND = 100
const BIG_BLIND = 200
const FIXED_WAGER = 5_000
const TURN_TIMER_SEC = 30
/** Slow enough that a human can watch a bot think, fast enough to iterate on. */
const STEP_MS = 900
const NEXT_HAND_MS = 6_000

const ACK: AckOrError = { t: 'ACK', reqId: 'playground' }
const RNG: Rng = { int: (max) => Math.floor(Math.random() * max) }

const rulesFor = (mode: PlaygroundMode): Ruleset =>
  mode === 'holdem'
    ? { mode: 'holdem', smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND, tableFeeRate: ECONOMY.tableFeeRate, tableFeeCapBB: ECONOMY.tableFeeCapBB }
    : {
        mode: 'blind',
        holeCards: mode === 'blindB' ? 3 : 2,
        decisionMode: mode === 'blindB' ? 'playOrFold' : 'none',
        fixedWager: FIXED_WAGER,
        tableFeeRate: ECONOMY.tableFeeRate,
      }

const configFor = (mode: PlaygroundMode): RoomSummary['config'] => ({
  name: mode === 'holdem' ? 'Đêm Sài Gòn' : 'Chiếu Bạc',
  mode: mode === 'holdem' ? 'holdem' : 'blind',
  maxPlayers: SEATS,
  isPrivate: false,
  turnTimerSec: TURN_TIMER_SEC,
  autoStart: true,
  hasPassword: false,
  ...(mode === 'holdem'
    ? { holdem: { smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND, minBuyInBB: 50, maxBuyInBB: 200 } }
    : { blind: { holeCards: mode === 'blindB' ? (3 as const) : (2 as const), decisionMode: mode === 'blindB' ? ('playOrFold' as const) : ('none' as const), fixedWager: FIXED_WAGER, botCount: BOTS.length } }),
})

/** Two tickets for the lobby view: one open hold'em table, one locked blind room. */
export const SAMPLE_ROOMS: RoomSummary[] = [
  { roomId: 'r1', code: 'ABC234', name: 'Đêm Sài Gòn', mode: 'holdem', config: configFor('holdem'), playerCount: 3, maxPlayers: SEATS, status: 'OPEN' },
  {
    roomId: 'r2',
    code: 'XYZ789',
    name: 'Chiếu Bạc',
    mode: 'blind',
    config: { ...configFor('blindB'), isPrivate: true, hasPassword: true },
    playerCount: 2,
    maxPlayers: SEATS,
    status: 'IN_GAME',
  },
]

export interface MockClient {
  api: GameClientApi
  /** Abandons the hand in flight and deals a fresh one. */
  nextHand(): void
  stop(): void
}

/**
 * A `GameClientApi` with no server behind it — and no fake game either.
 *
 * The state comes out of `reduceClient`, fed by real `@bp/core` events: the driver creates a hand with `createHand`,
 * drives every other seat with `createBotStrategy`, runs each event through `filterEvent` for my seat and wraps it in
 * the `GAME_EVENT` frame a server would send. When it is my turn it simply stops and waits for `act()`. So the
 * playground exercises the same reducer, the same views and the same hole-card hiding as production.
 */
export function createMockClient(mode: PlaygroundMode, onChange: (state: ClientState) => void): MockClient {
  const rules = rulesFor(mode)
  const bot = createBotStrategy()

  let state = initialClientState
  let seq = 0
  let generation = 0
  let handNo = 0
  let button = 0
  let carryOver = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let waiting: ((action: PlayerAction) => void) | null = null
  const stacks = new Map<number, number>(Array.from({ length: SEATS }, (_, i) => [i, START_STACK]))

  // Everything up to the first `await` runs while `createMockClient` is still returning, so the caller's very first
  // render already sees a room and a dealt hand. Notifying before that point would be a setState during render.
  let live = false
  const publish = (next: ClientState): void => {
    state = next
    if (live) onChange(state)
  }
  const push = (msg: ServerMessage): void => publish(reduceClient(state, { type: 'server', msg, now: Date.now() }))
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms)
    })

  const players = (): RoomPlayerView[] =>
    Array.from({ length: SEATS }, (_, seat) => ({
      playerId: seat === MY_SEAT ? MY_ID : `bot${seat}`,
      displayName: seat === MY_SEAT ? 'Bạn' : (BOTS[seat - 1] ?? `Bot ${seat}`),
      isBot: seat !== MY_SEAT,
      isHost: seat === MY_SEAT,
      connected: true,
      seat,
      status: 'IN_HAND' as const,
      stack: stacks.get(seat) ?? 0,
      ready: true,
    }))

  const room = (nextHandAt: number | null): RoomView => ({
    roomId: 'r1',
    code: 'ABC234',
    name: configFor(mode).name,
    mode: rules.mode,
    config: configFor(mode),
    playerCount: SEATS,
    maxPlayers: SEATS,
    status: 'IN_GAME',
    hostPlayerId: MY_ID,
    players: players(),
    carryOverPot: carryOver,
    nextHandAt,
  })

  const emit = (events: GameEvent[]): void => {
    for (const event of events) {
      seq += 1
      const seen = filterEvent(event, MY_SEAT)
      const framed =
        seen.type === 'TURN_CHANGED' || seen.type === 'DECISION_PHASE'
          ? { ...seen, deadlineAt: Date.now() + TURN_TIMER_SEC * 1000 }
          : seen
      push({ t: 'GAME_EVENT', seq, event: framed })
    }
  }

  /** Whoever the engine is waiting on: the acting seat while betting, the first undecided seat in a decision phase. */
  const pendingSeat = (hand: HandState): number =>
    hand.phase === 'DECISION' ? (hand.players.find((p) => p.decision === null)?.seat ?? MY_SEAT) : (hand.actingSeat ?? MY_SEAT)

  async function runHand(gen: number): Promise<void> {
    // Nobody busts out of a playground: short stacks are topped back up between hands.
    const floor = rules.mode === 'holdem' ? BIG_BLIND * 2 : FIXED_WAGER * 2
    for (const seat of stacks.keys()) if ((stacks.get(seat) ?? 0) < floor) stacks.set(seat, START_STACK)

    push({ t: 'ROOM_SNAPSHOT', seq: (seq += 1), room: room(null), hand: null, deadlineAt: null })

    handNo += 1
    const seats: SeatInput[] = Array.from({ length: SEATS }, (_, seat) => ({
      seat,
      playerId: seat === MY_SEAT ? MY_ID : `bot${seat}`,
      stack: stacks.get(seat) ?? START_STACK,
      isBot: seat !== MY_SEAT,
    }))

    let hand: HandState
    let events: GameEvent[]
    ;({ state: hand, events } = createHand({ handId: `h${handNo}`, rules, seats, button, carryOverIn: carryOver }, RNG))
    emit(events)

    while (hand.phase !== 'COMPLETE') {
      if (gen !== generation) return

      if (hand.phase === 'REVEAL') {
        await sleep(STEP_MS)
        if (gen !== generation) return
        ;({ state: hand, events } = applyCommand(hand, { type: 'ADVANCE' }, RNG))
        emit(events)
        continue
      }

      const seat = pendingSeat(hand)
      let action: PlayerAction
      if (seat === MY_SEAT) {
        action = await new Promise<PlayerAction>((resolve) => {
          waiting = resolve
        })
      } else {
        await sleep(STEP_MS)
        action = bot.decide(playerView(hand, seat), legalActions(hand, seat), RNG)
      }
      if (gen !== generation) return

      try {
        ;({ state: hand, events } = applyCommand(hand, { type: 'ACTION', seat, action }, RNG))
      } catch (cause) {
        push({ t: 'ERROR', code: 'ILLEGAL_ACTION', message: String(cause) })
        continue
      }
      emit(events)
    }

    for (const p of hand.players) stacks.set(p.seat, p.stack)
    carryOver = hand.result?.carryOverOut ?? 0
    button = (button + 1) % SEATS

    const at = Date.now() + NEXT_HAND_MS
    push({ t: 'ROOM_EVENT', seq: (seq += 1), event: { type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: at } })
    await sleep(NEXT_HAND_MS)
    if (gen !== generation) return
    void runHand(gen)
  }

  const start = (): void => {
    generation += 1
    if (timer !== null) clearTimeout(timer)
    waiting = null
    void runHand(generation)
  }

  publish(reduceClient(state, { type: 'status', status: 'open' }))
  push({ t: 'WELCOME', playerId: MY_ID, displayName: 'Bạn', balance: ECONOMY.startingBalance, serverTime: Date.now() })
  push({ t: 'ROOM_LIST', rooms: SAMPLE_ROOMS })
  start()

  const api: GameClientApi = {
    get state() {
      return state
    },
    connect: () => {},
    disconnect: () => {},
    listRooms: () => push({ t: 'ROOM_LIST', rooms: SAMPLE_ROOMS }),
    createRoom: async () => ACK,
    joinRoom: async () => ACK,
    leaveRoom: async () => ACK,
    sitDown: async () => ACK,
    standUp: async () => ACK,
    setReady: async () => ACK,
    startGame: async () => ACK,
    kick: async () => ACK,
    act: async (action) => {
      const resolve = waiting
      if (resolve === null) return { t: 'ERROR', code: 'NOT_YOUR_TURN', message: 'not waiting on you', reqId: 'playground' }
      waiting = null
      resolve(action)
      return ACK
    },
    resync: () => {},
    clearError: () => publish(reduceClient(state, { type: 'clearError' })),
    dismissNotification: (id) => publish(reduceClient(state, { type: 'dismissNotification', id })),
    serverNow: () => Date.now(),
  }

  live = true

  return {
    api,
    nextHand: start,
    stop: () => {
      generation += 1
      waiting = null
      if (timer !== null) clearTimeout(timer)
    },
  }
}
