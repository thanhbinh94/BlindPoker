import { HandCategory, parseCards, type Card, type ChaosEffectKind, type RoomPlayerView, type RoomView, type ShowdownHand } from '@bp/core'
import { useEffect, useMemo } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { AckOrError } from '../src/client/connection.js'
import { initialChaos, initialClientState, type AppliedChaosView, type ClientChaos, type ClientHand, type ClientSeat, type ClientState } from '../src/client/types.js'
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
 * Every human player has a caption (the Normal edition prints a title there), so every human plate runs three lines; a
 * bot has none, as in Normal (`makeCaptionFor`). The room
 * takes the whole viewport, as Normal's room route does; `seats` is 2–9 (6 by default), `lang` `vi` (default) or `en`.
 *
 * - `blindS`: a Blind Poker squeeze table (pure luck, two hole cards, one bot) in its `SQUEEZE` round — my two cards face
 *   down with the Lật pill, the bot's turned, every third person's turned, the round's countdown on my plate.
 *
 * Optional segments after the language, in any order: `/long` gives the viewer a 30-character name (`LONG_NAME`) —
 * longer than the own plate's cap at any seat count, so it shows where the plate stops widening and the name ends in
 * "…" (review round 2, R2-3); without it the viewer keeps `NAMES[0]`, which earlier measurements use. `/landscape`
 * or `/desktop` forces that room frame whatever the window is; without either, the window's own media query chooses.
 * `/rank<N>` (1–5) gives the viewer that rank instead of `RANKS[ME]`, to see the longest rank word beside the own name.
 *
 * BP-28, the short landscape tier — the user's own table on a phone that keeps its browser bars:
 *
 * - `blindP`: a Blind Poker play-or-fold table (three hole cards, a 2.000 wager), the viewer and bots in every other
 *   seat, in its `DECISION` round after every bot has chosen: "Bot · Đã chọn · 2.000" under each bot, my three cards up,
 *   my Chơi / Bỏ bài to press.
 * - `blindW`: the same table taking seats — every bot ready, me the host and not ready, so the hint says
 *   "Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một người chơi thật."
 *
 * `/short` lays the room out in an 855 × 319 box in the landscape frame, whatever the window — the user's phone with its
 * address bar (bug log §10): the stage measures 255 px, so the room takes the short tier.
 */

export type WorstState = 'waiting' | 'turn' | 'result' | 'blindS' | 'blindP' | 'blindW' | ChaosState

/**
 * Plan 37, Poker hỗn loạn: a Blind Poker play-or-fold table on the 5-hand chaos cycle, every seat but mine a bot, each seat
 * holding a few cards (the icons under the plates, 0 to 5 of them).
 *
 * - `chaosDraft`: the last hand over, my three cards still fanned out, and the draft open — three Vàng cards to choose from, the
 *   timer running. The draft lies above my seat; the last hand's result card steps aside for it.
 * - `chaosReveal`: a hand in its `DECISION` round with three cards having fired — their toasts are up for 4 s (reload to see
 *   them again; the hand is not a snapshot).
 * - `chaosFour`: "Thêm lá" on a three-card table — I hold four cards, one seat holds four face down — with a "Nhìn trộm" of the
 *   next board cards in the ghost slots.
 * - `chaosPeel`: a squeeze table, my four cards face down to peel (the peel layout with a card more).
 * - `chaosBlind`: "Che mắt" on me — my three cards are backs I cannot turn, with the word "Bị che mắt" on my seat.
 * - `chaosResult`: the hand over — the result card with its "Thẻ đã dùng" line and the credits, "Bạo kích ×2!" on the winner, and
 *   the "Mượn lá" card the viewer ranked with beside their own cards, tagged "Mượn" and gold-edged in the winning five.
 * - `chaosBoard`: after the river, the five board cards face up and the reveal cards firing as toasts — and "Thế giới đảo
 *   ngược" on: its pinned toast stays all hand.
 *
 * BP-39, round two:
 * - `chaosBonus`: a hand in its `DECISION` round with my bonus hand full — three cards waiting (a debuff, a board re-deal, a
 *   deal-time buff), none pressed; the other seats show how many bonus cards they hold, never which.
 * - `chaosBurst`: the hand over, and every one of up to eight seats fired a card ("Thẻ đã dùng" at its longest, eight
 *   toasts in one batch with the settlement: as many as the band holds, the rest under "+N thẻ khác", the result open beside
 *   them), the result wait running with "Bỏ qua" at 3 of 5 and not pressed by me, one bonus card in my hand.
 * - `chaosArmed`: `chaosBonus` after I pressed "Dùng" on the board re-deal: it waits marked "Đã đặt dùng · ván này" for this hand's
 *   reveal, the other two cards still in my hand with their "Dùng" greyed.
 *
 * BP-41, round three (each herald and roll plays from the page's load, for its 3 s; reload to see it again):
 * - `chaosGod`: the deal of a Thần's first hand — the herald across the screen, Bot 1 the Thần with its aura and "♛ 5",
 *   Bot 2 a Bán Thần ("✦ 5"), Bot 3 carrying my bomb ("✹ 2"); my decision round with "Bỏ bài" gone and the reason in its
 *   place; the herald's and the curse's lines in the toasts; my Cá chép at 35 % energy among my cards.
 * - `chaosDice`: the hand over and the dice of fortune rolling for the table — Bot 1's Kim cương 6-6-6 (the jackpot's banner
 *   once the dice land) and my Bạc die — beside the result, its jackpot credit, and the dice lines in the toasts.
 * - `chaosSix`: after the river with Lá chung thứ sáu — six board cards — my five hole cards (one of them wild, Lá ma) fanned,
 *   Bot 1 down to one card, Bot 2 holding five face down.
 */
