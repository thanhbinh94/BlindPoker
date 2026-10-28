import { describe, expect, it } from 'vitest'
import { parseCards, rankOf, type Card } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { applyBlindCommand, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandState } from '../hand/types.js'
import { filterEvent } from '../hand/view.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { receiveCard } from './hold.js'
import { planHand } from './plan.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import { DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type PlannedEffect } from './types.js'

/**
 * BP-41 Task 4: the round-three reveal cards (Hoán vị định mệnh, Ngược dòng, Gậy ông đập lưng ông, Đại hồng thủy, Đổi bài
 * liều, Xào bài, Đổi lá hàng xóm, Xúc xắc định mệnh, Thách đấu), Bia đỡ đạn, Cao thủ, and the order of the reveal. The
 * cards ship disabled in data; the plans here name them directly. A hand is staged at the turn with chosen hole cards,
 * board and deck, then the river's ADVANCE runs the reveal with a scripted rng.
 */

const def = (id: string): ChaosCardDef => {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === id)
  if (!d) throw new Error(`no card ${id}`)
  return d
}
let uidSeq = 1_000
function fx(cardId: string, extra: Partial<PlannedEffect> = {}): PlannedEffect {
  const d = def(cardId)
  return { uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets: [], ...extra }
}
type SeatPlan = { effects?: PlannedEffect[]; shield?: 'shield' | 'mirror'; scapegoat?: true }
function plan(n: number, by: Record<number, SeatPlan>, reverse = false): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({
      seat,
      effects: by[seat]?.effects ?? [],
      shield: by[seat]?.shield ? { uid: 700 + seat, cardId: by[seat]!.shield === 'mirror' ? 'd_mirror' : 's_shield', kind: by[seat]!.shield! } : null,
      blindfolded: false,
      ...(by[seat]?.scapegoat ? { scapegoat: { uid: 800 + seat, cardId: 'g_scapegoat' } } : {}),
    })),
    reverse,
  }
}

/** Answers `vals` in order (each must fit), then 0. */
function script(...vals: number[]): Rng {
  return {
    int: (n) => {
      const v = vals.length > 0 ? vals.shift()! : 0
      if (v >= n) throw new Error(`scripted ${v} does not fit ${n}`)
      return v
    },
  }
}

type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>
const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0 }

/**
 * A hand at the turn: seat i holds `holes[i]`, the board shows `board`'s first four cards and its fifth is the river
 * still to come; `burned` cards sit dealt before the river (to shorten the deck); `next` are the first cards after it.
 */
class Stage {
  state: HandState
  dealEvents: GameEvent[]
  events: GameEvent[] = []
  constructor(o: { chaos: ChaosHandPlan; holes: string[]; board: string; next?: string; burned?: number; rules?: Partial<BlindRules>; dealRng?: Rng }) {
    const rules = { ...RULES, ...o.rules }
    const seats = o.chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false }))
    const res = createBlindHand({ handId: 'r4', rules, seats, button: 0, carryOverIn: 0, chaos: o.chaos }, o.dealRng ?? seededRng(1))
    this.state = res.state
    this.dealEvents = res.events
    const holes = o.holes.map((h) => parseCards(h))
    const board = parseCards(o.board)
    const next = parseCards(o.next ?? '')
    const used = [...holes.flat(), ...board, ...next]
    const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.includes(c))
    const burned = rest.splice(0, o.burned ?? 0)
    this.state.deck = [...holes.flat(), ...board.slice(0, 4), ...burned, board[4]!, ...next, ...rest]
    this.state.deckIndex = holes.flat().length + 4 + burned.length
    this.state.players.forEach((p, i) => {
      p.holeCards = holes[i]!.slice()
    })
    this.state.community = board.slice(0, 4)
    this.state.street = 'TURN'
    this.state.revealQueue = ['RIVER']
  }
  reveal(rng: Rng): this {
    const r = applyBlindCommand(this.state, { type: 'ADVANCE' }, rng)
    this.state = r.state
    this.events.push(...r.events)
    return this
  }
  get chaos() { return this.state.chaos! }
  hole(seat: number): Card[] { return this.state.players.find((p) => p.seat === seat)!.holeCards }
  applied(effect: string, from = this.events): Applied[] {
    return from.filter((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === effect)
  }
  assertDeck(): void {
    expect([...this.state.deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i))
    const seen = [...this.state.players.flatMap((p) => p.holeCards), ...this.state.community]
    expect(new Set(seen).size).toBe(seen.length)
    // Every card in a hand or on the board has been dealt.
    const dealt = new Set(this.state.deck.slice(0, this.state.deckIndex))
    for (const c of seen) expect(dealt.has(c)).toBe(true)
  }
}

