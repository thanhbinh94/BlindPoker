import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb } from '../db/client.js'
import { playerAchievements, players, playerStats, reputationEvents, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { BACKFILL_USAGE, backfillReputation, MIRRORED_REASONS, parseBackfillArgs } from './backfill.js'
import { seedDefaults } from './reputation-service.js'

let test: TestDb
let db: AppDb

/** One definition per achievement rule: item (500), big (150), small (50). Only `achievementRuleFor` reads them. */
const DEFS: AchievementDef[] = [
  { id: 'ach_item', category: 'holdem', metric: 'handsPlayedHoldem', threshold: 100, reward: { itemId: 'hat_01' } },
  { id: 'ach_big', category: 'holdem', metric: 'handsWonHoldem', threshold: 500, reward: { points: 10_000 } },
  { id: 'ach_small', category: 'login', metric: 'totalLoginDays', threshold: 3, reward: { points: 1_000 } },
]

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  await seedDefaults(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table reputation_events, player_achievements, player_stats, players, users restart identity cascade`)
  await db.execute(sql`delete from reputation_rules`)
  await db.execute(sql`delete from reputation_ranks`)
  await seedDefaults(db)
})

let seq = 0
async function seedPlayer(standing: { reputation?: number; rank?: number } = {}): Promise<string> {
  seq += 1
  const name = `b${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 0, reputation: standing.reputation ?? 0, rank: standing.rank ?? 1 })
  return id
}

/** 100 Hold'em + 20 Blind hands, 25 + 5 wins, 10 login days, and the item achievement unlocked: 120 + 90 + 100 + 500. */
async function seedHistory(playerId: string): Promise<void> {
  await db.insert(playerStats).values({ playerId, handsPlayedHoldem: 100, handsPlayedBlind: 20, handsWonHoldem: 25, handsWonBlind: 5, totalLoginDays: 10 })
  await db.insert(playerAchievements).values([
    { playerId, achievementId: 'ach_item', progress: 100, unlockedAt: new Date('2026-10-01T00:00:00Z') },
    // In progress: pays nothing.
    { playerId, achievementId: 'ach_big', progress: 30, unlockedAt: null },
  ])
}

async function standing(playerId: string): Promise<{ reputation: number; rank: number }> {
  const [row] = await db.select({ reputation: players.reputation, rank: players.rank }).from(players).where(eq(players.id, playerId))
  return row!
}

async function events(playerId: string): Promise<{ delta: number; reason: string; refId: string }[]> {
  return db
    .select({ delta: reputationEvents.delta, reason: reputationEvents.reason, refId: reputationEvents.refId })
    .from(reputationEvents)
    .where(eq(reputationEvents.playerId, playerId))
    .orderBy(asc(reputationEvents.id))
}