export type ChaosState =
  | 'chaosDraft' | 'chaosReveal' | 'chaosFour' | 'chaosPeel' | 'chaosBlind' | 'chaosResult' | 'chaosBoard' | 'chaosBonus' | 'chaosBurst' | 'chaosArmed'
  | 'chaosGod' | 'chaosDice' | 'chaosSix'

const CHAOS_STATES: readonly ChaosState[] = [
  'chaosDraft', 'chaosReveal', 'chaosFour', 'chaosPeel', 'chaosBlind', 'chaosResult', 'chaosBoard', 'chaosBonus', 'chaosBurst', 'chaosArmed',
  'chaosGod', 'chaosDice', 'chaosSix',
]
/** The states whose hand is over (the result out). */
const isOver = (state: ChaosState): boolean => state === 'chaosDraft' || state === 'chaosResult' || state === 'chaosBurst' || state === 'chaosDice'
const isChaos = (state: WorstState): state is ChaosState => (CHAOS_STATES as readonly string[]).includes(state)

/** `/short`: the box the room is laid out in, the user's 855 × 319 phone (bug log §10, E1/E2). */
export const SHORT_BOX = { w: 855, h: 319 } as const

export interface WorstSpec {
  state: WorstState
  seats: number
  lang: Language
  /** The viewer's own name is `LONG_NAME` rather than `NAMES[0]`. */
  long: boolean
  /** A frame forced on the room whatever the window is; `null` leaves the choice to the window's own media query. */
  frame: RoomFrame | null
  /** The viewer's own rank, from `/rank<N>`; absent, the viewer keeps `RANKS[ME]`. */
  meRank?: number
  /** `/short`: the room in a box this size (and the landscape frame) rather than the whole window. */
  box?: { w: number; h: number }
}

const STATES: readonly WorstState[] = ['waiting', 'turn', 'result', 'blindS', 'blindP', 'blindW', ...CHAOS_STATES]

/**
 * Reads `#worst/<state>/<seats>/<lang>[/long][/landscape|/desktop][/short]`; `null` for any other hash. The tokens after
 * the language are read by name, in any order, and one it does not know is ignored. `/short` forces the landscape frame.
 */
