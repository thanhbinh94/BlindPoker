import { HandCategory } from '@bp/core'
import type { HandSummary, PublicRoomConfig } from '@bp/server-kit'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { NormalRepositories } from '../repos/index.js'
import { createRepositories } from '../repos/index.js'
import type { HistoryService } from './history-service.js'
import { createHistoryService } from './history-service.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let history: HistoryService

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
  history = createHistoryService({ db, repos })
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table game_players, games, players, users restart identity cascade`)
})

let seq = 0
async function seedPlayer(displayName?: string): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: displayName ?? name, nameKey: name, balance: 0 })
  return id
}

const CONFIG: PublicRoomConfig = { name: 'Bàn 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 30, autoStart: true }
const START = Date.parse('2026-10-04T10:00:00.000Z')
const MINUTE = 60_000

function summary(patch: Partial<HandSummary> & Pick<HandSummary, 'handId' | 'players'>): HandSummary {
  return { roomId: 'r1', mode: 'holdem', config: CONFIG, startedAt: START, endedAt: START + MINUTE, fee: 0, cancelled: false, ...patch }
}

describe('listForPlayer', () => {
  it('returns the reading player’s own result alongside every other seat, named', async () => {
    const me = await seedPlayer('Bình')
    const rival = await seedPlayer('Lan')
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        fee: 120,
        players: [
          { playerId: me, seat: 0, isBot: false, net: 5_880, won: true, bestCategory: HandCategory.FULL_HOUSE },
          { playerId: rival, seat: 1, isBot: false, net: -4_000, won: false, bestCategory: HandCategory.FLUSH },
          { playerId: 'bot-7', seat: 2, isBot: true, net: -2_000, won: false, bestCategory: null },
        ],
      }),
    )

    const [entry] = await history.listForPlayer(me)
    expect(entry).toEqual({
      handId: 'h1',
      roomId: 'r1',
      mode: 'holdem',
      startedAt: START,
      endedAt: START + MINUTE,
      net: 5_880,
      won: true,
      bestCategory: HandCategory.FULL_HOUSE,
      cancelled: false,
      players: [
        // A human seat carries both: the id the reader filters on, and the name the reader reads.
        { playerId: me, label: 'Bình', seat: 0, isBot: false, net: 5_880, won: true },
        { playerId: rival, label: 'Lan', seat: 1, isBot: false, net: -4_000, won: false },
        // A bot has no account, so no id — and its label stays the engine-side one it was recorded under.
        { playerId: null, label: 'bot-7', seat: 2, isBot: true, net: -2_000, won: false },
      ],
    })
  })

  it('falls back to the recorded id when the account behind a seat is gone', async () => {
    const me = await seedPlayer('Bình')
    const quitter = await seedPlayer('Lan')
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        players: [
          { playerId: me, seat: 0, isBot: false, net: 100, won: true, bestCategory: null },
          { playerId: quitter, seat: 1, isBot: false, net: -100, won: false, bestCategory: null },
        ],
      }),
    )
    // `game_players.player_id` is `ON DELETE SET NULL`: the hand survives the account, and so must the seat.
    await db.delete(users).where(eq(users.id, quitter))

    const [entry] = await history.listForPlayer(me)
    expect(entry!.players[1]).toEqual({ playerId: null, label: quitter, seat: 1, isBot: false, net: -100, won: false })
  })

  it('reads the same hand from the other seat’s point of view', async () => {
    const me = await seedPlayer()
    const rival = await seedPlayer()
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        players: [
          { playerId: me, seat: 0, isBot: false, net: 100, won: true, bestCategory: HandCategory.PAIR },
          { playerId: rival, seat: 1, isBot: false, net: -100, won: false, bestCategory: null },
        ],
      }),
    )

    expect(await history.listForPlayer(rival)).toMatchObject([{ net: -100, won: false, bestCategory: null }])
  })

  it('lists the newest hand first and honours the limit', async () => {
    const me = await seedPlayer()
    for (let i = 0; i < 5; i += 1) {
      await repos.history.recordHand(
        summary({
          handId: `h${i}`,
          startedAt: START + i * MINUTE,
          endedAt: START + i * MINUTE + 1_000,
          players: [{ playerId: me, seat: 0, isBot: false, net: i, won: false, bestCategory: null }],
        }),
      )
    }

    expect((await history.listForPlayer(me)).map((h) => h.handId)).toEqual(['h4', 'h3', 'h2', 'h1', 'h0'])
    expect((await history.listForPlayer(me, 2)).map((h) => h.handId)).toEqual(['h4', 'h3'])
    // A page size that is not a usable number falls back to the default rather than reaching `LIMIT`.
    expect(await history.listForPlayer(me, Number.NaN)).toHaveLength(5)
    expect(await history.listForPlayer(me, 10_000)).toHaveLength(5)
  })

  it('shows an abandoned hand as abandoned rather than hiding it or calling it a loss', async () => {
    const me = await seedPlayer()
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        cancelled: true,
        settlementError: 'insufficient balance',
        players: [{ playerId: me, seat: 0, isBot: false, net: 0, won: false, bestCategory: null }],
      }),
    )

    expect(await history.listForPlayer(me)).toMatchObject([{ handId: 'h1', cancelled: true, net: 0 }])
  })

  it('answers with nothing for a player who has played nothing, or a malformed id', async () => {
    expect(await history.listForPlayer(await seedPlayer())).toEqual([])
    expect(await history.listForPlayer('not-a-uuid')).toEqual([])
  })
})
