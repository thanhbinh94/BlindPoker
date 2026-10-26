import type { HandSummary, HandSummaryPlayer, PublicRoomConfig } from '@bp/server-kit'
import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAchievements } from '../achievements/definitions.js'
import { rowsOf, type AppDb } from '../db/client.js'
import { players, reputationEvents, reputationRanks, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AppEventBus } from '../events.js'
import { createEventBus } from '../events.js'
import { loadItemCatalog } from '../inventory/items.js'
import {
  createReputationService,
  DEFAULT_RANKS,
  RankOrderError,
  seedDefaults,
  type RankRow,
  type RankUpMessage,
  type ReputationReason,
  type ReputationService,
} from './reputation-service.js'

let test: TestDb
let db: AppDb
let bus: AppEventBus
let reputation: ReputationService
let stop: () => void
let notified: { playerId: string; msg: RankUpMessage }[] = []
let warned: { msg: string; data?: object }[] = []
/** The service's clock: `rules()` and `ranks()` cache for 5 s of it. */
let clock = Date.parse('2026-10-22T10:00:00.000Z')

/** A GM's id for `updated_by`; the configuration tables carry no foreign key, so it need not be an account. */
const ADMIN = '00000000-0000-4000-8000-0000000000aa'

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  bus = createEventBus(silentLogger)
  reputation = createReputationService({
    db,
    bus,
    notify: (playerId, msg) => notified.push({ playerId, msg }),
    log: { ...silentLogger, warn: (msg, data) => warned.push({ msg, data }) },
    now: () => clock,
  })
  stop = reputation.start()
})
afterAll(async () => {
  stop()
  await test.close()
})
beforeEach(() => {
  notified = []
  warned = []
})
/** What `notify` received for a rank-up to `rank`. */
const rankUp = (playerId: string, rank: number) => ({ playerId, msg: { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank } } })
afterEach(async () => {
  await db.execute(sql`truncate table reputation_events, players, users restart identity cascade`)
  // The test reset never truncates the configuration tables (the harness's `resetDb` neither): put the seeds back.
  await db.execute(sql`delete from reputation_rules`)
  await db.execute(sql`delete from reputation_ranks`)
  await seedDefaults(db)
  // Rows written behind the service's back: step past the views' cache so the next test reads them fresh.
  clock += 10_000
})

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 0 })
  return id
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

