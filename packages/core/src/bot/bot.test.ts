import { describe, expect, it } from 'vitest'
import { parseCards } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { simulateHand } from '../hand/simulate.js'
import type { BlindRules, HoldemRules } from '../hand/types.js'
import { chenScore } from './chen.js'
import { createBotStrategy } from './strategy.js'

describe('chenScore', () => {
  it.each([
    ['As Ah', 20], ['Ks Kh', 16], ['2s 2h', 5], ['As Ks', 12], ['As Kh', 10], ['Ts 9s', 8], ['7s 2h', -1], ['Js Ts', 9], ['Qs Jh', 7],
  ])('%s → %i', (hand, expected) => {
    expect(chenScore(parseCards(hand))).toBe(expected)
  })
  it('scores three cards using the best pair plus bonuses', () => {
    expect(chenScore(parseCards('As Ah 2c'))).toBe(22)      // pair of aces + 2
    expect(chenScore(parseCards('7s 7h 7c'))).toBe(14)     // pair of 7s = 3.5 × 2 = 7, + 2 (pair) + 5 (trips)
  })
})

describe('bot never makes illegal moves', () => {
  const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
  const seats = (stacks: number[]) => stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: true }))
  it('plays 2000 blind hands of every variant', () => {
    const bot = createBotStrategy()
    const rng = seededRng(11)
    let plays = 0, decisions = 0
    for (let i = 0; i < 2000; i++) {
      const rules: BlindRules = { mode: 'blind', holeCards: i % 2 === 0 ? 2 : 3, decisionMode: i % 4 < 2 ? 'none' : 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
      const n = 2 + rng.int(7)
      const { state } = simulateHand({ handId: `b${i}`, rules, seats: seats(Array(n).fill(20000)), button: 0 }, (v, l, r) => {
        const a = bot.decide(v, l, r)
        if (rules.decisionMode === 'playOrFold') { decisions++; if (a.kind === 'play') plays++ }
        return a
      }, rng)
      expect(state.phase).toBe('COMPLETE')
    }
    const rate = plays / decisions
    expect(rate).toBeGreaterThan(0.3)
    expect(rate).toBeLessThan(0.8)
  })
  it('plays more often when a pot has carried over', () => {
    const bot = createBotStrategy()
    const rules: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
    const playRate = (carryOverIn: number) => {
      const rng = seededRng(31)
      let plays = 0, decisions = 0
      for (let i = 0; i < 500; i++) {
        simulateHand({ handId: `c${i}`, rules, seats: seats([20000, 20000, 20000]), button: 0, carryOverIn }, (v, l, r) => {
          const a = bot.decide(v, l, r)
          decisions++
          if (a.kind === 'play') plays++
          return a
        }, rng)
      }
      return plays / decisions
    }
    // decideBlind drops its threshold by 1.5 once carryOverIn exceeds 4 × the wager
    expect(playRate(5 * rules.fixedWager)).toBeGreaterThan(playRate(0))
  })
  it('plays 1000 hold’em hands with 2–6 bots', () => {
    const bot = createBotStrategy()
    const rng = seededRng(12)
    for (let i = 0; i < 1000; i++) {
      const n = 2 + rng.int(5)
      const { state } = simulateHand({ handId: `h${i}`, rules: HOLDEM, seats: seats(Array.from({ length: n }, () => 2000 + rng.int(8000))), button: rng.int(n) }, bot.decide, rng)
      expect(state.phase).toBe('COMPLETE')
    }
  })
})
