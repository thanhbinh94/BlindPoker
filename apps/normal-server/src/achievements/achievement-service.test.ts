import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HandCategory, type ServerMessage } from '@bp/core'
import type { HandSummary, HandSummaryPlayer, PublicRoomConfig } from '@bp/server-kit'
import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, playerAchievements, players, playerStats, pointTransactions, reputationEvents, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AppEventBus } from '../events.js'
import { createEventBus } from '../events.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import { createInventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { loadItemCatalog } from '../inventory/items.js'
import type { NormalRepositories } from '../repos/index.js'
import { createRepositories } from '../repos/index.js'
import { createReputationService, type ReputationService } from '../reputation/reputation-service.js'
import { createStatsService, type StatsService } from '../stats/stats-service.js'
import type { AchievementService } from './achievement-service.js'
import { createAchievementService, unlockWithin } from './achievement-service.js'
import type { AchievementDef } from './definitions.js'
import { loadAchievements } from './definitions.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let inv: InventoryService
let catalog: ItemCatalog
let bus: AppEventBus
let stats: StatsService
let reputation: ReputationService
let achievements: AchievementService
let defs: AchievementDef[]
let stops: (() => void)[] = []
let scratch: string

let notified: { playerId: string; msg: ServerMessage }[] = []
let balanceCalls: { playerId: string; balance: number }[] = []

