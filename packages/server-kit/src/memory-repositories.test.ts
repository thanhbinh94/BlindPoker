import { describe, expect, it } from 'vitest'
import { createMemoryRepositories } from './memory-repositories.js'
import { InsufficientBalanceError } from './repositories.js'

describe('memory repositories', () => {
  it('stores players and balances', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 1000)
    expect(await repos.players.findById('p1')).toEqual({ playerId: 'p1', displayName: 'Ann', balance: 1000 })
    expect(await repos.players.findById('nope')).toBeNull()
    expect(await repos.balances.get('p1')).toBe(1000)
  })
  it('applies entries atomically and records them', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 1000)
    repos.addPlayer('p2', 'Bob', 500)
    await repos.balances.apply([{ playerId: 'p1', delta: -300, reason: 'settlement', refId: 'h1' }, { playerId: 'p2', delta: 280, reason: 'settlement', refId: 'h1' }], { refId: 'h1', fee: 20, kind: 'table_fee' })
    expect(await repos.balances.get('p1')).toBe(700)
    expect(await repos.balances.get('p2')).toBe(780)
    expect(repos.entries).toHaveLength(2)
    expect(repos.entries[0]!.meta).toEqual({ refId: 'h1', fee: 20, kind: 'table_fee' })
    expect(repos.sinks).toEqual([{ refId: 'h1', fee: 20, kind: 'table_fee' }]) // 300 left p1, 280 reached p2: the 20 is a sink
  })
  it('rejects the whole batch when any balance would go negative', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 100)
    repos.addPlayer('p2', 'Bob', 100)
    await expect(repos.balances.apply([{ playerId: 'p1', delta: 50, reason: 'refund' }, { playerId: 'p2', delta: -150, reason: 'buy_in' }])).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get('p1')).toBe(100)
    expect(await repos.balances.get('p2')).toBe(100)
    expect(repos.sinks).toEqual([])
  })

  it('nets a player’s deltas before the negativity check', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 100)
    // -150 then +200: the intermediate is negative, the net (+50) is not — the batch must commit.
    await repos.balances.apply([{ playerId: 'p1', delta: -150, reason: 'buy_in' }, { playerId: 'p1', delta: 200, reason: 'refund' }])
    expect(await repos.balances.get('p1')).toBe(150)
    await expect(repos.balances.apply([{ playerId: 'p1', delta: -100, reason: 'buy_in' }, { playerId: 'p1', delta: -100, reason: 'buy_in' }])).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get('p1')).toBe(150)
  })

  it('records a sink row only when the meta carries a fee', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 100)
    await repos.balances.apply([{ playerId: 'p1', delta: 10, reason: 'refund' }], { refId: 'r1', fee: 0, kind: 'carry_over' })
    expect(repos.sinks).toEqual([])
    await repos.balances.apply([], { refId: 'r1', fee: 7, kind: 'carry_over' })
    expect(repos.sinks).toEqual([{ refId: 'r1', fee: 7, kind: 'carry_over' }])
  })
  it('rejects unknown players and records hands', async () => {
    const repos = createMemoryRepositories()
    await expect(repos.balances.get('ghost')).rejects.toThrow(/unknown player/)
    await repos.history.recordHand({ handId: 'h', roomId: 'r', mode: 'blind', config: { name: 'x', mode: 'blind', maxPlayers: 2, isPrivate: false, turnTimerSec: 15, autoStart: false, hasPassword: false }, startedAt: 1, endedAt: 2, fee: 0, cancelled: false, players: [] })
    expect(repos.hands).toHaveLength(1)
  })
})
