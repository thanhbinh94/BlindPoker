import { describe, expect, it } from 'vitest'
import { parseCards } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandState } from '../hand/types.js'
import { filterEvent } from '../hand/view.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { toHeld } from './hold.js'
import { passBombs, planHand } from './plan.js'
import { afterHand } from './settle.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE,
  type ChaosBomb, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type ChaosTableState, type HeldCard, type PlannedEffect,
} from './types.js'

/**
 * BP-41 Task 5b: the points the round-three cards move between players at the settlement (`SettleHooks.afterPayout` →
 * `payTransfers`): Thách đấu's payment (and the Thần's duels, Task 6), Ép chia thưởng, Thuế thắng, and Bom nổ chậm from
 * its plant to its going off. The cards ship disabled in data; the plans here name them directly.
 */

const WAGER = 1000
const def = (id: string): ChaosCardDef => {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === id)
  if (!d) throw new Error(`no card ${id}`)
  return d
}
let uidSeq = 5_000
function fx(cardId: string, extra: Partial<PlannedEffect> = {}): PlannedEffect {
  const d = def(cardId)
  return { uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets: [], ...extra }
}
type SeatPlan = { effects?: PlannedEffect[]; shield?: 'shield' | 'mirror'; scapegoat?: true; stake?: number }
function plan(n: number, by: Record<number, SeatPlan>, bombs?: ChaosBomb[]): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({
      seat,
      effects: by[seat]?.effects ?? [],
      shield: by[seat]?.shield ? { uid: 700 + seat, cardId: by[seat]!.shield === 'mirror' ? 'd_mirror' : 's_shield', kind: by[seat]!.shield! } : null,
      blindfolded: false,
      ...(by[seat]?.scapegoat ? { scapegoat: { uid: 800 + seat, cardId: 'g_scapegoat' } } : {}),
      ...(by[seat]?.stake ? { stake: by[seat]!.stake } : {}),
    })),
    reverse: false,
    ...(bombs ? { bombs } : {}),
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
const zero: Rng = { int: () => 0 }
const last: Rng = { int: (n) => n - 1 }

type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>
const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: WAGER, tableFeeRate: 0 }
const BOARD = 'Kd 7h 4c 2s 9d'

/**
 * A hand at the turn (every seat anted one wager, or its stake): seat i holds `holes[i]`, the board shows `board`'s first
 * four cards and its river is still to come. `folded`: seats that folded after the ante (still in `state.players`).
 */
class Stage {
  state: HandState
  events: GameEvent[] = []
  readonly start: number
  constructor(o: { chaos: ChaosHandPlan; holes: string[]; board?: string; stacks?: number[]; folded?: number[]; rules?: Partial<BlindRules>; carryOverIn?: number }) {
    const rules = { ...RULES, ...o.rules }
    const seats = o.chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: o.stacks?.[seat] ?? 5000, isBot: seat % 2 === 1 }))
    this.start = seats.reduce((a, s) => a + s.stack, 0) + (o.carryOverIn ?? 0)
    const res = createBlindHand({ handId: 't5b', rules, seats, button: 0, carryOverIn: o.carryOverIn ?? 0, chaos: o.chaos }, seededRng(1))
    this.state = res.state
    this.events.push(...res.events)
    const holes = o.holes.map((h) => parseCards(h))
    const board = parseCards(o.board ?? BOARD)
    const used = [...holes.flat(), ...board]
    const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.includes(c))
    this.state.deck = [...holes.flat(), ...board, ...rest]
    this.state.deckIndex = holes.flat().length + 4
    this.state.players.forEach((p, i) => {
      p.holeCards = holes[i]!.slice()
      if (o.folded?.includes(p.seat)) p.folded = true
    })
    this.state.community = board.slice(0, 4)
    this.state.street = 'TURN'
    this.state.revealQueue = ['RIVER']
  }
  reveal(rng: Rng = zero): this {
    const r = applyBlindCommand(this.state, { type: 'ADVANCE' }, rng)
    this.state = r.state
    this.events.push(...r.events)
    return this
  }
  stack(seat: number): number { return this.state.players.find((p) => p.seat === seat)!.stack }
  applied(effect: string): Applied[] { return this.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === effect) }
  settlement() { return this.events.find((e): e is Extract<GameEvent, { type: 'SETTLEMENT' }> => e.type === 'SETTLEMENT')! }
  payout(seat: number): number { return this.settlement().payouts.find((p) => p.seat === seat)?.amount ?? 0 }
  conserved(): void {
    const r = this.state.result!
    expect(this.state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut).toBe(this.start)
    expect(this.state.players.every((p) => p.stack >= 0)).toBe(true)
    // SETTLEMENT tells the stacks after every transfer.
    expect(this.settlement().stacks).toEqual(this.state.players.map((p) => ({ seat: p.seat, stack: p.stack })))
  }
}