const NOW = Date.UTC(2026, 9, 4, 12, 0)

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
  inv = createInventoryService(db)
  catalog = loadItemCatalog()
  await catalog.seed(db)
  defs = loadAchievements(catalog)
  scratch = mkdtempSync(join(tmpdir(), 'bp-ach-'))

  bus = createEventBus(silentLogger)
  stats = createStatsService({ db, bus })
  // Not started: only the unlocks' reputation is under test here, not the per-hand listener.
  reputation = createReputationService({ db, bus, notify: (playerId, msg) => notified.push({ playerId, msg }), log: silentLogger })
  achievements = createAchievementService({
    db,
    repos,
    inventory: inv,
    stats,
    bus,
    defs,
    log: silentLogger,
    reputation,
    notify: (playerId, msg) => notified.push({ playerId, msg }),
    onBalanceChanged: (playerId, balance) => balanceCalls.push({ playerId, balance }),
    now: () => NOW,
  })
  // The wiring order Task 6 uses: the counters must be written before the thresholds are compared.
  stops = [stats.start(), achievements.start()]
})
afterAll(async () => {
  for (const stop of stops) stop()
  await test.close()
  rmSync(scratch, { recursive: true, force: true })
})
beforeEach(() => {
  notified = []
  balanceCalls = []
})
afterEach(async () => {
  await db.execute(sql`truncate table player_achievements, inventory, player_stats, point_transactions, players, users restart identity cascade`)
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
function seat(playerId: string, patch: Partial<HandSummaryPlayer> = {}): HandSummaryPlayer {
  return { playerId, seat: 0, isBot: false, net: 0, won: false, bestCategory: null, ...patch }
}
function settle(seats: HandSummaryPlayer[], patch: Partial<HandSummary> = {}): Promise<void> {
  handSeq += 1
  return bus.publish({
    type: 'HAND_SETTLED',
    summary: { handId: `h${handSeq}`, roomId: 'r1', mode: 'holdem', config: CONFIG, startedAt: START, endedAt: START + 1_000, fee: 0, cancelled: false, players: seats, ...patch },
  })
}

async function ledger(playerId: string): Promise<{ amount: number; reason: string; refId: string | null }[]> {
  const rows = await db
    .select({ amount: pointTransactions.amount, reason: pointTransactions.reason, refId: pointTransactions.refId })
    .from(pointTransactions)
    .where(eq(pointTransactions.playerId, playerId))
    .orderBy(asc(pointTransactions.id))
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

const find = (playerId: string, id: string) => achievements.list(playerId).then((rows) => rows.find((r) => r.id === id))

describe('loadAchievements', () => {
  it('reads the shipped catalogue, whose every metric is a counter and every item reward a real item', () => {
    expect(defs.length).toBe(47)
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length)
    for (const id of [
      'login_days_7', 'login_streak_7', 'holdem_hands_10', 'win_streak_3', 'lose_streak_10', 'hand_royal',
      'big_win_100k', 'blind_hands_10', 'bot_hands_50', 'rooms_10', 'games_500', 'login_days_365', 'games_1000',
    ]) {
      expect(defs.find((d) => d.id === id), id).toBeDefined()
    }
    expect(defs.find((d) => d.id === 'hand_royal')).toMatchObject({ metric: 'bestHandRank', threshold: 9, reward: { itemId: 'aura_gold_cards01' } })
    expect(defs.find((d) => d.id === 'games_500')).toMatchObject({ metric: 'gamesCompleted', threshold: 500, reward: { itemId: 'badge_veteran' } })
    expect(defs.find((d) => d.id === 'login_days_365')).toMatchObject({ metric: 'totalLoginDays', threshold: 365, reward: { itemId: 'frame_founder' } })
    expect(defs.find((d) => d.id === 'games_1000')).toMatchObject({ metric: 'gamesCompleted', threshold: 1000, reward: { itemId: 'frame_veteran' } })
    // BP-33 (spec 2026-10-24 §3.3): five more, each giving one piece of the wardrobe batch on an existing counter.
    expect(defs.find((d) => d.id === 'bot_hands_200')).toMatchObject({ category: 'social', metric: 'botHands', threshold: 200, reward: { itemId: 'outfit_denim01' } })
    expect(defs.find((d) => d.id === 'holdem_hands_500')).toMatchObject({ category: 'holdem', metric: 'handsPlayedHoldem', threshold: 500, reward: { itemId: 'outfit_trench01' } })
    expect(defs.find((d) => d.id === 'blind_wins_250')).toMatchObject({ category: 'blind', metric: 'handsWonBlind', threshold: 250, reward: { itemId: 'outfit_brocade_red01' } })
    expect(defs.find((d) => d.id === 'big_win_250k')).toMatchObject({ category: 'holdem', metric: 'biggestWin', threshold: 250_000, reward: { itemId: 'head_fedora01' } })
    expect(defs.find((d) => d.id === 'login_days_60')).toMatchObject({ category: 'login', metric: 'totalLoginDays', threshold: 60, reward: { itemId: 'face_monocle_gold01' } })
    // BP-35 (spec 2026-10-25 §3.3): five more on existing counters, each between two milestones already there.
    expect(defs.find((d) => d.id === 'login_days_200')).toMatchObject({ category: 'login', metric: 'totalLoginDays', threshold: 200, reward: { itemId: 'outfit_santa01' } })
    expect(defs.find((d) => d.id === 'login_streak_14')).toMatchObject({ category: 'login', metric: 'bestLoginStreak', threshold: 14, reward: { itemId: 'head_reindeer01' } })
    expect(defs.find((d) => d.id === 'blind_hands_500')).toMatchObject({ category: 'blind', metric: 'handsPlayedBlind', threshold: 500, reward: { itemId: 'head_pumpkin01' } })
    expect(defs.find((d) => d.id === 'rooms_50')).toMatchObject({ category: 'social', metric: 'roomsJoined', threshold: 50, reward: { itemId: 'outfit_sailor01' } })
    expect(defs.find((d) => d.id === 'win_streak_7')).toMatchObject({ category: 'holdem', metric: 'bestWinStreak', threshold: 7, reward: { itemId: 'head_crab01' } })
    // BP-41 (spec 2026-10-28 §4.4): the three chaos titles, each points + a title item + its own reputation.
    expect(defs.filter((d) => d.category === 'chaos')).toEqual([
      { id: 'chaos_god', category: 'chaos', metric: 'chaosAscensions', threshold: 1, reward: { points: 300_000, itemId: 'title_god' }, reputation: 300 },
      { id: 'chaos_demigod', category: 'chaos', metric: 'chaosDemigods', threshold: 1, reward: { points: 150_000, itemId: 'title_demigod' }, reputation: 150 },
      { id: 'chaos_godslayer', category: 'chaos', metric: 'chaosGodsSlain', threshold: 2, reward: { points: 500_000, itemId: 'title_godslayer' }, reputation: 500 },
    ])
    // Every older achievement keeps paying its rule: none names a reputation of its own.
    expect(defs.filter((d) => d.reputation !== undefined).map((d) => d.id)).toEqual(['chaos_god', 'chaos_demigod', 'chaos_godslayer'])
  })

  it('maps §14.1’s special-hand thresholds onto the category ranks', () => {
    const rank = (id: string): number => defs.find((d) => d.id === id)!.threshold
    expect(rank('hand_flush')).toBe(HandCategory.FLUSH)
    expect(rank('hand_full_house')).toBe(HandCategory.FULL_HOUSE)
    expect(rank('hand_quads')).toBe(HandCategory.QUADS)
    expect(rank('hand_straight_flush')).toBe(HandCategory.STRAIGHT_FLUSH)
    expect(rank('hand_royal')).toBe(HandCategory.ROYAL_FLUSH)
  })

  let fixtureSeq = 0
  const fixture = (rows: unknown): string => {
    fixtureSeq += 1
    const path = join(scratch, `ach-${fixtureSeq}.json`)
    writeFileSync(path, JSON.stringify(rows), 'utf8')
    return path
  }
  const OK = { id: 'a1', category: 'login', metric: 'totalLoginDays', threshold: 7, reward: { points: 5_000 } }

  it('refuses a metric no counter exists for — the failure that would otherwise look like "nobody has earned it yet"', () => {
    expect(() => loadAchievements(catalog, fixture([{ ...OK, metric: 'handsPlayedOmaha' }]))).toThrow(/handsPlayedOmaha, which is not a player_stats metric/)
  })

  it('refuses a reward item that is not in the catalogue', () => {
    expect(() => loadAchievements(catalog, fixture([{ ...OK, reward: { itemId: 'hat_imaginary' } }]))).toThrow(/rewards hat_imaginary/)
  })

  it('refuses a duplicate id, an unknown category, a bad threshold and an empty reward', () => {
    expect(() => loadAchievements(catalog, fixture([OK, OK]))).toThrow(/duplicate achievement id a1/)
    expect(() => loadAchievements(catalog, fixture([{ ...OK, category: 'chess' }]))).toThrow(/unknown category chess/)
    expect(() => loadAchievements(catalog, fixture([{ ...OK, threshold: 0 }]))).toThrow(/no positive threshold/)
    expect(() => loadAchievements(catalog, fixture([{ ...OK, reward: {} }]))).toThrow(/grants neither points nor an item/)
    expect(() => loadAchievements(catalog, fixture({ defs: [OK] }))).toThrow(/not a JSON array/)
  })

  it('BP-41: takes the chaos category, a points-and-item reward and a positive whole reputation; refuses any other reputation', () => {
    const chaos = { ...OK, category: 'chaos', metric: 'chaosGodsSlain', threshold: 2, reward: { points: 500_000, itemId: 'title_godslayer' }, reputation: 500 }
    expect(loadAchievements(catalog, fixture([chaos]))).toEqual([chaos])
    // Left out, it is left out: the rule pays.
    expect(loadAchievements(catalog, fixture([OK]))[0]).not.toHaveProperty('reputation')
    for (const reputation of [0, -5, 1.5, '300', null]) {
      expect(() => loadAchievements(catalog, fixture([{ ...chaos, reputation }])), String(reputation)).toThrow(/reputation that is not a positive whole number/)
    }
  })
})

describe('unlocking', () => {
  it('unlocks holdem_hands_10 on the tenth settled hand and credits the reward once', async () => {
    const playerId = await seedPlayer()

    // Alternating, break-even hands: exactly one threshold is crossed by the tenth of them, so the
    // ledger below says what `holdem_hands_10` paid and nothing else.
    for (let i = 0; i < 9; i += 1) await settle([seat(playerId, { won: i % 2 === 0 })])
    expect(await find(playerId, 'holdem_hands_10')).toEqual({ id: 'holdem_hands_10', progress: 9, target: 10, unlockedAt: null })
    expect(await ledger(playerId)).toEqual([])

    await settle([seat(playerId, { won: true })])

    expect(await find(playerId, 'holdem_hands_10')).toEqual({ id: 'holdem_hands_10', progress: 10, target: 10, unlockedAt: NOW })
    expect(await ledger(playerId)).toEqual([{ amount: 2_000, reason: 'achievement', refId: `ach:${playerId}:holdem_hands_10` }])
    expect(await repos.balances.get(playerId)).toBe(2_000)
    expect(notified).toEqual([
      { playerId, msg: { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'holdem_hands_10', reward: { points: 2_000 } } } },
    ])
    expect(balanceCalls).toEqual([{ playerId, balance: 2_000 }])
  })

  it('does not pay twice when the same STATS_UPDATED is delivered again', async () => {
    const playerId = await seedPlayer()
    for (let i = 0; i < 10; i += 1) await settle([seat(playerId, { won: i % 2 === 0 })])
    const before = await ledger(playerId)
    expect(before).toHaveLength(1)
    notified = []
    balanceCalls = []

    // A replayed backlog, a redelivered event, a second subscriber calling in: the unlock is
    // guarded by `unlocked_at IS NULL`, so none of them can pay again.
    await bus.publish({ type: 'STATS_UPDATED', playerId, changedMetrics: ['handsPlayedHoldem'] })
    await bus.publish({ type: 'STATS_UPDATED', playerId, changedMetrics: ['handsPlayedHoldem'] })

    expect(await ledger(playerId)).toEqual(before)
    expect(await repos.balances.get(playerId)).toBe(2_000)
    expect(notified).toEqual([])
    expect(balanceCalls).toEqual([])
  })

  it('grants an item reward into the inventory, sourced to the achievement', async () => {
    const playerId = await seedPlayer()

    await settle([seat(playerId, { won: true, net: 100, bestCategory: HandCategory.ROYAL_FLUSH })])

    expect(await find(playerId, 'hand_royal')).toMatchObject({ progress: 9, unlockedAt: NOW })
    expect(await inv.list(playerId)).toEqual([{ itemId: 'aura_gold_cards01', source: 'achievement', acquiredAt: expect.any(Number) }])
    // A royal flush clears every lower special-hand tier on the way past, and those pay points —
    // but `hand_royal` itself rewards an item, so it writes no ledger row and announces no balance.
    expect((await ledger(playerId)).map((r) => r.refId)).toEqual([
      `ach:${playerId}:hand_flush`,
      `ach:${playerId}:hand_full_house`,
      `ach:${playerId}:hand_quads`,
      `ach:${playerId}:hand_straight_flush`,
    ])
    expect(balanceCalls).toHaveLength(4)
    expect(notified.at(-1)!.msg).toMatchObject({ kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'hand_royal', reward: { itemId: 'aura_gold_cards01' } } })
  })

  it('unlocks the lower tiers of the same metric alongside the one that was crossed', async () => {
    const playerId = await seedPlayer()
    await settle([seat(playerId, { won: true, net: 100, bestCategory: HandCategory.QUADS })])

    const unlocked = (await achievements.list(playerId)).filter((a) => a.unlockedAt !== null).map((a) => a.id)
    expect(unlocked).toEqual(['hand_flush', 'hand_full_house', 'hand_quads'])
    expect(await repos.balances.get(playerId)).toBe(3_000 + 5_000 + 20_000)
  })

  it('unlocks login_streak_7 from the consecutive run the check-in reported', async () => {
    const playerId = await seedPlayer()
    for (let streak = 1; streak <= 6; streak += 1) await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: streak, streak, consecutive: streak })
    expect(await find(playerId, 'login_streak_7')).toMatchObject({ progress: 6, unlockedAt: null })

    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 7, streak: 7, consecutive: 7 })

    expect(await find(playerId, 'login_streak_7')).toMatchObject({ progress: 7, unlockedAt: NOW })
    // Day 7 is also the seventh login day, so both of that event's achievements land together.
    expect(await find(playerId, 'login_days_7')).toMatchObject({ unlockedAt: NOW })
    expect(await repos.balances.get(playerId)).toBe(10_000)
  })

  it('does not unlock login_streak_7 on the month’s seventh claim when the consecutive run is 1 (Plan 27 Part G)', async () => {
    const playerId = await seedPlayer()
    // Seven claims this month with a gap before the last: the tier says 7, the run of days says 1.
    await bus.publish({ type: 'DAILY_CLAIMED', playerId, day: 7, streak: 7, consecutive: 1 })

    expect(await find(playerId, 'login_streak_7')).toMatchObject({ progress: 1, unlockedAt: null })
  })

  it('records progress for every definition the event touched, unlocked or not', async () => {
    const playerId = await seedPlayer()
    await settle([seat(playerId, { won: true, net: 250_000 })])

    const rows = await db.select().from(playerAchievements).where(eq(playerAchievements.playerId, playerId))
    const byId = new Map(rows.map((r) => [r.achievementId, r]))
    expect(byId.get('big_win_100k')).toMatchObject({ progress: 250_000, unlockedAt: new Date(NOW) })
    expect(byId.get('big_win_500k')).toMatchObject({ progress: 250_000, unlockedAt: null })
    expect(byId.get('holdem_hands_1000')).toMatchObject({ progress: 1, unlockedAt: null })
    // Nothing is written for a metric this hand could not have moved.
    expect(byId.has('rooms_10')).toBe(false)
  })
})

