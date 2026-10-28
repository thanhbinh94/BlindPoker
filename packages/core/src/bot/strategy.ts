import { rankOf, suitOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { HandCategory, evaluate } from '../evaluator/evaluator.js'
import type { LegalActions, PlayerAction } from '../hand/types.js'
import type { HandView } from '../hand/view.js'
import { chenScore } from './chen.js'

export interface BotStrategy {
  decide(view: HandView, legal: LegalActions, rng: Rng): PlayerAction
}

/** Box–Muller normal sample. */
export function gaussian(rng: Rng, mean: number, sd: number): number {
  const u = (rng.int(1_000_000) + 1) / 1_000_001
  const v = (rng.int(1_000_000) + 1) / 1_000_001
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function decideBlind(view: HandView, legal: LegalActions, rng: Rng): PlayerAction {
  const me = view.seats.find((s) => s.seat === view.mySeat)
  if (!me || !legal.kinds.includes('play')) return { kind: legal.kinds[0] ?? 'fold' } as PlayerAction
  // BP-41 Cấm bỏ bài / a Thần: no fold to choose, so nothing to weigh.
  if (!legal.kinds.includes('fold')) return { kind: 'play' }
  // Blindfolded (Poker hỗn loạn "Che mắt"): the bot cannot see its own cards either, so it plays half its hands.
  if (!me.holeCards) return { kind: rng.int(2) === 0 ? 'play' : 'fold' }
  const opponents = view.seats.filter((s) => s.seat !== view.mySeat && !s.folded).length
  let threshold = 3 + 0.5 * (opponents - 1)
  if (view.carryOverIn > 4 * legal.callAmount) threshold -= 1.5
  const score = chenScore(me.holeCards) + gaussian(rng, 0, 1.5)
  return { kind: score >= threshold ? 'play' : 'fold' }
}

/** Rough made-hand strength in [0,1] plus draw bonus, from my cards and the board. */
function handStrength(hole: Card[], community: Card[]): number {
  if (community.length === 0) return clamp((chenScore(hole) + 2) / 22, 0, 1)
  const ev = evaluate([...hole, ...community])
  const base: Record<number, number> = {
    [HandCategory.HIGH_CARD]: 0.15, [HandCategory.PAIR]: 0.45, [HandCategory.TWO_PAIR]: 0.65, [HandCategory.TRIPS]: 0.75,
    [HandCategory.STRAIGHT]: 0.85, [HandCategory.FLUSH]: 0.9, [HandCategory.FULL_HOUSE]: 0.97, [HandCategory.QUADS]: 0.99,
    [HandCategory.STRAIGHT_FLUSH]: 1, [HandCategory.ROYAL_FLUSH]: 1,
  }
  let s = base[ev.category] ?? 0.15
  if (ev.category === HandCategory.HIGH_CARD && hole.some((c) => rankOf(c) >= 11)) s = 0.25
  if (community.length < 5) {
    const all = [...hole, ...community]
    const suits = new Map<number, number>()
    for (const c of all) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1)
    if ([...suits.values()].some((n) => n === 4) && ev.category < HandCategory.FLUSH) s += 0.2
    const ranks = [...new Set(all.map(rankOf))].sort((a, b) => a - b)
    for (let i = 0; i + 3 < ranks.length; i++) if (ranks[i + 3]! - ranks[i]! === 3 && ev.category < HandCategory.STRAIGHT) s += 0.15
  }
  return clamp(s, 0, 1)
}

function decideHoldem(view: HandView, legal: LegalActions, rng: Rng): PlayerAction {
  const me = view.seats.find((s) => s.seat === view.mySeat)
  if (!me?.holeCards) return { kind: legal.kinds.includes('check') ? 'check' : 'fold' }
  const toCall = legal.callAmount
  const potOdds = toCall > 0 ? toCall / (view.pot + toCall) : 0
  const strength = clamp(handStrength(me.holeCards, view.community) + gaussian(rng, 0, 0.05), 0, 1)
  const opponents = view.seats.filter((s) => s.seat !== view.mySeat && !s.folded).length
  const can = (k: PlayerAction['kind']) => legal.kinds.includes(k)

  const sizeBet = (): PlayerAction => {
    const target = Math.round(view.pot * (0.5 + rng.int(26) / 100)) // ½–¾ pot
    if (can('bet')) return { kind: 'bet', amount: clamp(Math.max(target, legal.minBet), legal.minBet, legal.maxBet) }
    if (can('raise')) return { kind: 'raise', amount: clamp(Math.max(view.currentBet + target, legal.minRaiseTo), legal.minRaiseTo, legal.maxRaiseTo) }
    if (can('call')) return { kind: 'call' }
    return { kind: can('check') ? 'check' : 'fold' }
  }

  if (strength >= 0.7) return strength >= 0.95 && can('allIn') && rng.int(4) === 0 ? { kind: 'allIn' } : sizeBet()
  if (toCall === 0) {
    if (opponents <= 2 && rng.int(100) < 8 && (can('bet') || can('raise'))) return sizeBet() // bluff
    return { kind: can('check') ? 'check' : 'fold' }
  }
  if (strength >= potOdds + 0.05 && can('call')) return { kind: 'call' }
  return { kind: 'fold' }
}

export function createBotStrategy(): BotStrategy {
  return {
    decide(view, legal, rng) {
      const action = view.mode === 'blind' ? decideBlind(view, legal, rng) : decideHoldem(view, legal, rng)
      if (legal.kinds.includes(action.kind)) return action
      if (legal.kinds.length === 0) throw new Error('bot: no legal actions')
      return { kind: legal.kinds.includes('check') ? 'check' : legal.kinds.includes('fold') ? 'fold' : legal.kinds[0]! } as PlayerAction
    },
  }
}