const BOARD = 'Kd 7h 4c 2s 9d'

describe('Hoán vị định mệnh (shuffleHoles)', () => {
  it('deals every live hand, the holder\'s too, round among their seats at random; told with the other seats', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_shuffle_holes')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    // Hands from the button: seats 1, 2, 0 → [Ah Kh, 7s 8s, 2c 3d]; Fisher–Yates i=2 j=0, i=1 j=0.
    t.reveal(script(0, 0))
    expect(t.hole(1)).toEqual(parseCards('7s 8s'))
    expect(t.hole(2)).toEqual(parseCards('2c 3d'))
    expect(t.hole(0)).toEqual(parseCards('Ah Kh'))
    expect(t.applied('shuffleHoles')[0]).toMatchObject({ seat: 0, targets: [1, 2], outcome: 'applied' })
    t.assertDeck()
  })

  it('an immune seat keeps its hand; a shield stops nothing (not a debuff) and is not spent', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_shuffle_holes')] }, 1: { shield: 'shield' } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    t.chaos.immune = [2]
    t.reveal(script(0))
    expect(t.hole(2)).toEqual(parseCards('7s 8s'))
    expect(t.hole(1)).toEqual(parseCards('2c 3d'))
    expect(t.hole(0)).toEqual(parseCards('Ah Kh'))
    expect(t.chaos.shieldSpent).toEqual([])
    expect(t.chaos.blocked).toEqual([])
    expect(t.chaos.hit).toEqual([])
  })

  it('fizzles when fewer than two hands can move', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('d_shuffle_holes')] } }), holes: ['2c 3d', 'Ah Kh'], board: BOARD })
    t.chaos.immune = [1]
    t.reveal(script())
    expect(t.applied('shuffleHoles')[0]).toMatchObject({ outcome: 'fizzled', targets: [] })
    expect(t.hole(0)).toEqual(parseCards('2c 3d'))
  })
})

