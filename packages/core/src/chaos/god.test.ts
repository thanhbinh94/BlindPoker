import { describe, expect, it } from 'vitest'
import { parseCards, rankOf } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { createBotStrategy } from '../bot/strategy.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from '../hand/blind.js'
import { EngineError, type BlindRules, type GameEvent, type HandState } from '../hand/types.js'
import { filterEvent, playerView } from '../hand/view.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { countReigns, endReign } from './god.js'
import { receiveCard, toHeld } from './hold.js'
import { planHand, type PlanSeatInput } from './plan.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE,
  type ChaosCardDef, type ChaosGodCurse, type ChaosHandPlan, type ChaosReign, type ChaosSeat, type ChaosTableState, type HeldCard, type PlannedEffect,
} from './types.js'

/**
 * BP-41 Task 6 (spec 2026-10-28 §4): Cá chép hóa rồng's energy and ascension, the Thần Bài's five-hand reign — its Aces,
 * its protection (Review Focus 1), its curse, its crit, the no-fold rule and its fall — the Bán Thần, two Cá chép at once
 * (Review Focus 4), and a run of hands that keeps every point with the duel curse in play. The card ships disabled in
 * data; the tests hold it directly.
 */

const WAGER = 1000
const def = (id: string): ChaosCardDef => {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === id)
  if (!d) throw new Error(`no card ${id}`)
  return d
}
const CARP = def('d_carp')
const ENABLED = CHAOS_CARDS_SPEC.map((c) => ({ ...c, enabled: true }))
let uidSeq = 50_000
const held = (id: string, extra: Partial<HeldCard> = {}): HeldCard => ({ ...toHeld(def(id), ++uidSeq), ...extra })
const carp = (energy: number): HeldCard => held('d_carp', { charge: energy })
const seatWith = (cards: HeldCard[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, cards, ...extra })
function fx(cardId: string, extra: Partial<PlannedEffect> = {}): PlannedEffect {
  const d = def(cardId)
  return { uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets: [], ...extra }
}
const reign = (seat: number, extra: Partial<ChaosReign> = {}): ChaosReign => ({ seat, isBot: false, cardId: 'd_carp', uid: 900 + seat, params: CARP.params, ...extra })
const godOf = (seat: number, curse: ChaosGodCurse | null = null, extra: Partial<ChaosReign> = {}): NonNullable<ChaosHandPlan['god']> => ({ ...reign(seat, extra), curse })
const tableGod = (seat: number, handsLeft = 5, curse: ChaosGodCurse | null = null, isBot = false): ChaosTableState => ({
  ...EMPTY_CHAOS_TABLE, god: { ...reign(seat, { isBot }), playerId: `p${seat}`, handsLeft, curse },
})

type SeatPlan = { effects?: PlannedEffect[]; shield?: 'shield' | 'mirror'; lasting?: true }
function plan(n: number, by: Record<number, SeatPlan>, extra: Partial<ChaosHandPlan> = {}): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({
      seat,
      effects: by[seat]?.effects ?? [],
      shield: by[seat]?.shield
        ? { uid: 700 + seat, cardId: by[seat]!.shield === 'mirror' ? 'd_mirror' : 's_shield', kind: by[seat]!.shield!, ...(by[seat]!.lasting ? { lasting: true as const } : {}) }
        : null,
      blindfolded: false,
    })),
    reverse: false,
    ...extra,
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
const never: Rng = { int: () => { throw new Error('drew from rng') } }

type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>
const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: WAGER, tableFeeRate: 0 }
const POF: BlindRules = { ...RULES, decisionMode: 'playOrFold' }
const BOARD = 'Kd 7h 4c 2s 9d'
const isAce = (c: number): boolean => rankOf(c) === 12

/** A hand at the turn: seat i holds `holes[i]`, the board shows `board`'s first four cards, its river still to come. */
class Stage {
  state: HandState
  events: GameEvent[] = []
  readonly start: number
  constructor(o: { chaos: ChaosHandPlan; holes: string[]; board?: string; stacks?: number[]; rules?: Partial<BlindRules> }) {
    const rules = { ...RULES, ...o.rules }
    const seats = o.chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: o.stacks?.[seat] ?? 5000, isBot: false }))
    this.start = seats.reduce((a, s) => a + s.stack, 0)
    const res = createBlindHand({ handId: 't6', rules, seats, button: 0, carryOverIn: 0, chaos: o.chaos }, seededRng(1))
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
  hole(seat: number): number[] { return this.state.players.find((p) => p.seat === seat)!.holeCards }
  stack(seat: number): number { return this.state.players.find((p) => p.seat === seat)!.stack }
  applied(effect: string): Applied[] { return this.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === effect) }
  settlement() { return this.events.find((e): e is Extract<GameEvent, { type: 'SETTLEMENT' }> => e.type === 'SETTLEMENT')! }
  conserved(): void {
    const r = this.state.result!
    expect(this.state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut).toBe(this.start)
    expect(this.state.players.every((p) => p.stack >= 0)).toBe(true)
    expect(this.settlement().stacks).toEqual(this.state.players.map((p) => ({ seat: p.seat, stack: p.stack })))
  }
}

const planSeats = (by: Record<number, ChaosSeat>, isBot: (s: number) => boolean = () => false): PlanSeatInput[] =>
  Object.entries(by).map(([s, chaos]) => ({ seat: Number(s), playerId: `p${s}`, isBot: isBot(Number(s)), chaos }))
let uidNext = 70_000
const plan$ = (by: Record<number, ChaosSeat>, o: { rules?: BlindRules; rng?: Rng; table?: ChaosTableState; isBot?: (s: number) => boolean; pool?: ChaosCardDef[] } = {}) =>
  planHand({ seats: planSeats(by, o.isBot), rules: o.rules ?? POF, pool: o.pool ?? ENABLED, rng: o.rng ?? never, nextUid: () => uidNext++, ...(o.table ? { table: o.table } : {}) })

type Input = Parameters<typeof afterHand>[0]
const at = (seat: number, chaos: ChaosSeat, s: Partial<AfterHandSeat> = {}): AfterHandSeat => ({
  seat, playerId: `p${seat}`, isBot: false, chaos, stackAfter: 10_000, net: 0, inHand: true, outcome: 'loss', ...s,
})
function settle(seats: AfterHandSeat[], over: Partial<Input> = {}) {
  let n = 90_000
  return afterHand({
    rules: RULES, config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1_000 }, pool: ENABLED, rng: zero, nextUid: () => n++, plan: plan(0, {}),
    consumed: new Set(), carryOverOnly: false, marks: [], seats, ...over,
  })
}

// ---------------------------------------------------------------------------------------------------------------------