export function parseWorstHash(hash: string): WorstSpec | null {
  const [head, state, seats, lang, ...flags] = hash.replace(/^#/, '').split('/')
  if (head !== 'worst') return null
  const n = Number(seats ?? 6)
  const meRank = flags.map((flag) => /^rank([1-5])$/.exec(flag)?.[1]).find((digit) => digit !== undefined)
  const short = flags.includes('short')
  return {
    state: STATES.includes(state as WorstState) ? (state as WorstState) : 'result',
    seats: Number.isInteger(n) && n >= 2 && n <= 9 ? n : 6,
    lang: SUPPORTED_LANGUAGES.includes(lang as Language) ? (lang as Language) : 'vi',
    long: flags.includes('long'),
    frame: short || flags.includes('landscape') ? 'landscape' : flags.includes('desktop') ? 'desktop' : null,
    ...(meRank === undefined ? {} : { meRank: Number(meRank) }),
    ...(short ? { box: { ...SHORT_BOX } } : {}),
  }
}

/** The Blind Poker states of BP-28: every seat but mine a bot. */
const allBots = (state: WorstState): boolean => state === 'blindP' || state === 'blindW' || isChaos(state)
const BLIND_WAGER = 2_000

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
/** Plan 27: a rank after some of the names — the viewer a Cao thủ (3), the seat after a Huyền thoại (5), then 4 and 2;
 *  the rest are rank 1 and show nothing. */
const RANKS: Record<string, number> = { [ME]: 3, p1: 5, p2: 4, p3: 2 }
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
  if (allBots(state)) {
    return Array.from({ length: n }, (_, seat) => ({
      playerId: seat === 0 ? ME : `bot:worst:${seat}`,
      displayName: seat === 0 ? nameOf(0, long) : `Bot ${seat}`,
      isBot: seat !== 0,
      isHost: seat === 0,
      connected: true,
      seat,
      status: state === 'blindW' ? (seat === 0 ? ('SEATED' as const) : ('READY' as const)) : ('IN_HAND' as const),
      sittingOut: false,
      stack: seat === 0 ? 5_000 : 10_000,
      ready: state !== 'blindW' || seat !== 0,
    }))
  }
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
  if (allBots(state)) {
    const name = 'Góc Bến Nhà Rồng'
    const blind = {
      holeCards: 3 as const,
      decisionMode: state === 'chaosPeel' ? ('none' as const) : ('playOrFold' as const),
      fixedWager: BLIND_WAGER,
      botCount: n - 1,
      ...(isChaos(state) ? { chaosCycle: 5 as const } : {}),
      ...(state === 'chaosPeel' ? { squeeze: true } : {}),
    }
    return {
      roomId: 'worst',
      code: 'WRST28',
      name,
      mode: 'blind',
      config: { name, mode: 'blind', maxPlayers: n, isPrivate: false, turnTimerSec: 20, autoStart: false, hasPassword: false, blind },
      playerCount: n,
      maxPlayers: n,
      status: state === 'blindW' ? 'OPEN' : 'IN_GAME',
      hostPlayerId: ME,
      players: players(n, state, long),
      carryOverPot: 0,
      nextHandAt: state === 'chaosDraft' ? now + 15_000 : state === 'chaosBurst' || state === 'chaosDice' ? now + 10_000 : null,
    }
  }
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

/** A third card for each seat's two, all different from the pair and from one another, so a seat's cards never repeat a key. */
const THIRD = ['2s', '3h', '3d', '4h', '4s', '6c', '8c', '9h', 'Jc']
/** Four cards for the viewer when "Thêm lá" is on a three-card table. */
const FOURTH = '2h'

/** `chaosSix`: my five hole cards (Hên xui, Đảo bài and Thêm lá together), none on the six-card board. */
const MY_FIVE = 'Ah Kh 2s 5c 8d'
const SIX_BOARD = 'Ac Kc 9h 4h 3d 7s'

function chaosSeat(i: number, state: ChaosState, long: boolean): ClientSeat {
  const mine = i === 0
  const over = isOver(state)
  const four = (state === 'chaosFour' || state === 'chaosPeel') && mine
  const six = state === 'chaosSix'
  const count = six ? (mine ? 5 : i === 1 ? 1 : i === 2 ? 5 : 3) : four ? 4 : state === 'chaosFour' && i === 2 ? 4 : 3
  const own = six && mine ? MY_FIVE : `${HANDS[i]!.hole} ${THIRD[i]!}${four ? ` ${FOURTH}` : ''}`
  const turned = state === 'chaosPeel' && i === 1
  const shown = over || (mine && state !== 'chaosBlind') || turned
  return {
    seat: i,
    playerId: mine ? ME : `bot:worst:${i}`,
    displayName: mine ? nameOf(0, long) : `Bot ${i}`,
    isBot: !mine,
    stack: mine ? 3_000 : 8_000,
    betThisStreet: over ? 0 : BLIND_WAGER,
    folded: false,
    allIn: false,
    cardCount: count,
    holeCards: shown ? cards(count === 4 && !mine ? `${own} ${FOURTH}` : own) : null,
    ...(state === 'chaosPeel' ? { revealed: turned } : {}),
    hasDecided: state === 'chaosBoard' || six || (!mine && (state === 'chaosReveal' || state === 'chaosFour' || state === 'chaosBlind' || state === 'chaosBonus' || state === 'chaosArmed' || state === 'chaosGod')),
    decision: null,
    lastAction: null,
    timedOut: false,
  }
}

function seat(n: number, i: number, state: WorstState, long: boolean): ClientSeat {
  if (isChaos(state)) return chaosSeat(i, state, long)
  if (state === 'blindP') {
    // The decision round, every bot chosen: their three cards down, "Đã chọn" and the wager in front of them; mine up,
    // my choice still to make.
    return {
      seat: i,
      playerId: i === 0 ? ME : `bot:worst:${i}`,
      displayName: i === 0 ? nameOf(0, long) : `Bot ${i}`,
      isBot: i !== 0,
      stack: i === 0 ? 3_000 : 8_000,
      betThisStreet: BLIND_WAGER,
      folded: false,
      allIn: false,
      cardCount: 3,
      holeCards: i === 0 ? cards('Kh 9c 4d') : null,
      hasDecided: i !== 0,
      decision: null,
      lastAction: null,
      timedOut: false,
    }
  }
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

/** BP-39 `chaosBurst`: one card fired by each of eight seats, in the order they acted. */
const BURST: { seat: number; cardId: string; outcome: string; targets: number[] }[] = [
  { seat: 0, cardId: 'g_steal_all', outcome: 'applied', targets: [1] },
  { seat: 1, cardId: 's_steal_one', outcome: 'blocked', targets: [0] },
  { seat: 2, cardId: 's_swap_one', outcome: 'applied', targets: [3] },
  { seat: 3, cardId: 'g_redeal_board_1', outcome: 'applied', targets: [] },
  { seat: 4, cardId: 'd_mirror', outcome: 'applied', targets: [] },
  { seat: 5, cardId: 'g_borrow', outcome: 'applied', targets: [6] },
  { seat: 6, cardId: 's_lower', outcome: 'applied', targets: [7] },
  { seat: 7, cardId: 'd_reverse', outcome: 'applied', targets: [] },
]

/** BP-39: my bonus hand in `chaosBonus` (full) and `chaosBurst` (one card left). */
const BONUS_HAND = [
  { uid: 901, cardId: 's_steal_one', tier: 'silver' as const, handsLeft: null },
  { uid: 902, cardId: 'g_redeal_board_1', tier: 'gold' as const, handsLeft: null },
  { uid: 903, cardId: 'd_insure_2', tier: 'diamond' as const, handsLeft: 2 },
]

/** A chaos hand: the round it is in, and — for a hand that is over — a result that pays the viewer, with the cards that acted. */
function chaosHand(n: number, state: ChaosState, long: boolean): ClientHand {
  const all = Array.from({ length: n }, (_, i) => i)
  const over = isOver(state)
  const base: ClientHand = {
    handId: `worst-${state}`,
    mode: 'blind',
    phase: over ? 'COMPLETE' : state === 'chaosPeel' ? 'SQUEEZE' : state === 'chaosBoard' || state === 'chaosSix' ? 'REVEAL' : 'DECISION',
    community: state === 'chaosSix' ? cards(SIX_BOARD) : over || state === 'chaosBoard' ? cards('Ac Kc 9h 4h 3d') : [],
    pot: over ? 0 : n * BLIND_WAGER,
    carryOverIn: 0,
    button: Math.min(3, n - 1),
    actingSeat: null,
    seats: all.map((i) => chaosSeat(i, state, long)),
    mySeat: 0,
    legal:
      over || state === 'chaosPeel' || state === 'chaosBoard' || state === 'chaosSix'
        ? null
        // A Thần at the table (BP-41 G11): nobody may fold.
        : { seat: 0, kinds: state === 'chaosGod' ? ['play'] : ['play', 'fold'], callAmount: BLIND_WAGER, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 },
    result: null,
    potPulse: 1,
    // The toasts play for a live hand (the burst's eight cards arrive with its settlement, in one batch); every other state
    // is a snapshot, which replays nothing.
    restored: state !== 'chaosReveal' && state !== 'chaosBoard' && state !== 'chaosBurst' && state !== 'chaosGod' && state !== 'chaosSix',
    dealtAt: null,
    boardAt: null,
    showdownAt: null,
  }
  if (!over) return base
  const win = n * BLIND_WAGER - 100
  return {
    ...base,
    result: {
      payouts: [{ seat: 0, amount: win }],
      pots: [{ amount: win, eligibleSeats: all, winners: [{ seat: 0, amount: win }] }],
      fee: 100,
      // "Mượn lá": the viewer ranked with a copy of a Q of hearts, one of their winning five.
      showdown: all.map((i) => ({ seat: i, cards: cards(HANDS[i]!.hole), rank: 9 - i, category: HANDS[i]!.category, best: cards(HANDS[i]!.best), ...(i === 0 && state === 'chaosResult' ? { borrowed: cards('Qh')[0]! } : {}) })),
      carryOverOut: 0,
      uncalledReturned: null,
      cancelled: false,
      reason: null,
      chaosUsed: state === 'chaosBurst'
        ? BURST.slice(0, Math.min(n, 8)).map((u) => ({ ...u, targets: [...u.targets] }))
        : [
            { seat: 0, cardId: 'g_swap_all', outcome: 'applied', targets: [] },
            { seat: 0, cardId: 's_peek_1', outcome: 'applied', targets: [] },
            { seat: 1, cardId: 's_steal_one', outcome: 'blocked', targets: [0] },
            ...(n > 2 ? [{ seat: 2, cardId: 'd_mirror', outcome: 'applied', targets: [] }] : []),
          ],
    },
  }
}

/** The cards each seat holds: from none to five, a mix of the tiers, some with hands left and some waiting on their moment. */
const HELD: { cardId: string; tier: 'silver' | 'gold' | 'diamond'; handsLeft: number | null }[] = [
  { cardId: 's_shield', tier: 'silver', handsLeft: null },
  { cardId: 'g_shield_3', tier: 'gold', handsLeft: 3 },
  { cardId: 'd_mirror', tier: 'diamond', handsLeft: null },
  { cardId: 's_rescue', tier: 'silver', handsLeft: null },
  { cardId: 'g_crit', tier: 'gold', handsLeft: null },
  { cardId: 'd_insure_2', tier: 'diamond', handsLeft: 2 },
]
const HELD_COUNT = [3, 1, 2, 4, 5, 0, 1, 2, 3]
/** How many bonus cards each seat holds in `chaosBonus` (mine is the full three). */
const BONUS_COUNT = [3, 1, 0, 2, 1, 0, 1, 2, 0]
const BURST_EFFECT: Record<string, ChaosEffectKind> = {
  g_steal_all: 'stealHole', s_steal_one: 'stealHole', s_swap_one: 'swapHands', g_redeal_board_1: 'redealBoard',
  d_mirror: 'mirror', g_borrow: 'borrowHole', s_lower: 'lowerHole', d_reverse: 'reverseRank',
}

/** `ClientState.chaos` for a chaos state: every seat's cards, and what the state shows besides. */
function chaosState(n: number, state: ChaosState, now: number): ClientChaos {
  const seats: ClientChaos['seats'] = {}
  for (let i = 0; i < n; i++) {
    const count = state === 'chaosFour' && i === 0 ? 5 : (HELD_COUNT[i] ?? 0)
    const bonusCount = state === 'chaosBonus' || state === 'chaosArmed' ? (BONUS_COUNT[i] ?? 0) : state === 'chaosBurst' ? (i % 3 === 0 ? 1 : 0) : 0
    seats[i] = { cards: Array.from({ length: count }, (_, k) => ({ uid: i * 10 + k, ...HELD[(i + k) % HELD.length]! })), points: i, bonusCount }
  }
  const chaos: ClientChaos = { ...initialChaos, seats }
  if (state === 'chaosBonus') return { ...chaos, bonus: { cards: BONUS_HAND.map((c) => ({ ...c })), armed: null } }
  if (state === 'chaosArmed') {
    const pressed = BONUS_HAND[1]!
    return { ...chaos, bonus: { cards: BONUS_HAND.filter((c) => c !== pressed).map((c) => ({ ...c })), armed: { uid: pressed.uid, cardId: pressed.cardId, hand: 'this' } } }
  }
  if (state === 'chaosBurst') {
    return {
      ...chaos,
      bonus: { cards: BONUS_HAND.slice(0, 1).map((c) => ({ ...c })), armed: null },
      applied: BURST.slice(0, Math.min(n, 8)).map((u) => ({ seat: u.seat, cardId: u.cardId, effect: BURST_EFFECT[u.cardId] ?? 'mirror', targets: [...u.targets], outcome: u.outcome as AppliedChaosView['outcome'] })),
    }
  }
  if (state === 'chaosDraft') {
    return { ...chaos, draft: { tier: 'gold', totalMs: 15_000, deadlineAt: now + 15_000, offer: { offerId: 'worst', cardIds: ['g_swap_all', 'g_shield_3', 'g_rescue'] }, picked: false } }
  }
  if (state === 'chaosReveal') {
    return {
      ...chaos,
      applied: [
        { seat: 1, cardId: 's_steal_one', effect: 'stealHole', targets: [0], outcome: 'blocked' },
        { seat: 0, cardId: 'g_swap_all', effect: 'swapAll', targets: [], outcome: 'applied' },
        { seat: 2, cardId: 'd_mirror', effect: 'mirror', targets: [], outcome: 'applied' },
      ],
    }
  }
  if (state === 'chaosFour') return { ...chaos, peek: { seat: 0, cards: cards('Ad Kd 2c') } }
  if (state === 'chaosBoard') {
    return {
      ...chaos,
      reverse: true,
      applied: [
        { seat: 2, cardId: 'd_reverse', effect: 'reverseRank', targets: [], outcome: 'applied' },
        { seat: 1, cardId: 's_steal_one', effect: 'stealHole', targets: [0], outcome: 'blocked' },
        { seat: 0, cardId: 'g_borrow', effect: 'borrowHole', targets: [1], outcome: 'applied' },
      ],
    }
  }
  if (state === 'chaosResult') {
    return {
      ...chaos,
      credits: [
        { seat: 0, amount: 6_000, reason: 'chaos_crit', capped: false, multiplier: 2 },
        { seat: 2, amount: 2_000, reason: 'chaos_rescue', capped: true },
      ],
    }
  }
  // BP-41 round three.
  if (state === 'chaosGod') {
    const carp = { uid: 990, cardId: 'd_carp', tier: 'diamond' as const, handsLeft: null, charge: 35 }
    return {
      ...chaos,
      seats: { ...seats, 0: { ...seats[0]!, cards: [carp, ...(seats[0]?.cards ?? []).slice(0, 2)] } },
      table: {
        god: { seat: 1, handsLeft: 5, curse: 2 },
        demigods: n > 2 ? [{ seat: 2, handsLeft: 5 }] : [],
        bombs: n > 3 ? [{ owner: 0, carrier: 3, handsLeft: 2 }] : [],
      },
      heralds: [
        { id: 1, kind: 'god', seat: 1, name: 'Bot 1', at: now },
        ...(n > 2 ? [{ id: 2, kind: 'demigod' as const, seat: 2, name: 'Bot 2', at: now }] : []),
      ],
      applied: [
        { seat: 1, cardId: 'd_carp', effect: 'carp', targets: [], outcome: 'applied', reign: 'god' },
        { seat: 1, cardId: 'd_carp', effect: 'carp', targets: all(n).filter((i) => i !== 1), outcome: 'applied' },
      ],
    }
  }
  if (state === 'chaosDice') {
    const jackpot = { jackpot: 60 * BLIND_WAGER, cards: [{ tier: 'diamond' as const, count: 2 }], triple: true as const, herald: true as const }
    const mine = { cards: [{ tier: 'silver' as const, count: 1 }] }
    return {
      ...chaos,
      rolls: [
        { id: 1, seat: 1, name: 'Bot 1', cardId: 'd_dice', dice: [6, 6, 6], result: jackpot, at: now },
        { id: 2, seat: 0, name: nameOf(0, false), cardId: 's_dice', dice: [5], result: mine, at: now },
      ],
      heralds: [{ id: 3, kind: 'dice', seat: 1, name: 'Bot 1', dice: [6, 6, 6], amount: jackpot.jackpot, at: now }],
      credits: [{ seat: 1, amount: jackpot.jackpot, reason: 'chaos_jackpot', capped: false }],
      applied: [
        { seat: 1, cardId: 'd_dice', effect: 'fortuneDice', targets: [], outcome: 'applied', dice: [6, 6, 6], roll: jackpot },
        { seat: 0, cardId: 's_dice', effect: 'fortuneDice', targets: [], outcome: 'applied', dice: [5], roll: mine },
      ],
    }
  }
  if (state === 'chaosSix') {
    return {
      ...chaos,
      wild: cards('5c')[0]!,
      applied: [
        { seat: 2, cardId: 'g_sixth_board', effect: 'sixthBoard', targets: [], outcome: 'applied' },
        { seat: 0, cardId: 'd_wild_card', effect: 'wildCard', targets: [], outcome: 'applied', wild: cards('5c')[0]! },
        { seat: 1, cardId: 'd_risky_hand', effect: 'riskyHand', targets: [], outcome: 'applied', holeDelta: -2 },
      ],
    }
  }
  return chaos
}

const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

function hand(n: number, state: WorstState, long: boolean): ClientHand | null {
  if (state === 'waiting' || state === 'blindW') return null
  if (isChaos(state)) return chaosHand(n, state, long)
  const all = Array.from({ length: n }, (_, i) => i)
  if (state === 'blindP') {
    return {
      handId: 'worst-blindP',
      mode: 'blind',
      phase: 'DECISION',
      community: [],
      pot: n * BLIND_WAGER,
      carryOverIn: 0,
      button: Math.min(3, n - 1),
      actingSeat: null,
      seats: all.map((i) => seat(n, i, state, long)),
      mySeat: 0,
      legal: { seat: 0, kinds: ['play', 'fold'], callAmount: BLIND_WAGER, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 },
      result: null,
      potPulse: 1,
      restored: true,
      dealtAt: null,
      boardAt: null,
      showdownAt: null,
    }
  }
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
    pickChaos: ack,
    playBonus: ack,
    skipResult: ack,
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
      deadlineAt: spec.state === 'turn' ? now + 25_000 : spec.state === 'blindS' || spec.state === 'blindP' || (isChaos(spec.state) && !isOver(spec.state)) ? now + 15_000 : null,
      ...(isChaos(spec.state) ? { chaos: chaosState(spec.seats, spec.state, now) } : {}),
      ...(spec.state === 'chaosBurst' || spec.state === 'chaosDice' ? { resultSkips: { skipped: 3, total: 5, mine: false } } : {}),
    })
  }, [spec])
  useEffect(() => {
    document.title = `worst: ${spec.state}, ${spec.seats} seats, ${spec.lang}${spec.long ? ', long name' : ''}${spec.frame === null ? '' : `, ${spec.frame} frame`}${spec.box === undefined ? '' : `, ${spec.box.w} × ${spec.box.h}`}`
  }, [spec])
  const screen = (
    <RoomScreen
      client={client}
      lang={spec.lang}
      onLeft={() => {}}
      captionFor={(p) => (p.isBot ? null : CAPTION)}
      rankFor={(p) => (p.playerId === ME && spec.meRank !== undefined ? spec.meRank : (RANKS[p.playerId] ?? null))}
      frame={spec.frame ?? undefined}
    />
  )
  return (
    <I18nextProvider i18n={i18n}>
      {spec.box === undefined ? (
        screen
      ) : (
        // The room's `--bp-stage` knob, as a host app with a bar of its own turns it: the box is the room's whole height.
        <div style={{ width: spec.box.w, height: spec.box.h, overflow: 'hidden', ['--bp-stage' as string]: '100%' }}>{screen}</div>
      )}
    </I18nextProvider>
  )
}