describe('Đại hồng thủy (deluge)', () => {
  it('deals every live hand and the whole board again; a folded seat and an immune seat keep theirs', () => {
    const e = fx('d_deluge')
    const t = new Stage({
      chaos: plan(4, { 0: { effects: [e] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s', 'Tc Td'], board: BOARD,
      next: 'Qc Qd 5h 6h 3s 4s Jc Jd Js 8c 8d',
    })
    t.state.players.find((p) => p.seat === 3)!.folded = true
    t.chaos.immune = [2]
    t.reveal(script())
    // Reachable from the button: seats 1, 0 (2 immune, 3 folded); then the board.
    expect(t.hole(1)).toEqual(parseCards('Qc Qd'))
    expect(t.hole(0)).toEqual(parseCards('5h 6h'))
    expect(t.hole(2)).toEqual(parseCards('7s 8s'))
    expect(t.hole(3)).toEqual(parseCards('Tc Td'))
    expect(t.state.community).toEqual(parseCards('3s 4s Jc Jd Js'))
    expect(t.applied('deluge')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'applied', community: parseCards('3s 4s Jc Jd Js') })
    expect(t.chaos.applied).toContain(e.uid)
    t.assertDeck()
  })

  it('a deck that cannot deal it all fizzles and the card waits', () => {
    const e = fx('d_deluge')
    // 2 seats: 4 hole cards + 5 board to deal (9); 52 − 4 hole − 4 board − 35 burned − the river = 8 left.
    const t = new Stage({ chaos: plan(2, { 0: { effects: [e] } }), holes: ['2c 3d', 'Ah Kh'], board: BOARD, burned: 35 })
    t.reveal(script())
    expect(t.applied('deluge')[0]).toMatchObject({ outcome: 'fizzled' })
    expect(t.chaos.applied).not.toContain(e.uid)
    expect(t.hole(0)).toEqual(parseCards('2c 3d'))
    expect(t.state.community).toEqual(parseCards(BOARD))
  })
})

describe('Ngược dòng (swapLeader)', () => {
  const holes = ['3c 5d', 'Ah Ad', 'Ks Kc'] // on Kd 7h 4c 2s 9d: high card, a pair of Aces, trip Kings
  it('swaps hands with the leader once the board is complete', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_swap_leader')] } }), holes, board: BOARD })
    t.reveal(script())
    expect(t.hole(0)).toEqual(parseCards('Ks Kc'))
    expect(t.hole(2)).toEqual(parseCards('3c 5d'))
    expect(t.applied('swapLeader')[0]).toMatchObject({ seat: 0, targets: [2], outcome: 'applied' })
    expect(t.chaos.hit).toEqual([2])
    t.assertDeck()
  })

  it('does nothing for the leader (spent), against an immune leader (fizzled) or a shielded one (blocked)', () => {
    const lead = new Stage({ chaos: plan(3, { 2: { effects: [fx('d_swap_leader')] } }), holes, board: BOARD }).reveal(script())
    expect(lead.applied('swapLeader')[0]).toMatchObject({ outcome: 'fizzled', targets: [] })
    expect(lead.hole(2)).toEqual(parseCards('Ks Kc'))

    const immune = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_swap_leader')] } }), holes, board: BOARD })
    immune.chaos.immune = [2]
    immune.reveal(script())
    expect(immune.applied('swapLeader')[0]).toMatchObject({ outcome: 'fizzled', targets: [2] })
    expect(immune.hole(0)).toEqual(parseCards('3c 5d'))
    expect(immune.chaos.hit).toEqual([])

    const shielded = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_swap_leader')] }, 2: { shield: 'mirror' } }), holes, board: BOARD })
    shielded.chaos.hit = [0] // the user took a debuff already: the mirror blocks
    shielded.reveal(script())
    expect(shielded.applied('swapLeader')[0]).toMatchObject({ outcome: 'blocked', targets: [2] })
    expect(shielded.hole(0)).toEqual(parseCards('3c 5d'))
  })

  it('under "Thế giới đảo ngược" the leader is the weakest hand', () => {
    const t = new Stage({ chaos: plan(3, { 1: { effects: [fx('d_swap_leader')] } }, true), holes, board: BOARD }).reveal(script())
    expect(t.applied('swapLeader')[0]).toMatchObject({ seat: 1, targets: [0], outcome: 'applied' })
    expect(t.hole(1)).toEqual(parseCards('3c 5d'))
  })

  it('reads the leader after Đại hồng thủy re-dealt the hands and the board', () => {
    const t = new Stage({
      chaos: plan(3, { 0: { effects: [fx('d_swap_leader')] }, 1: { effects: [fx('d_deluge')] } }), holes, board: BOARD,
      // Re-dealt from the button: seat 1, seat 2, seat 0, then the board — seat 1 now holds a full house, Queens on Jacks.
      next: 'Qh Qs 4h 6h 5h 6d Qd Jd 8c 2d Jc',
    })
    t.reveal(script())
    const order = t.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED').map((e) => e.effect)
    expect(order).toEqual(['deluge', 'swapLeader'])
    expect(t.applied('swapLeader')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'applied' })
    expect(t.hole(0)).toEqual(parseCards('Qh Qs'))
    t.assertDeck()
  })
})

