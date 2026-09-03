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
    await repos.balances.apply([{ playerId: 'p1', delta: -300, reason: 'settlement', refId: 'h1' }, { playerId: 'p2', delta: 280, reason: 'settlement', refId: 'h1' }], { refId: 'h1', fee: 20 })
    expect(await repos.balances.get('p1')).toBe(700)
    expect(await repos.balances.get('p2')).toBe(780)
    expect(repos.entries).toHaveLength(2)
    expect(repos.entries[0]!.meta).toEqual({ refId: 'h1', fee: 20 })
  })
  it('rejects the whole batch when any balance would go negative', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 100)
    repos.addPlayer('p2', 'Bob', 100)
    await expect(repos.balances.apply([{ playerId: 'p1', delta: 50, reason: 'refund' }, { playerId: 'p2', delta: -150, reason: 'buy_in' }])).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get('p1')).toBe(100)
    expect(await repos.balances.get('p2')).toBe(100)
  })
  it('rejects unknown players and records hands', async () => {
    const repos = createMemoryRepositories()
    await expect(repos.balances.get('ghost')).rejects.toThrow(/unknown player/)
    await repos.history.recordHand({ handId: 'h', roomId: 'r', mode: 'blind', config: { name: 'x', mode: 'blind', maxPlayers: 2, isPrivate: false, turnTimerSec: 15, autoStart: false }, startedAt: 1, endedAt: 2, fee: 0, cancelled: false, players: [] })
    expect(repos.hands).toHaveLength(1)
  })
})
