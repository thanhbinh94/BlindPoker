import type { LegalActions } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { resolvePreAction } from './preaction.js'

const legal = (kinds: LegalActions['kinds'], callAmount = 0): LegalActions => ({
  seat: 1, kinds, callAmount, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0,
})

describe('resolvePreAction', () => {
  it('check/fold checks when it is free and folds when it is not', () => {
    expect(resolvePreAction('checkFold', legal(['fold', 'check', 'bet', 'allIn']))).toEqual({ kind: 'check' })
    expect(resolvePreAction('checkFold', legal(['fold', 'call', 'raise', 'allIn'], 300))).toEqual({ kind: 'fold' })
  })

  it('call any calls a bet, checks when there is none, and lapses rather than going all-in', () => {
    expect(resolvePreAction('callAny', legal(['fold', 'call', 'raise', 'allIn'], 300))).toEqual({ kind: 'call' })
    expect(resolvePreAction('callAny', legal(['fold', 'check', 'bet', 'allIn']))).toEqual({ kind: 'check' })
    expect(resolvePreAction('callAny', legal(['fold', 'allIn'], 5000))).toBeNull()
  })

  it('fold folds into a bet but never throws away a free check', () => {
    expect(resolvePreAction('fold', legal(['fold', 'call', 'raise', 'allIn'], 300))).toEqual({ kind: 'fold' })
    expect(resolvePreAction('fold', legal(['fold', 'check', 'bet', 'allIn']))).toEqual({ kind: 'check' })
  })

  it('never sends a kind the server did not list', () => {
    expect(resolvePreAction('checkFold', legal(['play', 'fold']))).toEqual({ kind: 'fold' })
    expect(resolvePreAction('callAny', legal(['play', 'fold']))).toBeNull()
  })
})