describe('Đổi bài liều, Xào bài, Đổi lá hàng xóm', () => {
  it('Đổi bài liều swaps hands with a random live opponent (BP-37 swapHands)', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_swap_hands')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD }).reveal(script(1))
    expect(t.hole(0)).toEqual(parseCards('7s 8s'))
    expect(t.hole(2)).toEqual(parseCards('2c 3d'))
    expect(t.applied('swapHands')[0]).toMatchObject({ seat: 0, targets: [2], outcome: 'applied' })
  })

  it('Xào bài deals one random hole card of a random opponent again; an immune target lets it fizzle', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('s_redeal_hole')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD, next: 'Qc' })
    t.reveal(script(0, 1)) // seat 1, its second card
    expect(t.hole(1)).toEqual(parseCards('Ah Qc'))
    expect(t.applied('redealHole')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'applied' })
    t.assertDeck()

    const immune = new Stage({ chaos: plan(3, { 0: { effects: [fx('s_redeal_hole')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    immune.chaos.immune = [1]
    immune.reveal(script(0))
    expect(immune.applied('redealHole')[0]).toMatchObject({ targets: [1], outcome: 'fizzled' })
    expect(immune.hole(1)).toEqual(parseCards('Ah Kh'))
  })

  it('Đổi lá hàng xóm swaps one random card with the next live seat clockwise (the left); a hit neighbour lets it fizzle', () => {
    const t = new Stage({ chaos: plan(3, { 1: { effects: [fx('s_neighbour_swap')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD }).reveal(script(0, 1))
    expect(t.hole(1)).toEqual(parseCards('8s Kh'))
    expect(t.hole(2)).toEqual(parseCards('7s Ah'))
    expect(t.applied('neighbourSwap')[0]).toMatchObject({ seat: 1, targets: [2], outcome: 'applied' })

    const folded = new Stage({ chaos: plan(3, { 1: { effects: [fx('s_neighbour_swap')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    folded.state.players.find((p) => p.seat === 2)!.folded = true
    folded.reveal(script(0, 0))
    expect(folded.applied('neighbourSwap')[0]).toMatchObject({ targets: [0], outcome: 'applied' })
    expect(folded.hole(0)).toEqual(parseCards('Ah 3d'))

    const hit = new Stage({ chaos: plan(3, { 1: { effects: [fx('s_neighbour_swap')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    hit.chaos.hit = [2]
    hit.reveal(script())
    expect(hit.applied('neighbourSwap')[0]).toMatchObject({ targets: [2], outcome: 'fizzled' })
    expect(hit.hole(1)).toEqual(parseCards('Ah Kh'))
  })
})

describe('Xúc xắc định mệnh (fateDie)', () => {
  const stage = (holes = ['2c 3d', 'Ah Kh']) =>
    new Stage({ chaos: plan(2, { 0: { effects: [fx('g_fate_die')] } }), holes, board: BOARD, next: 'Qc' })

  it('1–2 loses a random card (never the last), 3–4 nothing, 5–6 one more card and the ×2 crit flag', () => {
    const lose = stage().reveal(script(0, 1))
    expect(lose.hole(0)).toEqual(parseCards('2c'))
    expect(lose.applied('fateDie')[0]).toMatchObject({ outcome: 'applied', dice: [1], holeDelta: -1 })
    expect(lose.chaos.outcomes?.fateCrit).toBeUndefined()

    const last = stage(['2c', 'Ah Kh']).reveal(script(1))
    expect(last.hole(0)).toEqual(parseCards('2c'))
    expect(last.applied('fateDie')[0]).toMatchObject({ dice: [2], holeDelta: 0 })

    const still = stage().reveal(script(3))
    expect(still.hole(0)).toEqual(parseCards('2c 3d'))
    expect(still.applied('fateDie')[0]).toMatchObject({ dice: [4], holeDelta: 0 })

    const gain = stage().reveal(script(5))
    expect(gain.hole(0)).toEqual(parseCards('2c 3d Qc'))
    expect(gain.applied('fateDie')[0]).toMatchObject({ dice: [6], holeDelta: 1 })
    expect(gain.chaos.outcomes?.fateCrit).toEqual([0])
    gain.assertDeck()
  })
})

describe('Thách đấu (duel)', () => {
  const strong = 'Ah Ad'
  const weak = '3c 5d'

  it('a winning hand rolls the wagers the loser owes: Vàng 10 % three, 30 % two, else nothing', () => {
    const e = fx('g_duel')
    const three = new Stage({ chaos: plan(2, { 0: { effects: [e] } }), holes: [strong, weak], board: BOARD }).reveal(script(0, 5))
    expect(three.applied('duel')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'applied', wagers: 3 })
    expect(three.chaos.duels).toEqual([{ winner: 0, payer: 1, wagers: 3, cardId: 'g_duel', uid: e.uid }])
    expect(three.chaos.hit).toEqual([1])
    expect(three.chaos.outcomes?.duelWins).toEqual([0])

    const two = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] } }), holes: [strong, weak], board: BOARD }).reveal(script(0, 39))
    expect(two.chaos.duels?.[0]).toMatchObject({ winner: 0, payer: 1, wagers: 2 })

    const none = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] } }), holes: [strong, weak], board: BOARD }).reveal(script(0, 40))
    expect(none.applied('duel')[0]).toMatchObject({ outcome: 'applied', wagers: 0 })
    expect(none.chaos.duels).toBeUndefined()
    expect(none.chaos.outcomes?.duelWins).toBeUndefined()
  })

  it('Bạc pays only two wagers, at 25 %; a losing or tied hand owes nothing and rolls nothing', () => {
    const silver = new Stage({ chaos: plan(2, { 0: { effects: [fx('s_duel')] } }), holes: [strong, weak], board: BOARD }).reveal(script(0, 0))
    expect(silver.chaos.duels?.[0]).toMatchObject({ wagers: 2 })
    const lost = new Stage({ chaos: plan(2, { 0: { effects: [fx('s_duel')] } }), holes: [weak, strong], board: BOARD }).reveal(script(0, 99))
    expect(lost.applied('duel')[0]).toMatchObject({ wagers: 0 })
    expect(lost.chaos.duels).toBeUndefined()
  })

  it('a mirror turns it round: the target challenges the holder, who owes', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] }, 1: { shield: 'mirror' } }), holes: [weak, strong], board: BOARD }).reveal(script(0, 5))
    expect(t.applied('duel')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'reflected', wagers: 3 })
    expect(t.chaos.duels?.[0]).toMatchObject({ winner: 1, payer: 0, wagers: 3 })
  })

  it('compares the hands after the borrowed cards (the last reveal step)', () => {
    // Seat 1 borrows a copy of seat 0's Ah: with 3c 5d and the board's 2s 4c it ranks a wheel (A-2-3-4-5), above seat
    // 0's pair of Aces, so seat 0's duel owes nothing (rng: the borrowed seat, its card, the duel's target).
    const t = new Stage({
      chaos: plan(2, { 0: { effects: [fx('g_duel')] }, 1: { effects: [fx('g_borrow')] } }), holes: [strong, weak], board: BOARD,
    }).reveal(script(0, 0, 0, 5))
    expect(t.applied('borrowHole')[0]).toMatchObject({ seat: 1, outcome: 'applied' })
    expect(t.applied('duel')[0]).toMatchObject({ seat: 0, wagers: 0 })
  })
})