const STRONG = 'Ah Ad'
const WEAK = '3c 5d'
const MID = '6c 8d'

describe('Thách đấu: the loser pays at the settlement', () => {
  it('the payer pays wagers × the fixed wager to the winner after the pot is paid; SETTLEMENT stacks include it', () => {
    const e = fx('g_duel')
    const t = new Stage({ chaos: plan(2, { 0: { effects: [e] } }), holes: [STRONG, WEAK] }).reveal(script(0, 5))
    expect(t.payout(0)).toBe(2000) // the pot itself is unchanged
    expect(t.stack(0)).toBe(4000 + 2000 + 3000)
    expect(t.stack(1)).toBe(4000 - 3000)
    const paid = t.applied('duel').find((x) => x.transfers)!
    expect(paid).toMatchObject({ seat: 0, cardId: 'g_duel', targets: [1], outcome: 'applied', amount: 3000, transfers: [{ from: 1, to: 0, amount: 3000 }] })
    // The duel's line in the summary was written at the reveal; the payment adds none.
    const summary = t.events.find((x): x is Extract<GameEvent, { type: 'CHAOS_SUMMARY' }> => x.type === 'CHAOS_SUMMARY')!
    expect(summary.used.filter((u) => u.effect === 'duel')).toHaveLength(1)
    // Told before the summary and the settlement, and to every seat and spectator.
    const types = t.events.map((x) => x.type)
    expect(types.indexOf('CHAOS_SUMMARY')).toBeGreaterThan(t.events.indexOf(paid))
    expect(filterEvent(paid, null)).toEqual(paid)
    t.conserved()
  })

  it('a payer short of the debt pays its stack and stops at 0 (spec §3)', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] } }), holes: [STRONG, WEAK], stacks: [5000, 2500] }).reveal(script(0, 5))
    expect(t.stack(1)).toBe(0)
    expect(t.stack(0)).toBe(4000 + 2000 + 1500)
    expect(t.applied('duel').find((x) => x.transfers)!.transfers).toEqual([{ from: 1, to: 0, amount: 1500 }])
    t.conserved()
  })

  it('a payer already at 0 (all in and lost) pays nothing: the payment is told as 0', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] } }), holes: [STRONG, WEAK], stacks: [5000, 1000] }).reveal(script(0, 5))
    expect(t.stack(1)).toBe(0)
    expect(t.applied('duel').find((x) => x.transfers)!.transfers).toEqual([{ from: 1, to: 0, amount: 0 }])
    t.conserved()
  })

  it('a duel turned round by a mirror: the holder lost it and pays the seat it challenged', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] }, 1: { shield: 'mirror' } }), holes: [WEAK, STRONG] }).reveal(script(0, 5))
    expect(t.stack(1)).toBe(4000 + 2000 + 3000)
    expect(t.stack(0)).toBe(1000)
    t.conserved()
  })

  it('a duel that rolled nothing moves nothing', () => {
    const t = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_duel')] } }), holes: [STRONG, WEAK] }).reveal(script(0, 99))
    expect(t.applied('duel').some((x) => x.transfers)).toBe(false)
    expect(t.stack(0)).toBe(6000)
    t.conserved()
  })

  it('Ruling 2: the cards’ duels are paid before the Thần’s (Task 6 pushes its own, marked `god`)', () => {
    const t = new Stage({ chaos: plan(3, {}), holes: [STRONG, WEAK, MID] })
    t.state.chaos!.duels = [
      { winner: 0, payer: 2, wagers: 1, cardId: 'd_carp', uid: 1, god: true },
      { winner: 0, payer: 1, wagers: 2, cardId: 's_duel', uid: 2 },
    ]
    t.reveal()
    const paid = t.events.filter((x): x is Applied => x.type === 'CHAOS_APPLIED' && x.transfers !== undefined)
    expect(paid.map((x) => [x.effect, x.transfers])).toEqual([
      ['duel', [{ from: 1, to: 0, amount: 2000 }]],
      ['carp', [{ from: 2, to: 0, amount: 1000 }]],
    ])
    t.conserved()
  })
})

