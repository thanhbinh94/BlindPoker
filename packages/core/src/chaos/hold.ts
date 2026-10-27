import type { Rng } from '../cards/rng.js'
import { drawOffer, drawTier } from './draw.js'
import {
  CHAOS_TIERS, DEFAULT_CHAOS_CONFIG,
  type ChaosCardDef, type ChaosConfig, type ChaosMode, type ChaosSeat, type ChaosTier, type HeldCard, type HeldCardView,
} from './types.js'

const TIER_RANK: Readonly<Record<ChaosTier, number>> = { silver: 1, gold: 2, diamond: 3 }

/** A tier written as a number in `params` (Cấp độ, Thần tài): 1 silver, 2 gold, 3 diamond; anything else = none. */
export const tierFromParam = (n: number | undefined): ChaosTier | undefined => (n === undefined ? undefined : CHAOS_TIERS[n - 1])

/** "Cày điểm" doubling left, mirrored from the held farm card. */
export const farmHandsOf = (cards: readonly HeldCard[]): number =>
  cards.find((c) => c.effect === 'farm' && c.handsLeft !== null)?.handsLeft ?? 0

/** A card as a seat holds it, under `uid`: a duration card starts with its full `hands`. */
export const toHeld = (def: ChaosCardDef, uid: number): HeldCard => ({
  uid, cardId: def.id, tier: def.tier, effect: def.effect, params: def.params, timing: def.timing, debuff: def.debuff,
  handsLeft: def.params.hands ?? null,
})

/**
 * Spec §3.4's rule for a duration card reaching a seat that already holds a duration card of the same effect, at index
 * `i`: a lower tier is dropped, the same card adds its hands, another card of the same tier or a higher tier replaces
 * the held one. `push` when the seat holds no such card. One rule for `receiveCard`, a bonus card played into `cards`
 * (`stackHeld`) and the refusal of a weaker duplicate (`armBonus`).
 */
export function stackRule(
  cards: readonly HeldCard[], card: { effect: HeldCard['effect']; tier: ChaosTier; cardId: string },
): { kind: 'drop' | 'add' | 'replace'; i: number } | { kind: 'push' } {
  const i = cards.findIndex((c) => c.effect === card.effect && c.handsLeft !== null)
  const old = cards[i]
  if (!old) return { kind: 'push' }
  if (TIER_RANK[card.tier] < TIER_RANK[old.tier]) return { kind: 'drop', i }
  return { kind: TIER_RANK[card.tier] === TIER_RANK[old.tier] && old.cardId === card.cardId ? 'add' : 'replace', i }
}

/**
 * A held duration card (a played bonus card) joins `cards` under `stackRule`, keeping its uid when it is added or
 * replaces; null when the rule drops it. The input is never changed.
 */
export function stackHeld(cards: readonly HeldCard[], card: HeldCard): HeldCard[] | null {
  const rule = stackRule(cards, card)
  const out = cards.slice()
  switch (rule.kind) {
    case 'drop': return null
    case 'push': out.push(card); return out
    case 'add': out[rule.i] = { ...out[rule.i]!, handsLeft: (out[rule.i]!.handsLeft ?? 0) + (card.handsLeft ?? 0) }; return out
    case 'replace': out[rule.i] = card; return out
  }
}

/**
 * A seat receives a card (a draft pick, a bonus card, a Thần tài prize). "Now" cards act at once — Cấp độ turns into
 * its cards (spec §5.6, never another Cấp độ), Tích lũy adds its points — and the rest are held, under spec §3.4's
 * rule for duration cards of the same effect: a higher tier replaces the held one, the same card adds its hands, another
 * card of the same tier replaces it (with its own params), a lower tier is dropped. `received` lists every card that reached the seat, a Cấp độ first and then what it became; a
 * dropped card is not in it. The input seat is never changed.
 */
export function receiveCard(
  seat: ChaosSeat, def: ChaosCardDef, nextUid: () => number, pool: readonly ChaosCardDef[], mode: ChaosMode, rng: Rng,
  weights?: ReadonlyMap<string, number>, tierWeights: ChaosConfig['tierWeights'] = DEFAULT_CHAOS_CONFIG.tierWeights,
): { seat: ChaosSeat; received: ChaosCardDef[] } {
  const cards = seat.cards.slice()
  let points = seat.points
  const received: ChaosCardDef[] = []

  const take = (d: ChaosCardDef): void => {
    if (d.effect === 'levelUp') {
      received.push(d)
      const notLevel = pool.filter((c) => c.effect !== 'levelUp')
      for (let i = 0; i < (d.params.count ?? 1); i++) {
        const tier = tierFromParam(d.params.tier) ?? drawTier(tierWeights, rng)
        const got = drawOffer(notLevel, tier, mode, rng, 1, weights)[0]
        if (got) take(got)
      }
      return
    }
    if (d.effect === 'chaosPoints') {
      points += d.params.points ?? 0
      received.push(d)
      return
    }
    const hands = d.params.hands
    if (hands !== undefined) {
      const rule = stackRule(cards, { effect: d.effect, tier: d.tier, cardId: d.id })
      if (rule.kind === 'drop') return
      if (rule.kind !== 'push') {
        // Only the same card adds its hands; another card of the same effect and tier replaces the held one with its own
        // params (ledger ruling, Plan 37 final wave): adding hands to the older card's params would stack a stronger card's
        // reach onto a weaker one, or the other way round.
        const old = cards[rule.i]!
        cards[rule.i] = rule.kind === 'add' ? { ...old, handsLeft: (old.handsLeft ?? 0) + hands } : toHeld(d, nextUid())
        received.push(d)
        return
      }
    }
    cards.push(toHeld(d, nextUid()))
    received.push(d)
  }

  take(def)
  return { seat: { ...seat, cards, points, farmHandsLeft: farmHandsOf(cards) }, received }
}

export const toHeldCardView = (card: HeldCard): HeldCardView => ({
  uid: card.uid, cardId: card.cardId, tier: card.tier, handsLeft: card.handsLeft,
})
