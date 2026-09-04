import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InsufficientBalanceError, type HandSummary, type HandSummaryPlayer } from '@bp/server-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/sqlite.js'
import { NameTakenError, createSqliteRepositories, type LiteRepositories } from './sqlite-repos.js'

const dirs: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-lite-repos-'))
  dirs.push(dir)
  return join(dir, 'test.sqlite')
}

const open: LiteRepositories[] = []
function repos(opts: { handLog?: boolean; now?: () => number; path?: string } = {}): LiteRepositories {
  const r = createSqliteRepositories(openDatabase(opts.path ?? ':memory:'), { handLog: opts.handLog ?? false, now: opts.now })
  open.push(r)
  return r
}

afterEach(() => {
  for (const r of open.splice(0)) {
    try {
      r.close()
    } catch {
      /* already closed by the test */
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function handSummary(players: Pick<HandSummaryPlayer, 'playerId' | 'isBot' | 'net' | 'won'>[], over: Partial<HandSummary> = {}): HandSummary {
  return {
    handId: 'h1',
    roomId: 'r1',
    mode: 'blind',
    config: { name: 'Room', mode: 'blind', maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 20, autoStart: true },
    startedAt: 1000,
    endedAt: 2000,
    fee: 10,
    cancelled: false,
    players: players.map((p, i) => ({ seat: i, bestCategory: null, ...p })),
    ...over,
  }
}

describe('createPlayer / lookups', () => {
  it('creates a player with the starting balance and zeroed counters', () => {
    const r = repos({ now: () => 12345 })
    const rec = r.createPlayer('Alice', 'hash-a', 5000)
    expect(rec).toMatchObject({ displayName: 'Alice', balance: 5000, handsPlayed: 0, handsWon: 0, streak: 0, lastDailyClaim: null, lastReliefAt: null, createdAt: 12345 })
    expect(rec.playerId).toMatch(/\S/)
    expect(r.getLitePlayer(rec.playerId)).toEqual(rec)
  })

  it('rejects a duplicate display name case-insensitively with NameTakenError', () => {
    const r = repos()
    r.createPlayer('Alice', 'hash-a', 5000)
    expect(() => r.createPlayer('ALICE', 'hash-b', 5000)).toThrow(NameTakenError)
    expect(() => r.createPlayer('aLiCe', 'hash-c', 5000)).toThrow(NameTakenError)
    // The failed inserts left nothing behind.
    expect((r.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n).toBe(1)
  })

  it('finds by token hash and by name (case-insensitively), and returns null for misses', () => {
    const r = repos()
    const alice = r.createPlayer('Alice', 'hash-a', 5000)
    expect(r.findByTokenHash('hash-a')).toEqual(alice)
    expect(r.findByTokenHash('nope')).toBeNull()
    expect(r.findByName('alice')).toEqual(alice)
    expect(r.findByName('ALICE')).toEqual(alice)
    expect(r.findByName('Bob')).toBeNull()
    expect(r.getLitePlayer('missing')).toBeNull()
  })

  it('exposes the player through PlayerRepository.findById', async () => {
    const r = repos()
    const alice = r.createPlayer('Alice', 'hash-a', 5000)
    await expect(r.players.findById(alice.playerId)).resolves.toEqual({ playerId: alice.playerId, displayName: 'Alice', balance: 5000 })
    await expect(r.players.findById('missing')).resolves.toBeNull()
  })
})

describe('balances.apply', () => {
  it('applies a multi-player batch and reports balances through get()', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    const b = r.createPlayer('Bob', 'hb', 1000).playerId
    await r.balances.apply([
      { playerId: a, delta: -300, reason: 'settlement' },
      { playerId: b, delta: 290, reason: 'settlement' },
    ])
    await expect(r.balances.get(a)).resolves.toBe(700)
    await expect(r.balances.get(b)).resolves.toBe(1290)
  })

  it('nets deltas per player before the negativity check', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100).playerId
    await r.balances.apply([
      { playerId: a, delta: -300, reason: 'buy_in' },
      { playerId: a, delta: 250, reason: 'cash_out' },
    ])
    await expect(r.balances.get(a)).resolves.toBe(50)
  })

  it('rolls the whole batch back when any player would go negative', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    const b = r.createPlayer('Bob', 'hb', 100).playerId
    await expect(
      r.balances.apply(
        [
          { playerId: a, delta: -50, reason: 'settlement' },
          { playerId: b, delta: -200, reason: 'settlement' },
        ],
        { kind: 'table_fee', refId: 'h1', fee: 10 },
      ),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
    await expect(r.balances.get(a)).resolves.toBe(1000)
    await expect(r.balances.get(b)).resolves.toBe(100)
    expect(r.sinks()).toEqual([])

    // The rollback left no transaction open: the next batch still commits.
    await r.balances.apply([{ playerId: b, delta: -50, reason: 'settlement' }], { kind: 'table_fee', refId: 'h2', fee: 5 })
    await expect(r.balances.get(b)).resolves.toBe(50)
    expect(r.sinks()).toHaveLength(1)
  })

  it('names the offending player on InsufficientBalanceError', async () => {
    const r = repos()
    const b = r.createPlayer('Bob', 'hb', 100).playerId
    await expect(r.balances.apply([{ playerId: b, delta: -200, reason: 'settlement' }])).rejects.toMatchObject({ name: 'InsufficientBalanceError', playerId: b })
  })

  it('rejects an unknown player and writes nothing', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    await expect(
      r.balances.apply([
        { playerId: a, delta: -50, reason: 'settlement' },
        { playerId: 'ghost', delta: 50, reason: 'settlement' },
      ]),
    ).rejects.toThrow(/ghost/)
    await expect(r.balances.get(a)).resolves.toBe(1000)
    expect(r.sinks()).toEqual([])
  })

  it('throws for an unknown player on get()', async () => {
    const r = repos()
    await expect(r.balances.get('ghost')).rejects.toThrow(/ghost/)
  })

  it('writes a sink row when meta.fee > 0 and none when it is 0', async () => {
    const r = repos({ now: () => 777 })
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    await r.balances.apply([{ playerId: a, delta: -110, reason: 'settlement' }], { kind: 'table_fee', refId: 'hand-1', fee: 10 })
    expect(r.sinks()).toEqual([{ id: 1, kind: 'table_fee', refId: 'hand-1', amount: 10, createdAt: 777 }])

    await r.balances.apply([{ playerId: a, delta: -100, reason: 'settlement' }], { kind: 'table_fee', refId: 'hand-2', fee: 0 })
    expect(r.sinks()).toHaveLength(1)
    await expect(r.balances.get(a)).resolves.toBe(790)
  })

  it('records a carry_over sink for an empty batch (the Hold’em fee path)', async () => {
    const r = repos({ now: () => 42 })
    await r.balances.apply([], { kind: 'carry_over', refId: 'room-9', fee: 25 })
    expect(r.sinks()).toEqual([{ id: 1, kind: 'carry_over', refId: 'room-9', amount: 25, createdAt: 42 }])
  })

  it('is a no-op for an empty batch with no meta', async () => {
    const r = repos()
    await r.balances.apply([])
    expect(r.sinks()).toEqual([])
  })

  it('allows a batch that takes a balance exactly to zero', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100).playerId
    await r.balances.apply([{ playerId: a, delta: -100, reason: 'buy_in' }])
    await expect(r.balances.get(a)).resolves.toBe(0)
  })
})