describe('Ép chia thưởng', () => {
  it('a holder still in that lost takes half the winner’s net win (payout − what it put in), the winner pays', () => {
    const e = fx('d_share_winnings')
    const t = new Stage({ chaos: plan(3, { 2: { effects: [e] } }), holes: [STRONG, MID, WEAK] }).reveal()
    // Pot 3 000 to seat 0, who put in 1 000: net 2 000, half of it to seat 2.
    expect(t.stack(0)).toBe(4000 + 3000 - 1000)
    expect(t.stack(2)).toBe(4000 + 1000)
    expect(t.stack(1)).toBe(4000)
    expect(t.applied('shareWinnings')).toEqual([expect.objectContaining({ seat: 2, targets: [0], outcome: 'applied', amount: 1000, transfers: [{ from: 0, to: 2, amount: 1000 }] })])
    const summary = t.events.find((x): x is Extract<GameEvent, { type: 'CHAOS_SUMMARY' }> => x.type === 'CHAOS_SUMMARY')!
    expect(summary.used).toContainEqual({ seat: 2, cardId: 'd_share_winnings', effect: 'shareWinnings', outcome: 'applied', targets: [0] })
    t.conserved()
  })

  it('a holder who folded, or who won, takes nothing', () => {
    const folded = new Stage({ chaos: plan(3, { 2: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK], folded: [2] }).reveal()
    expect(folded.applied('shareWinnings')).toEqual([])
    expect(folded.stack(2)).toBe(4000)
    folded.conserved()
    const won = new Stage({ chaos: plan(3, { 0: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK] }).reveal()
    expect(won.applied('shareWinnings')).toEqual([])
    expect(won.stack(0)).toBe(7000)
    won.conserved()
  })

  it('a split pot: each winner pays half of its own net win', () => {
    const t = new Stage({ chaos: plan(3, { 2: { effects: [fx('d_share_winnings')] } }), holes: ['Ah Kc', 'As Kh', WEAK] }).reveal()
    // 3 000 split 1 500 / 1 500, each put in 1 000: net 500 each, 250 each to seat 2.
    expect(t.payout(0)).toBe(1500)
    expect(t.payout(1)).toBe(1500)
    expect(t.applied('shareWinnings')[0]!.transfers).toEqual([{ from: 1, to: 2, amount: 250 }, { from: 0, to: 2, amount: 250 }])
    expect(t.stack(2)).toBe(4500)
    t.conserved()
  })

  it('two holders: clockwise from the button, the second takes half of what the first left', () => {
    const t = new Stage({ chaos: plan(4, { 2: { effects: [fx('d_share_winnings')] }, 3: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK, '3d 5c'] }).reveal()
    // Pot 4 000, net 3 000: seat 2 takes 1 500, seat 3 half of the 1 500 left.
    expect(t.stack(2)).toBe(4000 + 1500)
    expect(t.stack(3)).toBe(4000 + 750)
    expect(t.stack(0)).toBe(4000 + 4000 - 2250)
    t.conserved()
  })

  it('the net win counts a stake card’s dead money as put in', () => {
    // Seat 0 stakes ×2: 1 000 real + 1 000 dead. Pot 3 000 + 1 000 dead = 4 000; net 4 000 − 2 000 = 2 000.
    const t = new Stage({ chaos: plan(3, { 0: { stake: 2 }, 2: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK] }).reveal()
    expect(t.payout(0)).toBe(4000)
    expect(t.applied('shareWinnings')[0]!.transfers).toEqual([{ from: 0, to: 2, amount: 1000 }])
    t.conserved()
  })

  it('a winner of a side pot that lost the main pot made no net win: it pays nothing', () => {
    // Seat 1 (short, 600) holds the best hand and takes the main pot 1 800; seat 0 wins the side pot of 800 it put
    // 1 000 for (net −200); the holder, seat 2, lost both and takes half of seat 1's net (1 800 − 600 = 1 200).
    const t = new Stage({ chaos: plan(3, { 2: { effects: [fx('d_share_winnings')] } }), holes: [MID, STRONG, WEAK], stacks: [5000, 600, 5000] }).reveal()
    expect(t.payout(1)).toBe(1800)
    expect(t.payout(0)).toBe(800)
    expect(t.applied('shareWinnings')[0]!.transfers).toEqual([{ from: 1, to: 2, amount: 600 }])
    t.conserved()
  })
})

describe('Thuế thắng', () => {
  it('every winner but the holder pays it 10 % of its net win, folded or not', () => {
    const t = new Stage({ chaos: plan(3, { 2: { effects: [fx('g_win_tax')] } }), holes: [STRONG, MID, WEAK], folded: [2] }).reveal()
    // Pot 3 000 (seat 2's folded ante in it), net 2 000: 200 to seat 2.
    expect(t.applied('winTax')).toEqual([expect.objectContaining({ seat: 2, targets: [0], amount: 200, transfers: [{ from: 0, to: 2, amount: 200 }] })])
    expect(t.stack(2)).toBe(4200)
    t.conserved()
  })

  it('a pot carried in counts as the winner’s profit (Ruling 16): Thuế thắng and Ép chia thưởng take their share of it too', () => {
    // Pot 3 000 + 3 000 carried in; seat 0 put in 1 000, so its net win is 5 000: 10 % to the tax holder.
    const tax = new Stage({ chaos: plan(3, { 2: { effects: [fx('g_win_tax')] } }), holes: [STRONG, MID, WEAK], folded: [2], carryOverIn: 3000 }).reveal()
    expect(tax.payout(0)).toBe(6000)
    expect(tax.applied('winTax')[0]!.transfers).toEqual([{ from: 0, to: 2, amount: 500 }])
    tax.conserved()
    const share = new Stage({ chaos: plan(3, { 2: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK], carryOverIn: 3000 }).reveal()
    const pct = def('d_share_winnings').params.percent!
    expect(share.applied('shareWinnings')[0]!.transfers).toEqual([{ from: 0, to: 2, amount: Math.floor((5000 * pct) / 100) }])
    share.conserved()
  })

  it('a holder who wins pays itself nothing; another winner of a split still pays it', () => {
    const t = new Stage({ chaos: plan(3, { 0: { effects: [fx('g_win_tax')] } }), holes: ['Ah Kc', 'As Kh', WEAK] }).reveal()
    expect(t.applied('winTax')[0]!.transfers).toEqual([{ from: 1, to: 0, amount: 50 }])
    expect(t.stack(0)).toBe(4000 + 1500 + 50)
    t.conserved()
  })

  it('a winner by folds pays it too (the hand settles without a showdown)', () => {
    // A hand in the choice: seat 0 plays, 1 and 2 fold.
    const h = createBlindHand({ handId: 'f', rules: { ...RULES, decisionMode: 'playOrFold' }, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false })), button: 0, carryOverIn: 0, chaos: plan(3, { 2: { effects: [fx('g_win_tax')] } }) }, seededRng(3))
    let state = h.state
    const events: GameEvent[] = []
    for (const [seat, kind] of [[0, 'play'], [1, 'fold'], [2, 'fold']] as const) {
      const r = applyBlindCommand(state, { type: 'ACTION', seat, action: { kind } }, zero)
      state = r.state
      events.push(...r.events)
    }
    expect(state.phase).toBe('COMPLETE')
    // Seat 0 put in 2 000 and takes the 4 000 pot (its uncalled 1 000 comes back first): net 2 000, 200 to seat 2.
    const tax = events.find((x): x is Applied => x.type === 'CHAOS_APPLIED' && x.effect === 'winTax')!
    expect(tax.transfers).toEqual([{ from: 0, to: 2, amount: 200 }])
    expect(state.players.reduce((a, p) => a + p.stack, 0)).toBe(15_000)
  })

  it('Ruling 2: after Ép chia thưởng — the tax is on what the share left', () => {
    const t = new Stage({ chaos: plan(4, { 2: { effects: [fx('d_share_winnings')] }, 3: { effects: [fx('g_win_tax')] } }), holes: [STRONG, MID, WEAK, '3d 5c'] }).reveal()
    // Net 3 000 → seat 2 takes 1 500 → the tax is 10 % of 1 500.
    expect(t.applied('shareWinnings')[0]!.transfers).toEqual([{ from: 0, to: 2, amount: 1500 }])
    expect(t.applied('winTax')[0]!.transfers).toEqual([{ from: 0, to: 3, amount: 150 }])
    t.conserved()
  })

  it('after a duel: what a pot winner took in a duel counts in its net win; a seat ahead only by a duel is no winner', () => {
    // Seat 0 wins the pot (4 000, net 3 000) and a duel off seat 1 (+3 000): taxed on 6 000.
    const both = new Stage({
      chaos: plan(4, { 0: { effects: [fx('g_duel')] }, 3: { effects: [fx('g_win_tax')] } }), holes: [STRONG, WEAK, MID, '3d 5c'], folded: [3],
    }).reveal(script(0, 5))
    expect(both.applied('winTax')[0]!.transfers).toEqual([{ from: 0, to: 3, amount: 600 }])
    both.conserved()
    // Seat 2 wins a duel off seat 1 (fresh opponents [0, 1] → seat 1) but no pot: only seat 0 is taxed, on 3 000.
    const duelOnly = new Stage({
      chaos: plan(4, { 2: { effects: [fx('g_duel')] }, 3: { effects: [fx('g_win_tax')] } }), holes: [STRONG, WEAK, MID, '3d 5c'], folded: [3],
    }).reveal(script(1, 5))
    expect(duelOnly.state.chaos!.duels?.map((d) => [d.winner, d.payer, d.wagers])).toEqual([[2, 1, 3]])
    expect(duelOnly.applied('winTax')[0]!.transfers).toEqual([{ from: 0, to: 3, amount: 300 }])
    duelOnly.conserved()
  })

  it('a seat ahead only by what Ép chia thưởng gave it pays no second holder', () => {
    // Pot 4 000 to seat 0 (net 3 000): seat 2's share takes 1 500 (seat 2 now +500), seat 3's half of the 1 500 left.
    const t = new Stage({ chaos: plan(4, { 2: { effects: [fx('d_share_winnings')] }, 3: { effects: [fx('d_share_winnings')] } }), holes: [STRONG, MID, WEAK, '3d 5c'] }).reveal()
    expect(t.applied('shareWinnings').map((x) => x.transfers)).toEqual([[{ from: 0, to: 2, amount: 1500 }], [{ from: 0, to: 3, amount: 750 }]])
    t.conserved()
  })
})

describe('Bom nổ chậm: the plant', () => {
  const deal = (chaos: ChaosHandPlan, rng: Rng) =>
    createBlindHand({ handId: 'b', rules: RULES, seats: chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false })), button: 0, carryOverIn: 0, chaos }, rng)

  it('lands on a random opponent at the deal: owner and carrier know, the rest of the table does not until the summary', () => {
    const e = fx('d_time_bomb')
    const { state, events } = deal(plan(3, { 0: { effects: [e] } }), last)
    expect(state.chaos!.outcomes?.planted).toEqual([{ owner: 0, carrier: 2, fuse: 3, wagers: 1, cardId: 'd_time_bomb', uid: e.uid }])
    expect(state.chaos!.applied).toContain(e.uid)
    expect(state.chaos!.hit).toEqual([2])
    const ev = events.find((x): x is Applied => x.type === 'CHAOS_APPLIED' && x.effect === 'timeBomb')!
    expect(ev).toMatchObject({ seat: 0, targets: [2], outcome: 'applied' })
    expect(filterEvent(ev, 0)).toEqual(ev)
    expect(filterEvent(ev, 2)).toEqual(ev)
    expect(filterEvent(ev, 1)).toBeNull()
    expect(filterEvent(ev, null)).toBeNull()
  })

  it('a shield blocks it; a mirror turns it round (the seat aimed at plants it on the holder); Bia đỡ đạn hands it on', () => {
    const blocked = deal(plan(2, { 0: { effects: [fx('d_time_bomb')] }, 1: { shield: 'shield' } }), zero)
    expect(blocked.state.chaos!.outcomes?.planted).toBeUndefined()
    const mirrored = deal(plan(2, { 0: { effects: [fx('d_time_bomb')] }, 1: { shield: 'mirror' } }), zero)
    expect(mirrored.state.chaos!.outcomes?.planted).toEqual([expect.objectContaining({ owner: 1, carrier: 0 })])
    const passed = deal(plan(3, { 0: { effects: [fx('d_time_bomb')] }, 1: { scapegoat: true } }), zero)
    expect(passed.state.chaos!.outcomes?.planted).toEqual([expect.objectContaining({ owner: 0, carrier: 2 })])
  })

  it('two holders each plant one', () => {
    const { state } = deal(plan(3, { 0: { effects: [fx('d_time_bomb')] }, 1: { effects: [fx('d_time_bomb')] } }), zero)
    // Clockwise from the button: seat 1 first (on seat 0), then seat 0 (on seat 1: a seat that took a debuff may still use one).
    expect(state.chaos!.outcomes?.planted?.map((b) => [b.owner, b.carrier])).toEqual([[1, 0], [0, 1]])
  })
})