describe('Gậy ông đập lưng ông (backfire)', () => {
  it('is told to the table at the deal; every debuff of another seat turns back on its user, the deal\'s included', () => {
    const curse = fx('g_curse')
    const backfire = fx('d_backfire')
    const t = new Stage({
      chaos: plan(3, { 0: { effects: [curse] }, 2: { effects: [backfire, fx('s_redeal_hole')] }, 1: { effects: [fx('s_freeze_one', { targets: [2] })] } }),
      holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD, next: 'Qc',
    })
    const told = t.applied('backfire', t.dealEvents)[0]!
    expect(told).toMatchObject({ seat: 2, outcome: 'applied', targets: [] })
    expect(filterEvent(told, 1)).not.toBeNull()
    expect(t.chaos.applied).toContain(backfire.uid)
    // The curse (deal) bounced on seat 0; the freeze on seat 1.
    expect(t.applied('curse', t.dealEvents)[0]).toMatchObject({ seat: 0, outcome: 'reflected' })
    expect(t.applied('freeze', t.dealEvents)[0]).toMatchObject({ seat: 1, targets: [2], outcome: 'reflected' })
    expect(t.chaos.marks).toEqual([{ seat: 1, kind: 'freeze' }])
    // The holder's own debuff lands: Xào bài on a fresh opponent (0 and 1 are hit; nobody is fresh → fizzled).
    t.reveal(script())
    expect(t.applied('redealHole')[0]).toMatchObject({ seat: 2, outcome: 'fizzled' })
  })

  it("the holder's own debuff is not turned back; another seat's reveal debuff is", () => {
    const t = new Stage({
      chaos: plan(3, { 0: { effects: [fx('s_redeal_hole')] }, 1: { effects: [fx('d_backfire'), fx('g_swap_hands')] } }),
      holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD, next: 'Qc',
    })
    // From the button: seat 1 swaps first (lands on seat 2, rng 1), then seat 0's Xào bài turns back on seat 0 (slot 0).
    t.reveal(script(1, 0))
    expect(t.applied('swapHands')[0]).toMatchObject({ seat: 1, targets: [2], outcome: 'applied' })
    expect(t.hole(1)).toEqual(parseCards('7s 8s'))
    expect(t.applied('redealHole')[0]).toMatchObject({ seat: 0, outcome: 'reflected' })
    expect(t.hole(0)).toEqual(parseCards('Qc 3d'))
    expect(t.chaos.hit.sort()).toEqual([0, 2])
    t.assertDeck()
  })

  it('a turned-back debuff fizzles on a user already hit or immune to it; Cướp đoạt turns back to nothing', () => {
    const immune = new Stage({ chaos: plan(2, { 0: { effects: [fx('s_redeal_hole')] }, 1: { effects: [fx('d_backfire')] } }), holes: ['2c 3d', 'Ah Kh'], board: BOARD })
    immune.chaos.immune = [0, 1]
    immune.reveal(script())
    expect(immune.applied('redealHole')[0]).toMatchObject({ outcome: 'fizzled', targets: [1] })
    expect(immune.hole(0)).toEqual(parseCards('2c 3d'))

    const plunder = new Stage({ chaos: plan(2, { 0: { effects: [fx('d_plunder')] }, 1: { effects: [fx('d_backfire')] } }), holes: ['2c 3d', 'Ah Kh'], board: BOARD })
    expect(plunder.applied('plunder', plunder.dealEvents)[0]).toMatchObject({ seat: 0, outcome: 'reflected', targets: [] })
    expect(plunder.chaos.hit).toEqual([])
  })

  it('turns a duel round: the target challenges the user', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] }, 1: { effects: [fx('d_backfire')] } }), holes: ['3c 5d', 'Ah Ad'], board: BOARD }).reveal(script(0, 0))
    expect(t.applied('duel')[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'reflected', wagers: 3 })
    expect(t.chaos.duels?.[0]).toMatchObject({ winner: 1, payer: 0 })
  })

  it('one that joins the plan after the deal is told at the reveal, unless its holder folded', () => {
    const late = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_swap_hands')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    late.chaos.plan.seats[1]!.effects.push(fx('d_backfire', { fromBonus: true }))
    late.reveal(script(0))
    const kinds = late.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED').map((e) => `${e.effect}:${e.outcome}`)
    expect(kinds).toEqual(['backfire:applied', 'swapHands:reflected'])

    const folded = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_swap_hands')] } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    folded.chaos.plan.seats[1]!.effects.push(fx('d_backfire', { fromBonus: true }))
    folded.state.players.find((p) => p.seat === 1)!.folded = true
    folded.reveal(script(0))
    expect(folded.applied('backfire')).toEqual([])
    expect(folded.applied('swapHands')[0]).toMatchObject({ outcome: 'applied', targets: [2] })
  })
})

