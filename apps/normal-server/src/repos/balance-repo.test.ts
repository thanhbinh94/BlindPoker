import { InsufficientBalanceError, type ApplyResult } from '@bp/server-kit'
import { asc, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { ledgerKeys, players, pointTransactions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { NormalRepositories } from './index.js'
import { createRepositories, pruneLedgerKeys, UnknownPlayerError } from './index.js'

/** One PGlite per file: the first boot costs seconds, every table reset after it costs milliseconds. */
let test: TestDb
let db: AppDb
let repos: NormalRepositories

let seq = 0

/** The account + profile pair every balance hangs off; there is no auth service to make one yet. */
async function seedPlayer(balance: number): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance })
  return id
}

/** `restart identity` so the ledger's `id` cursor is predictable from one test to the next. */
async function reset(): Promise<void> {
  await db.execute(sql`truncate table game_players, games, point_transactions, ledger_keys, players, users restart identity cascade`)
}

/** Every ledger row in insertion order, snake-cased so the assertions read like the table. */
async function ledgerRows(): Promise<{ player_id: string | null; amount: number; reason: string; ref_id: string | null; kind: string | null }[]> {
  const rows = await db
    .select({
      player_id: pointTransactions.playerId,
      amount: pointTransactions.amount,
      reason: pointTransactions.reason,
      ref_id: pointTransactions.refId,
      kind: pointTransactions.kind,
    })
    .from(pointTransactions)
    .orderBy(asc(pointTransactions.id))
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

async function settled<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await p }
  } catch (reason) {
    return { status: 'rejected', reason }
  }
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(reset)