describe('Cá chép hóa rồng: energy', () => {
  it('starts at its energy0 (0 in data; the ops pack forces 100), never above 100', () => {
    expect(toHeld(CARP, 1).charge).toBe(0)
    expect(toHeld({ ...CARP, params: { ...CARP.params, energy0: 100 } }, 1).charge).toBe(100)
    expect(toHeld({ ...CARP, params: { ...CARP.params, energy0: 250 } }, 1).charge).toBe(100)
    // Every other card still carries no charge.
    expect('charge' in toHeld(def('g_crit'), 1)).toBe(false)
  })

  it('a lost hand adds 5..7 %, capped at 100; a carry-over adds nothing; a frozen or dark seat waits', () => {
    const c = carp(40)
    expect(settle([at(0, seatWith([c]))], { rng: script(0) }).seats.get(0)!.cards[0]!.charge).toBe(45)
    expect(settle([at(0, seatWith([c]))], { rng: script(2) }).seats.get(0)!.cards[0]!.charge).toBe(47)
    expect(settle([at(0, seatWith([carp(98)]))], { rng: script(2) }).seats.get(0)!.cards[0]!.charge).toBe(100)
    expect(settle([at(0, seatWith([c]), { outcome: 'none' })], { rng: never }).seats.get(0)!.cards[0]!.charge).toBe(40)
    expect(settle([at(0, seatWith([c], { frozenNextHand: true }))], { rng: never }).seats.get(0)!.cards[0]!.charge).toBe(40)
    const dark = plan(1, {})
    dark.seats[0]!.eclipsed = true
    expect(settle([at(0, seatWith([c]))], { rng: never, plan: dark }).seats.get(0)!.cards[0]!.charge).toBe(40)
  })

  it('only the oldest Cá chép acts; a second copy waits', () => {
    const [a, b] = [carp(10), carp(20)]
    const r = settle([at(0, seatWith([a, b]))], { rng: script(0) }).seats.get(0)!.cards
    expect(r.map((x) => x.charge)).toEqual([15, 20])
  })

  it('a win before ascending spends the card and makes a Bán Thần from the next hand, for 5 hands', () => {
    const c = carp(30)
    const r = settle([at(1, seatWith([c]), { outcome: 'win', net: 2000, isBot: true })])
    expect(r.seats.get(1)!.cards).toEqual([])
    expect(r.table.demigods).toEqual([{ seat: 1, playerId: 'p1', isBot: true, handsLeft: 5, cardId: 'd_carp', uid: c.uid, params: CARP.params }])
    expect(r.table.god).toBeNull()
  })
})

describe('Cá chép hóa rồng: the roll at the start of each hand', () => {
  it('rolls under its energy: a hit ascends this very hand, spends the card and draws the curse once', () => {
    const c = carp(50)
    const hit = plan$({ 0: seatWith([c]), 1: EMPTY_CHAOS_SEAT }, { rng: script(49, 2) })
    expect(hit.seats.get(0)!.cards).toEqual([])
    expect(hit.table.god).toEqual({ seat: 0, playerId: 'p0', isBot: false, handsLeft: 5, curse: 3, cardId: 'd_carp', uid: c.uid, params: CARP.params })
    expect(hit.plan.god).toEqual({ seat: 0, isBot: false, cardId: 'd_carp', uid: c.uid, params: CARP.params, curse: 3, ascended: true })
    const miss = plan$({ 0: seatWith([c]), 1: EMPTY_CHAOS_SEAT }, { rng: script(50) })
    expect(miss.table.god).toBeNull()
    expect(miss.seats.get(0)!.cards).toEqual([c])
    expect(miss.plan.god).toBeUndefined()
    expect(miss.plan.carps).toEqual([{ seat: 0, uid: c.uid, cardId: 'd_carp' }])
  })

  it('at 0 % nothing is drawn; at 100 % it is certain (only the curse is drawn)', () => {
    expect(plan$({ 0: seatWith([carp(0)]), 1: EMPTY_CHAOS_SEAT }, { rng: never }).table.god).toBeNull()
    expect(plan$({ 0: seatWith([carp(100)]), 1: EMPTY_CHAOS_SEAT }, { rng: script(0) }).table.god).toMatchObject({ seat: 0, curse: 1 })
  })

  it('a plain chaos hand (no Cá chép, nobody reigning) gets no reign in its plan and draws nothing more', () => {
    const r = plan$({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT }, { rng: never })
    expect(r.plan).toEqual({ seats: r.plan.seats, reverse: false })
    expect(r.table).toBe(EMPTY_CHAOS_TABLE)
  })

  it('a frozen seat, or one Nhật thực darkens, does not roll (its cards are off)', () => {
    const frozen = plan$({ 0: seatWith([carp(100)], { frozenNextHand: true }), 1: EMPTY_CHAOS_SEAT }, { rng: never })
    expect(frozen.table.god).toBeNull()
    expect(frozen.plan.carps).toBeUndefined()
    const dark = plan$({ 0: seatWith([carp(100)]), 1: seatWith([held('d_eclipse')]) }, { rng: never })
    expect(dark.table.god).toBeNull()
    expect(dark.seats.get(0)!.cards[0]!.charge).toBe(100)
  })

  it('Review Focus 4: two Cá chép hitting in one hand make one Thần; the other keeps its energy and rolls once the throne is empty', () => {
    const [a, b] = [carp(100), carp(100)]
    // Both hit; the rng picks the second (seat 1); the curse is drawn.
    const h1 = plan$({ 0: seatWith([a]), 1: seatWith([b]), 2: EMPTY_CHAOS_SEAT }, { rng: script(1, 0) })
    expect(h1.table.god).toMatchObject({ seat: 1, uid: b.uid })
    expect(h1.seats.get(0)!.cards).toEqual([a])
    expect(h1.seats.get(1)!.cards).toEqual([])
    expect(h1.plan.carps).toEqual([{ seat: 0, uid: a.uid, cardId: 'd_carp' }])
    // While the Thần reigns, nobody rolls — seat 0 at 100 % waits (no draw at all).
    let table = h1.table
    let seats: Record<number, ChaosSeat> = { 0: h1.seats.get(0)!, 1: h1.seats.get(1)!, 2: h1.seats.get(2)! }
    for (let hand = 0; hand < 5; hand++) {
      const p = hand === 0 ? h1 : plan$(seats, { rng: never, table })
      expect(p.table.god?.seat).toBe(1)
      // A carry-over each hand: no energy, no Bán Thần, the reign counts down.
      const r = settle([0, 1, 2].map((s) => at(s, p.seats.get(s)!, { outcome: 'none' })), { plan: p.plan, table: p.table, rng: never })
      table = r.table
      seats = { 0: r.seats.get(0)!, 1: r.seats.get(1)!, 2: r.seats.get(2)! }
    }
    expect(table.god).toBeNull()
    expect(seats[0]!.cards[0]).toMatchObject({ uid: a.uid, charge: 100 })
    const next = plan$(seats, { rng: script(2), table })
    expect(next.table.god).toMatchObject({ seat: 0, uid: a.uid, handsLeft: 5, curse: 3 })
    expect(next.plan.god?.ascended).toBe(true)
  })

  it('a Bán Thần who ascends ends its Bán Thần reign; a Bán Thần coexists with a Thần', () => {
    const table: ChaosTableState = { ...EMPTY_CHAOS_TABLE, demigods: [{ ...reign(0), playerId: 'p0', handsLeft: 3 }, { ...reign(2), playerId: 'p2', handsLeft: 4 }] }
    const r = plan$({ 0: seatWith([carp(100)]), 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }, { rng: script(0), table })
    expect(r.table.god?.seat).toBe(0)
    expect(r.table.demigods.map((d) => d.seat)).toEqual([2])
    expect(r.plan.god?.seat).toBe(0)
    expect(r.plan.demigods?.map((d) => d.seat)).toEqual([2])
  })

  it('the Thần is the table\'s while it reigns: a holder at 100 % waits, but still charges on a loss and turns Bán Thần on a win', () => {
    const c = carp(100)
    const p = plan$({ 0: EMPTY_CHAOS_SEAT, 1: seatWith([c]) }, { rng: never, table: tableGod(0, 4) })
    expect(p.table.god?.seat).toBe(0)
    expect(p.plan.carps).toEqual([{ seat: 1, uid: c.uid, cardId: 'd_carp' }])
    const won = settle([at(0, EMPTY_CHAOS_SEAT), at(1, p.seats.get(1)!, { outcome: 'win', net: 1000 })], { plan: p.plan, table: p.table })
    expect(won.table.god).toMatchObject({ seat: 0, handsLeft: 3 })
    expect(won.table.demigods.map((d) => d.seat)).toEqual([1])
  })

  it('the Thần\'s own Cá chép cards wait while it reigns: no energy, no Bán Thần', () => {
    const c = carp(20)
    const p = plan$({ 0: seatWith([c]), 1: EMPTY_CHAOS_SEAT }, { rng: never, table: tableGod(0, 4) })
    expect(p.plan.carps).toBeUndefined()
    const lost = settle([at(0, p.seats.get(0)!), at(1, EMPTY_CHAOS_SEAT, { outcome: 'win', net: 1 })], { plan: p.plan, table: p.table, rng: never })
    expect(lost.seats.get(0)!.cards).toEqual([c])
    const won = settle([at(0, p.seats.get(0)!, { outcome: 'win', net: 1000 })], { plan: { ...p.plan, god: undefined }, table: p.table, rng: zero })
    expect(won.table.demigods).toEqual([])
  })
})