describe('Bia đỡ đạn (scapegoat)', () => {
  it('the next debuff aimed at its holder goes to another seat at random; the card is spent', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_swap_hands')] }, 1: { scapegoat: true } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    t.reveal(script(0, 0)) // aimed at seat 1; handed to seat 2 (the only other seat)
    expect(t.applied('scapegoat')[0]).toMatchObject({ seat: 1, targets: [2], outcome: 'applied' })
    expect(t.applied('swapHands')[0]).toMatchObject({ seat: 0, targets: [2], outcome: 'applied' })
    expect(t.hole(0)).toEqual(parseCards('7s 8s'))
    expect(t.hole(1)).toEqual(parseCards('Ah Kh'))
    expect(t.chaos.applied).toContain(801)
    expect(t.chaos.hit).toEqual([2])
  })

  it('acts on a deal debuff too (a freeze lands on another seat)', () => {
    const t = new Stage({
      chaos: plan(3, { 0: { effects: [fx('s_freeze_one', { targets: [1] })] }, 1: { scapegoat: true } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD,
    })
    expect(t.chaos.marks).toEqual([{ seat: 2, kind: 'freeze' }])
    expect(t.applied('scapegoat', t.dealEvents)[0]).toMatchObject({ seat: 1, targets: [2] })
  })

  it('a standing shield blocks first and the scapegoat waits; with nobody to take it, the debuff lands and it waits', () => {
    const shield = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_swap_hands')] }, 1: { scapegoat: true, shield: 'shield' } }), holes: ['2c 3d', 'Ah Kh', '7s 8s'], board: BOARD })
    shield.reveal(script(0))
    expect(shield.applied('swapHands')[0]).toMatchObject({ outcome: 'blocked', targets: [1] })
    expect(shield.chaos.applied).not.toContain(801)

    const alone = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_swap_hands')] }, 1: { scapegoat: true } }), holes: ['2c 3d', 'Ah Kh'], board: BOARD })
    alone.reveal(script(0))
    expect(alone.applied('scapegoat')).toEqual([])
    expect(alone.applied('swapHands')[0]).toMatchObject({ outcome: 'applied', targets: [1] })
    expect(alone.chaos.applied).not.toContain(801)
  })

  it('never hands a hole-card debuff to an immune seat', () => {
    const t = new Stage({ chaos: plan(4, { 0: { effects: [fx('s_redeal_hole')] }, 1: { scapegoat: true } }), holes: ['2c 3d', 'Ah Kh', '7s 8s', 'Tc Td'], board: BOARD, next: 'Qc' })
    t.chaos.immune = [2]
    t.reveal(script(0, 0, 0)) // aimed at seat 1 → handed to seat 3 (seat 2 immune) → its first card
    expect(t.applied('scapegoat')[0]).toMatchObject({ seat: 1, targets: [3] })
    expect(t.hole(3)).toEqual(parseCards('Qc Td'))
  })

  it('planHand stands the oldest held one, never for a frozen or eclipsed seat', () => {
    let n = 1
    const holding = (ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({
      ...ids.reduce((s, id) => receiveCard(s, def(id), () => n++, CHAOS_CARDS_SPEC, 'none', seededRng(1)).seat, EMPTY_CHAOS_SEAT), ...extra,
    })
    const rules: BlindRules = RULES
    const base = { rules, pool: CHAOS_CARDS_SPEC, rng: seededRng(2), nextUid: () => 5_000 + n++ }
    const sg = holding(['g_scapegoat'])
    const p = planHand({ ...base, seats: [{ seat: 0, isBot: false, chaos: sg }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }] })
    expect(p.plan.seats[0]!.scapegoat).toEqual({ uid: sg.cards[0]!.uid, cardId: 'g_scapegoat' })
    expect(p.plan.seats[0]!.effects).toEqual([])
    const frozen = planHand({ ...base, seats: [{ seat: 0, isBot: false, chaos: { ...sg, frozenNextHand: true } }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }] })
    expect(frozen.plan.seats[0]!.scapegoat).toBeUndefined()
    const dark = planHand({ ...base, seats: [{ seat: 0, isBot: false, chaos: sg }, { seat: 1, isBot: false, chaos: holding(['d_eclipse']) }] })
    expect(dark.plan.seats[0]!.scapegoat).toBeUndefined()
    expect(dark.plan.seats[0]!.eclipsed).toBe(true)
  })
})