describe('history.recordHand', () => {
  it('bumps hands_played/hands_won for humans only and skips bots', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    const b = r.createPlayer('Bob', 'hb', 1000).playerId
    const bot = r.createPlayer('Botty', 'hbot', 1000).playerId
    await r.history.recordHand(
      handSummary([
        { playerId: a, isBot: false, net: 200, won: true },
        { playerId: b, isBot: false, net: -100, won: false },
        { playerId: bot, isBot: true, net: -100, won: false },
      ]),
    )
    expect(r.getLitePlayer(a)).toMatchObject({ handsPlayed: 1, handsWon: 1 })
    expect(r.getLitePlayer(b)).toMatchObject({ handsPlayed: 1, handsWon: 0 })
    expect(r.getLitePlayer(bot)).toMatchObject({ handsPlayed: 0, handsWon: 0 })
  })

  it('accumulates counters across hands', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    await r.history.recordHand(handSummary([{ playerId: a, isBot: false, net: 50, won: true }], { handId: 'h1' }))
    await r.history.recordHand(handSummary([{ playerId: a, isBot: false, net: -50, won: false }], { handId: 'h2' }))
    expect(r.getLitePlayer(a)).toMatchObject({ handsPlayed: 2, handsWon: 1 })
  })

  it('does not bump hands_played/hands_won for a cancelled hand, but still writes hand_log when enabled', async () => {
    const r = repos({ handLog: true })
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    await r.history.recordHand(handSummary([{ playerId: a, isBot: false, net: 0, won: false }], { cancelled: true }))
    expect(r.getLitePlayer(a)).toMatchObject({ handsPlayed: 0, handsWon: 0 })
    expect((r.db.prepare('SELECT COUNT(*) AS n FROM hand_log').get() as { n: number }).n).toBe(1)
  })

  it('does not write hand_log when handLog is disabled', async () => {
    const r = repos({ handLog: false })
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    await r.history.recordHand(handSummary([{ playerId: a, isBot: false, net: 10, won: true }]))
    expect((r.db.prepare('SELECT COUNT(*) AS n FROM hand_log').get() as { n: number }).n).toBe(0)
  })

  it('writes a hand_log row with the serialized summary when handLog is enabled', async () => {
    const r = repos({ handLog: true, now: () => 999 })
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    const summary = handSummary([{ playerId: a, isBot: false, net: 10, won: true }], { cancelled: true, fee: 7 })
    await r.history.recordHand(summary)
    const row = r.db.prepare('SELECT hand_id, room_id, mode, fee, cancelled, summary, created_at FROM hand_log').get() as Record<string, unknown>
    expect(row).toMatchObject({ hand_id: 'h1', room_id: 'r1', mode: 'blind', fee: 7, cancelled: 1, created_at: 999 })
    expect(JSON.parse(String(row.summary))).toEqual(summary)
  })

  it('tolerates a summary naming a player that is not in the database', async () => {
    const r = repos()
    await expect(r.history.recordHand(handSummary([{ playerId: 'ghost', isBot: false, net: 1, won: true }]))).resolves.toBeUndefined()
  })
})