describe('the reign: who acts this hand, and the count-down', () => {
  it('the Thần acts when dealt in and not frozen; at a "Chơi hoặc bỏ" table nobody may fold (G11), at "Hoàn toàn may rủi" there is no fold anyway', () => {
    const r = plan$({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }, { table: tableGod(1, 2, null) })
    expect(r.plan.god).toEqual({ seat: 1, isBot: false, cardId: 'd_carp', uid: 901, params: CARP.params, curse: null })
    expect(r.plan.noFoldSeats).toEqual([0, 1, 2])
    expect(plan$({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT }, { rules: RULES, table: tableGod(1) }).plan.noFoldSeats).toBeUndefined()
    // With Cấm bỏ bài's marks too, one list.
    const both = plan$({ 0: seatWith([], { noFoldNextHand: true }), 1: EMPTY_CHAOS_SEAT }, { table: tableGod(1) })
    expect(both.plan.noFoldSeats).toEqual([0, 1])
  })

  it('a Thần frozen or sitting the hand out has no powers that hand (no Aces, no no-fold), yet the reign still counts it', () => {
    const frozen = plan$({ 0: seatWith([], { frozenNextHand: true }), 1: EMPTY_CHAOS_SEAT }, { table: tableGod(0, 4, 2) })
    expect(frozen.plan.god).toBeUndefined()
    expect(frozen.plan.noFoldSeats).toBeUndefined()
    const out = plan$({ 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }, { table: tableGod(0, 4, 2) })
    expect(out.plan.god).toBeUndefined()
    expect(out.table.god?.seat).toBe(0)
    expect(settle([at(1, EMPTY_CHAOS_SEAT)], { plan: out.plan, table: out.table }).table.god).toMatchObject({ seat: 0, handsLeft: 3, curse: 2 })
  })

  it('five hands, the curse in the first three only; then the throne is empty', () => {
    let table = tableGod(0, 5, 1)
    const seen: (ChaosGodCurse | null)[] = []
    for (let h = 0; h < 5; h++) {
      seen.push(table.god!.curse)
      table = countReigns(table, plan(2, {}, { god: godOf(0, table.god!.curse) }), undefined)
    }
    expect(seen).toEqual([1, 1, 1, null, null])
    expect(table.god).toBeNull()
  })

  it('a Bán Thần reigns 5 hands; a seat leaving the table ends its reigns at once (endReign)', () => {
    let table: ChaosTableState = { ...EMPTY_CHAOS_TABLE, demigods: [{ ...reign(1), playerId: 'p1', handsLeft: 5 }] }
    for (let h = 0; h < 4; h++) table = countReigns(table, plan(2, {}), undefined)
    expect(table.demigods[0]!.handsLeft).toBe(1)
    expect(countReigns(table, plan(2, {}), undefined).demigods).toEqual([])
    const both: ChaosTableState = { ...tableGod(1, 3, 1), demigods: [{ ...reign(1), playerId: 'p1', handsLeft: 5 }, { ...reign(2), playerId: 'p2', handsLeft: 2 }] }
    expect(endReign(both, 1)).toEqual({ ...both, god: null, demigods: [both.demigods[1]] })
    expect(endReign(both, 3)).toBe(both)
    expect(endReign(EMPTY_CHAOS_TABLE, 0)).toBe(EMPTY_CHAOS_TABLE)
  })
})

