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

/**
 * `blindS` and `blindBS` are Blind A and Blind B on a squeeze table (Plan 21): the viewer's cards come face down, to peel
 * or turn with "Lật" — in pure luck inside the `SQUEEZE` round, in play-or-fold before the choice.
 */
export type PlaygroundMode = 'holdem' | 'blindA' | 'blindB' | 'blindS' | 'blindBS'

export const PLAYGROUND_MODES: readonly PlaygroundMode[] = ['holdem', 'blindA', 'blindB', 'blindS', 'blindBS']

const isSqueeze = (mode: PlaygroundMode): boolean => mode === 'blindS' || mode === 'blindBS'
const isPlayOrFold = (mode: PlaygroundMode): boolean => mode === 'blindB' || mode === 'blindBS'

const MY_ID = 'me'
const MY_SEAT = 0
const BOTS = ['Bảo', 'Chi', 'Dũng', 'Hằng', 'Khánh', 'Liên', 'Minh', 'Phúc']
/**
 * On the pure-luck squeeze table the seat after mine is a person, not a bot: one who never turns by hand, so the round
 * runs to its deadline and the server's turn — and once mine are up the table still has someone to wait for, as a real
 * one would. (Play-or-fold needs none: the bots decide after me, so the round waits on me anyway.)
 */
const OTHER_HUMAN_SEAT = 1
export const PLAYGROUND_SEAT_COUNTS = [4, 6, 9] as const
export type PlaygroundSeats = (typeof PLAYGROUND_SEAT_COUNTS)[number]
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
        holeCards: isPlayOrFold(mode) ? 3 : 2,
        decisionMode: isPlayOrFold(mode) ? 'playOrFold' : 'none',
        fixedWager: FIXED_WAGER,
        tableFeeRate: ECONOMY.tableFeeRate,
        ...(isSqueeze(mode) ? { squeeze: true } : {}),
      }

/** A squeeze table's round is the server's fixed 20 s, whatever the room asked for (spec 2026-10-08 §4.2.1). */
const timerSecFor = (mode: PlaygroundMode): number => (isSqueeze(mode) ? ECONOMY.squeezeTurnTimerSec : TURN_TIMER_SEC)

const configFor = (mode: PlaygroundMode, seats: number): RoomSummary['config'] => ({
  name: mode === 'holdem' ? 'Đêm Sài Gòn' : 'Chiếu Bạc',
  mode: mode === 'holdem' ? 'holdem' : 'blind',
  maxPlayers: seats,
  isPrivate: false,
  turnTimerSec: timerSecFor(mode),
  autoStart: true,
  hasPassword: false,
  ...(mode === 'holdem'
    ? { holdem: { smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND, minBuyInBB: 50, maxBuyInBB: 200 } }
    : {
        blind: {
          holeCards: isPlayOrFold(mode) ? (3 as const) : (2 as const),
          decisionMode: isPlayOrFold(mode) ? ('playOrFold' as const) : ('none' as const),
          fixedWager: FIXED_WAGER,
          botCount: seats - (mode === 'blindS' ? 2 : 1),
          ...(isSqueeze(mode) ? { squeeze: true } : {}),
        },
      }),
})

