import { HandCategory } from '@bp/core'
import type { HandSummary, HandSummaryPlayer, PublicRoomConfig } from '@bp/server-kit'
import { silentLogger } from '@bp/server-kit'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { players, playerStats, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AppEvent, AppEventBus } from '../events.js'
import { createEventBus } from '../events.js'
import { zeroStats } from './player-stats.js'
import type { StatsService } from './stats-service.js'
import { createStatsService } from './stats-service.js'

let test: TestDb
let db: AppDb
let bus: AppEventBus
let stats: StatsService
let stop: () => void
let updates: Extract<AppEvent, { type: 'STATS_UPDATED' }>[] = []

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  bus = createEventBus(silentLogger)
  stats = createStatsService({ db, bus })
  stop = stats.start()
  bus.subscribe((e) => {
    if (e.type === 'STATS_UPDATED') updates.push(e)
  })
})
afterAll(async () => {
  stop()
  await test.close()
})
beforeEach(() => {
  updates = []
})
afterEach(async () => {
  await db.execute(sql`truncate table player_stats, players, users restart identity cascade`)
})

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 0 })
  await db.insert(playerStats).values({ playerId: id })
  return id
}

const CONFIG: PublicRoomConfig = { name: 'Bàn 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 30, autoStart: true }
const START = Date.parse('2026-10-04T10:00:00.000Z')

let handSeq = 0
function hand(patch: Partial<HandSummary> & Pick<HandSummary, 'players'>): HandSummary {
  handSeq += 1
  return {
    handId: `h${handSeq}`,
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

function seat(playerId: string, patch: Partial<HandSummaryPlayer> = {}): HandSummaryPlayer {
  return { playerId, seat: 0, isBot: false, net: 0, won: false, bestCategory: null, ...patch }
}

const settle = (summary: HandSummary): Promise<void> => bus.publish({ type: 'HAND_SETTLED', summary })

describe('HAND_SETTLED', () => {
  it('counts a won hold’em hand: mode counters, the game, the streak, the pot and the showdown', async () => {
    const winner = await seedPlayer()
    const loser = await seedPlayer()

    await settle(hand({ players: [seat(winner, { net: 4_200, won: true, bestCategory: HandCategory.FLUSH }), seat(loser, { seat: 1, net: -4_200 })] }))

    expect(await stats.get(winner)).toMatchObject({
      handsPlayedHoldem: 1,
      handsWonHoldem: 1,
      gamesCompleted: 1,
      currentWinStreak: 1,
      bestWinStreak: 1,
      currentLoseStreak: 0,
      biggestWin: 4_200,
      bestHandRank: HandCategory.FLUSH,
      botHands: 0,
    })
    expect(await stats.get(loser)).toMatchObject({
      handsPlayedHoldem: 1,
      handsWonHoldem: 0,
      gamesCompleted: 1,
      currentLoseStreak: 1,
      bestLoseStreak: 1,
      currentWinStreak: 0,
      biggestWin: 0,
      bestHandRank: 0,
    })
  })

  it('counts blind hands against the blind columns', async () => {
    const playerId = await seedPlayer()
    await settle(hand({ mode: 'blind', players: [seat(playerId, { net: 1_000, won: true })] }))

    expect(await stats.get(playerId)).toMatchObject({ handsPlayedBlind: 1, handsWonBlind: 1, handsPlayedHoldem: 0, gamesCompleted: 1 })
  })

  describe('a Poker hỗn loạn hand', () => {
    const CHAOS: PublicRoomConfig = { ...CONFIG, mode: 'blind', blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0, chaosCycle: 5 } }
    const PLAIN: PublicRoomConfig = { ...CHAOS, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0 } }

    it('is played and completed but never won: no win count, record or streak moves', async () => {
      const winner = await seedPlayer()
      const loser = await seedPlayer()
      const bot = { playerId: 'bot:r:0', seat: 2, isBot: true, net: 0, won: false, bestCategory: null }
      // The winner has a run going and the loser a loss run: a chaos hand neither extends nor breaks them.
      await settle(hand({ mode: 'blind', config: PLAIN, players: [seat(winner, { net: 100, won: true }), seat(loser, { seat: 1, net: -100 })] }))
      await settle(hand({ mode: 'blind', config: CHAOS, players: [seat(winner, { net: 9_000, won: true, bestCategory: HandCategory.FLUSH }), seat(loser, { seat: 1, net: -9_000 }), bot] }))

      expect(await stats.get(winner)).toMatchObject({
        handsPlayedBlind: 2, handsWonBlind: 1, gamesCompleted: 2, botHands: 1,
        currentWinStreak: 1, bestWinStreak: 1, currentLoseStreak: 0, biggestWin: 100, bestHandRank: 0,
      })
      expect(await stats.get(loser)).toMatchObject({
        handsPlayedBlind: 2, handsWonBlind: 0, gamesCompleted: 2, botHands: 1,
        currentLoseStreak: 1, bestLoseStreak: 1, currentWinStreak: 0, biggestWin: 0,
      })
    })

    it('leaves a lone chaos win with every win figure at zero, and a chaos loss out of the loss streaks', async () => {
      const a = await seedPlayer()
      const b = await seedPlayer()
      await settle(hand({ mode: 'blind', config: CHAOS, players: [seat(a, { net: 5_000, won: true, bestCategory: HandCategory.FLUSH }), seat(b, { seat: 1, net: -5_000 })] }))
      expect(await stats.get(a)).toEqual({ ...zeroStats(), handsPlayedBlind: 1, gamesCompleted: 1 })
      expect(await stats.get(b)).toEqual({ ...zeroStats(), handsPlayedBlind: 1, gamesCompleted: 1 })
    })

    // BP-41 (spec 2026-10-28 §4.4): the three title counters are the exception to Q13 — counted from a chaos hand.
    it('counts the title marks — an ascension, a Bán Thần, and every win over a human Thần — and nothing else of the win', async () => {
      const god = await seedPlayer()
      const half = await seedPlayer()
      const slayer = await seedPlayer()
      await settle(hand({
        mode: 'blind',
        config: CHAOS,
        players: [
          seat(god, { net: -1_000, chaosTitles: { ascended: true } }),
          seat(half, { seat: 1, net: -1_000, chaosTitles: { demigod: true } }),
          seat(slayer, { seat: 2, net: 2_000, won: true, bestCategory: HandCategory.FLUSH, chaosTitles: { slew: 1 } }),
        ],
      }))
      expect(await stats.get(god)).toEqual({ ...zeroStats(), handsPlayedBlind: 1, gamesCompleted: 1, chaosAscensions: 1 })
      expect(await stats.get(half)).toEqual({ ...zeroStats(), handsPlayedBlind: 1, gamesCompleted: 1, chaosDemigods: 1 })
      expect(await stats.get(slayer)).toEqual({ ...zeroStats(), handsPlayedBlind: 1, gamesCompleted: 1, chaosGodsSlain: 1 })
      expect(updates.find((u) => u.playerId === slayer)!.changedMetrics).toContain('chaosGodsSlain')
      expect(updates.find((u) => u.playerId === god)!.changedMetrics).toContain('chaosAscensions')
      expect(updates.find((u) => u.playerId === god)!.changedMetrics).not.toContain('chaosGodsSlain')

      // The slain count adds up across hands (and a row may carry more than one), and a second reign counts again.
      await settle(hand({ mode: 'blind', config: CHAOS, players: [seat(slayer, { net: 500, won: true, chaosTitles: { slew: 2 } }), seat(god, { seat: 1, chaosTitles: { ascended: true, demigod: true } })] }))
      expect(await stats.get(slayer)).toMatchObject({ chaosGodsSlain: 3, handsWonBlind: 0 })
      expect(await stats.get(god)).toMatchObject({ chaosAscensions: 2, chaosDemigods: 1 })
    })

    it('loses the title marks of a hand whose settlement failed, and of a cancelled hand (Ruling 7)', async () => {
      const god = await seedPlayer()
      await settle(hand({ mode: 'blind', config: CHAOS, settlementError: 'DatabaseFaultError: settlement failed', players: [seat(god, { chaosTitles: { ascended: true, slew: 1 } })] }))
      await settle(hand({ mode: 'blind', config: CHAOS, cancelled: true, players: [seat(god, { chaosTitles: { demigod: true } })] }))
      expect(await stats.get(god)).toEqual(zeroStats())
      expect(updates).toEqual([])
    })

    it('a row with no marks or a slew of 0 writes no title column', async () => {
      const a = await seedPlayer()
      await settle(hand({ mode: 'blind', config: CHAOS, players: [seat(a, { chaosTitles: { slew: 0 } })] }))
      expect(updates[0]!.changedMetrics.some((m) => m.startsWith('chaos'))).toBe(false)
    })
  })

  it('ignores a cancelled hand entirely', async () => {
    const playerId = await seedPlayer()
    await settle(hand({ cancelled: true, players: [seat(playerId, { net: 500, won: true })] }))

    expect(await stats.get(playerId)).toEqual(zeroStats())
    expect(updates).toEqual([])
  })

  /**
   * A hand nobody was paid for is not a hand played.
   *
   * When `balances.apply` throws — a pool exhausted, a statement timeout, the database briefly gone
   * — the room flags the summary and emits `HAND_SETTLED` anyway with `cancelled: false`, so the
   * hand is recorded for an operator to reconcile. Counting it would move `hands_won_*`,
   * `biggest_win` and the streaks for a hand in which no point moved, and the achievement module
   * evaluating those counters could then pay a real, ledgered credit (`big_win_500k` is 30,000
   * points) for a win the ledger says never happened.
   */
  it('ignores a hand whose settlement failed, so no achievement can be bought by a failed write', async () => {
    const playerId = await seedPlayer()
    const before = await stats.get(playerId)

    await settle(hand({ settlementError: 'DatabaseFaultError: settlement failed (sqlstate 40P01)', players: [seat(playerId, { net: 500_000, won: true })] }))

    expect(await stats.get(playerId)).toEqual(before)
    expect(await stats.get(playerId)).toEqual(zeroStats())
    // Nothing announced either: the achievement module is never given a threshold to compare.
    expect(updates).toEqual([])
  })

  it('counts the hand for the humans and nothing for the bots, but marks it as played against one', async () => {
    const playerId = await seedPlayer()
    await settle(hand({ players: [seat(playerId, { net: -100 }), seat('bot-1', { seat: 1, isBot: true, net: 100, won: true })] }))

    expect(await stats.get(playerId)).toMatchObject({ handsPlayedHoldem: 1, botHands: 1 })
    // Two bots at one table is still one hand played against bots.
    await settle(hand({ players: [seat(playerId, { net: 0 }), seat('bot-1', { seat: 1, isBot: true }), seat('bot-2', { seat: 2, isBot: true })] }))
    expect(await stats.get(playerId)).toMatchObject({ handsPlayedHoldem: 2, botHands: 2 })
    // And no counters were invented for the bots themselves.
    expect(await db.select().from(playerStats)).toHaveLength(1)
  })

  it('tracks win and lose streaks as high-water marks that reset on the other outcome', async () => {
    const playerId = await seedPlayer()
    const outcomes = [true, true, true, false, false, true, true]
    for (const won of outcomes) await settle(hand({ players: [seat(playerId, { won, net: won ? 100 : -100 })] }))

    expect(await stats.get(playerId)).toMatchObject({
      currentWinStreak: 2,
      bestWinStreak: 3,
      currentLoseStreak: 0,
      bestLoseStreak: 2,
      handsWonHoldem: 5,
      handsPlayedHoldem: 7,
    })
  })

  it('keeps the biggest single-hand win and the best category ever *won* with', async () => {
    const playerId = await seedPlayer()
    await settle(hand({ players: [seat(playerId, { net: 9_000, won: true, bestCategory: HandCategory.TWO_PAIR })] }))
    // A losing royal flush is not a record: the hand was beaten, or folded into.
    await settle(hand({ players: [seat(playerId, { net: -50_000, won: false, bestCategory: HandCategory.ROYAL_FLUSH })] }))
    await settle(hand({ players: [seat(playerId, { net: 1_000, won: true, bestCategory: HandCategory.PAIR })] }))

    expect(await stats.get(playerId)).toMatchObject({ biggestWin: 9_000, bestHandRank: HandCategory.TWO_PAIR })
  })

  it('announces what it wrote, once per human seat', async () => {
    const a = await seedPlayer()
    const b = await seedPlayer()
    await settle(hand({ players: [seat(a, { won: true, net: 10 }), seat(b, { seat: 1, net: -10 }), seat('bot-1', { seat: 2, isBot: true })] }))

    expect(updates.map((u) => u.playerId)).toEqual([a, b])
    expect(updates[0]!.changedMetrics).toEqual(expect.arrayContaining(['handsPlayedHoldem', 'handsWonHoldem', 'gamesCompleted', 'bestWinStreak', 'botHands']))
    expect(updates[1]!.changedMetrics).not.toContain('handsWonHoldem')
  })

  it('says nothing for a player whose account is gone', async () => {
    await settle(hand({ players: [seat('00000000-0000-4000-8000-000000000000', { won: true })] }))
    expect(updates).toEqual([])
  })
})

describe('the other events', () => {
  it('counts rooms joined', async () => {
    const playerId = await seedPlayer()
    await bus.publish({ type: 'ROOM_JOINED', roomId: 'r1', playerId })
    await bus.publish({ type: 'ROOM_JOINED', roomId: 'r2', playerId })

    expect(await stats.get(playerId)).toMatchObject({ roomsJoined: 2 })
    expect(updates.at(-1)!.changedMetrics).toEqual(['roomsJoined'])
  })

  it('counts login days from the check-in, taking the consecutive run the economy service decided', async () => {
    const playerId = await seedPlayer()
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 1, streak: 1, consecutive: 1 })
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 2, streak: 2, consecutive: 2 })
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 3, streak: 3, consecutive: 3 })
    // A missed day: the month's count goes on, the current run drops, the best one does not.
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 4, streak: 4, consecutive: 1 })

    expect(await stats.get(playerId)).toMatchObject({ totalLoginDays: 4, loginStreak: 1, bestLoginStreak: 3 })
  })

  it("login streak follows consecutive days, not the month's count", async () => {
    const playerId = await seedPlayer()
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 9, streak: 9, consecutive: 1 })

    expect(await stats.get(playerId)).toMatchObject({ totalLoginDays: 1, loginStreak: 1, bestLoginStreak: 1 })
  })

  it('leaves the counters alone for an event it does not handle', async () => {
    const playerId = await seedPlayer()
    await bus.publish({ type: 'ROOM_CREATED', roomId: 'r1', hostPlayerId: playerId, config: CONFIG })

    expect(await stats.get(playerId)).toEqual(zeroStats())
    expect(updates).toEqual([])
  })
})

describe('get', () => {
  it('answers zeroes for a player with no row, and for a malformed id', async () => {
    expect(await stats.get('00000000-0000-4000-8000-000000000000')).toEqual(zeroStats())
    expect(await stats.get('not-a-uuid')).toEqual(zeroStats())
  })
})