describe('backfillReputation', () => {
  it('a player with 120 hands, 30 wins, 10 login days and one item achievement gets 120+90+100+500', async () => {
    const p = await seedPlayer()
    await seedHistory(p)

    const result = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(result).toEqual({ players: 1, applied: 810, byRank: [0, 0, 1, 0, 0] })
    expect(await standing(p)).toEqual({ reputation: 810, rank: 3 })
    expect(await events(p)).toEqual([{ delta: 810, reason: 'backfill', refId: 'plan27' }])
  })

  it('uses the rules as stored, a missing key falling back to its seed', async () => {
    const p = await seedPlayer()
    await seedHistory(p)
    await db.execute(sql`update reputation_rules set amount = 2 where key = 'hand_played'`)
    await db.execute(sql`delete from reputation_rules where key = 'achievement_item'`)

    const result = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(result.applied).toBe(240 + 90 + 100 + 500)
  })

  it('live events already written are subtracted', async () => {
    const p = await seedPlayer({ reputation: 112 })
    await seedHistory(p)
    // Written by the live server between `compose up` and the CLI: one mirrors `player_stats`, the welcome does not.
    await db.insert(reputationEvents).values([
      { playerId: p, delta: 12, reason: 'hand_played', refId: 'h1' },
      { playerId: p, delta: 100, reason: 'welcome', refId: 'welcome' },
    ])

    const result = await backfillReputation(db, { dryRun: false, defs: DEFS })

    // 810 − 12: the welcome's 100 is not history the formula counts, so it is not taken back.
    expect(result.applied).toBe(798)
    expect(await standing(p)).toEqual({ reputation: 112 + 798, rank: 3 })
  })

  it('subtracts every one of the four mirrored reasons, and neither a newcomer day nor a GM grant', async () => {
    const p = await seedPlayer({ reputation: 4 + 3 + 10 + 500 + 200 + 1_000 })
    await seedHistory(p)
    await db.insert(reputationEvents).values([
      { playerId: p, delta: 4, reason: 'hand_played', refId: 'h1' },
      { playerId: p, delta: 3, reason: 'hand_won', refId: 'h1' },
      { playerId: p, delta: 10, reason: 'daily_login', refId: 'daily:1' },
      { playerId: p, delta: 500, reason: 'achievement', refId: 'ach:ach_item' },
      // Not history `player_stats` counts: left alone.
      { playerId: p, delta: 200, reason: 'newcomer_day', refId: 'newcomer:7' },
      { playerId: p, delta: 1_000, reason: 'gm_grant', refId: 'gm:1' },
    ])
    expect(new Set(MIRRORED_REASONS)).toEqual(new Set(['hand_played', 'hand_won', 'daily_login', 'achievement']))

    const result = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(result.applied).toBe(810 - (4 + 3 + 10 + 500))
  })

  it('announces no rank-up, even for a player the backfill lifts two ranks', async () => {
    const p = await seedPlayer()
    await seedHistory(p)
    const notify = vi.fn()

    await backfillReputation(db, { dryRun: false, defs: DEFS, notify })

    expect(await standing(p)).toEqual({ reputation: 810, rank: 3 })
    // A deploy-time credit: a toast for every old account at once, to nobody online, would only be noise.
    expect(notify).not.toHaveBeenCalled()
  })

  it('a second run applies 0', async () => {
    const p = await seedPlayer()
    await seedHistory(p)
    await backfillReputation(db, { dryRun: false, defs: DEFS })

    const again = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(again).toEqual({ players: 0, applied: 0, byRank: [0, 0, 1, 0, 0] })
    expect(await standing(p)).toEqual({ reputation: 810, rank: 3 })
    expect(await events(p)).toHaveLength(1)
  })

  it('dry run writes nothing', async () => {
    const p = await seedPlayer()
    await seedHistory(p)

    const result = await backfillReputation(db, { dryRun: true, defs: DEFS })

    expect(result).toEqual({ players: 1, applied: 810, byRank: [0, 0, 1, 0, 0] })
    expect(await standing(p)).toEqual({ reputation: 0, rank: 1 })
    expect(await events(p)).toEqual([])
  })

  it('rank is raised to the high-water mark of the result', async () => {
    // Already rank 4 (a GM lowered the ladder once, then raised it back): 810 never takes that rank away.
    const kept = await seedPlayer({ rank: 4 })
    await seedHistory(kept)
    const raised = await seedPlayer()
    await seedHistory(raised)
    const idle = await seedPlayer()

    const result = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(await standing(kept)).toEqual({ reputation: 810, rank: 4 })
    expect(await standing(raised)).toEqual({ reputation: 810, rank: 3 })
    expect(await standing(idle)).toEqual({ reputation: 0, rank: 1 })
    expect(result).toEqual({ players: 3, applied: 1_620, byRank: [1, 0, 1, 1, 0] })
  })

  it('a player whose live events already exceed the formula gets nothing and no marker', async () => {
    const p = await seedPlayer({ reputation: 50 })
    await db.insert(playerStats).values({ playerId: p, handsPlayedHoldem: 3, handsWonHoldem: 1 })
    // More live hands than the stats show (a stats write that failed): the difference is clamped at 0.
    await db.insert(reputationEvents).values({ playerId: p, delta: 50, reason: 'hand_played', refId: 'h1' })

    const first = await backfillReputation(db, { dryRun: false, defs: DEFS })
    const second = await backfillReputation(db, { dryRun: false, defs: DEFS })

    expect(first).toEqual({ players: 1, applied: 0, byRank: [1, 0, 0, 0, 0] })
    expect(second).toEqual({ players: 1, applied: 0, byRank: [1, 0, 0, 0, 0] })
    expect(await standing(p)).toEqual({ reputation: 50, rank: 1 })
    expect(await events(p)).toEqual([{ delta: 50, reason: 'hand_played', refId: 'h1' }])
  })
})

describe('parseBackfillArgs (the CLI)', () => {
  it('takes no flag or --dry-run, and refuses anything else so a typo never runs the real credit', () => {
    expect(parseBackfillArgs([])).toEqual({ dryRun: false })
    expect(parseBackfillArgs(['--dry-run'])).toEqual({ dryRun: true })
    for (const argv of [['--dryrun'], ['--dry-run', 'extra'], ['-n'], ['--help']]) expect(parseBackfillArgs(argv), argv.join(' ')).toBeNull()
    expect(BACKFILL_USAGE).toBe('usage: node dist/reputation-backfill-cli.js [--dry-run]')
  })
})