describe('unlockWithin', () => {
  it('unlockWithin pays once and reports already on the second call, even with no progress row', async () => {
    const playerId = await seedPlayer()
    const points = defs.find((d) => d.id === 'login_streak_7')!
    const item = defs.find((d) => d.id === 'login_days_100')!
    const at = new Date(NOW)
    const run = (def: AchievementDef) =>
      db.transaction((tx) => unlockWithin(tx, playerId, def, at, { inventory: inv, reason: 'gm_achievement', refId: `gm:${def.id}` }))

    // The seeded player has no `player_achievements` row at all: the guarded UPDATE alone would match nothing.
    expect(await db.select().from(playerAchievements).where(eq(playerAchievements.playerId, playerId))).toEqual([])
    expect((await run(points)).outcome).toBe('unlocked')
    expect((await run(points)).outcome).toBe('already')
    expect((await run(item)).outcome).toBe('unlocked')
    // Without a reputation service nothing is granted and nothing is reported.
    expect(await run(item)).toEqual({ outcome: 'already', rankUp: false, rank: 0 })

    expect(await ledger(playerId)).toEqual([{ amount: points.reward.points, reason: 'gm_achievement', refId: 'gm:login_streak_7' }])
    expect(await repos.balances.get(playerId)).toBe(points.reward.points)
    expect(await inv.list(playerId)).toEqual([{ itemId: item.reward.itemId, source: 'achievement', acquiredAt: expect.any(Number) }])
    expect(await find(playerId, 'login_streak_7')).toMatchObject({ unlockedAt: NOW })
    expect(await find(playerId, 'login_days_100')).toMatchObject({ unlockedAt: NOW })
  })
})