describe('Bom nổ chậm: passed, counted down, going off', () => {
  const bomb = (o: Partial<ChaosBomb> = {}): ChaosBomb => ({ owner: 0, carrier: 1, handsLeft: 2, cardId: 'd_time_bomb', uid: 77, wagers: 1, ...o })

  it('passBombs: to a random seat dealt in that is neither owner nor carrier; heads-up the carrier keeps it; an absent owner’s bomb waits', () => {
    expect(passBombs([bomb()], [0, 1, 2, 3], last)).toEqual({ bombs: [bomb({ carrier: 3 })], playing: [bomb({ carrier: 3 })] })
    expect(passBombs([bomb()], [0, 1, 2, 3], zero).playing[0]!.carrier).toBe(2)
    expect(passBombs([bomb()], [0, 1], last).playing).toEqual([bomb()])
    expect(passBombs([bomb()], [1, 2, 3], last)).toEqual({ bombs: [bomb()], playing: [] })
    // The carrier sat out: it goes to whoever else is dealt in.
    expect(passBombs([bomb({ carrier: 2 })], [0, 1], last).playing[0]!.carrier).toBe(1)
  })

  it('planHand passes the table’s bombs and plays them (`plan.bombs`); an empty table draws nothing', () => {
    const table: ChaosTableState = { ...EMPTY_CHAOS_TABLE, bombs: [bomb()] }
    const seats = [0, 1, 2].map((seat) => ({ seat, isBot: false, chaos: EMPTY_CHAOS_SEAT }))
    const r = planHand({ seats, rules: RULES, pool: CHAOS_CARDS_SPEC, rng: zero, nextUid: () => 1, table })
    expect(r.table.bombs).toEqual([bomb({ carrier: 2 })])
    expect(r.plan.bombs).toEqual([bomb({ carrier: 2 })])
    let draws = 0
    const counting: Rng = { int: () => { draws++; return 0 } }
    const plain = planHand({ seats, rules: RULES, pool: CHAOS_CARDS_SPEC, rng: counting, nextUid: () => 1 })
    expect(draws).toBe(0)
    expect(plain.plan.bombs).toBeUndefined()
    expect(plain.table).toBe(EMPTY_CHAOS_TABLE)
  })

  it('on its last hand it goes off at the settlement: the carrier pays the owner one wager, told to the whole table', () => {
    const t = new Stage({ chaos: plan(3, {}, [bomb({ carrier: 2, handsLeft: 1 })]), holes: [WEAK, STRONG, MID] }).reveal()
    expect(t.stack(1)).toBe(4000 + 3000)
    expect(t.stack(2)).toBe(4000 - 1000)
    expect(t.stack(0)).toBe(4000 + 1000)
    const boom = t.applied('timeBomb')[0]!
    expect(boom).toMatchObject({ seat: 0, targets: [2], outcome: 'applied', amount: 1000, transfers: [{ from: 2, to: 0, amount: 1000 }] })
    expect(filterEvent(boom, 1)).toEqual(boom)
    expect(filterEvent(boom, null)).toEqual(boom)
    t.conserved()
  })

  it('not before its last hand; and a carrier at 0 pays nothing', () => {
    const early = new Stage({ chaos: plan(3, {}, [bomb({ carrier: 2, handsLeft: 2 })]), holes: [WEAK, STRONG, MID] }).reveal()
    expect(early.applied('timeBomb')).toEqual([])
    const broke = new Stage({ chaos: plan(3, {}, [bomb({ carrier: 2, handsLeft: 1 })]), holes: [WEAK, STRONG, MID], stacks: [5000, 5000, 1000] }).reveal()
    expect(broke.applied('timeBomb')[0]!.transfers).toEqual([{ from: 2, to: 0, amount: 0 }])
    broke.conserved()
  })

  it('a hand everyone folds still sets it off; the pot carries over whole', () => {
    const chaos = plan(3, {}, [bomb({ carrier: 1, handsLeft: 1 })])
    const h = createBlindHand({ handId: 'c', rules: { ...RULES, decisionMode: 'playOrFold' }, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false })), button: 0, carryOverIn: 0, chaos }, seededRng(2))
    let state = h.state
    const events: GameEvent[] = []
    for (const seat of [0, 1, 2]) {
      const r = applyBlindCommand(state, { type: 'ACTION', seat, action: { kind: 'fold' } }, zero)
      state = r.state
      events.push(...r.events)
    }
    expect(state.result!.carryOverOut).toBe(3000)
    expect(state.players.map((p) => p.stack)).toEqual([5000, 3000, 4000])
    const settlement = events.find((x): x is Extract<GameEvent, { type: 'SETTLEMENT' }> => x.type === 'SETTLEMENT')!
    expect(settlement.stacks).toEqual([{ seat: 0, stack: 5000 }, { seat: 1, stack: 3000 }, { seat: 2, stack: 4000 }])
    expect(events.filter((x) => x.type === 'CHAOS_APPLIED' && x.effect === 'timeBomb')).toHaveLength(1)
  })

  it('afterHand counts the bombs this hand played down, drops the spent ones, adds the planted ones, leaves a waiting one', () => {
    const waiting = bomb({ uid: 1, owner: 3, carrier: 1, handsLeft: 2 })
    const table: ChaosTableState = { ...EMPTY_CHAOS_TABLE, bombs: [bomb({ uid: 2, handsLeft: 2 }), bomb({ uid: 3, handsLeft: 1 }), waiting] }
    const p = plan(3, {}, [bomb({ uid: 2, handsLeft: 2 }), bomb({ uid: 3, handsLeft: 1 })])
    const r = afterHand({
      rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng: zero, nextUid: () => 1, plan: p, consumed: new Set(), carryOverOnly: false, marks: [],
      seats: [], table, outcomes: { planted: [{ owner: 2, carrier: 0, fuse: 3, wagers: 1, cardId: 'd_time_bomb', uid: 4 }] },
    })
    expect(r.table.bombs).toEqual([bomb({ uid: 2, handsLeft: 1 }), waiting, { owner: 2, carrier: 0, handsLeft: 2, cardId: 'd_time_bomb', uid: 4, wagers: 1 }])
    const none = afterHand({ rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng: zero, nextUid: () => 1, plan: plan(2, {}), consumed: new Set(), carryOverOnly: false, marks: [], seats: [], table })
    expect(none.table).toBe(table)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Hands in a row: the room's loop, in miniature.

const TRANSFER_CARDS = ['g_duel', 's_duel', 'd_share_winnings', 'g_win_tax', 'd_time_bomb']

interface Seated { seat: number; stack: number; chaos: ChaosSeat }

describe('Bom nổ chậm, hand after hand', () => {
  it('planted on hand 1, passed on hands 2 and 3, goes off at the end of hand 3, then gone', () => {
    const rules: BlindRules = { ...RULES }
    const pool = CHAOS_CARDS_SPEC
    let uid = 100
    const seated: Seated[] = [0, 1, 2].map((seat) => ({ seat, stack: 50_000, chaos: seat === 0 ? { ...EMPTY_CHAOS_SEAT, cards: [toHeld(def('d_time_bomb'), uid++)] } : EMPTY_CHAOS_SEAT }))
    let table: ChaosTableState = EMPTY_CHAOS_TABLE
    const rng = seededRng(9)
    const carriers: number[] = []
    const booms: Applied[] = []
    for (let hand = 1; hand <= 4; hand++) {
      const planned = planHand({ seats: seated.map((s) => ({ seat: s.seat, isBot: false, chaos: s.chaos })), rules, pool, rng, nextUid: () => uid++, table })
      for (const s of seated) s.chaos = planned.seats.get(s.seat)!
      const before = seated.map((s) => s.stack)
      const h = createBlindHand({ handId: `h${hand}`, rules, seats: seated.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack, isBot: false })), button: 0, carryOverIn: 0, chaos: planned.plan }, rng)
      let state = h.state
      const events = [...h.events]
      while (state.phase === 'REVEAL') {
        const r = applyBlindCommand(state, { type: 'ADVANCE' }, rng)
        state = r.state
        events.push(...r.events)
      }
      booms.push(...events.filter((x): x is Applied => x.type === 'CHAOS_APPLIED' && x.effect === 'timeBomb' && x.transfers !== undefined))
      expect(state.players.reduce((a, x) => a + x.stack, 0) + state.result!.fee + state.result!.carryOverOut).toBe(before.reduce((a, b) => a + b, 0))
      const chaos = state.chaos!
      const after = afterHand({
        rules, config: DEFAULT_CHAOS_CONFIG, pool, rng, nextUid: () => uid++, plan: chaos.plan, consumed: new Set([...chaos.applied, ...chaos.blocked]),
        recorded: new Set(chaos.recorded), carryOverOnly: state.result!.pots.length === 0, marks: chaos.marks, table: planned.table,
        ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
        seats: state.players.map((hp, i) => ({ seat: hp.seat, isBot: false, chaos: seated[i]!.chaos, stackAfter: hp.stack, net: hp.stack - before[i]!, inHand: true, outcome: 'none' as const })),
      })
      for (const s of seated) {
        s.chaos = after.seats.get(s.seat)!
        s.stack = state.players.find((x) => x.seat === s.seat)!.stack
      }
      table = after.table
      if (hand === 1) {
        expect(seated[0]!.chaos.cards).toEqual([]) // the card is spent: the bomb lives on the table
        expect(table.bombs).toHaveLength(1)
        expect(table.bombs[0]!.handsLeft).toBe(2)
      }
      if (hand === 2) expect(table.bombs[0]!.handsLeft).toBe(1)
      if (hand <= 3) carriers.push(hand === 1 ? chaos.outcomes!.planted![0]!.carrier : chaos.plan.bombs![0]!.carrier)
      if (hand >= 3) expect(table.bombs).toEqual([])
    }
    // Passed every hand to the other seat (never the owner, seat 0).
    expect(carriers).not.toContain(0)
    expect(carriers[1]).not.toBe(carriers[0])
    expect(carriers[2]).not.toBe(carriers[1])
    expect(booms).toHaveLength(1)
    expect(booms[0]).toMatchObject({ seat: 0, targets: [carriers[2]], transfers: [{ from: carriers[2], to: 0, amount: WAGER }] })
  })
})