describe('balances.apply', () => {
  it('nets a player’s deltas before judging solvency', async () => {
    const id = await seedPlayer(100)
    // −300 then +250 is never solvent read one entry at a time, but the batch's net effect is −50.
    await repos.balances.apply([
      { playerId: id, delta: -300, reason: 'settlement', refId: 'h1' },
      { playerId: id, delta: 250, reason: 'settlement', refId: 'h1' },
    ])
    expect(await repos.balances.get(id)).toBe(50)
    const rows = await ledgerRows()
    expect(rows.map((r) => r.amount)).toEqual([-300, 250])
    expect(rows.every((r) => r.player_id === id && r.reason === 'settlement' && r.ref_id === 'h1' && r.kind === null)).toBe(true)
  })

  it('is all-or-nothing: one insolvent player rolls the whole batch back, ledger included', async () => {
    const solvent = await seedPlayer(100)
    const broke = await seedPlayer(100)
    await expect(
      repos.balances.apply([
        { playerId: solvent, delta: -50, reason: 'settlement', refId: 'h2' },
        { playerId: broke, delta: -150, reason: 'settlement', refId: 'h2' },
      ]),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get(solvent)).toBe(100)
    expect(await repos.balances.get(broke)).toBe(100)
    expect(await ledgerRows()).toEqual([])
  })

  it('names the insolvent player on the error', async () => {
    const id = await seedPlayer(10)
    const err = await repos.balances.apply([{ playerId: id, delta: -11, reason: 'buy_in', refId: 'r' }]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InsufficientBalanceError)
    expect((err as InsufficientBalanceError).playerId).toBe(id)
  })

  it('writes the sink row of a table fee: positive amount, kind in both reason and kind', async () => {
    const id = await seedPlayer(100)
    await repos.balances.apply([{ playerId: id, delta: -20, reason: 'settlement', refId: 'hand-9' }], { refId: 'hand-9', fee: 5, kind: 'table_fee' })
    expect(await repos.balances.get(id)).toBe(80)
    expect(await ledgerRows()).toEqual([
      { player_id: id, amount: -20, reason: 'settlement', ref_id: 'hand-9', kind: null },
      { player_id: null, amount: 5, reason: 'table_fee', ref_id: 'hand-9', kind: 'table_fee' },
    ])
  })

  it('writes only the sink row for an empty batch with a fee', async () => {
    // How a carry-over pot nobody could receive reaches the ledger: no player moved, points left.
    await repos.balances.apply([], { refId: 'room-1', fee: 40, kind: 'carry_over' })
    expect(await ledgerRows()).toEqual([{ player_id: null, amount: 40, reason: 'carry_over', ref_id: 'room-1', kind: 'carry_over' }])
  })

  it('writes nothing at all for an empty batch with no fee', async () => {
    await repos.balances.apply([])
    await repos.balances.apply([], { refId: 'room-1', fee: 0, kind: 'table_fee' })
    expect(await ledgerRows()).toEqual([])
  })

  it('records an entry whose delta is zero', async () => {
    const id = await seedPlayer(100)
    await repos.balances.apply([{ playerId: id, delta: 0, reason: 'settlement', refId: 'h3' }])
    expect(await repos.balances.get(id)).toBe(100)
    expect(await ledgerRows()).toEqual([{ player_id: id, amount: 0, reason: 'settlement', ref_id: 'h3', kind: null }])
  })

  it('round-trips values above 2^31 as numbers', async () => {
    // `balance`, `amount` and `fee` are `bigint mode: 'number'`, and `pg` hands `int8` back as a
    // string. Every other value in this file would fit in an `int4`, so this is the test that would
    // notice the mapping being lost — a string, or a silently truncated number.
    const id = await seedPlayer(5_000_000_000)
    await repos.balances.apply([{ playerId: id, delta: -3_000_000_000, reason: 'settlement', refId: 'big' }], { refId: 'big', fee: 4_000_000_000, kind: 'table_fee' })

    const balance = await repos.balances.get(id)
    expect(balance).toBe(2_000_000_000)
    expect(typeof balance).toBe('number')
    const [row] = await repos.ledger.list(id)
    expect(row!.amount).toBe(-3_000_000_000)
    expect(await repos.ledger.sums(0)).toEqual([
      { reason: 'settlement', total: -3_000_000_000 },
      { reason: 'table_fee', total: 4_000_000_000 },
    ])
  })

  it('sumsByDay buckets by the economy day: 23:30 and 00:30 Ho Chi Minh land on different days', async () => {
    // 16:30Z is 23:30 on the 4th in Ho Chi Minh (UTC+7), 17:30Z is 00:30 on the 5th: one hour apart, two days.
    const id = await seedPlayer(0)
    await db.insert(pointTransactions).values([
      { playerId: id, amount: 100, reason: 'daily_reward', refId: 'a', createdAt: new Date('2026-09-04T16:30:00Z') },
      { playerId: id, amount: 40, reason: 'daily_reward', refId: 'b', createdAt: new Date('2026-09-04T17:30:00Z') },
      { playerId: id, amount: 2, reason: 'daily_reward', refId: 'c', createdAt: new Date('2026-09-04T17:45:00Z') },
      { playerId: null, amount: 7, reason: 'table_fee', kind: 'table_fee', refId: 'd', createdAt: new Date('2026-09-04T17:50:00Z') },
      { playerId: id, amount: 999, reason: 'daily_reward', refId: 'old', createdAt: new Date('2026-09-01T00:00:00Z') },
    ])
    const since = Date.parse('2026-09-04T00:00:00Z')
    const rows = await repos.ledger.sumsByDay(since, 'Asia/Ho_Chi_Minh')
    expect(rows).toEqual([
      { day: '2026-09-04', reason: 'daily_reward', playerless: false, total: 100 },
      { day: '2026-09-05', reason: 'daily_reward', playerless: false, total: 42 },
      { day: '2026-09-05', reason: 'table_fee', playerless: true, total: 7 },
    ])
    expect(typeof rows[0]!.total).toBe('number')
    // The zone is what moves the line: by UTC's clock the same four rows are all one day.
    expect(await repos.ledger.sumsByDay(since, 'UTC')).toEqual([
      { day: '2026-09-04', reason: 'daily_reward', playerless: false, total: 142 },
      { day: '2026-09-04', reason: 'table_fee', playerless: true, total: 7 },
    ])
  })

  it('throws UnknownPlayerError rather than silently skipping an id that is not there', async () => {
    const known = await seedPlayer(100)
    const missing = '00000000-0000-4000-8000-000000000000'
    const err = await repos.balances
      .apply([
        { playerId: known, delta: 10, reason: 'daily_reward', refId: 'd' },
        { playerId: missing, delta: 10, reason: 'daily_reward', refId: 'd' },
      ])
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnknownPlayerError)
    expect((err as UnknownPlayerError).playerId).toBe(missing)
    expect(await repos.balances.get(known)).toBe(100)
    expect(await ledgerRows()).toEqual([])
  })

  it('rejects an id that is not even a uuid as an unknown player', async () => {
    await expect(repos.balances.apply([{ playerId: 'bot-3', delta: -1, reason: 'settlement' }])).rejects.toBeInstanceOf(UnknownPlayerError)
    await expect(repos.balances.get('bot-3')).rejects.toBeInstanceOf(UnknownPlayerError)
  })

  it('serialises two applies racing for the same balance', async () => {
    const id = await seedPlayer(100)
    const attempt = (): Promise<ApplyResult> => repos.balances.apply([{ playerId: id, delta: -60, reason: 'buy_in', refId: 'room' }])
    // PGlite is a single in-process connection, so a real `FOR UPDATE` race can only be observed
    // against a server: `TEST_DATABASE_URL` runs the two overlapping, everywhere else back to back.
    // Either way exactly one of the two may succeed — that is what the lock is for.
    const results = process.env.TEST_DATABASE_URL
      ? await Promise.allSettled([attempt(), attempt()])
      : [await settled(attempt()), await settled(attempt())]

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get(id)).toBe(40)
    expect(await ledgerRows()).toHaveLength(1)
  })
})

