import { describe, expect, it } from 'vitest'
import { rankOf } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandState } from '../hand/types.js'
import { filterEvent } from '../hand/view.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { endReign } from './god.js'
import { receiveCard } from './hold.js'
import { planHand } from './plan.js'
import { afterHand } from './settle.js'
import { stealPoints } from './steal.js'
import { DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE, type ChaosSeat, type ChaosTableState } from './types.js'

/**
 * BP-41 fix wave (item 8): the final review's fuzz, kept as a seeded regression. A table of 3–6 seats (every third a bot) plays
 * `HANDS` hands with every card of the catalogue on — Cá chép at 100 % energy, so Thần reign often — carried from hand to hand as
 * the room does: cards received at random (Trộm điểm resolved on receipt), a seat that leaves now and then (its reign ends,
 * its bombs go, its chaos is lost), seats sitting a hand out (they still settle, `inHand: false`), random decisions and
 * FORFEITs. After every hand it holds:
 * - the points: Σ stacks + the carry-over − what entered or left from outside (top-ups, credits, debits, fees) never changes,
 *   and the hand itself conserves Σ stacks + fee + carry-over; no stack or chaos point total goes negative;
 * - the cards: no card twice among the hands and the board, no empty hand, a full board (six on a sixth-board hand) at a
 *   showdown, and the Thần's hand all Aces as far as four go;
 * - the rules: nobody may fold on a "Chơi hoặc bỏ" table while a Thần acts (G11); a Bán Thần's title mark (engine) is given
 *   exactly when `afterHand` crowns one; the Thần sits on a seated seat, is never also a Bán Thần, and reigns 1–5 hands;
 *   no Bán Thần twice; no card past its hands, cap or the bonus hand's three; no private deal event reaches a non-party.
 * Everything it finds goes into one list, so a failure names every problem with its seed and hand.
 */

const WAGER = 1000
const SEEDS = [1, 2, 3, 4, 5]
const HANDS = 120
const ALL = CHAOS_CARDS_SPEC.map((c) => (c.id === 'd_carp' ? { ...c, enabled: true, params: { ...c.params, energy0: 100 } } : { ...c, enabled: true }))
/** Cards that change how many hole cards the Thần is dealt, so its "all Aces" check does not apply. */
const RESIZING = ['extraHole', 'bestOfN', 'riskyHand', 'bigTable', 'wildCard']

interface Seated {
  seat: number
  stack: number
  chaos: ChaosSeat
  isBot: boolean
}

interface Seen {
  ascensions: number
  godHands: number
  demigods: number
  slain: number
}

