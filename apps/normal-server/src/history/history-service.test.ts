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
import { botLabel, createHistoryService } from './history-service.js'

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

describe('botLabel', () => {
  it('turns the engine id of a bot into the name the room gave it: the index, counted from one', () => {
    expect(botLabel('bot:c30c3565-99ac-4163-bbce-f4be343fad3b:0')).toBe('Bot 1')
    expect(botLabel('bot:c30c3565-99ac-4163-bbce-f4be343fad3b:4')).toBe('Bot 5')
    expect(botLabel('bot:r1:11')).toBe('Bot 12')
    // A room id is whatever the room was created under; only the trailing index matters.
    expect(botLabel('bot:room:with:colons:2')).toBe('Bot 3')
  })

  it('returns anything else untouched', () => {
    for (const label of ['bot-7', 'Bot 2', 'bot:r1', 'bot:r1:', 'bot:r1:x', 'bot::3', 'xbot:r1:3', 'bot:r1:3 ', '', 'Lan']) {
      expect(botLabel(label)).toBe(label)
    }
  })
})

describe('listForPlayer', () => {
  it('carries the cards a chaos hand used, and has no such field on any other hand', async () => {
    const me = await seedPlayer('Bình')
    const used = [{ seat: 0, cardId: 's_shield', outcome: 'blocked' }]
    const seat = [{ playerId: me, seat: 0, isBot: false, net: 0, won: false, bestCategory: null }]
    await repos.history.recordHand(summary({ handId: 'c1', mode: 'blind', chaosUsed: used, players: seat }))
    await repos.history.recordHand(summary({ handId: 'p1', startedAt: START - MINUTE, endedAt: START, players: seat }))

    const [chaos, plain] = await history.listForPlayer(me)
    expect(chaos?.chaosUsed).toEqual(used)
    expect(plain).toBeDefined()
    expect('chaosUsed' in plain!).toBe(false)
  })

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
      // The name the table had when the hand was dealt, read from the stored config.
      roomName: 'Bàn 1',
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

  it('reads a bot seat as "Bot n" — the in-room name — instead of the engine id it was recorded under (No4)', async () => {
    const me = await seedPlayer('Bình')
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        players: [
          { playerId: me, seat: 0, isBot: false, net: 4_000, won: true, bestCategory: null },
          // The engine's own ids: `bot:<roomId>:<i>`, with `i` counted from zero.
          { playerId: 'bot:c30c3565-99ac-4163-bbce-f4be343fad3b:4', seat: 1, isBot: true, net: -2_000, won: false, bestCategory: null },
          { playerId: 'bot:c30c3565-99ac-4163-bbce-f4be343fad3b:0', seat: 2, isBot: true, net: -2_000, won: false, bestCategory: null },
        ],
      }),
    )

    const [entry] = await history.listForPlayer(me)
    expect(entry!.players.map((p) => p.label)).toEqual(['Bình', 'Bot 5', 'Bot 1'])
    // Only the text changes: a bot still has no account, and is still marked as one.
    expect(entry!.players[1]).toEqual({ playerId: null, label: 'Bot 5', seat: 1, isBot: true, net: -2_000, won: false })
  })

  it('leaves a bot label it cannot parse as it was recorded, and never renames a human seat', async () => {
    const me = await seedPlayer('Bình')
    // A display name that happens to look like an engine id: the mapping is for bots, whatever a human calls themselves.
    const lookalike = await seedPlayer('bot:r1:3')
    await repos.history.recordHand(
      summary({
        handId: 'h1',
        players: [
          { playerId: me, seat: 0, isBot: false, net: 100, won: true, bestCategory: null },
          { playerId: lookalike, seat: 1, isBot: false, net: -50, won: false, bestCategory: null },
          { playerId: 'bot-7', seat: 2, isBot: true, net: -50, won: false, bestCategory: null },
        ],
      }),
    )

    const [entry] = await history.listForPlayer(me)
    expect(entry!.players.map((p) => p.label)).toEqual(['Bình', 'bot:r1:3', 'bot-7'])
  })

  it('carries the room name from the stored config, and null when the hand was stored without one', async () => {
    const me = await seedPlayer('Bình')
    const seats = [{ playerId: me, seat: 0, isBot: false, net: 0, won: false, bestCategory: null }]
    await repos.history.recordHand(summary({ handId: 'h-named', startedAt: START + 4 * MINUTE, endedAt: START + 4 * MINUTE + 1_000, players: seats }))
    // Rows written before the name was kept, or with a config that is not the shape we write today.
    await repos.history.recordHand(summary({ handId: 'h-bare', startedAt: START + 3 * MINUTE, endedAt: START + 3 * MINUTE + 1_000, config: {} as PublicRoomConfig, players: seats }))
    await repos.history.recordHand(summary({ handId: 'h-blank', startedAt: START + 2 * MINUTE, endedAt: START + 2 * MINUTE + 1_000, config: { ...CONFIG, name: '' }, players: seats }))
    await repos.history.recordHand(
      summary({ handId: 'h-odd', startedAt: START + MINUTE, endedAt: START + MINUTE + 1_000, config: { ...CONFIG, name: 7 } as unknown as PublicRoomConfig, players: seats }),
    )

    const hands = await history.listForPlayer(me)
    expect(hands.map((h) => [h.handId, h.roomName])).toEqual([
      ['h-named', 'Bàn 1'],
      ['h-bare', null],
      ['h-blank', null],
      ['h-odd', null],
    ])
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