describe('the reveal order', () => {
  it('hand debuffs → shuffles → re-deals → the die → Ngược dòng → borrowed cards → duels', () => {
    const t = new Stage({
      chaos: plan(4, {
        0: { effects: [fx('g_borrow'), fx('g_fate_die')] },
        1: { effects: [fx('s_redeal_hole'), fx('d_shuffle_holes')] },
        2: { effects: [fx('d_swap_leader'), fx('d_deluge'), fx('g_redeal_board_1')] },
        3: { effects: [fx('g_duel')] },
      }),
      holes: ['2c 3d', 'Ah Kh', '7s 8s', 'Tc Td'], board: BOARD,
    })
    t.reveal(seededRng(7))
    const order = t.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED').map((e) => e.effect)
    expect(order).toEqual(['redealHole', 'shuffleHoles', 'deluge', 'redealBoard', 'fateDie', 'swapLeader', 'borrowHole', 'duel'])
    t.assertDeck()
    expect(t.events.at(-1)).toEqual({ type: 'HAND_COMPLETE' })
  })

  it('many seeded reveals keep the deck whole and every hand unique', () => {
    const kinds = ['d_shuffle_holes', 'd_deluge', 'g_fate_die', 'g_borrow']
    const debuffs = ['s_redeal_hole', 's_neighbour_swap', 'g_swap_hands', 'd_swap_leader', 'g_duel', 's_duel', 's_steal_one']
    for (let seed = 1; seed <= 150; seed++) {
      const r = seededRng(seed)
      const n = 2 + r.int(5)
      const by: Record<number, SeatPlan> = {}
      for (let s = 0; s < n; s++) {
        by[s] = {
          effects: [fx(debuffs[r.int(debuffs.length)]!), ...(r.int(2) ? [fx(kinds[r.int(kinds.length)]!)] : []), ...(r.int(6) ? [] : [fx('d_backfire')])],
          ...(r.int(4) ? {} : { scapegoat: true as const }),
          ...(r.int(5) ? {} : { shield: r.int(2) ? ('mirror' as const) : ('shield' as const) }),
        }
      }
      const holes = Array.from({ length: n }, () => '')
      const cards = 'Ac Kc Qc Jc Tc 9c 8c 7c 6c 5c 3c 2c Ah Kh Qh Jh'.split(' ')
      for (let s = 0; s < n; s++) holes[s] = `${cards[2 * s]} ${cards[2 * s + 1]}`
      const t = new Stage({ chaos: plan(n, by), holes, board: BOARD, rules: { holeCards: 2 } })
      t.reveal(seededRng(seed * 31))
      t.assertDeck()
      expect(t.state.phase).toBe('COMPLETE')
      for (const p of t.state.players) expect(p.holeCards.length).toBeGreaterThan(0)
    }
  })
})

