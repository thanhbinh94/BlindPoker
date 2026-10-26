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

const toHeld = (def: ChaosCardDef, uid: number): HeldCard => ({
  uid, cardId: def.id, tier: def.tier, effect: def.effect, params: def.params, timing: def.timing, debuff: def.debuff,
  handsLeft: def.params.hands ?? null,
})

/**
 * A seat receives a card (a draft pick, a bonus card, a Thần tài prize). "Now" cards act at once — Cấp độ turns into
 * its cards (spec §5.6, never another Cấp độ), Tích lũy adds its points — and the rest are held, under spec §3.4's
 * rule for duration cards of the same effect: a higher tier replaces the held one, the same tier adds its hands, a
 * lower tier is dropped. `received` lists every card that reached the seat, a Cấp độ first and then what it became; a
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
      const i = cards.findIndex((c) => c.effect === d.effect && c.handsLeft !== null)
      const old = cards[i]
      if (old) {
        if (TIER_RANK[d.tier] < TIER_RANK[old.tier]) return
        cards[i] = TIER_RANK[d.tier] > TIER_RANK[old.tier] ? toHeld(d, nextUid()) : { ...old, handsLeft: (old.handsLeft ?? 0) + hands }
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