/** Two tickets for the lobby view: one open hold'em table, one locked blind room — a squeeze table (the "Nặn bài" badge). */
export const SAMPLE_ROOMS: RoomSummary[] = [
  { roomId: 'r1', code: 'ABC234', name: 'Đêm Sài Gòn', mode: 'holdem', config: configFor('holdem', 6), playerCount: 3, maxPlayers: 6, status: 'OPEN' },
  {
    roomId: 'r2',
    code: 'XYZ789',
    name: 'Chiếu Bạc',
    mode: 'blind',
    config: { ...configFor('blindBS', 4), isPrivate: true, hasPassword: true },
    playerCount: 2,
    maxPlayers: 4,
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
 * the `GAME_EVENT` frame a server would send. When it is my turn it simply stops and waits for `act()` (at a squeeze
 * table's decision `reveal()` turns my cards meanwhile); in a pure-luck squeeze round it waits for `reveal()` or the
 * round's deadline, and turns what is still down then. So the
 * playground exercises the same reducer, the same views and the same hole-card hiding as production.
 */
export function createMockClient(mode: PlaygroundMode, seatCount: number, onChange: (state: ClientState) => void): MockClient {
  const SEATS = seatCount
  const rules = rulesFor(mode)
  const bot = createBotStrategy()

  let state = initialClientState
  let seq = 0
  let generation = 0
  let handNo = 0
  let button = 0
  let carryOver = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Waiting on me: my action from `act()`, or — at a squeeze table's decision — `'reveal'` from `reveal()`. */
  let waiting: ((choice: PlayerAction | 'reveal') => void) | null = null
  /** In a squeeze round: wakes the driver with the seat `reveal()` turned, or `null` when the round's deadline is up. */
  let revealing: ((seat: number | null) => void) | null = null
  /** The latest deadline sent with a turn, a decision or a squeeze round: the round's driver waits it out. */
  let deadlineAt = 0
  const timerSec = timerSecFor(mode)
  const isBotSeat = (seat: number): boolean => seat !== MY_SEAT && !(mode === 'blindS' && seat === OTHER_HUMAN_SEAT)
  /** No server here to skip a hand, but the tray's toggle is a real one: it flips my seat's status. */
  let sittingOut = false
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
      isBot: isBotSeat(seat),
      isHost: seat === MY_SEAT,
      connected: true,
      seat,
      status: seat === MY_SEAT && sittingOut ? ('SITTING_OUT' as const) : ('IN_HAND' as const),
      sittingOut: seat === MY_SEAT && sittingOut,
      stack: stacks.get(seat) ?? 0,
      ready: true,
    }))

  const room = (nextHandAt: number | null): RoomView => ({
    roomId: 'r1',
    code: 'ABC234',
    name: configFor(mode, SEATS).name,
    mode: rules.mode,
    config: configFor(mode, SEATS),
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
      if (seen === null) continue
      const timed = seen.type === 'TURN_CHANGED' || seen.type === 'DECISION_PHASE' || seen.type === 'SQUEEZE_PHASE'
      if (timed) deadlineAt = Date.now() + timerSec * 1000
      const framed = timed ? { ...seen, deadlineAt } : seen
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
      isBot: isBotSeat(seat),
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

      // The squeeze round, as the server runs it (spec 2026-10-08 §5.2): `reveal()` turns my cards — the round ends at once
      // when nobody else is left to turn — and at the deadline every seat still down is turned for it.
      if (hand.phase === 'SQUEEZE') {
        const seat = await new Promise<number | null>((resolve) => {
          revealing = resolve
          timer = setTimeout(() => resolve(null), Math.max(0, deadlineAt - Date.now()))
        })
        revealing = null
        if (timer !== null) clearTimeout(timer)
        if (gen !== generation) return
        const down = seat === null ? hand.players.filter((p) => !p.revealed).map((p) => p.seat) : [seat]
        for (const s of down) {
          ;({ state: hand, events } = applyCommand(hand, { type: 'REVEALED', seat: s }, RNG))
          emit(events)
        }
        continue
      }

      const seat = pendingSeat(hand)
      let action: PlayerAction
      if (seat === MY_SEAT) {
        const choice = await new Promise<PlayerAction | 'reveal'>((resolve) => {
          waiting = resolve
        })
        if (gen !== generation) return
        // A squeeze table's decision: my cards turned before my choice (spec 2026-10-08 §4.2.4) — the engine marks the
        // seat, and the decision is still mine to make.
        if (choice === 'reveal') {
          ;({ state: hand, events } = applyCommand(hand, { type: 'REVEALED', seat: MY_SEAT }, RNG))
          emit(events)
          continue
        }
        action = choice
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

  const setSittingOut = (out: boolean): AckOrError => {
    sittingOut = out
    push({ t: 'ROOM_EVENT', seq: (seq += 1), event: { type: 'PLAYER_SIT_OUT', playerId: MY_ID, sittingOut: out } })
    return ACK
  }

  const start = (): void => {
    generation += 1
    if (timer !== null) clearTimeout(timer)
    waiting = null
    revealing = null
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
    sitOut: async () => setSittingOut(true),
    sitIn: async () => setSittingOut(false),
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
    // In the pure-luck round it wakes the round's wait, in a squeeze table's decision the wait for my choice; anywhere
    // else there is nothing to turn: an ACK that changes nothing, as the server's.
    reveal: async () => {
      if (revealing !== null) revealing(MY_SEAT)
      else if (isSqueeze(mode) && waiting !== null) {
        const resolve = waiting
        waiting = null
        resolve('reveal')
      }
      return ACK
    },
    // The playground's tables deal no chaos cards (yet): nothing is on offer, so a pick is an ACK that changes nothing.
    pickChaos: async () => ACK,
    setPreAction: (kind) => publish(reduceClient(state, { type: 'preAction', kind })),
    setAutoPlay: (on) => publish(reduceClient(state, { type: 'autoPlay', on })),
    resync: () => {},
    renamed: (displayName) => publish(reduceClient(state, { type: 'renamed', displayName })),
    clearError: () => publish(reduceClient(state, { type: 'clearError' })),
    dismissNotification: (id) => publish(reduceClient(state, { type: 'dismissNotification', id })),
    reset: () => publish(reduceClient(state, { type: 'reset' })),
    serverNow: () => Date.now(),
  }

  live = true

  return {
    api,
    nextHand: start,
    stop: () => {
      generation += 1
      waiting = null
      revealing = null
      if (timer !== null) clearTimeout(timer)
    },
  }
}