describe('reputation', () => {
  it('an unlock adds 500 reputation for an item reward', async () => {
    const playerId = await seedPlayer()
    await db.update(playerStats).set({ totalLoginDays: 100 }).where(eq(playerStats.playerId, playerId))

    await bus.publish({ type: 'STATS_UPDATED', playerId, changedMetrics: ['totalLoginDays'] })

    // login_days_7 (5,000 points → small), login_days_30 (20,000 → big), login_days_60 and login_days_100 (an item each
    // → item; BP-33 put the monocle at 60 days).
    const events = await db
      .select({ delta: reputationEvents.delta, reason: reputationEvents.reason, refId: reputationEvents.refId })
      .from(reputationEvents)
      .where(eq(reputationEvents.playerId, playerId))
    expect(events).toEqual([
      { delta: 50, reason: 'achievement', refId: `ach:${playerId}:login_days_7` },
      { delta: 150, reason: 'achievement', refId: `ach:${playerId}:login_days_30` },
      { delta: 500, reason: 'achievement', refId: `ach:${playerId}:login_days_60` },
      { delta: 500, reason: 'achievement', refId: `ach:${playerId}:login_days_100` },
    ])
    const [row] = await db.select({ reputation: players.reputation, rank: players.rank }).from(players).where(eq(players.id, playerId))
    expect(row).toEqual({ reputation: 1_200, rank: 3 })
    // Each rank reached is announced after its unlock committed, right after the unlock's own notice.
    expect(notified.map((n) => n.msg)).toEqual([
      { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_7', reward: { points: 5_000 } } },
      { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_30', reward: { points: 20_000 } } },
      { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank: 2 } },
      { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_60', reward: { itemId: 'face_monocle_gold01' } } },
      { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank: 3 } },
      { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_100', reward: { itemId: 'head_crown_gold01' } } },
    ])

    // Replayed: nothing unlocks, so nothing is added.
    await bus.publish({ type: 'STATS_UPDATED', playerId, changedMetrics: ['totalLoginDays'] })
    expect((await db.select().from(reputationEvents).where(eq(reputationEvents.playerId, playerId))).length).toBe(4)
  })
})

describe('BP-41: the chaos titles', () => {
  const CHAOS: PublicRoomConfig = { ...CONFIG, mode: 'blind', blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0, chaosCycle: 5 } }
  const settleChaos = (seats: HandSummaryPlayer[]): Promise<void> => settle(seats, { mode: 'blind', config: CHAOS })
  const repOf = (playerId: string) =>
    db.select({ delta: reputationEvents.delta, reason: reputationEvents.reason, refId: reputationEvents.refId }).from(reputationEvents).where(eq(reputationEvents.playerId, playerId))
  const standing = async (playerId: string) => (await db.select({ reputation: players.reputation, rank: players.rank }).from(players).where(eq(players.id, playerId)))[0]

  it('each title unlocks once from a chaos hand with its points, its title item and its own reputation', async () => {
    const god = await seedPlayer()
    const half = await seedPlayer()
    const slayer = await seedPlayer()

    await settleChaos([
      seat(god, { chaosTitles: { ascended: true } }),
      seat(half, { seat: 1, chaosTitles: { demigod: true } }),
      seat(slayer, { seat: 2, won: true, net: 2_000, chaosTitles: { slew: 1 } }),
    ])

    expect(await ledger(god)).toEqual([{ amount: 300_000, reason: 'achievement', refId: `ach:${god}:chaos_god` }])
    expect(await inv.list(god)).toEqual([{ itemId: 'title_god', source: 'achievement', acquiredAt: expect.any(Number) }])
    expect(await repOf(god)).toEqual([{ delta: 300, reason: 'achievement', refId: `ach:${god}:chaos_god` }])
    expect(await standing(god)).toEqual({ reputation: 300, rank: 2 })

    expect(await ledger(half)).toEqual([{ amount: 150_000, reason: 'achievement', refId: `ach:${half}:chaos_demigod` }])
    expect(await inv.list(half)).toEqual([{ itemId: 'title_demigod', source: 'achievement', acquiredAt: expect.any(Number) }])
    expect(await repOf(half)).toEqual([{ delta: 150, reason: 'achievement', refId: `ach:${half}:chaos_demigod` }])

    // One god slain of two: progress, nothing paid.
    expect(await find(slayer, 'chaos_godslayer')).toEqual({ id: 'chaos_godslayer', progress: 1, target: 2, unlockedAt: null })
    expect(await ledger(slayer)).toEqual([])
    expect(await repOf(slayer)).toEqual([])

    expect(notified.filter((n) => n.msg.t === 'NOTIFICATION' && n.msg.kind === 'ACHIEVEMENT_UNLOCKED').map((n) => [n.playerId, n.msg])).toEqual([
      [god, { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'chaos_god', reward: { points: 300_000, itemId: 'title_god' } } }],
      [half, { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'chaos_demigod', reward: { points: 150_000, itemId: 'title_demigod' } } }],
    ])
    expect(balanceCalls).toEqual([{ playerId: god, balance: 300_000 }, { playerId: half, balance: 150_000 }])

    // The second god slain unlocks Kẻ Sát Thần; a second ascension and a second Bán Thần pay nothing again.
    await settleChaos([
      seat(slayer, { won: true, net: 2_000, chaosTitles: { slew: 1 } }),
      seat(god, { seat: 1, chaosTitles: { ascended: true } }),
      seat(half, { seat: 2, chaosTitles: { demigod: true } }),
    ])
    expect(await ledger(slayer)).toEqual([{ amount: 500_000, reason: 'achievement', refId: `ach:${slayer}:chaos_godslayer` }])
    expect(await inv.list(slayer)).toEqual([{ itemId: 'title_godslayer', source: 'achievement', acquiredAt: expect.any(Number) }])
    expect(await repOf(slayer)).toEqual([{ delta: 500, reason: 'achievement', refId: `ach:${slayer}:chaos_godslayer` }])
    expect(await standing(slayer)).toEqual({ reputation: 500, rank: 3 })
    expect(await find(god, 'chaos_god')).toMatchObject({ progress: 2, unlockedAt: NOW })
    expect(await ledger(god)).toHaveLength(1)
    expect(await ledger(half)).toHaveLength(1)
    expect(await repOf(god)).toHaveLength(1)
    expect(await repOf(half)).toHaveLength(1)
  })

  it('a GM unlock pays the same override, under the same reputation ref as the earning', async () => {
    const playerId = await seedPlayer()
    const def = defs.find((d) => d.id === 'chaos_demigod')!
    const run = () =>
      db.transaction((tx) => unlockWithin(tx, playerId, def, new Date(NOW), { inventory: inv, reason: 'gm_achievement', refId: 'gm:7', reputation }))
    expect(await run()).toEqual({ outcome: 'unlocked', rankUp: true, rank: 2 })
    expect(await run()).toEqual({ outcome: 'already', rankUp: false, rank: 0 })
    expect(await ledger(playerId)).toEqual([{ amount: 150_000, reason: 'gm_achievement', refId: 'gm:7' }])
    expect(await repOf(playerId)).toEqual([{ delta: 150, reason: 'achievement', refId: `ach:${playerId}:chaos_demigod` }])
  })
})