describe('Review Focus 1: the Thần at the table', () => {
  it('nobody may fold at a "Chơi hoặc bỏ" table: the engine refuses it, the time-out plays, a bot plays', () => {
    const p = plan$({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }, { table: tableGod(2, 3), isBot: (s) => s === 1 })
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: seat === 1 }))
    const { state, events } = createBlindHand({ handId: 'nf', rules: POF, seats, button: 0, carryOverIn: 0, chaos: p.plan }, seededRng(3))
    expect(events.find((e) => e.type === 'DECISION_PHASE')).toMatchObject({ noFold: [0, 1, 2] })
    for (const seat of [0, 1, 2]) expect(blindLegalActions(state, seat).kinds).toEqual(['play'])
    expect(() => applyBlindCommand(state, { type: 'ACTION', seat: 0, action: { kind: 'fold' } }, zero)).toThrow(EngineError)
    expect(() => applyBlindCommand(state, { type: 'ACTION', seat: 2, action: { kind: 'fold' } }, zero)).toThrow(/ILLEGAL_ACTION/)
    const timedOut = applyBlindCommand(state, { type: 'TIMEOUT', seat: 0 }, zero).state
    expect(timedOut.players.find((x) => x.seat === 0)!.decision).toBe('play')
    expect(createBotStrategy().decide(playerView(state, 1), blindLegalActions(state, 1), seededRng(1))).toEqual({ kind: 'play' })
    // A seat that left still forfeits (A2).
    const left = applyBlindCommand(state, { type: 'FORFEIT', seat: 1 }, zero).state
    expect(left.players.find((x) => x.seat === 1)!.decision).toBe('fold')
  })

  it('the Thần holds all Aces (2 or 3 by the table), claimed before any Siêu cộng dồn, and its ascension is told to every viewer', () => {
    for (const holeCards of [2, 3] as const) {
      const sieu = held('d_aces_charge', { charge: 100 })
      const p = plan$({ 0: seatWith([carp(100)]), 1: seatWith([sieu]), 2: EMPTY_CHAOS_SEAT }, { rules: { ...RULES, holeCards }, rng: seededRng(holeCards) })
      expect(p.plan.god?.ascended).toBe(true)
      const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
      const { state, events } = createBlindHand({ handId: 'aces', rules: { ...RULES, holeCards }, seats, button: 2, carryOverIn: 0, chaos: p.plan }, seededRng(9))
      const god = state.players.find((x) => x.seat === 0)!.holeCards
      expect(god).toHaveLength(holeCards)
      expect(god.every(isAce)).toBe(true)
      // Siêu cộng dồn gets the Aces left (4 − holeCards), then the highest cards left.
      const s1 = state.players.find((x) => x.seat === 1)!.holeCards
      expect(s1.filter(isAce)).toHaveLength(4 - holeCards)
      expect(Math.min(...s1.map(rankOf))).toBeGreaterThanOrEqual(11)
      const told = events.find((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.reign === 'god')!
      expect(told).toMatchObject({ seat: 0, effect: 'carp', cardId: 'd_carp', outcome: 'applied', targets: [] })
      expect(filterEvent(told, null)).toEqual(told)
      expect(state.chaos!.titles).toEqual([{ seat: 0, ascended: true }])
      // A second hand of the reign tells nothing new and marks nothing.
      const again = createBlindHand({ handId: 'aces2', rules: { ...RULES, holeCards }, seats, button: 2, carryOverIn: 0, chaos: { ...p.plan, god: godOf(0) } }, seededRng(9))
      expect(again.events.some((e) => e.type === 'CHAOS_APPLIED' && e.reign !== undefined)).toBe(false)
      expect(again.state.chaos!.titles).toBeUndefined()
      expect(again.state.players.find((x) => x.seat === 0)!.holeCards.every(isAce)).toBe(true)
    }
  })

  it('a deal buff that would replace one of the Thần\'s Aces fizzles; Liều ăn nhiều leaves it fewer Aces', () => {
    const p = plan(2, { 0: { effects: [fx('s_swap_one')] } }, { god: godOf(0) })
    const seats = [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
    const { state, events } = createBlindHand({ handId: 'b', rules: RULES, seats, button: 1, carryOverIn: 0, chaos: p }, seededRng(4))
    expect(state.players[0]!.holeCards.every(isAce)).toBe(true)
    expect(events.find((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === 'swapLowest')!.outcome).toBe('fizzled')
    const risky = createBlindHand({ handId: 'r', rules: RULES, seats, button: 1, carryOverIn: 0, chaos: plan(2, { 0: { effects: [fx('d_risky_hand')] } }, { god: godOf(0) }) }, seededRng(4))
    expect(risky.state.players[0]!.holeCards).toHaveLength(1)
    expect(risky.state.players[0]!.holeCards.every(isAce)).toBe(true)
  })

  const GOD = 'Ah Ad'
  const reveal = (id: string, n: number, holes: string[], extra: { reverse?: boolean } = {}) => {
    const t = new Stage({ chaos: plan(n, { 1: { effects: [fx(id)] } }, { god: godOf(0), ...extra }), holes }).reveal()
    expect(t.hole(0)).toEqual(parseCards(GOD))
    return t
  }
  it.each([
    ['s_steal_one'], ['g_steal_all'], ['s_lower'], ['d_swap_hands'], ['s_redeal_hole'], ['s_neighbour_swap'], ['d_swap_leader'],
  ])('its Aces survive %s (the card is spent for nothing)', (id) => {
    const t = reveal(id, 2, [GOD, '3c 5d'])
    const e = t.applied(def(id).effect)
    expect(e.length).toBeGreaterThan(0)
    expect(e.every((x) => x.outcome === 'fizzled')).toBe(true)
    expect(t.hole(1)).toEqual(parseCards('3c 5d'))
  })

  it('its Aces survive Hoán vị định mệnh and Đại hồng thủy (the others\' hands still move)', () => {
    const shuffled = reveal('d_shuffle_holes', 3, [GOD, '3c 5d', '6c 8d'])
    expect(shuffled.applied('shuffleHoles')[0]).toMatchObject({ outcome: 'applied', targets: [2] })
    const flood = reveal('d_deluge', 3, [GOD, '3c 5d', '6c 8d'])
    expect(flood.applied('deluge')[0]).toMatchObject({ outcome: 'applied', targets: [2] })
    expect(flood.hole(1)).not.toEqual(parseCards('3c 5d'))
  })

  it('its Aces survive Cướp đoạt and Lời nguyền at the deal', () => {
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
    for (const id of ['d_plunder', 'g_curse']) {
      for (let seed = 1; seed <= 6; seed++) {
        const { state, events } = createBlindHand({ handId: id, rules: RULES, seats, button: 2, carryOverIn: 0, chaos: plan(3, { 1: { effects: [fx(id)] } }, { god: godOf(0) }) }, seededRng(seed))
        expect(state.players[0]!.holeCards.every(isAce)).toBe(true)
        // Aimed at the Thần, it is spent for nothing; Cướp đoạt never reaches it.
        const e = events.find((x): x is Applied => x.type === 'CHAOS_APPLIED' && x.effect === def(id).effect)!
        if (e.targets.includes(0)) expect([id, e.outcome]).toEqual(['g_curse', 'fizzled'])
      }
    }
  })

  it('its own swaps, Ngược dòng, Cướp đoạt and a low Xúc xắc định mệnh never give its Aces away', () => {
    for (const id of ['d_swap_hands', 's_neighbour_swap', 'd_swap_leader']) {
      const t = new Stage({ chaos: plan(2, { 0: { effects: [fx(id)] } }, { god: godOf(0), reverse: id === 'd_swap_leader' }), holes: [GOD, '3c 5d'] }).reveal()
      expect(t.hole(0)).toEqual(parseCards(GOD))
      expect(t.hole(1)).toEqual(parseCards('3c 5d'))
    }
    // Spent before it is aimed: the opponent's one-shot Khiên is not spent, nobody is hit, the line names nobody.
    for (const id of ['d_swap_hands', 's_neighbour_swap']) {
      const t = new Stage({ chaos: plan(2, { 0: { effects: [fx(id)] }, 1: { shield: 'shield' } }, { god: godOf(0) }), holes: [GOD, '3c 5d'] }).reveal(never)
      expect(t.state.chaos!.blocked).not.toContain(701)
      expect(t.state.chaos!.hit).toEqual([])
      expect(t.applied(def(id).effect)).toEqual([expect.objectContaining({ seat: 0, outcome: 'fizzled', targets: [] })])
      expect(t.hole(0)).toEqual(parseCards(GOD))
    }
    const die = new Stage({ chaos: plan(2, { 0: { effects: [fx('g_fate_die')] } }, { god: godOf(0) }), holes: [GOD, '3c 5d'] }).reveal(script(0))
    expect(die.applied('fateDie')[0]).toMatchObject({ dice: [1], holeDelta: 0 })
    expect(die.hole(0)).toEqual(parseCards(GOD))
  })

  it('Nhật thực never darkens the Thần: its cards and powers stay on; everyone else is dark', () => {
    const luck = held('g_luck_3')
    const r = plan$({ 0: seatWith([luck]), 1: seatWith([held('d_eclipse')]), 2: seatWith([held('g_crit')]) }, { table: tableGod(0, 4, 1) })
    expect(r.plan.god?.seat).toBe(0)
    const s0 = r.plan.seats.find((s) => s.seat === 0)!
    expect(s0.eclipsed).toBeUndefined()
    expect(s0.effects.map((e) => e.cardId)).toEqual(['g_luck_3'])
    expect(r.plan.seats.find((s) => s.seat === 2)!.eclipsed).toBe(true)
  })

  it('Kẻ phá đám never switches the Thần off: it is no target, and a mirrored one spares it too', () => {
    const seats = [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
    const lone = createBlindHand({ handId: 's', rules: RULES, seats, button: 1, carryOverIn: 0, chaos: plan(2, { 0: { effects: [fx('g_luck_3')] }, 1: { effects: [fx('s_spoiler')] } }, { god: godOf(0) }) }, seededRng(2))
    expect(lone.events.find((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === 'spoiler')!.outcome).toBe('fizzled')
    expect(lone.state.chaos!.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['g_luck_3'])
    // The Thần's own Kẻ phá đám turned back on it by a mirror: nothing of the Thần's is switched off.
    const mirrored = createBlindHand({
      handId: 'm', rules: RULES, seats, button: 1, carryOverIn: 0,
      chaos: plan(2, { 0: { effects: [fx('g_luck_3'), fx('s_spoiler')] }, 1: { effects: [fx('s_coin_flip')], shield: 'mirror' } }, { god: godOf(0) }),
    }, seededRng(2))
    const back = mirrored.events.find((e): e is Applied => e.type === 'CHAOS_APPLIED' && e.effect === 'spoiler')!
    expect(back.outcome).toBe('reflected')
    expect(back.off).toBeUndefined()
    expect(mirrored.state.chaos!.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['g_luck_3', 's_spoiler'])
  })

  it('a Bia đỡ đạn never hands Kẻ phá đám to the Thần: with nobody else to take it, the card waits and the debuff lands', () => {
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
    const p = plan(3, { 0: { effects: [fx('g_luck_3')] }, 1: { effects: [fx('s_coin_flip')] }, 2: { effects: [fx('s_spoiler')] } }, { god: godOf(0) })
    p.seats[1] = { ...p.seats[1]!, scapegoat: { uid: 4_501, cardId: 'g_scapegoat' } }
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = createBlindHand({ handId: `sg${seed}`, rules: RULES, seats, button: 2, carryOverIn: 0, chaos: p }, seededRng(seed))
      const applied = r.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED')
      expect(applied.filter((e) => e.effect === 'scapegoat'), 'no hand-off').toEqual([])
      expect(applied.find((e) => e.effect === 'spoiler')).toMatchObject({ seat: 2, targets: [1], outcome: 'applied', off: 's_coin_flip' })
      expect(r.state.chaos!.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['g_luck_3'])
    }
  })
})

describe('the curse (the first three hands)', () => {
  it('1 rút bài: every other seat still in loses one random card at the reveal, never its last; immune seats keep theirs', () => {
    const t = new Stage({
      chaos: plan(4, {}, { god: godOf(0, 1) }),
      holes: ['Ah Ad Ac', '3c 5d 6c', '8d', 'Tc Jc Qc'],
      rules: { holeCards: 3 },
    })
    t.state.chaos!.immune = [3]
    t.reveal(script(1))
    expect(t.hole(1)).toEqual(parseCards('3c 6c'))
    expect(t.hole(2)).toEqual(parseCards('8d'))
    expect(t.hole(3)).toEqual(parseCards('Tc Jc Qc'))
    expect(t.hole(0)).toEqual(parseCards('Ah Ad Ac'))
    expect(t.applied('carp')[0]).toMatchObject({ seat: 0, cardId: 'd_carp', outcome: 'applied', targets: [1] })
    expect(t.applied('carp')[0]!.reign).toBeUndefined()
    t.conserved()
  })

  it('a Khiên or a Gương only blocks it for its own seat (no reflection, A16); the curse is no seat\'s one debuff', () => {
    const t = new Stage({
      chaos: plan(4, { 1: { shield: 'shield' }, 2: { shield: 'mirror' } }, { god: godOf(0, 1) }),
      holes: ['Ah Ad Ac', '3c 5d 6c', '8d 9d Td', 'Tc Jc Qc'],
      rules: { holeCards: 3 },
    })
    t.reveal(script(0))
    const blocks = t.applied('carp').filter((e) => e.outcome === 'blocked')
    expect(blocks.map((e) => e.targets)).toEqual([[1], [2]])
    expect([t.hole(1), t.hole(2)]).toEqual([parseCards('3c 5d 6c'), parseCards('8d 9d Td')])
    expect(t.hole(0)).toEqual(parseCards('Ah Ad Ac'))
    expect(t.state.chaos!.blocked).toEqual(expect.arrayContaining([701, 702]))
    expect(t.applied('carp').find((e) => e.outcome === 'applied')!.targets).toEqual([3])
  })

  it('the curse is no seat\'s one debuff: a seat a card hit still loses a card to it, and the curse adds nobody to `hit`', () => {
    const t = new Stage({
      chaos: plan(3, { 2: { effects: [fx('s_steal_one')] } }, { god: godOf(0, 1) }),
      holes: ['Ah Ad Ac', '3c 5d 6c', 'Tc Jc Qc'],
      rules: { holeCards: 3 },
    })
    // Seat 2 steals seat 1's first card (its pick among seats 0 and 1 lands on 1), then the curse takes one from seats 1 and 2.
    t.reveal(script(1, 0, 0, 0))
    expect(t.state.chaos!.hit).toEqual([1])
    expect(t.hole(1)).toEqual(parseCards('6c'))
    expect(t.hole(2)).toEqual(parseCards('Jc Qc'))
    expect(t.applied('carp')[0]).toMatchObject({ outcome: 'applied', targets: [1, 2] })
  })

  it('3 tráo bài: the other seats\' hands are dealt round among them; the Thần keeps its own; a shield keeps a seat out', () => {
    const t = new Stage({ chaos: plan(4, {}, { god: godOf(0, 3) }), holes: ['Ah Ad', '3c 5d', '6c 8d', 'Tc Jc'] }).reveal(script(0, 0))
    expect(t.hole(0)).toEqual(parseCards('Ah Ad'))
    expect([t.hole(1), t.hole(2), t.hole(3)]).toEqual([parseCards('6c 8d'), parseCards('Tc Jc'), parseCards('3c 5d')])
    expect(t.applied('carp')[0]).toMatchObject({ outcome: 'applied', targets: [1, 2, 3] })
    const kept = new Stage({ chaos: plan(4, { 2: { shield: 'shield', lasting: true } }, { god: godOf(0, 3) }), holes: ['Ah Ad', '3c 5d', '6c 8d', 'Tc Jc'] }).reveal(script(0))
    expect(kept.hole(2)).toEqual(parseCards('6c 8d'))
    expect([kept.hole(1), kept.hole(3)]).toEqual([parseCards('Tc Jc'), parseCards('3c 5d')])
    // Heads-up there is nobody to swap with: it fizzles.
    const lone = new Stage({ chaos: plan(2, {}, { god: godOf(0, 3) }), holes: ['Ah Ad', '3c 5d'] }).reveal(never)
    expect(lone.applied('carp')[0]).toMatchObject({ outcome: 'fizzled', targets: [] })
  })

  it('2 thách đấu (🔓): each seat it beats pays the Thần a wager, each seat that beats it is paid one, a tie nothing — after the cards\' duels, stack to stack', () => {
    // Seat 1 loses to the Aces, seat 2's trip Kings beat them (and win the pot: the Thần falls too), seat 3 ties.
    const t = new Stage({
      chaos: plan(4, { 3: { effects: [fx('g_duel')] } }, { god: godOf(0, 2) }),
      holes: ['Ah Ad', '3c 5d', 'Kc Ks', 'Ac As'],
    }).reveal(script(1, 0))
    expect(t.state.chaos!.duels!.filter((d) => d.god)).toEqual([
      { winner: 0, payer: 1, wagers: 1, cardId: 'd_carp', uid: 900, god: true },
      { winner: 2, payer: 0, wagers: 1, cardId: 'd_carp', uid: 900, god: true },
    ])
    expect(t.applied('carp').find((e) => e.reign === undefined)).toMatchObject({ seat: 0, targets: [1, 2, 3], wagers: 1 })
    const paid = t.applied('carp').filter((e) => e.transfers)
    expect(paid.map((e) => e.transfers)).toEqual([[{ from: 1, to: 0, amount: 1000 }], [{ from: 0, to: 2, amount: 1000 }]])
    // The card's duel (seat 3 vs a random opponent) pays first.
    const order = t.events.filter((e): e is Applied => e.type === 'CHAOS_APPLIED' && !!e.transfers).map((e) => e.effect)
    expect(order.indexOf('duel')).toBeLessThan(order.indexOf('carp'))
    t.conserved()
  })

  it('2 thách đấu: a payer short of a wager pays its stack; a shield keeps its seat out', () => {
    const t = new Stage({ chaos: plan(3, { 2: { shield: 'shield' } }, { god: godOf(0, 2) }), holes: ['Ah Ad', '3c 5d', '6c 8d'], stacks: [5000, 1300, 5000] }).reveal()
    // Seat 1 anted 1000 and has 300 left.
    expect(t.applied('carp').find((e) => e.transfers)!.transfers).toEqual([{ from: 1, to: 0, amount: 300 }])
    expect(t.stack(1)).toBe(0)
    expect(t.applied('carp').find((e) => e.outcome === 'blocked')!.targets).toEqual([2])
    t.conserved()
  })

  it('no curse once its three hands are over, nor when the Thần is out of the hand', () => {
    const t = new Stage({ chaos: plan(3, {}, { god: godOf(0, null) }), holes: ['Ah Ad', '3c 5d', '6c 8d'] }).reveal(never)
    expect(t.applied('carp')).toEqual([])
    expect(t.hole(1)).toEqual(parseCards('3c 5d'))
  })
})

describe('the crit and the fall', () => {
  const win = (s: Partial<AfterHandSeat> = {}) => at(0, EMPTY_CHAOS_SEAT, { outcome: 'win', net: 1000, ...s })
  it('the Thần crits ×4 / ×3 / ×2 at 10 / 25 / 40 % on a win; a Bán Thần ×3 / ×2 at 10 / 30 %', () => {
    const god = plan(1, {}, { god: godOf(0) })
    const crit = (p: ChaosHandPlan, r: number) => settle([win()], { plan: p, rng: script(r) }).credits
    expect(crit(god, 9)).toEqual([{ seat: 0, amount: 3000, reason: 'chaos_crit', cardId: 'd_carp', uid: 900, multiplier: 4 }])
    expect(crit(god, 34)[0]).toMatchObject({ amount: 2000, multiplier: 3 })
    expect(crit(god, 74)[0]).toMatchObject({ amount: 1000, multiplier: 2 })
    expect(crit(god, 75)).toEqual([])
    const demi = plan(1, {}, { demigods: [reign(0)] })
    expect(crit(demi, 9)[0]).toMatchObject({ amount: 2000, multiplier: 3 })
    expect(crit(demi, 39)[0]).toMatchObject({ amount: 1000, multiplier: 2 })
    expect(crit(demi, 40)).toEqual([])
    // Not on a loss, nor a win at a net loss.
    expect(settle([win({ outcome: 'loss' })], { plan: god, rng: never }).credits).toEqual([])
    expect(settle([win({ net: 0 })], { plan: god, rng: never }).credits).toEqual([])
  })

  it('with another crit the highest pays alone (Ruling 6)', () => {
    const e = fx('g_crit')
    const p = plan(1, { 0: { effects: [e] } }, { god: godOf(0) })
    // Bạo kích rolls ×3 (0 < 10), the Thần ×2 (50): one ×3 credit from Bạo kích.
    expect(settle([win()], { plan: p, rng: script(0, 50) }).credits).toEqual([{ seat: 0, amount: 2000, reason: 'chaos_crit', cardId: 'g_crit', uid: e.uid, multiplier: 3 }])
    expect(settle([win()], { plan: p, rng: script(0, 5) }).credits[0]).toMatchObject({ cardId: 'd_carp', multiplier: 4 })
  })

  it('dethroned: the Thần played and won no pot → every seat that won one beat it (marks, a public line); a split pot counts each', () => {
    const t = new Stage({ chaos: plan(3, {}, { god: godOf(0) }), holes: ['Ah Ad', 'Kc 3c', 'Ks 3d'], board: 'Kd Kh 4c 2s 9d' }).reveal(never)
    expect(t.state.result!.payouts.map((p) => p.seat)).toEqual([1, 2])
    expect(t.state.chaos!.outcomes!.dethroned).toEqual([1, 2])
    expect(t.state.chaos!.titles).toEqual([{ seat: 1, slew: 1 }, { seat: 2, slew: 1 }])
    const fall = t.applied('carp').find((e) => e.reign === 'godslain')!
    expect(fall).toMatchObject({ seat: 0, targets: [1, 2], outcome: 'applied' })
    expect(filterEvent(fall, null)).toEqual(fall)
    const summary = t.events.find((e): e is Extract<GameEvent, { type: 'CHAOS_SUMMARY' }> => e.type === 'CHAOS_SUMMARY')!
    expect(summary.used).toContainEqual({ seat: 0, cardId: 'd_carp', effect: 'carp', outcome: 'applied', targets: [1, 2], reign: 'godslain' })
    // A Thần that won (a share of) a pot stands.
    const tie = new Stage({ chaos: plan(2, {}, { god: godOf(0) }), holes: ['Ah Ad', 'Ac As'] }).reveal(never)
    expect(tie.state.chaos!.outcomes?.dethroned).toBeUndefined()
    expect(tie.state.chaos!.titles).toBeUndefined()
    // Without powers this hand (no plan.god) it cannot fall.
    const off = new Stage({ chaos: plan(2, {}), holes: ['Ah Ad', 'Kc Ks'] }).reveal(never)
    expect(off.state.chaos!.outcomes?.dethroned).toBeUndefined()
  })

  it('after the fall the throne is empty from the next hand; each slayer takes 2 Kim cương cards — a human\'s to its bonus hand (overflow dropped), a bot\'s at once', () => {
    const pool = [{ ...def('d_swap_hands'), enabled: true }]
    const p = plan(3, {}, { god: godOf(0) })
    const full = seatWith([], { bonus: [held('s_steal_one'), held('s_lower')] })
    const r = settle([
      at(0, EMPTY_CHAOS_SEAT),
      at(1, full, { outcome: 'win', net: 500 }),
      at(2, EMPTY_CHAOS_SEAT, { outcome: 'win', net: 500, isBot: true }),
    ], { plan: p, table: tableGod(0, 4), outcomes: { dethroned: [1, 2] }, pool, rng: zero })
    expect(r.table.god).toBeNull()
    expect(r.bonusAwarded).toEqual([{ seat: 1, cards: [pool[0]] }])
    expect(r.seats.get(1)!.bonus).toHaveLength(3)
    expect(r.awarded).toEqual([{ seat: 2, cards: [pool[0], pool[0]] }])
    // A dethrone outcome without a Thần acting this hand changes nothing.
    const none = settle([at(1, EMPTY_CHAOS_SEAT, { outcome: 'win', net: 500 })], { plan: plan(2, {}), table: tableGod(0, 4), outcomes: { dethroned: [1] }, pool })
    expect(none.table.god).toMatchObject({ seat: 0, handsLeft: 3 })
    expect(none.bonusAwarded).toEqual([])
  })
})

describe('the Bán Thần', () => {
  it('a live Cá chép whose seat wins a pot: the engine marks it and tells it; the reign starts next hand with 3 sets at the deal', () => {
    const c = carp(30)
    const t = new Stage({ chaos: plan(2, {}, { carps: [{ seat: 1, uid: c.uid, cardId: 'd_carp' }] }), holes: ['3c 5d', 'Ah Ad'] }).reveal(never)
    expect(t.state.chaos!.titles).toEqual([{ seat: 1, demigod: true }])
    expect(t.applied('carp')[0]).toMatchObject({ seat: 1, reign: 'demigod', outcome: 'applied', targets: [] })
    expect(t.state.chaos!.applied).toContain(c.uid)
    // afterHand starts the reign; the next plan has it.
    const after = settle([at(0, EMPTY_CHAOS_SEAT), at(1, seatWith([c]), { outcome: 'win', net: 1000 })], {
      plan: t.state.chaos!.plan, consumed: new Set(t.state.chaos!.applied), table: EMPTY_CHAOS_TABLE,
    })
    expect(after.table.demigods).toMatchObject([{ seat: 1, handsLeft: 5 }])
    const next = plan$({ 0: EMPTY_CHAOS_SEAT, 1: after.seats.get(1)! }, { rules: RULES, table: after.table })
    expect(next.plan.demigods).toEqual([{ seat: 1, isBot: false, cardId: 'd_carp', uid: c.uid, params: CARP.params }])
    expect(next.plan.noFoldSeats).toBeUndefined()
    // At the deal it keeps the best of 3 sets: 2 more sets of its hole cards come off the deck.
    const seats = [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: false }))
    const plain = createBlindHand({ handId: 'd0', rules: RULES, seats, button: 0, carryOverIn: 0, chaos: plan(2, {}) }, seededRng(5))
    const demi = createBlindHand({ handId: 'd1', rules: RULES, seats, button: 0, carryOverIn: 0, chaos: next.plan }, seededRng(5))
    expect(demi.state.deckIndex - plain.state.deckIndex).toBe(4)
    expect(demi.events.some((e) => e.type === 'CHAOS_APPLIED')).toBe(false)
  })

  it('a Bán Thần reigns alongside a Thần and acts on nobody else', () => {
    const table: ChaosTableState = { ...tableGod(0, 3, 1), demigods: [{ ...reign(1), playerId: 'p1', handsLeft: 4 }] }
    const r = plan$({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }, { table })
    expect(r.plan.god?.seat).toBe(0)
    expect(r.plan.demigods?.map((d) => d.seat)).toEqual([1])
    // Its seat is the Thần's curse target like any other.
    const t = new Stage({ chaos: { ...plan(3, {}), god: r.plan.god!, demigods: r.plan.demigods! }, holes: ['Ah Ad', '3c 5d', '6c 8d'] }).reveal(script(0, 0))
    expect(t.applied('carp')[0]!.targets).toEqual([1, 2])
  })

  it('a Bán Thần frozen or in Nhật thực\'s dark has no powers that hand', () => {
    const table: ChaosTableState = { ...EMPTY_CHAOS_TABLE, demigods: [{ ...reign(0), playerId: 'p0', handsLeft: 4 }] }
    expect(plan$({ 0: seatWith([], { frozenNextHand: true }), 1: EMPTY_CHAOS_SEAT }, { table }).plan.demigods).toBeUndefined()
    expect(plan$({ 0: EMPTY_CHAOS_SEAT, 1: seatWith([held('d_eclipse')]) }, { table }).plan.demigods).toBeUndefined()
  })
})