describe('afterHand: Cao thủ, Bia đỡ đạn', () => {
  let n = 1
  const holding = (ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({
    ...ids.reduce((s, id) => receiveCard(s, def(id), () => n++, CHAOS_CARDS_SPEC, 'none', seededRng(1)).seat, EMPTY_CHAOS_SEAT), ...extra,
  })
  const run = (chaos: ChaosSeat, s: Partial<AfterHandSeat>, over: Partial<Parameters<typeof afterHand>[0]> = {}) =>
    afterHand({
      rules: RULES, config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1_000 }, pool: CHAOS_CARDS_SPEC, rng: seededRng(3), nextUid: () => 9_000 + n++,
      plan: { seats: [{ seat: 0, effects: [], shield: null, blindfolded: false }], reverse: false },
      consumed: new Set(), carryOverOnly: false, marks: [],
      seats: [{ seat: 0, isBot: false, chaos, stackAfter: 10_000, net: 0, inHand: true, outcome: 'none', ...s }], ...over,
    }).seats.get(0)!

  it('Cao thủ: +3 chaos points if the next hand is won (flat), spent on a loss, waits through a carry-over or a frozen hand', () => {
    const m = holding(['s_master'])
    expect(m.cards.map((c) => c.effect)).toEqual(['master'])
    const won = run({ ...m, streak: { kind: 'win', len: 2 } }, { outcome: 'win' })
    expect(won.points).toBe(2 + 3) // the 3rd win of a streak is worth 2, Cao thủ adds 3 undoubled
    expect(won.cards).toEqual([])
    const lost = run(m, { outcome: 'loss' })
    expect(lost.points).toBe(2)
    expect(lost.cards).toEqual([])
    expect(run(m, { outcome: 'none' }).cards).toHaveLength(1)
    expect(run({ ...m, frozenNextHand: true }, { outcome: 'win' }).cards).toHaveLength(1)
  })

  it('Bia đỡ đạn leaves once the engine spent it, and waits otherwise', () => {
    const sg = holding(['g_scapegoat'])
    const uid = sg.cards[0]!.uid
    expect(run(sg, { outcome: 'loss' }, { consumed: new Set([uid]) }).cards).toEqual([])
    expect(run(sg, { outcome: 'loss' }).cards).toHaveLength(1)
  })
})

describe('Gậy ông at the deal, on the dealt cards', () => {
  it("Lời nguyền turned back changes its user's highest dealt card into a 2; the target keeps its cards", () => {
    const dealt = (t: Stage, seat: number) =>
      t.dealEvents.find((e): e is Extract<GameEvent, { type: 'CARDS_DEALT' }> => e.type === 'CARDS_DEALT' && e.seat === seat)!.cards
    let lowered = 0
    for (let seed = 1; seed <= 20; seed++) {
      const opts = { holes: ['2c 3d', 'Ah Kh'], board: BOARD }
      const plain = new Stage({ ...opts, chaos: plan(2, {}), dealRng: seededRng(seed) })
      const t = new Stage({ ...opts, chaos: plan(2, { 0: { effects: [fx('g_curse')] }, 1: { effects: [fx('d_backfire')] } }), dealRng: seededRng(seed) })
      expect(t.applied('curse', t.dealEvents)[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'reflected' })
      expect(t.chaos.hit).toEqual([0])
      expect(dealt(t, 1)).toEqual(dealt(plain, 1))
      const before = dealt(plain, 0)
      const after = dealt(t, 0)
      const top = before.reduce((hi, c, i) => (rankOf(c) > rankOf(before[hi]!) ? i : hi), 0)
      if (rankOf(before[top]!) === 0) continue // nothing above a 2 to lower
      expect(rankOf(after[top]!)).toBe(0)
      expect(after.filter((_, i) => i !== top)).toEqual(before.filter((_, i) => i !== top))
      lowered++
    }
    expect(lowered).toBeGreaterThan(15)
  })
})