describe('Conservation with the transfer cards (seeded)', () => {
  it('300 hands in a row: stacks + pot + fee + carry-over keep every point; no stack below 0; plain hands unchanged', () => {
    const rng = seededRng(55)
    let uid = 1
    const nextUid = (): number => uid++
    const seated: Seated[] = Array.from({ length: 5 }, (_, seat) => ({ seat, stack: 20_000, chaos: EMPTY_CHAOS_SEAT }))
    let table: ChaosTableState = EMPTY_CHAOS_TABLE
    let carry = 0
    /** Points from outside the table: top-ups of a broke seat, less the fees (the room's sink rows). */
    let outside = 0
    const moved = new Map<string, number>()
    const total = (): number => seated.reduce((a, s) => a + s.stack, 0) + carry - outside
    const start = total()
    for (let h = 0; h < 300; h++) {
      for (const s of seated) {
        if (s.stack < WAGER) {
          outside += 20_000 - s.stack
          s.stack = 20_000
        }
        const add: HeldCard[] = []
        if (rng.int(3) === 0) add.push(toHeld(def(TRANSFER_CARDS[rng.int(TRANSFER_CARDS.length)]!), nextUid()))
        if (rng.int(10) === 0) add.push({ ...toHeld(def('d_adventurer'), nextUid()), charge: rng.int(4) })
        if (rng.int(10) === 0) add.push(toHeld(def(rng.int(2) === 0 ? 's_shield' : 'd_mirror'), nextUid()))
        if (rng.int(12) === 0) add.push(toHeld(def('g_scapegoat'), nextUid()))
        if (add.length > 0) s.chaos = { ...s.chaos, cards: [...s.chaos.cards, ...add] }
      }
      const dealt = seated.filter(() => rng.int(6) !== 0)
      if (dealt.length < 2) continue
      const rules: BlindRules = { mode: 'blind', holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold', fixedWager: WAGER, tableFeeRate: rng.int(2) * 0.05 }
      const { plan: p, seats: planSeats, table: planned } = planHand({ seats: dealt.map((s) => ({ seat: s.seat, isBot: s.seat % 2 === 0, chaos: s.chaos })), rules, pool: CHAOS_CARDS_SPEC, rng, nextUid, table })
      for (const s of dealt) s.chaos = planSeats.get(s.seat)!
      const before = new Map(dealt.map((s) => [s.seat, s.stack]))
      const hand = createBlindHand({ handId: `s${h}`, rules, seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack, isBot: s.seat % 2 === 0 })), button: dealt[0]!.seat, carryOverIn: carry, chaos: p }, rng)
      let state = hand.state
      const events = [...hand.events]
      const step = (cmd: Parameters<typeof applyBlindCommand>[1]): void => {
        const r = applyBlindCommand(state, cmd, rng)
        state = r.state
        events.push(...r.events)
        if (state.result === null) expect(state.players.reduce((a, x) => a + x.stack, 0) + state.pot).toBe([...before.values()].reduce((a, b) => a + b, 0) + carry)
      }
      while (state.phase === 'DECISION') {
        const undecided = state.players.filter((x) => blindLegalActions(state, x.seat).kinds.length > 0)
        const x = undecided[rng.int(undecided.length)]!
        const kinds = blindLegalActions(state, x.seat).kinds as ('play' | 'fold')[]
        step({ type: 'ACTION', seat: x.seat, action: { kind: kinds[rng.int(kinds.length)]! } })
      }
      while (state.phase === 'REVEAL') step({ type: 'ADVANCE' })
      expect(state.phase).toBe('COMPLETE')
      expect(state.players.every((x) => x.stack >= 0)).toBe(true)
      const r = state.result!
      expect(state.players.reduce((a, x) => a + x.stack, 0) + r.fee + r.carryOverOut).toBe([...before.values()].reduce((a, b) => a + b, 0) + carry)
      for (const ev of events) {
        if (ev.type === 'CHAOS_APPLIED' && ev.transfers) {
          moved.set(ev.effect, (moved.get(ev.effect) ?? 0) + ev.transfers.reduce((a, t) => a + t.amount, 0))
          for (const t of ev.transfers) expect(t.amount).toBeGreaterThanOrEqual(0)
        }
      }
      const chaos = state.chaos!
      const winners = new Set(r.pots.flatMap((pot) => pot.winners.map((w) => w.seat)))
      const after = afterHand({
        rules, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng, nextUid, plan: chaos.plan, consumed: new Set([...chaos.applied, ...chaos.blocked]),
        recorded: new Set(chaos.recorded), carryOverOnly: r.pots.length === 0, marks: chaos.marks, table: planned,
        ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
        seats: state.players.map((hp) => ({
          seat: hp.seat, isBot: hp.seat % 2 === 0, chaos: seated.find((s) => s.seat === hp.seat)!.chaos, stackAfter: hp.stack, net: hp.stack - before.get(hp.seat)!,
          inHand: true, outcome: r.pots.length === 0 ? ('none' as const) : winners.has(hp.seat) ? ('win' as const) : ('loss' as const),
        })),
      })
      for (const s of dealt) {
        s.chaos = after.seats.get(s.seat)!
        s.stack = state.players.find((x) => x.seat === s.seat)!.stack
      }
      // The fee leaves the table; the cards' credits (new points the room writes) are not paid in this loop.
      outside -= r.fee
      table = after.table
      carry = r.carryOverOut
      for (const b of table.bombs) {
        expect(b.owner).not.toBe(b.carrier)
        expect(b.handsLeft).toBeGreaterThan(0)
      }
      expect(total()).toBe(start)
    }
    // The run did move points between players, through every card.
    for (const effect of ['duel', 'shareWinnings', 'winTax', 'timeBomb']) expect(moved.get(effect) ?? 0).toBeGreaterThan(0)
  })
})
