import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import { drawOffer, drawTier } from './draw.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { DEFAULT_CHAOS_CONFIG, type ChaosTier } from './types.js'

describe('drawTier', () => {
  it('lands within ±2 % of 60/30/10 over 10 000 seeded draws', () => {
    const rng = seededRng(37)
    const counts: Record<ChaosTier, number> = { silver: 0, gold: 0, diamond: 0 }
    for (let i = 0; i < 10_000; i++) counts[drawTier(DEFAULT_CHAOS_CONFIG.tierWeights, rng)]++
    expect(Math.abs(counts.silver - 6_000)).toBeLessThanOrEqual(200)
    expect(Math.abs(counts.gold - 3_000)).toBeLessThanOrEqual(200)
    expect(Math.abs(counts.diamond - 1_000)).toBeLessThanOrEqual(200)
  })

  it('never draws a tier of weight 0', () => {
    const rng = seededRng(1)
    for (let i = 0; i < 500; i++) expect(drawTier({ silver: 0, gold: 1, diamond: 0 }, rng)).toBe('gold')
  })
})

describe('drawOffer', () => {
  it('returns 3 distinct enabled cards of the tier', () => {
    const rng = seededRng(5)
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      for (let i = 0; i < 200; i++) {
        const offer = drawOffer(CHAOS_CARDS_SPEC, tier, 'playOrFold', rng)
        expect(offer).toHaveLength(3)
        expect(new Set(offer.map((c) => c.id)).size).toBe(3)
        for (const c of offer) expect(c.tier).toBe(tier)
      }
    }
  })

  it('never offers a play-or-fold-only card to a pure-luck table', () => {
    const rng = seededRng(6)
    for (let i = 0; i < 500; i++) {
      for (const c of drawOffer(CHAOS_CARDS_SPEC, 'silver', 'none', rng)) expect(c.modes, c.id).toContain('none')
    }
  })

  it('never offers a weight-0 or disabled card, and favours a heavier one', () => {
    const rng = seededRng(7)
    const pool = CHAOS_CARDS_SPEC.map((c) => (c.id === 'g_farm' ? { ...c, enabled: false } : c))
    const weights = new Map([['g_luck_3', 0], ['g_crit', 20]])
    const seen = new Map<string, number>()
    for (let i = 0; i < 500; i++) {
      for (const c of drawOffer(pool, 'gold', 'none', rng, 3, weights)) seen.set(c.id, (seen.get(c.id) ?? 0) + 1)
    }
    expect(seen.has('g_luck_3')).toBe(false)
    expect(seen.has('g_farm')).toBe(false)
    expect(seen.get('g_crit')).toBeGreaterThan(450)
  })

  it('offers what exists when a tier has fewer active cards, and falls back a tier when it has none', () => {
    const rng = seededRng(8)
    const onlyTwoDiamonds = new Map(CHAOS_CARDS_SPEC.filter((c) => c.tier === 'diamond' && c.id !== 'd_crit' && c.id !== 'd_mirror').map((c) => [c.id, 0]))
    expect(drawOffer(CHAOS_CARDS_SPEC, 'diamond', 'none', rng, 3, onlyTwoDiamonds).map((c) => c.id).sort()).toEqual(['d_crit', 'd_mirror'])
    const noDiamonds = new Map(CHAOS_CARDS_SPEC.filter((c) => c.tier === 'diamond').map((c) => [c.id, 0]))
    const fallback = drawOffer(CHAOS_CARDS_SPEC, 'diamond', 'none', rng, 3, noDiamonds)
    expect(fallback).toHaveLength(3)
    for (const c of fallback) expect(c.tier).toBe('gold')
    expect(drawOffer([], 'diamond', 'none', rng)).toEqual([])
  })

  it('draws the same offer from the same seed', () => {
    const a = drawOffer(CHAOS_CARDS_SPEC, 'gold', 'playOrFold', seededRng(99)).map((c) => c.id)
    const b = drawOffer(CHAOS_CARDS_SPEC, 'gold', 'playOrFold', seededRng(99)).map((c) => c.id)
    expect(a).toEqual(b)
  })
})
