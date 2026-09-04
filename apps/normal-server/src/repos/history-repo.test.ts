import { HandCategory } from '@bp/core'
import type { HandSummary, PublicRoomConfig } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { gamePlayers, games, players, playerStats, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { NormalRepositories } from './index.js'
import { createRepositories } from './index.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories

let seq = 0

async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 0 })
  return id
}

async function reset(): Promise<void> {
  await db.execute(sql`truncate table game_players, games, point_transactions, players, users restart identity cascade`)
}

const CONFIG: PublicRoomConfig = {
  name: 'Bàn 1',
  mode: 'holdem',
  maxPlayers: 6,
  isPrivate: true,
  hasPassword: true,
  turnTimerSec: 20,
  autoStart: true,
}

const START = Date.parse('2026-02-01T10:00:00.000Z')

function summary(patch: Partial<HandSummary> & Pick<HandSummary, 'handId' | 'players'>): HandSummary {
  return {
    roomId: 'room-1',
    mode: 'holdem',
    config: CONFIG,
    startedAt: START,
    endedAt: START + 60_000,
    fee: 0,
    cancelled: false,
    ...patch,
  }
}

async function seatRows(): Promise<{ game_id: string; seat: number; player_id: string | null; label: string; is_bot: boolean; net: number; won: boolean; best_category: number | null }[]> {
  const rows = await db
    .select({
      game_id: gamePlayers.gameId,
      seat: gamePlayers.seat,
      player_id: gamePlayers.playerId,
      label: gamePlayers.label,
      is_bot: gamePlayers.isBot,
      net: gamePlayers.net,
      won: gamePlayers.won,
      best_category: gamePlayers.bestCategory,
    })
    .from(gamePlayers)
    .orderBy(asc(gamePlayers.gameId), asc(gamePlayers.seat))
  return rows.map((r) => ({ ...r, net: Number(r.net) }))
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

describe('history.recordHand', () => {
  it('stores the hand and every seat, bots with a null player but a label', async () => {
    const human = await seedPlayer()
    await repos.history.recordHand(
      summary({
        handId: 'hand-1',
        fee: 15,
        players: [
          { playerId: human, seat: 0, isBot: false, net: 120, won: true, bestCategory: HandCategory.FLUSH },
          { playerId: 'bot-7', seat: 2, isBot: true, net: -120, won: false, bestCategory: null },
        ],
      }),
    )

    const [game] = await db.select().from(games)
    expect(game).toMatchObject({ id: 'hand-1', roomId: 'room-1', mode: 'holdem', fee: 15, cancelled: false, settlementError: null })
    // The stored config is the public one — a flag where the password was.
    expect(game!.config).toEqual({ ...CONFIG })
    expect(game!.startedAt).toEqual(new Date(START))
    expect(game!.endedAt).toEqual(new Date(START + 60_000))

    expect(await seatRows()).toEqual([
      { game_id: 'hand-1', seat: 0, player_id: human, label: human, is_bot: false, net: 120, won: true, best_category: HandCategory.FLUSH },
      { game_id: 'hand-1', seat: 2, player_id: null, label: 'bot-7', is_bot: true, net: -120, won: false, best_category: null },
    ])
  })

  it('stores a cancelled hand, and the settlement error when there was one', async () => {
    const human = await seedPlayer()
    await repos.history.recordHand(
      summary({
        handId: 'hand-2',
        cancelled: true,
        settlementError: 'InsufficientBalanceError',
        players: [{ playerId: human, seat: 1, isBot: false, net: 0, won: false, bestCategory: null }],
      }),
    )
    const [game] = await db.select().from(games)
    expect(game).toMatchObject({ id: 'hand-2', cancelled: true, settlementError: 'InsufficientBalanceError' })
    expect(await seatRows()).toHaveLength(1)
  })

  it('stores a hand with no seats at all', async () => {
    await repos.history.recordHand(summary({ handId: 'hand-3', cancelled: true, players: [] }))
    expect(await db.select().from(games)).toHaveLength(1)
    expect(await seatRows()).toEqual([])
  })

  it('never touches player_stats — the stats module owns those counters', async () => {
    const human = await seedPlayer()
    await repos.history.recordHand(summary({ handId: 'hand-4', players: [{ playerId: human, seat: 0, isBot: false, net: 5, won: true, bestCategory: null }] }))
    expect(await db.select().from(playerStats)).toEqual([])
  })

  it('rolls the games row back when a seat fails to insert', async () => {
    // The other direction from the duplicate-hand test below: there the `games` insert is what
    // fails, so the seats never run. Here the game lands and the *seats* are refused — two seats
    // numbered 0 violate `primaryKey(game_id, seat)` — and a `games` row with no seats is a hand
    // nobody played, which is worse than no row at all.
    const human = await seedPlayer()
    await expect(
      repos.history.recordHand(
        summary({
          handId: 'hand-6',
          players: [
            { playerId: human, seat: 0, isBot: false, net: 10, won: true, bestCategory: null },
            { playerId: 'bot-1', seat: 0, isBot: true, net: -10, won: false, bestCategory: null },
          ],
        }),
      ),
    ).rejects.toThrow()
    expect(await db.select().from(games).where(eq(games.id, 'hand-6'))).toEqual([])
    expect(await seatRows()).toEqual([])
  })

  it('refuses to record the same hand twice, leaving the first recording intact', async () => {
    const human = await seedPlayer()
    const s = summary({ handId: 'hand-5', players: [{ playerId: human, seat: 0, isBot: false, net: 5, won: true, bestCategory: null }] })
    await repos.history.recordHand(s)
    await expect(repos.history.recordHand(s)).rejects.toThrow()
    expect(await seatRows()).toHaveLength(1)
  })
})

describe('history.listForPlayer', () => {
  it('lists the player’s own hands, newest first, honouring the limit', async () => {
    const human = await seedPlayer()
    const other = await seedPlayer()
    for (let i = 1; i <= 3; i += 1) {
      await repos.history.recordHand(
        summary({
          handId: `h${i}`,
          startedAt: START + i * 60_000,
          endedAt: START + i * 60_000 + 30_000,
          fee: i,
          players: [
            { playerId: human, seat: 0, isBot: false, net: i * 10, won: i === 3, bestCategory: HandCategory.PAIR },
            { playerId: 'bot-1', seat: 1, isBot: true, net: -i * 10, won: false, bestCategory: null },
          ],
        }),
      )
    }
    await repos.history.recordHand(summary({ handId: 'other', players: [{ playerId: other, seat: 0, isBot: false, net: 1, won: true, bestCategory: null }] }))

    const rows = await repos.history.listForPlayer(human, 2)
    expect(rows.map((r) => r.handId)).toEqual(['h3', 'h2'])
    expect(rows[0]).toMatchObject({ roomId: 'room-1', mode: 'holdem', fee: 3, cancelled: false, seat: 0, net: 30, won: true, bestCategory: HandCategory.PAIR })
    expect(rows[0]!.config).toEqual({ ...CONFIG })
    expect((await repos.history.listForPlayer(human, 10)).map((r) => r.handId)).toEqual(['h3', 'h2', 'h1'])
  })

  it('returns nothing for a player with no hands, or an id that is not a uuid', async () => {
    expect(await repos.history.listForPlayer('00000000-0000-4000-8000-000000000000', 10)).toEqual([])
    expect(await repos.history.listForPlayer('bot-1', 10)).toEqual([])
  })

  it('falls back to the default page rather than sending a non-finite limit to the driver', async () => {
    const human = await seedPlayer()
    for (let i = 1; i <= 3; i += 1) {
      await repos.history.recordHand(
        summary({ handId: `n${i}`, startedAt: START + i * 1000, players: [{ playerId: human, seat: 0, isBot: false, net: i, won: false, bestCategory: null }] }),
      )
    }
    expect(await repos.history.listForPlayer(human, Number.NaN)).toHaveLength(3)
    expect(await repos.history.listForPlayer(human, Number.POSITIVE_INFINITY)).toHaveLength(3)
    expect(await repos.history.listForPlayer(human, 0)).toHaveLength(1)
    expect(await repos.history.listForPlayer(human, 1.9)).toHaveLength(1)
  })

  it('round-trips a net above 2^31 as a number', async () => {
    const human = await seedPlayer()
    await repos.history.recordHand(
      summary({ handId: 'big', fee: 3_000_000_000, players: [{ playerId: human, seat: 0, isBot: false, net: 5_000_000_000, won: true, bestCategory: null }] }),
    )
    const [row] = await repos.history.listForPlayer(human, 10)
    expect(row!.net).toBe(5_000_000_000)
    expect(row!.fee).toBe(3_000_000_000)
    expect(typeof row!.net).toBe('number')
  })
})
