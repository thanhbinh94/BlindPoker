import { HandCategory, parseCards, type Card, type RoomPlayerView, type RoomView, type ShowdownHand } from '@bp/core'
import { useEffect, useMemo } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { AckOrError } from '../src/client/connection.js'
import { initialClientState, type ClientHand, type ClientSeat, type ClientState } from '../src/client/types.js'
import type { GameClientApi } from '../src/client/useGameClient.js'
import { SUPPORTED_LANGUAGES, createI18n, type Language } from '../src/i18n/index.js'
import { RoomScreen } from '../src/screens/RoomScreen.js'
import type { RoomFrame } from '../src/table/frame.js'

/**
 * `#worst/<state>/<seats>/<lang>` — the room at its tallest, frozen, for measuring a layout against a screen size
 * (review 2026-09-29, No2). No engine runs: each state is one hand-written `ClientState`, the worst a Hold'em table
 * can show in it.
 *
 * - `waiting`: taking seats — everyone seated, the host (me) not yet ready, the hint under the controls.
 * - `turn`: my turn on the river with the sizing tray up (presets, amount, slider, four buttons), my turn ring
 *   running, an all-in, a disconnected player and a fold around the table, a bet in front of nearly everyone.
 * - `result`: every seat shown down, three pots, an uncalled bet returned, the countdown on the card — and my own
 *   seat carrying all it can: "Bạn", the host's crown, all-in, a bet, the longest hand name and a payout.
 *
 * Every player has a caption (the Normal edition prints a title there), so every plate runs three lines. The room
 * takes the whole viewport, as Normal's room route does; `seats` is 2–9 (6 by default), `lang` `vi` (default) or `en`.
 *
 * - `blindS`: a Blind Poker squeeze table (pure luck, two hole cards, one bot) in its `SQUEEZE` round — my two cards face
 *   down with the Lật pill, the bot's turned, every third person's turned, the round's countdown on my plate.
 *
 * Optional segments after the language, in any order: `/long` gives the viewer a 30-character name (`LONG_NAME`) —
 * longer than the own plate's cap at any seat count, so it shows where the plate stops widening and the name ends in
 * "…" (review round 2, R2-3); without it the viewer keeps `NAMES[0]`, which earlier measurements use. `/landscape`
 * or `/desktop` forces that room frame whatever the window is; without either, the window's own media query chooses.
 */

export type WorstState = 'waiting' | 'turn' | 'result' | 'blindS'

export interface WorstSpec {
  state: WorstState
  seats: number
  lang: Language
  /** The viewer's own name is `LONG_NAME` rather than `NAMES[0]`. */
  long: boolean
  /** A frame forced on the room whatever the window is; `null` leaves the choice to the window's own media query. */
  frame: RoomFrame | null
}

const STATES: readonly WorstState[] = ['waiting', 'turn', 'result', 'blindS']

/**
 * Reads `#worst/<state>/<seats>/<lang>[/long][/landscape|/desktop]`; `null` for any other hash. The tokens after the
 * language are read by name, in any order, and one it does not know is ignored.
 */