describe('list', () => {
  it('returns every definition, at zero, for a player who has done nothing', async () => {
    const playerId = await seedPlayer()
    const rows = await achievements.list(playerId)

    expect(rows).toHaveLength(defs.length)
    expect(rows.every((r) => r.progress === 0 && r.unlockedAt === null)).toBe(true)
    expect(rows.map((r) => r.id)).toEqual(defs.map((d) => d.id))
    expect(rows.find((r) => r.id === 'holdem_hands_10')!.target).toBe(10)
  })

  it('answers for a malformed id rather than reaching the driver with it', async () => {
    expect((await achievements.list('not-a-uuid')).every((r) => r.progress === 0)).toBe(true)
  })
})

describe('an item reward already owned', () => {
  it('still unlocks, and does not fail on the duplicate grant', async () => {
    const playerId = await seedPlayer()
    await db.transaction((tx) => inv.grant(tx, playerId, 'aura_gold_cards01', 'daily'))

    await settle([seat(playerId, { won: true, net: 10, bestCategory: HandCategory.ROYAL_FLUSH })])

    expect(await find(playerId, 'hand_royal')).toMatchObject({ unlockedAt: NOW })
    const owned = await db.select().from(inventory).where(eq(inventory.playerId, playerId))
    expect(owned).toHaveLength(1)
    expect(owned[0]).toMatchObject({ source: 'daily' })
  })
})