const CONFIG: PublicRoomConfig = { name: 'Bàn 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 30, autoStart: true }
const START = Date.parse('2026-10-22T10:00:00.000Z')
let handSeq = 0
function hand(seats: HandSummaryPlayer[], patch: Partial<HandSummary> = {}): HandSummary {
  handSeq += 1
  return { handId: `h${handSeq}`, roomId: 'r1', mode: 'holdem', config: CONFIG, startedAt: START, endedAt: START + 1_000, fee: 0, cancelled: false, players: seats, ...patch }
}
function seat(playerId: string, patch: Partial<HandSummaryPlayer> = {}): HandSummaryPlayer {
  return { playerId, seat: 0, isBot: false, net: 0, won: false, bestCategory: null, ...patch }
}
const settle = (summary: HandSummary): Promise<void> => bus.publish({ type: 'HAND_SETTLED', summary })

describe('ReputationService — grants', () => {
  it('grants, materialises and ranks up once', async () => {
    const p = await seedPlayer()

    const first = await reputation.grant(p, 60, 'gm_grant', 'gm:1')
    expect(first).toEqual({ reputation: 60, rank: 1, rankUp: false, applied: true })
    const second = await reputation.grant(p, 60, 'gm_grant', 'gm:2')
    expect(second).toEqual({ reputation: 120, rank: 2, rankUp: true, applied: true })

    expect(await standing(p)).toEqual({ reputation: 120, rank: 2 })
    expect(await events(p)).toEqual([
      { delta: 60, reason: 'gm_grant', refId: 'gm:1' },
      { delta: 60, reason: 'gm_grant', refId: 'gm:2' },
    ])
    // `grant` owns its transaction, so it announces the rank itself — once, after the commit.
    expect(notified).toEqual([rankUp(p, 2)])
  })

  it('a repeated (reason, refId) is a no-op', async () => {
    const p = await seedPlayer()
    await reputation.grant(p, 60, 'daily_login', 'daily:x:2026-10-22')

    const again = await reputation.grant(p, 60, 'daily_login', 'daily:x:2026-10-22')

    expect(again).toEqual({ reputation: 60, rank: 1, rankUp: false, applied: false })
    expect(await standing(p)).toEqual({ reputation: 60, rank: 1 })
    expect(await events(p)).toHaveLength(1)
    // The same ref under another reason is another event.
    expect((await reputation.grant(p, 5, 'hand_played', 'daily:x:2026-10-22')).applied).toBe(true)
  })

  it('a GM-style grant lands once per action, each under its own gm:<actionId> ref', async () => {
    const p = await seedPlayer()
    const r1 = await db.transaction((tx) => reputation.grantWithin(tx, p, 25, 'gm_grant', 'gm:101'))
    const r2 = await db.transaction((tx) => reputation.grantWithin(tx, p, 25, 'gm_grant', 'gm:102'))
    const replay = await db.transaction((tx) => reputation.grantWithin(tx, p, 25, 'gm_grant', 'gm:101'))

    expect([r1.applied, r2.applied, replay.applied]).toEqual([true, true, false])
    expect(await standing(p)).toEqual({ reputation: 50, rank: 1 })
    // `grantWithin` leaves the announcement to its caller, who knows when the transaction committed.
    expect(notified).toEqual([])
  })

  it('a zero or negative delta writes nothing and does not throw', async () => {
    const p = await seedPlayer()
    expect(await reputation.grant(p, 0, 'gm_grant', 'gm:1')).toEqual({ reputation: 0, rank: 1, rankUp: false, applied: false })
    expect(await reputation.grant(p, -5, 'gm_grant', 'gm:2')).toEqual({ reputation: 0, rank: 1, rankUp: false, applied: false })
    expect(await events(p)).toEqual([])
  })

  it('rank is a high-water mark', async () => {
    const p = await seedPlayer()
    expect(await reputation.grant(p, 450, 'gm_grant', 'gm:1')).toMatchObject({ reputation: 450, rank: 3, rankUp: true })

    const raised: RankRow[] = DEFAULT_RANKS.map((r) => (r.rank === 3 ? { rank: 3, threshold: 600 } : r))
    await db.transaction((tx) => reputation.setRanks(tx, raised, ADMIN))
    expect(await reputation.ranks()).toEqual(raised)
    expect(await standing(p)).toEqual({ reputation: 450, rank: 3 })

    // The ladder now places 451 at rank 2, but the rank already reached is kept (spec R15).
    expect(reputation.rankOf(451, raised)).toBe(2)
    expect(await reputation.grant(p, 1, 'gm_grant', 'gm:2')).toEqual({ reputation: 451, rank: 3, rankUp: false, applied: true })
    expect(await standing(p)).toEqual({ reputation: 451, rank: 3 })
    expect(notified).toEqual([rankUp(p, 3)])
  })

  it('invariant: players.reputation = Σ events', async () => {
    const ids = [await seedPlayer(), await seedPlayer(), await seedPlayer()]
    const reasons: ReputationReason[] = ['hand_played', 'hand_won', 'daily_login', 'achievement', 'gm_grant']
    // A fixed LCG, so a failure is reproducible; refs collide on purpose to exercise the replay path.
    let s = 2_026
    const next = (n: number): number => {
      s = (s * 1_103_515_245 + 12_345) % 2_147_483_648
      return s % n
    }
    for (let i = 0; i < 50; i += 1) {
      await reputation.grant(ids[next(3)]!, 1 + next(400), reasons[next(reasons.length)]!, `ref:${String(next(20))}`)
    }

    const drift = rowsOf<{ id: string }>(
      await db.execute(sql`
        select p.id from players p
        left join (select player_id, sum(delta) as total from reputation_events group by player_id) e on e.player_id = p.id
        where p.reputation <> coalesce(e.total, 0)`),
    )
    expect(drift).toEqual([])
    const written = rowsOf(await db.execute(sql`select 1 from reputation_events`)).length
    expect(written).toBeGreaterThan(0)
    // At least one (player, reason, ref) came up twice, so the replay path really ran.
    expect(written).toBeLessThan(50)
    const ranks = await reputation.ranks()
    for (const id of ids) {
      const now = await standing(id)
      expect(now.rank).toBe(reputation.rankOf(now.reputation, ranks))
    }
  })
})

describe('ReputationService — rules and ranks', () => {
  it('a rule set to 0 makes grantRuleWithin a no-op that leaves the caller’s transaction standing', async () => {
    const p = await seedPlayer()
    await db.transaction((tx) => reputation.setRules(tx, { daily_login: 0 }, ADMIN))
    expect((await reputation.rules()).daily_login).toBe(0)

    const r = await db.transaction(async (tx) => {
      const grant = await reputation.grantRuleWithin(tx, p, 'daily_login', 'daily_login', 'daily:p:2026-10-22')
      // Something else the caller writes in the same transaction must survive the no-op.
      await tx.update(players).set({ balance: 7 }).where(eq(players.id, p))
      return grant
    })

    expect(r).toEqual({ reputation: 0, rank: 1, rankUp: false, applied: false })
    expect(await events(p)).toEqual([])
    const [row] = await db.select({ balance: players.balance }).from(players).where(eq(players.id, p))
    expect(Number(row!.balance)).toBe(7)
  })

  it('grantRuleWithin pays the rule read through the transaction', async () => {
    const p = await seedPlayer()
    const r = await db.transaction((tx) => reputation.grantRuleWithin(tx, p, 'achievement_item', 'achievement', `ach:${p}:login_days_100`))
    expect(r).toEqual({ reputation: 500, rank: 3, rankUp: true, applied: true })
    expect(await reputation.rules()).toEqual({
      hand_played: 1, hand_won: 3, daily_login: 10, achievement_small: 50, achievement_big: 150, achievement_item: 500, welcome: 100, newcomer_day7: 200,
    })
  })

  it('rules() caches for at most 5 s, and a GM save through the service refreshes it at once', async () => {
    expect((await reputation.rules()).hand_won).toBe(3)
    await db.execute(sql`update reputation_rules set amount = 9 where key = 'hand_won'`)
    expect((await reputation.rules()).hand_won).toBe(3)
    clock += 5_000
    expect((await reputation.rules()).hand_won).toBe(9)
    await db.transaction((tx) => reputation.setRules(tx, { hand_won: 4 }, ADMIN))
    expect((await reputation.rules()).hand_won).toBe(4)
  })

  it('invalidate() drops the views’ cache, so rules() and ranks() read the tables again', async () => {
    expect((await reputation.rules()).hand_won).toBe(3)
    expect((await reputation.ranks())[1]!.threshold).toBe(100)
    // Written outside the service, as a GM route's own transaction would.
    await db.execute(sql`update reputation_rules set amount = 8 where key = 'hand_won'`)
    await db.execute(sql`update reputation_ranks set threshold = 120 where rank = 2`)
    expect((await reputation.rules()).hand_won).toBe(3)

    reputation.invalidate()

    expect((await reputation.rules()).hand_won).toBe(8)
    expect((await reputation.ranks())[1]!.threshold).toBe(120)
  })

  it('setRules refuses an unknown key and a negative or fractional amount', async () => {
    await expect(db.transaction((tx) => reputation.setRules(tx, { daily_login: -1 }, ADMIN))).rejects.toMatchObject({ code: 'INVALID_RULES' })
    await expect(db.transaction((tx) => reputation.setRules(tx, { daily_login: 1.5 }, ADMIN))).rejects.toMatchObject({ code: 'INVALID_RULES' })
    await expect(db.transaction((tx) => reputation.setRules(tx, { nope: 3 } as never, ADMIN))).rejects.toMatchObject({ code: 'INVALID_RULES' })
    expect((await reputation.rules()).daily_login).toBe(10)
  })

  it('setRanks refuses a non-increasing ladder', async () => {
    const bad: RankRow[][] = [
      DEFAULT_RANKS.map((r) => (r.rank === 3 ? { rank: 3, threshold: 100 } : r)), // equal to rank 2
      DEFAULT_RANKS.map((r) => (r.rank === 4 ? { rank: 4, threshold: 50 } : r)), // below rank 3
      DEFAULT_RANKS.map((r) => (r.rank === 1 ? { rank: 1, threshold: 10 } : r)), // rank 1 must start at 0
      DEFAULT_RANKS.slice(0, 4), // a rank missing
    ]
    for (const ladder of bad) {
      await expect(db.transaction((tx) => reputation.setRanks(tx, ladder, ADMIN))).rejects.toBeInstanceOf(RankOrderError)
    }
    const stored = await db.select({ rank: reputationRanks.rank, threshold: reputationRanks.threshold }).from(reputationRanks).orderBy(asc(reputationRanks.rank))
    expect(stored).toEqual(DEFAULT_RANKS)
  })

  it('achievementRuleFor', () => {
    const defs = loadAchievements(loadItemCatalog())
    const ruleOf = (id: string) => reputation.achievementRuleFor(defs.find((d) => d.id === id)!)
    expect(ruleOf('login_days_7')).toBe('achievement_small')
    expect(ruleOf('holdem_hands_1000')).toBe('achievement_big')
    expect(ruleOf('login_days_100')).toBe('achievement_item')
  })

  it('seedDefaults is idempotent and never overwrites a GM’s edit', async () => {
    await db.transaction((tx) => reputation.setRules(tx, { hand_won: 7 }, ADMIN))
    await seedDefaults(db)
    await reputation.seedDefaults()
    expect((await reputation.rules()).hand_won).toBe(7)
    expect(await reputation.ranks()).toEqual(DEFAULT_RANKS)
  })
})

describe('ReputationService — HAND_SETTLED', () => {
  it('HAND_SETTLED pays 1 per dealt human and 3 more per winner, never bots, never twice', async () => {
    const winner = await seedPlayer()
    const loser = await seedPlayer()
    const summary = hand([seat(winner, { won: true, net: 900 }), seat(loser, { seat: 1, net: -500 }), seat('bot-1', { seat: 2, isBot: true, won: true, net: 400 })])

    await settle(summary)
    await settle(summary)

    expect(await standing(winner)).toEqual({ reputation: 4, rank: 1 })
    expect(await standing(loser)).toEqual({ reputation: 1, rank: 1 })
    expect(await events(winner)).toEqual([
      { delta: 1, reason: 'hand_played', refId: summary.handId },
      { delta: 3, reason: 'hand_won', refId: summary.handId },
    ])
    expect(await events(loser)).toEqual([{ delta: 1, reason: 'hand_played', refId: summary.handId }])
    const all = await db.select({ id: reputationEvents.id }).from(reputationEvents)
    expect(all).toHaveLength(3)
  })

  it('pays hand_played and no hand_won for a Poker hỗn loạn hand, a winner included', async () => {
    const winner = await seedPlayer()
    const loser = await seedPlayer()
    const chaos: PublicRoomConfig = { ...CONFIG, mode: 'blind', blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0, chaosCycle: 5 } }
    const summary = hand([seat(winner, { won: true, net: 900 }), seat(loser, { seat: 1, net: -900 })], { mode: 'blind', config: chaos })
    await settle(summary)
    expect(await events(winner)).toEqual([{ delta: 1, reason: 'hand_played', refId: summary.handId }])
    expect(await events(loser)).toEqual([{ delta: 1, reason: 'hand_played', refId: summary.handId }])
    // The same table without cards still pays the winner.
    const plain = hand([seat(winner, { won: true, net: 900 })], { mode: 'blind', config: { ...chaos, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0 } } })
    await settle(plain)
    expect((await events(winner)).map((e) => e.reason)).toEqual(['hand_played', 'hand_played', 'hand_won'])
  })

  it('pays nothing for a cancelled hand or one whose settlement failed', async () => {
    const p = await seedPlayer()
    await settle(hand([seat(p, { won: true, net: 100 })], { cancelled: true }))
    await settle(hand([seat(p, { won: true, net: 100 })], { settlementError: 'boom' }))
    expect(await standing(p)).toEqual({ reputation: 0, rank: 1 })
    expect(await events(p)).toEqual([])
  })

  it('announces RANK_UP when a hand carries a player over a threshold, and skips a seat with no account', async () => {
    const p = await seedPlayer()
    await reputation.grant(p, 98, 'gm_grant', 'gm:1')
    await settle(hand([seat(p, { won: true, net: 100 }), seat('00000000-0000-4000-8000-0000000000ff', { seat: 1 })]))
    expect(await standing(p)).toEqual({ reputation: 102, rank: 2 })
    expect(notified).toEqual([{ playerId: p, msg: { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank: 2 } } }])
  })

  it('a failed grant for one seat is logged and the next seat of the hand is still paid', async () => {
    const first = await seedPlayer()
    const second = await seedPlayer()
    // The first seat's transaction fails with something other than an erased account (a dropped connection, say).
    const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('connection reset'))
    const summary = hand([seat(first, { won: true, net: 100 }), seat(second, { seat: 1, won: true, net: 50 })])
    try {
      await settle(summary)
    } finally {
      spy.mockRestore()
    }

    expect(await standing(first)).toEqual({ reputation: 0, rank: 1 })
    expect(await standing(second)).toEqual({ reputation: 4, rank: 1 })
    expect(warned).toEqual([{ msg: 'reputation for a hand failed', data: { handId: summary.handId, playerId: first, error: 'connection reset' } }])
  })
})