export function parseWorstHash(hash: string): WorstSpec | null {
  const [head, state, seats, lang, ...flags] = hash.replace(/^#/, '').split('/')
  if (head !== 'worst') return null
  const n = Number(seats ?? 6)
  return {
    state: STATES.includes(state as WorstState) ? (state as WorstState) : 'result',
    seats: Number.isInteger(n) && n >= 2 && n <= 9 ? n : 6,
    lang: SUPPORTED_LANGUAGES.includes(lang as Language) ? (lang as Language) : 'vi',
    long: flags.includes('long'),
    frame: flags.includes('landscape') ? 'landscape' : flags.includes('desktop') ? 'desktop' : null,
  }
}

const ME = 'me'
/** Thirty characters: wider than the viewer's own plate may grow at any seat count. */
const LONG_NAME = 'Trịnh Nguyễn Hoàng Phương Thảo'
const NAMES = [
  'Nguyễn Thị Phương Anh',
  'Trần Minh Khôi',
  'Lê Hoàng Bảo Ngọc',
  'Phạm Quốc Dũng',
  'Võ Thanh Hằng',
  'Đặng Khánh Linh',
  'Bùi Gia Huy',
  'Hồ Tuyết Mai',
  'Dương Phúc',
]
const CAPTION = 'Tay chơi lão luyện'
/** Two hole cards and a best five per seat — all different, so the result rows never repeat a card key. */
const HANDS: { hole: string; best: string; category: ShowdownHand['category'] }[] = [
  { hole: 'Ah Kh', best: 'Ah Kh Qh Jh Th', category: HandCategory.ROYAL_FLUSH },
  { hole: '9s 8s', best: '9s 8s 7s 6s 5s', category: HandCategory.STRAIGHT_FLUSH },
  { hole: 'Qd Qc', best: 'Qd Qc Qs 4d 4c', category: HandCategory.FULL_HOUSE },
  { hole: '7d 7c', best: '7d 7c 7h Ad 2c', category: HandCategory.TRIPS },
  { hole: 'Jd 3c', best: 'Jd Js 3c 3h Kd', category: HandCategory.TWO_PAIR },
  { hole: 'Td 2d', best: 'Td Tc Ac Kc 6d', category: HandCategory.PAIR },
  { hole: '5d 4s', best: '5d 5h Ks Jc 8d', category: HandCategory.PAIR },
  { hole: '6h 2h', best: 'Ac Kc 9h 6h 3d', category: HandCategory.HIGH_CARD },
  { hole: '8h 3s', best: 'Ac Kc 9h 8h 4h', category: HandCategory.HIGH_CARD },
]
const cards = (text: string): Card[] => parseCards(text)

/** Seat `i`'s name; the viewer sits in seat 0. */
const nameOf = (i: number, long: boolean): string => (i === 0 && long ? LONG_NAME : (NAMES[i] ?? `Người chơi ${i}`))

function players(n: number, state: WorstState, long: boolean): RoomPlayerView[] {
  return Array.from({ length: n }, (_, seat) => ({
    playerId: seat === 0 ? ME : `p${seat}`,
    displayName: nameOf(seat, long),
    isBot: state === 'blindS' && seat === BOT_SEAT,
    isHost: seat === 0,
    connected: seat !== 2,
    seat,
    status: state === 'waiting' ? ('SEATED' as const) : ('IN_HAND' as const),
    sittingOut: false,
    stack: 118_000 - seat * 7_777,
    ready: state !== 'waiting' || seat !== 0,
  }))
}

/** The one bot at the squeeze table. */
const BOT_SEAT = 1
const FIXED_WAGER = 1_000

function room(n: number, state: WorstState, now: number, long: boolean): RoomView {
  const squeeze = state === 'blindS'
  return {
    roomId: 'worst',
    code: 'WRST26',
    name: 'Đêm Sài Gòn — bàn đông nhất',
    mode: squeeze ? 'blind' : 'holdem',
    config: {
      name: 'Đêm Sài Gòn — bàn đông nhất',
      mode: squeeze ? 'blind' : 'holdem',
      maxPlayers: n,
      isPrivate: false,
      // A squeeze table's round is the server's fixed 20 s, whatever the room asked for.
      turnTimerSec: squeeze ? 20 : 30,
      autoStart: false,
      hasPassword: false,
      ...(squeeze
        ? { blind: { holeCards: 2 as const, decisionMode: 'none' as const, fixedWager: FIXED_WAGER, botCount: 1, squeeze: true } }
        : { holdem: { smallBlind: 1_000, bigBlind: 2_000, minBuyInBB: 50, maxBuyInBB: 200 } }),
    },
    playerCount: n,
    maxPlayers: n,
    status: state === 'waiting' ? 'OPEN' : 'IN_GAME',
    hostPlayerId: ME,
    players: players(n, state, long),
    carryOverPot: 0,
    nextHandAt: state === 'result' ? now + 59_000 : null,
  }
}

function seat(n: number, i: number, state: WorstState, long: boolean): ClientSeat {
  if (state === 'blindS') {
    // The squeeze round: my two cards are mine to turn (face down), the bot's are turned from the deal, and every third
    // person has turned theirs. Everyone has put the fixed wager in; nobody folds, nobody decides, nobody acts.
    const turned = i === BOT_SEAT || (i > 0 && i % 3 === 0)
    return {
      seat: i,
      playerId: i === 0 ? ME : `p${i}`,
      displayName: nameOf(i, long),
      isBot: i === BOT_SEAT,
      stack: 118_000 - i * 7_777,
      betThisStreet: FIXED_WAGER,
      folded: false,
      allIn: false,
      cardCount: 2,
      holeCards: i === 0 || turned ? cards(HANDS[i]!.hole) : null,
      revealed: turned,
      hasDecided: false,
      decision: null,
      lastAction: null,
      timedOut: false,
    }
  }
  const shown = state === 'result' || i === 0
  return {
    seat: i,
    playerId: i === 0 ? ME : `p${i}`,
    displayName: nameOf(i, long),
    isBot: false,
    stack: i === 1 ? 0 : 118_000 - i * 7_777,
    // Everyone has chips out, and the most anyone's line can hold is a badge row *and* a bet.
    betThisStreet: i === 3 && state === 'turn' ? 0 : i === 0 ? 2_000 : 6_000,
    folded: i === 3 && state === 'turn' && n > 3,
    allIn: i === 1 || (i === 0 && state === 'result'),
    cardCount: 2,
    holeCards: shown ? cards(HANDS[i]!.hole) : null,
    hasDecided: false,
    decision: null,
    lastAction: null,
    timedOut: false,
  }
}

function hand(n: number, state: WorstState, long: boolean): ClientHand | null {
  if (state === 'waiting') return null
  const all = Array.from({ length: n }, (_, i) => i)
  if (state === 'blindS') {
    return {
      handId: 'worst-blindS',
      mode: 'blind',
      phase: 'SQUEEZE',
      community: [],
      pot: n * FIXED_WAGER,
      carryOverIn: 0,
      button: Math.min(3, n - 1),
      actingSeat: null,
      seats: all.map((i) => seat(n, i, state, long)),
      mySeat: 0,
      legal: null,
      result: null,
      potPulse: 1,
      restored: true,
      dealtAt: null,
      boardAt: null,
      showdownAt: null,
    }
  }
  const base: ClientHand = {
    handId: `worst-${state}`,
    mode: 'holdem',
    phase: state === 'turn' ? 'BETTING' : 'COMPLETE',
    community: cards('Ac Kc 9h 4h 3d'),
    pot: 48_000,
    carryOverIn: 0,
    button: Math.min(3, n - 1),
    actingSeat: state === 'turn' ? 0 : null,
    seats: all.map((i) => seat(n, i, state, long)),
    mySeat: 0,
    legal:
      state === 'turn'
        ? { seat: 0, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 4_000, minBet: 0, maxBet: 0, minRaiseTo: 10_000, maxRaiseTo: 118_000 }
        : null,
    result: null,
    potPulse: 1,
    restored: true,
    dealtAt: null,
    boardAt: null,
    showdownAt: null,
  }
  if (state === 'turn') return base
  const others = all.slice(1)
  return {
    ...base,
    pot: 0,
    result: {
      payouts: [{ seat: 0, amount: 123_456 }, ...(n > 2 ? [{ seat: 2, amount: 24_000 }] : []), ...(n > 4 ? [{ seat: 4, amount: 12_000 }] : [])],
      pots: [
        { amount: 123_456, eligibleSeats: all, winners: [{ seat: 0, amount: 123_456 }] },
        ...(n > 2 ? [{ amount: 24_000, eligibleSeats: others, winners: [{ seat: 2, amount: 24_000 }] }] : []),
        ...(n > 4 ? [{ amount: 12_000, eligibleSeats: others.slice(1), winners: [{ seat: 4, amount: 12_000 }] }] : []),
      ],
      fee: 2_000,
      showdown: all.map((i) => ({ seat: i, cards: cards(HANDS[i]!.hole), rank: 9 - i, category: HANDS[i]!.category, best: cards(HANDS[i]!.best) })),
      carryOverOut: 0,
      uncalledReturned: n > 5 ? { seat: 5, amount: 3_000 } : null,
      cancelled: false,
      reason: null,
    },
  }
}

const ACK: AckOrError = { t: 'ACK', reqId: 'worst' }

/** A client that holds one state and answers every request with an ACK that changes nothing. */
function frozenClient(state: ClientState): GameClientApi {
  const ack = async (): Promise<AckOrError> => ACK
  return {
    state,
    connect: () => {},
    disconnect: () => {},
    listRooms: () => {},
    createRoom: ack,
    joinRoom: ack,
    leaveRoom: ack,
    sitDown: ack,
    standUp: ack,
    sitOut: ack,
    sitIn: ack,
    setReady: ack,
    startGame: ack,
    kick: ack,
    act: ack,
    reveal: ack,
    setPreAction: () => {},
    setAutoPlay: () => {},
    resync: () => {},
    renamed: () => {},
    clearError: () => {},
    dismissNotification: () => {},
    reset: () => {},
    serverNow: () => Date.now(),
  }
}

export function WorstPage({ spec }: { spec: WorstSpec }) {
  const i18n = useMemo(() => createI18n({ language: spec.lang, storage: null }), [spec.lang])
  const client = useMemo(() => {
    const now = Date.now()
    return frozenClient({
      ...initialClientState,
      status: 'open',
      me: { playerId: ME, displayName: nameOf(0, spec.long) },
      balance: 250_000,
      roomStale: false,
      room: room(spec.seats, spec.state, now, spec.long),
      hand: hand(spec.seats, spec.state, spec.long),
      deadlineAt: spec.state === 'turn' ? now + 25_000 : spec.state === 'blindS' ? now + 15_000 : null,
    })
  }, [spec])
  useEffect(() => {
    document.title = `worst: ${spec.state}, ${spec.seats} seats, ${spec.lang}${spec.long ? ', long name' : ''}${spec.frame === null ? '' : `, ${spec.frame} frame`}`
  }, [spec])
  return (
    <I18nextProvider i18n={i18n}>
      <RoomScreen client={client} lang={spec.lang} onLeft={() => {}} captionFor={() => CAPTION} frame={spec.frame ?? undefined} />
    </I18nextProvider>
  )
}