/**
 * A `db` whose first transaction commits and *then* throws — a connection dropped after `COMMIT`, before
 * the acknowledgement came back. Everything else goes straight to the real handle.
 */
function ackLostOnce(real: AppDb): AppDb {
  let once = true
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'transaction') {
        return async (...args: Parameters<AppDb['transaction']>) => {
          const result = await target.transaction(...args)
          if (once) {
            once = false
            throw new Error('connection lost after COMMIT')
          }
          return result
        }
      }
      const value: unknown = Reflect.get(target, prop)
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

async function keyRows(): Promise<string[]> {
  return (await db.select({ key: ledgerKeys.key }).from(ledgerKeys).orderBy(asc(ledgerKeys.key))).map((r) => r.key)
}

describe('balances.apply with a key', () => {
  it('moves the balance once for the same key, and says the replay was not applied', async () => {
    const id = await seedPlayer(1000)
    const batch = [{ playerId: id, delta: 400, reason: 'cash_out' as const, refId: 'room-1' }]
    expect(await repos.balances.apply(batch, undefined, { key: 'cash_out:room-1:s1' })).toEqual({ applied: true })
    expect(await repos.balances.apply(batch, undefined, { key: 'cash_out:room-1:s1' })).toEqual({ applied: false })
    expect(await repos.balances.get(id)).toBe(1400)
    expect(await ledgerRows()).toEqual([{ player_id: id, amount: 400, reason: 'cash_out', ref_id: 'room-1', kind: null }])
    expect(await keyRows()).toEqual(['cash_out:room-1:s1'])
  })

  it('writes no sink row on a replay of a keyed carry-over release', async () => {
    const id = await seedPlayer(0)
    const meta = { refId: 'room-1', fee: 3, kind: 'carry_over' as const }
    await repos.balances.apply([{ playerId: id, delta: 10, reason: 'refund', refId: 'room-1' }], meta, { key: 'carry_over:room-1:x' })
    expect(await repos.balances.apply([{ playerId: id, delta: 10, reason: 'refund', refId: 'room-1' }], meta, { key: 'carry_over:room-1:x' })).toEqual({ applied: false })
    expect((await ledgerRows()).map((r) => [r.player_id, r.amount])).toEqual([[id, 10], [null, 3]])
  })

  it('skips the balance check on a replay: a committed buy-in retried with the balance now short is not refused', async () => {
    const id = await seedPlayer(5000)
    const buyIn = [{ playerId: id, delta: -5000, reason: 'buy_in' as const, refId: 'room-1' }]
    await repos.balances.apply(buyIn, undefined, { key: 'buy_in:room-1:s1' })
    expect(await repos.balances.apply(buyIn, undefined, { key: 'buy_in:room-1:s1' })).toEqual({ applied: false })
    expect(await repos.balances.get(id)).toBe(0)
  })

  it('leaves the key of a rejected batch unclaimed, so a later attempt can still apply', async () => {
    const id = await seedPlayer(100)
    const buyIn = [{ playerId: id, delta: -500, reason: 'buy_in' as const, refId: 'room-1' }]
    await expect(repos.balances.apply(buyIn, undefined, { key: 'buy_in:room-1:s1' })).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await keyRows()).toEqual([])
    await db.update(players).set({ balance: 1000 }).where(sql`${players.id} = ${id}`)
    expect(await repos.balances.apply(buyIn, undefined, { key: 'buy_in:room-1:s1' })).toEqual({ applied: true })
    expect(await repos.balances.get(id)).toBe(500)
  })

  it('applies a write that committed but reported an error only once when it is retried', async () => {
    const id = await seedPlayer(1000)
    const flaky = createRepositories(ackLostOnce(db))
    const cashOut = [{ playerId: id, delta: 4000, reason: 'cash_out' as const, refId: 'room-1' }]
    await expect(flaky.balances.apply(cashOut, undefined, { key: 'cash_out:room-1:s1' })).rejects.toThrow('connection lost after COMMIT')
    expect(await flaky.balances.apply(cashOut, undefined, { key: 'cash_out:room-1:s1' })).toEqual({ applied: false })
    expect(await repos.balances.get(id)).toBe(5000)
    expect(await ledgerRows()).toHaveLength(1)
  })

  it('applies two same-key calls racing each other exactly once', async () => {
    const id = await seedPlayer(100)
    const attempt = (): Promise<ApplyResult> => repos.balances.apply([{ playerId: id, delta: 50, reason: 'cash_out', refId: 'room-1' }], undefined, { key: 'cash_out:room-1:s1' })
    // Only a real server (`TEST_DATABASE_URL`) runs these two transactions truly overlapping: the second insert of
    // the key then waits on the first's uncommitted row and, once it commits, finds the key taken. PGlite serialises
    // transactions on its one connection, so here this proves the outcome, not the race.
    const results = await Promise.all([attempt(), attempt()])
    expect(results.map((r) => r.applied).sort()).toEqual([false, true])
    expect(await repos.balances.get(id)).toBe(150)
    expect(await ledgerRows()).toHaveLength(1)
  })

  it('behaves exactly as before without a key: every call applies, and no key is stored', async () => {
    const id = await seedPlayer(0)
    expect(await repos.balances.apply([{ playerId: id, delta: 5, reason: 'refund', refId: 'r' }])).toEqual({ applied: true })
    expect(await repos.balances.apply([{ playerId: id, delta: 5, reason: 'refund', refId: 'r' }])).toEqual({ applied: true })
    expect(await repos.balances.get(id)).toBe(10)
    expect(await keyRows()).toEqual([])
  })
})