describe('a bot Thần', () => {
  it('a bot ascends like anyone; the reign and the plan say it is a bot (the server leaves its titles out, G12)', () => {
    const c = carp(100)
    const r = plan$({ 0: EMPTY_CHAOS_SEAT, 1: seatWith([c]) }, { rng: script(1), isBot: (s) => s === 1 })
    expect(r.table.god).toMatchObject({ seat: 1, isBot: true, playerId: 'p1', curse: 2 })
    expect(r.plan.god).toMatchObject({ seat: 1, isBot: true, ascended: true })
    const seats = [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, stack: 10_000, isBot: seat === 1 }))
    const { state } = createBlindHand({ handId: 'bot', rules: POF, seats, button: 0, carryOverIn: 0, chaos: r.plan }, seededRng(8))
    expect(state.players[1]!.holeCards.every(isAce)).toBe(true)
    expect(createBotStrategy().decide(playerView(state, 1), blindLegalActions(state, 1), seededRng(1))).toEqual({ kind: 'play' })
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('Conservation with a Thần reigning (seeded)', () => {
  it('300 hands with Cá chép forced to 100 %: the duel curse, the crits and the falls keep every point; no stack below 0', () => {
    const rng = seededRng(4646)
    let next = 1
    const nextUid = (): number => next++
    const forced: ChaosCardDef = { ...CARP, params: { ...CARP.params, energy0: 100 }, enabled: true }
    const pool = [...ENABLED.filter((c) => c.id !== 'd_carp'), forced]
    const extras = ['g_duel', 'g_crit', 'd_mirror', 's_shield', 'd_swap_hands', 's_steal_one', 'g_win_tax'].map(def)
    interface Seated { seat: number; stack: number; chaos: ChaosSeat; isBot: boolean }
    const seated: Seated[] = Array.from({ length: 4 }, (_, seat) => ({ seat, stack: 20_000, chaos: EMPTY_CHAOS_SEAT, isBot: seat % 2 === 1 }))
    let table: ChaosTableState = EMPTY_CHAOS_TABLE
    let carry = 0
    let outside = 0
    const seen = { ascended: 0, godDuelsPaid: 0, falls: 0, demigods: 0, freshDemigods: 0, godCrits: 0, curses: new Set<number>() }
    const total = (): number => seated.reduce((a, s) => a + s.stack, 0) + carry - outside
    const start = total()
    for (let h = 0; h < 300; h++) {
      const rules: BlindRules = { mode: 'blind', holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold', fixedWager: WAGER, tableFeeRate: rng.int(2) * 0.05 }
      for (const s of seated) {
        if (s.stack < WAGER) {
          outside += 20_000 - s.stack
          s.stack = 20_000
        }
        if (rng.int(5) === 0) s.chaos = receiveCard(s.chaos, rng.int(3) === 0 ? forced : extras[rng.int(extras.length)]!, nextUid, pool, rules.decisionMode, rng).seat
      }
      const dealt = seated.filter(() => rng.int(8) !== 0)
      if (dealt.length < 2) continue
      const planned = planHand({ seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, isBot: s.isBot, chaos: s.chaos })), rules, pool, rng, nextUid, table })
      for (const s of dealt) s.chaos = planned.seats.get(s.seat)!
      if (planned.plan.god?.ascended) seen.ascended++
      if (planned.plan.god?.curse) seen.curses.add(planned.plan.god.curse)
      const before = new Map(dealt.map((s) => [s.seat, s.stack]))
      const sumBefore = [...before.values()].reduce((a, b) => a + b, 0)
      const hand = createBlindHand({ handId: `g${h}`, rules, seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack, isBot: s.isBot })), button: dealt[h % dealt.length]!.seat, carryOverIn: carry, chaos: planned.plan }, rng)
      let state = hand.state
      // The Thần's hand is Aces (Thêm lá or Hên xui may add a card past the four Aces of the deck).
      if (planned.plan.god) expect(state.players.find((p) => p.seat === planned.plan.god!.seat)!.holeCards.some(isAce)).toBe(true)
      while (state.phase === 'DECISION') {
        const undecided = state.players.filter((x) => blindLegalActions(state, x.seat).kinds.length > 0)
        const x = undecided[rng.int(undecided.length)]!
        const kinds = blindLegalActions(state, x.seat).kinds as ('play' | 'fold')[]
        if (planned.plan.god && rules.decisionMode === 'playOrFold') expect(kinds).toEqual(['play'])
        state = applyBlindCommand(state, { type: 'ACTION', seat: x.seat, action: { kind: kinds[rng.int(kinds.length)]! } }, rng).state
      }
      while (state.phase === 'REVEAL') {
        state = applyBlindCommand(state, { type: 'ADVANCE' }, rng).state
        if (state.result === null) expect(state.players.reduce((a, x) => a + x.stack, 0) + state.pot).toBe(sumBefore + carry)
      }
      const r = state.result!
      expect(state.players.reduce((a, x) => a + x.stack, 0) + r.fee + r.carryOverOut).toBe(sumBefore + carry)
      const chaos = state.chaos!
      seen.godDuelsPaid += (chaos.duels ?? []).filter((d) => d.god).length
      if (chaos.outcomes?.dethroned) seen.falls++
      seen.demigods += (chaos.titles ?? []).filter((t) => t.demigod).length
      const winners = new Set(r.pots.flatMap((pot) => pot.winners.map((w) => w.seat)))
      const after = afterHand({
        rules, config: DEFAULT_CHAOS_CONFIG, pool, rng, nextUid, plan: chaos.plan, consumed: new Set([...chaos.applied, ...chaos.blocked]),
        recorded: new Set(chaos.recorded), carryOverOnly: r.pots.length === 0, marks: chaos.marks, table: planned.table,
        ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
        seats: state.players.map((hp) => ({
          seat: hp.seat, playerId: hp.playerId, isBot: hp.isBot, chaos: seated.find((s) => s.seat === hp.seat)!.chaos, stackAfter: hp.stack,
          net: hp.stack - before.get(hp.seat)!, inHand: true,
          outcome: r.pots.length === 0 ? ('none' as const) : winners.has(hp.seat) ? ('win' as const) : ('loss' as const),
        })),
      })
      for (const s of dealt) {
        s.chaos = after.seats.get(s.seat)!
        s.stack = state.players.find((x) => x.seat === s.seat)!.stack
      }
      // A demigod mark in the hand and a reign started by afterHand agree.
      for (const t of chaos.titles ?? []) if (t.demigod) expect(after.table.demigods.some((d) => d.seat === t.seat && d.handsLeft === CARP.params.demigodHands)).toBe(true)
      // …and the other way: every reign afterHand started this hand has its mark.
      const fresh = after.table.demigods.filter((d) => !planned.table.demigods.some((x) => x.seat === d.seat && x.uid === d.uid))
      for (const d of fresh) expect(chaos.titles?.some((t) => t.seat === d.seat && t.demigod)).toBe(true)
      seen.freshDemigods += fresh.length
      if (chaos.outcomes?.dethroned) expect(after.table.god).toBeNull()
      for (const d of after.debits) {
        seated.find((x) => x.seat === d.seat)!.stack -= d.amount
        outside -= d.amount
      }
      for (const c of after.credits) {
        seated.find((x) => x.seat === c.seat)!.stack += c.amount
        outside += c.amount
        if (c.cardId === 'd_carp') seen.godCrits++
      }
      outside -= r.fee
      table = after.table
      carry = r.carryOverOut
      // One Thần at most; a Bán Thần per seat at most.
      expect(new Set(table.demigods.map((d) => d.seat)).size).toBe(table.demigods.length)
      expect(seated.every((s) => s.stack >= 0)).toBe(true)
      expect(total()).toBe(start)
    }
    expect(seen.ascended).toBeGreaterThan(5)
    expect(seen.godDuelsPaid).toBeGreaterThan(0)
    expect(seen.falls).toBeGreaterThan(0)
    expect(seen.demigods).toBeGreaterThan(0)
    expect(seen.freshDemigods).toBe(seen.demigods)
    expect(seen.godCrits).toBeGreaterThan(0)
    expect(seen.curses.size).toBe(3)
  })
})