describe('updateDaily / updateRelief', () => {
  it('persists the daily streak and claim day', () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    r.updateDaily(a, { streak: 3, lastDailyClaim: '2026-09-04' })
    expect(r.getLitePlayer(a)).toMatchObject({ streak: 3, lastDailyClaim: '2026-09-04' })
    r.updateDaily(a, { streak: 4, lastDailyClaim: '2026-09-05' })
    expect(r.getLitePlayer(a)).toMatchObject({ streak: 4, lastDailyClaim: '2026-09-05' })
  })

  it('persists the relief timestamp', () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 1000).playerId
    expect(r.getLitePlayer(a)?.lastReliefAt).toBeNull()
    r.updateRelief(a, 1_700_000_000_000)
    expect(r.getLitePlayer(a)?.lastReliefAt).toBe(1_700_000_000_000)
  })
})

describe('persistence across close/reopen', () => {
  it('keeps balances, counters, streaks and sinks on a file database', async () => {
    const path = tempDbPath()
    const first = repos({ path, handLog: true, now: () => 5 })
    const a = first.createPlayer('Alice', 'ha', 1000).playerId
    await first.balances.apply([{ playerId: a, delta: -110, reason: 'settlement' }], { kind: 'table_fee', refId: 'h1', fee: 10 })
    await first.history.recordHand(handSummary([{ playerId: a, isBot: false, net: -110, won: false }]))
    first.updateDaily(a, { streak: 2, lastDailyClaim: '2026-09-04' })
    first.updateRelief(a, 1234)
    first.close()

    const second = repos({ path, handLog: true })
    expect(second.getLitePlayer(a)).toMatchObject({ displayName: 'Alice', balance: 890, handsPlayed: 1, handsWon: 0, streak: 2, lastDailyClaim: '2026-09-04', lastReliefAt: 1234 })
    expect(second.sinks()).toEqual([{ id: 1, kind: 'table_fee', refId: 'h1', amount: 10, createdAt: 5 }])
    expect((second.db.prepare('SELECT COUNT(*) AS n FROM hand_log').get() as { n: number }).n).toBe(1)
    expect(second.findByName('alice')?.playerId).toBe(a)
  })
})