describe('pruneLedgerKeys', () => {
  it('empties ledger_keys and says how many keys went, touching no balance or ledger row', async () => {
    const id = await seedPlayer(1000)
    await repos.balances.apply([{ playerId: id, delta: -400, reason: 'buy_in', refId: 'room-1' }], undefined, { key: 'buy_in:room-1:s1' })
    await repos.balances.apply([{ playerId: id, delta: 400, reason: 'cash_out', refId: 'room-1' }], undefined, { key: 'cash_out:room-1:s1' })
    expect(await keyRows()).toHaveLength(2)
    expect(await pruneLedgerKeys(db)).toBe(2)
    expect(await keyRows()).toEqual([])
    expect(await repos.balances.get(id)).toBe(1000)
    expect(await ledgerRows()).toHaveLength(2)
    expect(await pruneLedgerKeys(db)).toBe(0) // nothing left: a second boot finds an empty table
  })
})

describe('balances.creditWithin', () => {
  it('commits with the caller’s transaction', async () => {
    const id = await seedPlayer(100)
    const at = new Date('2026-01-02T03:04:05.000Z')
    await db.transaction(async (tx) => {
      await repos.balances.creditWithin(tx, [{ playerId: id, delta: 250, reason: 'relief', refId: 'relief-1' }])
      await tx.update(players).set({ lastReliefAt: at }).where(sql`${players.id} = ${id}`)
    })
    expect(await repos.balances.get(id)).toBe(350)
    expect((await repos.players.findByIdFull(id))?.lastReliefAt).toEqual(at)
    expect(await ledgerRows()).toHaveLength(1)
  })

  it('rolls back with the caller’s transaction', async () => {
    const id = await seedPlayer(100)
    await expect(
      db.transaction(async (tx) => {
        await repos.balances.creditWithin(tx, [{ playerId: id, delta: 500, reason: 'daily_reward', refId: 'day' }])
        throw new Error('the caller’s other half failed')
      }),
    ).rejects.toThrow('the caller’s other half failed')
    expect(await repos.balances.get(id)).toBe(100)
    expect(await ledgerRows()).toEqual([])
  })
})