function play(seed: number, issues: string[]): Seen {
  const rng = seededRng(seed)
  let next = 1
  const nextUid = (): number => next++
  const n = 3 + (seed % 4)
  const seated: Seated[] = Array.from({ length: n }, (_, seat) => ({ seat, stack: 30_000, chaos: EMPTY_CHAOS_SEAT, isBot: seat % 3 === 0 }))
  let table: ChaosTableState = EMPTY_CHAOS_TABLE
  let carry = 0
  /** Points that came in from outside the table (top-ups, credits) less those that left it (debits, fees). */
  let outside = 0
  const seen: Seen = { ascensions: 0, godHands: 0, demigods: 0, slain: 0 }
  const total = (): number => seated.reduce((a, s) => a + s.stack, 0) + carry - outside
  const start = total()
  const issue = (h: number, what: string): void => {
    issues.push(`seed ${seed} hand ${h}: ${what}`)
  }

  for (let h = 0; h < HANDS; h++) {
    const rules: BlindRules = { mode: 'blind', holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold', fixedWager: WAGER, tableFeeRate: 0 }
    for (const s of seated) {
      if (s.stack < WAGER) {
        outside += 30_000 - s.stack
        s.stack = 30_000
      }
      if (rng.int(3) !== 0) continue
      const card = ALL[rng.int(ALL.length)]!
      if (!card.modes.includes(rules.decisionMode)) continue
      const got = receiveCard(s.chaos, card, nextUid, ALL, rules.decisionMode, rng)
      s.chaos = got.seat
      for (const c of got.received.filter((x) => x.effect === 'stealPoints')) {
        const pointsBefore = seated.reduce((a, x) => a + x.chaos.points, 0)
        const stolen = stealPoints({ seats: new Map(seated.map((x) => [x.seat, x.chaos])), holder: s.seat, card: { cardId: c.id, uid: nextUid(), params: c.params }, rng })
        for (const x of seated) x.chaos = stolen.seats.get(x.seat)!
        if (seated.reduce((a, x) => a + x.chaos.points, 0) !== pointsBefore) issue(h, 'a Trộm điểm changed the table’s chaos points')
      }
    }
    // A seat leaves now and then, as the room clears it: its reign ends, its bombs go, its chaos is lost.
    if (rng.int(40) === 0) {
      const s = seated[rng.int(seated.length)]!
      table = endReign(table, s.seat)
      table = { ...table, bombs: table.bombs.filter((b) => b.owner !== s.seat && b.carrier !== s.seat) }
      s.chaos = EMPTY_CHAOS_SEAT
    }
    const dealt = seated.filter(() => rng.int(6) !== 0)
    if (dealt.length < 2) continue
    const sitting = seated.filter((s) => !dealt.includes(s))

    const planned = planHand({ seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, isBot: s.isBot, chaos: s.chaos })), rules, pool: ALL, rng, nextUid, table })
    for (const s of dealt) s.chaos = planned.seats.get(s.seat)!
    const god = planned.plan.god
    if (god) {
      seen.godHands++
      if (god.ascended) seen.ascensions++
    }
    const before = new Map(dealt.map((s) => [s.seat, s.stack]))
    const sumBefore = [...before.values()].reduce((a, b) => a + b, 0)
    const events: GameEvent[] = []
    const hand = createBlindHand({
      handId: `f${seed}-${h}`, rules, seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack, isBot: s.isBot })),
      button: dealt[h % dealt.length]!.seat, carryOverIn: carry, chaos: planned.plan,
    }, rng)
    let state: HandState = hand.state
    events.push(...hand.events)
    if (god) {
      const gp = state.players.find((p) => p.seat === god.seat)!
      const resized = state.chaos!.plan.seats.find((s) => s.seat === god.seat)!.effects.some((e) => RESIZING.includes(e.effect))
      if (gp.holeCards.length <= 4 && gp.holeCards.some((c) => rankOf(c) !== 12) && !resized) issue(h, `the Thần (seat ${god.seat}) was dealt ${gp.holeCards.map(rankOf).join(',')}`)
    }
    const step = (cmd: Parameters<typeof applyBlindCommand>[1]): void => {
      const r = applyBlindCommand(state, cmd, rng)
      state = r.state
      events.push(...r.events)
    }
    while (state.phase === 'DECISION') {
      const undecided = state.players.filter((x) => blindLegalActions(state, x.seat).kinds.length > 0)
      const x = undecided[rng.int(undecided.length)]!
      const kinds = blindLegalActions(state, x.seat).kinds as ('play' | 'fold')[]
      if (god && rules.decisionMode === 'playOrFold' && kinds.includes('fold')) issue(h, 'a fold was legal while the Thần acts')
      if (rng.int(30) === 0) step({ type: 'FORFEIT', seat: x.seat })
      else step({ type: 'ACTION', seat: x.seat, action: { kind: kinds[rng.int(kinds.length)]! } })
    }
    while (state.phase === 'REVEAL') step({ type: 'ADVANCE' })

    const cards = [...state.players.flatMap((p) => p.holeCards), ...state.community]
    if (new Set(cards).size !== cards.length) issue(h, `a card twice: ${cards.join(',')}`)
    if (state.players.some((p) => p.holeCards.length === 0)) issue(h, 'an empty hand')
    const r = state.result!
    if (r.showdown && state.community.length !== (state.chaos!.sixthBoard ? 6 : 5)) issue(h, `a board of ${state.community.length}`)
    if (state.players.reduce((a, x) => a + x.stack, 0) + r.fee + r.carryOverOut !== sumBefore + carry) issue(h, 'the hand did not conserve its points')
    if (state.players.some((p) => p.stack < 0)) issue(h, 'a negative stack')
    for (const ev of events) {
      if (ev.type !== 'CHAOS_APPLIED' || !ev.privateTo) continue
      for (const p of state.players) if (!ev.privateTo.includes(p.seat) && filterEvent(ev, p.seat) !== null) issue(h, `a private ${ev.effect} reached seat ${p.seat}`)
    }

    const chaos = state.chaos!
    if (chaos.outcomes?.dethroned) seen.slain++
    const winners = new Set(r.pots.flatMap((pot) => pot.winners.map((w) => w.seat)))
    const carried = r.pots.length === 0
    const after = afterHand({
      rules, config: DEFAULT_CHAOS_CONFIG, pool: ALL, rng, nextUid, plan: chaos.plan, consumed: new Set([...chaos.applied, ...chaos.blocked]),
      recorded: new Set(chaos.recorded), carryOverOnly: carried, marks: chaos.marks, table: planned.table,
      ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
      seats: [
        ...state.players.map((hp) => ({
          seat: hp.seat, playerId: `p${hp.seat}`, isBot: hp.isBot, chaos: seated.find((s) => s.seat === hp.seat)!.chaos, stackAfter: hp.stack,
          net: hp.stack - before.get(hp.seat)!, inHand: true, outcome: carried ? ('none' as const) : winners.has(hp.seat) ? ('win' as const) : ('loss' as const),
        })),
        ...sitting.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, isBot: s.isBot, chaos: s.chaos, stackAfter: s.stack, net: 0, inHand: false, outcome: 'none' as const })),
      ],
    })
    // The engine's Bán Thần mark and afterHand's crown agree.
    const marked = new Set((chaos.titles ?? []).filter((t) => t.demigod).map((t) => t.seat))
    const crowned = new Set(after.table.demigods.filter((d) => !planned.table.demigods.some((x) => x.uid === d.uid)).map((d) => d.seat))
    if ([...marked].sort().join() !== [...crowned].sort().join()) issue(h, `Bán Thần marked ${[...marked].join(',')} but crowned ${[...crowned].join(',')}`)
    seen.demigods += crowned.size

    for (const s of dealt) {
      s.chaos = after.seats.get(s.seat)!
      s.stack = state.players.find((x) => x.seat === s.seat)!.stack
    }
    for (const s of sitting) s.chaos = after.seats.get(s.seat)!
    for (const d of after.debits) {
      const s = seated.find((x) => x.seat === d.seat)!
      if (d.amount > s.stack) issue(h, 'a debit larger than the stack')
      s.stack -= d.amount
      outside -= d.amount
    }
    for (const c of after.credits) {
      if (c.amount < 0) issue(h, 'a negative credit')
      seated.find((x) => x.seat === c.seat)!.stack += c.amount
      outside += c.amount
    }
    outside -= r.fee
    table = after.table
    carry = r.carryOverOut
    if (seated.some((s) => s.stack < 0)) issue(h, 'a negative stack after the credits and debits')
    if (total() !== start) {
      issue(h, `the table’s points moved by ${total() - start}`)
      return seen
    }

    const g = table.god
    if (g && !seated.some((s) => s.seat === g.seat)) issue(h, 'the Thần on an empty seat')
    if (g && table.demigods.some((d) => d.seat === g.seat)) issue(h, 'the Thần is also a Bán Thần')
    if (g && (g.handsLeft < 1 || g.handsLeft > 5)) issue(h, `the Thần has ${g.handsLeft} hands left`)
    if (new Set(table.demigods.map((d) => d.seat)).size !== table.demigods.length) issue(h, 'a Bán Thần twice')
    for (const s of seated) {
      for (const c of s.chaos.cards) {
        if (c.handsLeft !== null && c.handsLeft <= 0) issue(h, `${c.cardId} held with ${c.handsLeft} hands left`)
        if (c.effect === 'carp' && (c.charge ?? 0) > 100) issue(h, 'a Cá chép past 100 %')
        if (c.effect === 'acesCharge' && (c.charge ?? 0) > (c.params.cap ?? 100)) issue(h, 'a Siêu cộng dồn past its cap')
      }
      if (!s.isBot && s.chaos.bonus.length + (s.chaos.armed ? 1 : 0) > 3) issue(h, `a bonus hand of ${s.chaos.bonus.length}`)
      if (s.chaos.points < 0) issue(h, 'negative chaos points')
    }
  }
  return seen
}

describe('Poker hỗn loạn round three, seeded fuzz (BP-41)', () => {
  it(`plays ${SEEDS.length} tables × ${HANDS} hands with every card on, and every rule holds after every hand`, () => {
    const issues: string[] = []
    const seen: Seen = { ascensions: 0, godHands: 0, demigods: 0, slain: 0 }
    for (const seed of SEEDS) {
      const s = play(seed, issues)
      seen.ascensions += s.ascensions
      seen.godHands += s.godHands
      seen.demigods += s.demigods
      seen.slain += s.slain
    }
    expect(issues.slice(0, 20)).toEqual([])
    // The run reached what it is meant to test: Thần reigned, fell, and Bán Thần were crowned.
    expect(seen.ascensions).toBeGreaterThan(0)
    expect(seen.godHands).toBeGreaterThan(seen.ascensions)
    expect(seen.slain).toBeGreaterThan(0)
    expect(seen.demigods).toBeGreaterThan(0)
  })
})
