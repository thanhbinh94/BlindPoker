import type { Rng } from '../cards/rng.js'
import { CHAOS_TIERS, type ChaosCardDef, type ChaosConfig, type ChaosMode, type ChaosTier } from './types.js'

/** Weights may be fractional (a GM's 0.5): draws work in hundredths so `Rng.int` stays on integers. */
const ticks = (w: number | undefined): number => (w === undefined || !Number.isFinite(w) || w <= 0 ? 0 : Math.round(w * 100))

/** Picks an index by weight; -1 when every weight is 0. */
function pickWeighted(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return -1
  let r = rng.int(total)
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!
    if (r < 0) return i
  }
  return weights.length - 1
}

/** The tier of a draft or a bonus card (spec §3.2–§3.3: Bạc 60 / Vàng 30 / Kim cương 10 by default). */
export function drawTier(weights: ChaosConfig['tierWeights'], rng: Rng): ChaosTier {
  const i = pickWeighted(CHAOS_TIERS.map((t) => ticks(weights[t])), rng)
  return CHAOS_TIERS[Math.max(0, i)]!
}

/** The card's draw weight: the GM's weight, 1 by default; 0 (or a disabled card) means never. */
export const cardWeight = (card: ChaosCardDef, weights?: ReadonlyMap<string, number>): number =>
  card.enabled ? (weights?.get(card.id) ?? 1) : 0

/** One card from `candidates` by weight (any tier); undefined when none has a weight above 0. */
export function pickCard(candidates: readonly ChaosCardDef[], rng: Rng, weights?: ReadonlyMap<string, number>): ChaosCardDef | undefined {
  const i = pickWeighted(candidates.map((c) => ticks(cardWeight(c, weights))), rng)
  return i < 0 ? undefined : candidates[i]
}

/**
 * Up to `count` distinct cards of `tier` valid for `mode`, drawn by weight without replacement. A tier with fewer active
 * cards offers what it has; a tier with none falls back to the next lower tier (diamond → gold → silver), and an empty
 * silver tier offers nothing — a draw never throws.
 */
export function drawOffer(
  pool: readonly ChaosCardDef[], tier: ChaosTier, mode: ChaosMode, rng: Rng, count = 3, weights?: ReadonlyMap<string, number>,
): ChaosCardDef[] {
  for (let t = CHAOS_TIERS.indexOf(tier); t >= 0; t--) {
    const candidates = pool.filter((c) => c.tier === CHAOS_TIERS[t] && c.modes.includes(mode) && ticks(cardWeight(c, weights)) > 0)
    if (candidates.length === 0) continue
    const w = candidates.map((c) => ticks(cardWeight(c, weights)))
    const out: ChaosCardDef[] = []
    while (out.length < count) {
      const i = pickWeighted(w, rng)
      if (i < 0) break
      out.push(candidates[i]!)
      w[i] = 0
    }
    return out
  }
  return []
}