describe('ledger', () => {
  it('lists a player’s rows newest first and pages on the id cursor', async () => {
    const id = await seedPlayer(1000)
    const other = await seedPlayer(1000)
    for (let i = 1; i <= 5; i += 1) await repos.balances.apply([{ playerId: id, delta: i, reason: 'settlement', refId: `h${i}` }])
    await repos.balances.apply([{ playerId: other, delta: 99, reason: 'settlement', refId: 'other' }])

    const first = await repos.ledger.list(id, { limit: 2 })
    expect(first.map((r) => r.refId)).toEqual(['h5', 'h4'])
    const second = await repos.ledger.list(id, { limit: 2, before: first[1]!.id })
    expect(second.map((r) => r.refId)).toEqual(['h3', 'h2'])
    const third = await repos.ledger.list(id, { limit: 2, before: second[1]!.id })
    expect(third.map((r) => r.refId)).toEqual(['h1'])
    // Another player's rows are never in the page, and neither are sinks (they have no player).
    expect((await repos.ledger.list(id)).every((r) => r.playerId === id)).toBe(true)
  })

  it('returns nothing for a player with no history', async () => {
    expect(await repos.ledger.list('00000000-0000-4000-8000-000000000000')).toEqual([])
    expect(await repos.ledger.list('not-a-uuid')).toEqual([])
  })

  it('falls back to the default page rather than sending a non-finite limit or cursor to the driver', async () => {
    // `Number('abc')` is what the query-string layer above produces on a malformed page parameter;
    // `limit NaN` reaches Postgres as `invalid input syntax for type bigint` — a 500, not a page.
    const id = await seedPlayer(1000)
    for (let i = 1; i <= 3; i += 1) await repos.balances.apply([{ playerId: id, delta: i, reason: 'settlement', refId: `h${i}` }])

    expect((await repos.ledger.list(id, { limit: Number.NaN })).map((r) => r.refId)).toEqual(['h3', 'h2', 'h1'])
    expect((await repos.ledger.list(id, { limit: Number.POSITIVE_INFINITY })).map((r) => r.refId)).toEqual(['h3', 'h2', 'h1'])
    expect((await repos.ledger.list(id, { limit: 2, before: Number.NaN })).map((r) => r.refId)).toEqual(['h3', 'h2'])
    expect((await repos.ledger.list(id, { limit: 2, before: Number.POSITIVE_INFINITY })).map((r) => r.refId)).toEqual(['h3', 'h2'])
    // A fraction is not a `LIMIT` either, and 0 or a negative asks for a page nobody can use.
    expect(await repos.ledger.list(id, { limit: 1.9 })).toHaveLength(1)
    expect(await repos.ledger.list(id, { limit: 0 })).toHaveLength(1)
    expect(await repos.ledger.list(id, { limit: -5 })).toHaveLength(1)
  })

  it('sums by reason over a window, sinks included', async () => {
    const id = await seedPlayer(1000)
    await repos.balances.apply([{ playerId: id, delta: -100, reason: 'settlement', refId: 'h1' }], { refId: 'h1', fee: 10, kind: 'table_fee' })
    await repos.balances.apply([{ playerId: id, delta: 40, reason: 'settlement', refId: 'h2' }])
    await repos.balances.apply([{ playerId: id, delta: 500, reason: 'daily_reward', refId: 'day-1' }])

    expect(await repos.ledger.sums(0)).toEqual([
      { reason: 'daily_reward', total: 500 },
      { reason: 'settlement', total: -60 },
      { reason: 'table_fee', total: 10 },
    ])
  })

  it('excludes rows written before the window', async () => {
    const id = await seedPlayer(1000)
    await repos.balances.apply([{ playerId: id, delta: 10, reason: 'settlement', refId: 'h1' }])
    expect(await repos.ledger.sums(Date.now() + 60_000)).toEqual([])
  })
})
