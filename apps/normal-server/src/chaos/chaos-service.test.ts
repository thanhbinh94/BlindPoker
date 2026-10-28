import { CHAOS_CARDS_SPEC, CHAOS_MODES, CHAOS_TIERS, DEFAULT_CHAOS_CONFIG, type ChaosCardDef, type ChaosConfig } from '@bp/core'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rowsOf, type AppDb } from '../db/client.js'
import { chaosCardRules, chaosConfig, players, pointTransactions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { dayKey, nextDayStartMs } from '../economy/daily-rules.js'
import { ServiceError } from '../errors.js'
import { UnknownPlayerError } from '../repos/balance-repo.js'
import { createChaosPort } from './chaos-port.js'
import { CONFIG_CACHE_MS, createChaosService, type ChaosService } from './chaos-service.js'

const TZ = 'Asia/Ho_Chi_Minh'
const GM = '00000000-0000-4000-8000-0000000000aa'
const BALANCE = 50_000

let test: TestDb
let db: AppDb
/** The service's clock. The ledger rows carry the database's own clock, so credits are judged against the real now. */
let clock = Date.now()
let chaos: ChaosService

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(() => {
  clock = Date.now()
  chaos = serviceOver(CHAOS_CARDS_SPEC)
})
afterEach(async () => {
  await db.execute(sql`truncate table chaos_card_rules, chaos_config, ledger_keys, point_transactions, players, users restart identity cascade`)
})

function serviceOver(catalogue: readonly ChaosCardDef[], now: () => number = () => clock): ChaosService {
  return createChaosService({ db, catalogue, timezone: TZ, now })
}

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: BALANCE })
  return id
}

const balanceOf = async (id: string): Promise<number> => {
  const [row] = await db.select({ balance: players.balance }).from(players).where(eq(players.id, id))
  return Number(row!.balance)
}
const ledger = async (id: string) =>
  (await db.select().from(pointTransactions).where(eq(pointTransactions.playerId, id)).orderBy(pointTransactions.id)).map((r) => ({ amount: Number(r.amount), reason: r.reason, refId: r.refId }))

const setRules = (changes: Parameters<ChaosService['setRules']>[1]) => db.transaction((tx) => chaos.setRules(tx, changes, GM))
const setConfig = (config: ChaosConfig) => db.transaction((tx) => chaos.setConfig(tx, config, GM))
const rejects = async (promise: Promise<unknown>, code: string): Promise<void> => {
  const err = await promise.then(() => undefined, (e: unknown) => e)
  expect(err).toBeInstanceOf(ServiceError)
  expect((err as ServiceError).code).toBe(code)
}

const idsOf = (cards: readonly ChaosCardDef[]) => cards.map((c) => c.id)
const SILVER = CHAOS_CARDS_SPEC.filter((c) => c.tier === 'silver').map((c) => c.id)

describe('active()', () => {
  it('follows the file when there are no rules: every card on, each at weight 1 and marked enabled', async () => {
    const { cards, weights } = await chaos.active()
    expect(cards).toHaveLength(47 + 39)
    expect(cards.every((c) => c.enabled)).toBe(true)
    expect([...weights.values()].every((w) => w === 1)).toBe(true)
    expect(weights.size).toBe(47 + 39)
  })

  it('leaves out a card the file has off, and a rule inside its window can turn it on with a weight', async () => {
    const off = CHAOS_CARDS_SPEC.map((c) => (c.id === 'g_crit' ? { ...c, enabled: false } : c))
    chaos = serviceOver(off)
    expect(idsOf((await chaos.active()).cards)).not.toContain('g_crit')

    await setRules([{ cardId: 'g_crit', enabled: true, weight: 7, startsAt: clock - 1_000, endsAt: clock + 1_000 }])
    const { cards, weights } = await chaos.active()
    expect(idsOf(cards)).toContain('g_crit')
    expect(weights.get('g_crit')).toBe(7)
    expect(cards.find((c) => c.id === 'g_crit')?.enabled).toBe(true)
  })

  it('takes a card off with a rule, and honours the window edges: starts_at is inclusive, ends_at is not', async () => {
    await setRules([{ cardId: 's_charge', enabled: false, weight: 1, startsAt: clock, endsAt: clock + 10_000 }])
    expect(idsOf((await chaos.active(clock - 1)).cards)).toContain('s_charge') // before the window: the file's default
    expect(idsOf((await chaos.active(clock)).cards)).not.toContain('s_charge')
    expect(idsOf((await chaos.active(clock + 9_999)).cards)).not.toContain('s_charge')
    expect(idsOf((await chaos.active(clock + 10_000)).cards)).toContain('s_charge') // after: the file's default again
  })

  it('treats a rule outside its window as no rule at all, weight included', async () => {
    await setRules([{ cardId: 's_charge', enabled: true, weight: 40, startsAt: clock - 20_000, endsAt: clock - 10_000 }])
    const { cards, weights } = await chaos.active()
    expect(idsOf(cards)).toContain('s_charge')
    expect(weights.get('s_charge')).toBe(1)
  })

  it('keeps a weight-0 card in the list at weight 0, which the draw reads as never', async () => {
    await setRules([{ cardId: 's_charge', enabled: true, weight: 0, startsAt: null, endsAt: null }])
    const { cards, weights } = await chaos.active()
    expect(idsOf(cards)).toContain('s_charge')
    expect(weights.get('s_charge')).toBe(0)
  })

  it('reads the rules afresh on every call', async () => {
    expect((await chaos.active()).weights.get('s_charge')).toBe(1)
    await db.insert(chaosCardRules).values({ cardId: 's_charge', enabled: true, weight: 9 })
    expect((await chaos.active()).weights.get('s_charge')).toBe(9)
    await db.update(chaosCardRules).set({ enabled: false }).where(eq(chaosCardRules.cardId, 's_charge'))
    expect(idsOf((await chaos.active()).cards)).not.toContain('s_charge')
  })

  it('is what the port serves as the catalogue, with the config beside it', async () => {
    const port = createChaosPort(chaos)
    expect((await port.catalogue()).cards).toHaveLength(47 + 39)
    expect(await port.config()).toEqual(DEFAULT_CHAOS_CONFIG)
  })
})

describe('rules()', () => {
  it('lists the whole catalogue with the file default, the rule if any, and whether it is on now', async () => {
    await setRules([
      { cardId: 's_charge', enabled: false, weight: 3, startsAt: null, endsAt: null },
      { cardId: 'g_crit', enabled: true, weight: 12, startsAt: clock + 5_000, endsAt: clock + 9_000 },
    ])
    const list = await chaos.rules()
    expect(list).toHaveLength(47 + 39) // Plan 37's 47 and BP-41's 39
    expect(list.map((c) => c.id)).toEqual(idsOf(CHAOS_CARDS_SPEC))
    expect(list.find((c) => c.id === 's_charge')).toMatchObject({
      tier: 'silver', family: 'points', effect: 'chaosPoints', fileEnabled: true, activeNow: false,
      rule: { enabled: false, weight: 3, startsAt: null, endsAt: null },
    })
    // A window in the future: the rule exists, the file still governs.
    expect(list.find((c) => c.id === 'g_crit')).toMatchObject({ activeNow: true, rule: { enabled: true, weight: 12, startsAt: clock + 5_000, endsAt: clock + 9_000 } })
    expect(list.find((c) => c.id === 's_swap_one')).toMatchObject({ rule: null, activeNow: true, modes: ['playOrFold', 'none'] })
  })
})

describe('setRules()', () => {
  it('writes, updates and clears a rule, recording who and when', async () => {
    await setRules([{ cardId: 's_charge', enabled: false, weight: 2, startsAt: null, endsAt: null }])
    expect((await db.select().from(chaosCardRules))[0]).toMatchObject({ cardId: 's_charge', enabled: false, weight: 2, updatedBy: GM, updatedAt: new Date(clock) })

    await setRules([{ cardId: 's_charge', enabled: true, weight: 5, startsAt: null, endsAt: null }])
    expect(await db.select().from(chaosCardRules)).toHaveLength(1)
    expect((await chaos.active()).weights.get('s_charge')).toBe(5)

    await setRules([{ cardId: 's_charge', clear: true }])
    expect(await db.select().from(chaosCardRules)).toEqual([])
    expect((await chaos.active()).weights.get('s_charge')).toBe(1)
  })

  it('refuses an unknown card, a weight outside 0..100, a window that ends before it starts, and writes none of the batch', async () => {
    const ok = { cardId: 's_charge', enabled: false, weight: 1, startsAt: null, endsAt: null }
    await rejects(setRules([ok, { ...ok, cardId: 'nope' }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ ...ok, weight: 101 }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ ...ok, weight: -1 }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ ...ok, weight: 1.5 }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ ...ok, startsAt: 5_000, endsAt: 5_000 }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ ...ok, startsAt: 5_000, endsAt: 4_000 }]), 'INVALID_CHAOS_RULES')
    await rejects(setRules([{ cardId: 'nope', clear: true }]), 'INVALID_CHAOS_RULES')
    expect(await db.select().from(chaosCardRules)).toEqual([])
    // The limits themselves are fine.
    await setRules([{ ...ok, enabled: true, weight: 0 }, { cardId: 's_shield', enabled: true, weight: 100, startsAt: 1, endsAt: 2 }])
    expect(await db.select().from(chaosCardRules)).toHaveLength(2)
  })

  it('refuses leaving a tier with fewer than three cards that can be drawn, whether by off or by weight 0, and rolls the batch back', async () => {
    const keep = SILVER.slice(0, 2)
    const offAllButTwo = SILVER.filter((id) => !keep.includes(id)).map((cardId) => ({ cardId, enabled: false, weight: 1, startsAt: null, endsAt: null }))
    await rejects(setRules(offAllButTwo), 'INVALID_CHAOS_RULES')
    expect(await db.select().from(chaosCardRules)).toEqual([])

    const zeroAllButTwo = SILVER.filter((id) => !keep.includes(id)).map((cardId) => ({ cardId, enabled: true, weight: 0, startsAt: null, endsAt: null }))
    await rejects(setRules(zeroAllButTwo), 'INVALID_CHAOS_RULES')
    expect(await db.select().from(chaosCardRules)).toEqual([])

    // Three left is allowed.
    await setRules(SILVER.slice(3).map((cardId) => ({ cardId, enabled: false, weight: 1, startsAt: null, endsAt: null })))
    expect((await chaos.active()).cards.filter((c) => c.tier === 'silver')).toHaveLength(3)
  })

  it('refuses a shortfall in one kind of table even when the other keeps plenty', async () => {
    const forNone = CHAOS_CARDS_SPEC.filter((c) => c.tier === 'gold' && c.modes.includes('none')).map((c) => c.id)
    expect(forNone.length).toBeGreaterThan(3)
    const keep = forNone.slice(0, 2)
    await rejects(setRules(forNone.filter((id) => !keep.includes(id)).map((cardId) => ({ cardId, enabled: false, weight: 1, startsAt: null, endsAt: null }))), 'INVALID_CHAOS_RULES')
  })

  it('refuses a shortfall in force now and one a future window would open, and says from when', async () => {
    const off = SILVER.slice(2).map((cardId) => ({ cardId, enabled: false, weight: 1, startsAt: clock, endsAt: null }))
    await rejects(setRules(off), 'INVALID_CHAOS_RULES')
    // A season that starts in a minute: nothing is short now, but it would be then.
    const later = off.map((r) => ({ ...r, startsAt: clock + 60_000 }))
    const err = await setRules(later).then(() => null, (e: unknown) => e as ServiceError)
    expect(err?.code).toBe('INVALID_CHAOS_RULES')
    expect(err?.message).toContain(new Date(clock + 60_000).toISOString())
    expect(await db.select().from(chaosCardRules)).toEqual([])
  })

  it('refuses a shortfall that only opens when a window closes: a weight-up season that ends over cards the file has off', async () => {
    // The file turns all but two silver cards off; a rule keeps a third on until a season ends in an hour.
    const offInFile = new Set(SILVER.slice(2))
    chaos = serviceOver(CHAOS_CARDS_SPEC.map((c) => (offInFile.has(c.id) ? { ...c, enabled: false } : c)))
    const season = { cardId: SILVER[2]!, enabled: true, weight: 5, startsAt: null, endsAt: clock + 3_600_000 }
    await rejects(setRules([season]), 'INVALID_CHAOS_RULES')
    // Without an end it holds for good: accepted.
    await setRules([{ ...season, endsAt: null }])
    expect((await chaos.active()).cards.filter((c) => c.tier === 'silver')).toHaveLength(3)
  })

  it('accepts a future season that leaves every tier its three cards, and a window already over', async () => {
    const off = SILVER.slice(3).map((cardId) => ({ cardId, enabled: false, weight: 1, startsAt: clock + 60_000, endsAt: clock + 120_000 }))
    await setRules([...off, { cardId: SILVER[0]!, enabled: false, weight: 1, startsAt: clock - 20_000, endsAt: clock - 10_000 }])
    expect(await db.select().from(chaosCardRules)).toHaveLength(off.length + 1)
  })

  it('covers every tier and mode in the check', () => {
    expect(CHAOS_TIERS).toHaveLength(3)
    expect(CHAOS_MODES).toHaveLength(2)
  })
})

describe('config()/setConfig()', () => {
  const GOOD: ChaosConfig = { tierWeights: { silver: 50, gold: 40, diamond: 10 }, pointsThreshold: 8, draftMs: 20_000, resultMs: 12_000, dailyCapPoints: 250_000, dailyRescues: 5 }

  it('is the defaults until a GM saves, then the saved settings', async () => {
    expect(await chaos.config()).toEqual(DEFAULT_CHAOS_CONFIG)
    expect(DEFAULT_CHAOS_CONFIG.resultMs).toBe(10_000)
    await setConfig(GOOD)
    expect(await chaos.config()).toEqual(GOOD)
    expect((await db.select().from(chaosConfig))[0]).toMatchObject({ key: 'chaos', updatedBy: GM })
    await setConfig({ ...GOOD, pointsThreshold: 9 })
    expect(await db.select().from(chaosConfig)).toHaveLength(1)
    expect((await chaos.config()).pointsThreshold).toBe(9)
  })

  it('accepts the limits of every field, and a tier weighted 0 while another is not', async () => {
    await setConfig({ tierWeights: { silver: 0, gold: 0, diamond: 1 }, pointsThreshold: 1, draftMs: 5_000, resultMs: 5_000, dailyCapPoints: 0, dailyRescues: 0 })
    expect((await chaos.config()).tierWeights).toEqual({ silver: 0, gold: 0, diamond: 1 })
    await setConfig({ tierWeights: { silver: 100, gold: 100, diamond: 100 }, pointsThreshold: 100, draftMs: 60_000, resultMs: 15_000, dailyCapPoints: 10_000_000, dailyRescues: 20 })
    expect((await chaos.config()).dailyCapPoints).toBe(10_000_000)
    expect((await chaos.config()).resultMs).toBe(15_000)
  })

  it('refuses a weight set that adds up to nothing or is not whole, and a value out of its range', async () => {
    const bad: Record<string, unknown>[] = [
      { tierWeights: { silver: 0, gold: 0, diamond: 0 } },
      { tierWeights: { silver: -1, gold: 5, diamond: 5 } },
      { tierWeights: { silver: 1.5, gold: 5, diamond: 5 } },
      { tierWeights: { silver: 5, gold: 5 } },
      { pointsThreshold: 0 }, { pointsThreshold: 101 }, { pointsThreshold: 2.5 },
      { draftMs: 4_999 }, { draftMs: 60_001 },
      { resultMs: 4_999 }, { resultMs: 15_001 }, { resultMs: 9_000.5 },
      { dailyCapPoints: -1 }, { dailyCapPoints: 10_000_001 },
      { dailyRescues: -1 }, { dailyRescues: 21 }, { dailyRescues: Number.NaN },
    ]
    for (const patch of bad) await rejects(setConfig({ ...GOOD, ...patch } as ChaosConfig), 'INVALID_CHAOS_CONFIG')
    await rejects(setConfig(null as unknown as ChaosConfig), 'INVALID_CHAOS_CONFIG')
    expect(await db.select().from(chaosConfig)).toEqual([])
  })

  it('fills a stored row that lacks a field, or holds a wrong one, from the defaults', async () => {
    await db.insert(chaosConfig).values({ key: 'chaos', value: { pointsThreshold: 20, draftMs: 'soon', tierWeights: { gold: 7 } } })
    expect((await chaos.config()).resultMs).toBe(10_000) // a stored row from before BP-39 has no result time
    expect(await chaos.config()).toEqual({ ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 20, tierWeights: { silver: 50, gold: 7, diamond: 15 } })
    await db.update(chaosConfig).set({ value: 'garbage' }).where(eq(chaosConfig.key, 'chaos'))
    clock += CONFIG_CACHE_MS // a row edited by hand is seen once the cache runs out
    expect(await chaos.config()).toEqual(DEFAULT_CHAOS_CONFIG)
  })

  it('keeps what it read for a while, so the rooms\' reads after every hand do not each hit the database; a save drops it at once (M5)', async () => {
    let reads = 0
    const counting = createChaosService({
      db: new Proxy(db, { get: (t, k, r) => (k === 'select' ? (reads++, Reflect.get(t, k, r)) : Reflect.get(t, k, r)) }),
      catalogue: CHAOS_CARDS_SPEC, timezone: TZ, now: () => clock,
    })
    expect(await counting.config()).toEqual(DEFAULT_CHAOS_CONFIG)
    expect(await counting.config()).toEqual(DEFAULT_CHAOS_CONFIG)
    expect(reads).toBe(1)
    // A hand edit waits out the cache.
    await db.insert(chaosConfig).values({ key: 'chaos', value: { ...GOOD, pointsThreshold: 30 } })
    expect((await counting.config()).pointsThreshold).toBe(DEFAULT_CHAOS_CONFIG.pointsThreshold)
    clock += CONFIG_CACHE_MS
    expect((await counting.config()).pointsThreshold).toBe(30)
    expect(reads).toBe(2)
    // A GM's save is seen by the very next read.
    await db.transaction((tx) => counting.setConfig(tx, GOOD, GM))
    expect(await counting.config()).toEqual(GOOD)
    expect(reads).toBe(3)
  })

  it('forgetConfig drops what a read between the save and its commit kept, so the committed settings are seen at once', async () => {
    expect(await chaos.config()).toEqual(DEFAULT_CHAOS_CONFIG)
    // The row lands as the commit would land it, after the cache took the old settings.
    await db.insert(chaosConfig).values({ key: 'chaos', value: { ...GOOD } })
    expect(await chaos.config()).toEqual(DEFAULT_CHAOS_CONFIG)
    chaos.forgetConfig()
    expect(await chaos.config()).toEqual(GOOD)
  })
})

describe('credit()', () => {
  const credit = (playerId: string, amount: number, reason: 'chaos_rescue' | 'chaos_crit' | 'chaos_fortune' | 'chaos_jackpot', key: string) =>
    chaos.credit({ playerId, roomId: 'room-1', amount, reason, key })

  it('BP-41: pays a jackpot as its own source row, under the same daily cap as the other chaos credits', async () => {
    const p = await seedPlayer()
    await setConfig({ ...DEFAULT_CHAOS_CONFIG, dailyCapPoints: 50_000 })
    expect(await credit(p, 30_000, 'chaos_crit', 'kc')).toEqual({ credited: 30_000, capped: false })
    expect(await credit(p, 30_000, 'chaos_jackpot', 'kj')).toEqual({ credited: 20_000, capped: true })
    expect(await credit(p, 1_000, 'chaos_crit', 'kc2')).toEqual({ credited: 0, capped: true })
    expect((await ledger(p)).filter((r) => r.refId === 'kj')).toEqual([
      { amount: 20_000, reason: 'chaos_jackpot', refId: 'kj' },
      { amount: -20_000, reason: 'chaos_to_table', refId: 'kj' },
    ])
    expect(await balanceOf(p)).toBe(BALANCE)
  })

  it('writes the source row and the transfer to the table under one key, and leaves the balance alone', async () => {
    const p = await seedPlayer()
    expect(await credit(p, 30_000, 'chaos_crit', 'chaos:r:h1:0:7:chaos_crit')).toEqual({ credited: 30_000, capped: false })
    expect(await ledger(p)).toEqual([
      { amount: 30_000, reason: 'chaos_crit', refId: 'chaos:r:h1:0:7:chaos_crit' },
      { amount: -30_000, reason: 'chaos_to_table', refId: 'chaos:r:h1:0:7:chaos_crit' },
    ])
    expect(await balanceOf(p)).toBe(BALANCE)
    expect(rowsOf(await db.execute(sql`select key from ledger_keys`))).toEqual([{ key: 'chaos:r:h1:0:7:chaos_crit' }])
  })

  it('stops at the daily cap: 60 000 and 60 000 pay 60 000 and 40 000 (cut), then nothing', async () => {
    const p = await seedPlayer()
    expect(await credit(p, 60_000, 'chaos_crit', 'k1')).toEqual({ credited: 60_000, capped: false })
    expect(await credit(p, 60_000, 'chaos_fortune', 'k2')).toEqual({ credited: 40_000, capped: true })
    expect(await credit(p, 1_000, 'chaos_crit', 'k3')).toEqual({ credited: 0, capped: true })
    const rows = await ledger(p)
    expect(rows.filter((r) => r.reason !== 'chaos_to_table').reduce((s, r) => s + r.amount, 0)).toBe(100_000)
    expect(rows.filter((r) => r.reason === 'chaos_to_table').reduce((s, r) => s + r.amount, 0)).toBe(-100_000)
    expect(rows).toHaveLength(4) // the fully capped credit writes no row
    expect(await balanceOf(p)).toBe(BALANCE)
  })

  it('counts each player on their own, and takes the cap from the GM’s settings', async () => {
    const a = await seedPlayer()
    const b = await seedPlayer()
    await setConfig({ ...DEFAULT_CHAOS_CONFIG, dailyCapPoints: 5_000 })
    expect(await credit(a, 4_000, 'chaos_crit', 'ka1')).toEqual({ credited: 4_000, capped: false })
    expect(await credit(a, 4_000, 'chaos_crit', 'ka2')).toEqual({ credited: 1_000, capped: true })
    expect(await credit(b, 4_000, 'chaos_crit', 'kb1')).toEqual({ credited: 4_000, capped: false })
  })

  it('allows a Cấp cứu three times a day and pays a fourth nothing, without touching the points cap for the other cards', async () => {
    const p = await seedPlayer()
    for (let i = 1; i <= 3; i += 1) expect(await credit(p, 1_000, 'chaos_rescue', `r${String(i)}`)).toEqual({ credited: 1_000, capped: false })
    expect(await credit(p, 1_000, 'chaos_rescue', 'r4')).toEqual({ credited: 0, capped: true })
    // The count is of rescues only: a Bạo kích still pays.
    expect(await credit(p, 1_000, 'chaos_crit', 'c1')).toEqual({ credited: 1_000, capped: false })
    expect((await ledger(p)).filter((r) => r.reason === 'chaos_rescue')).toHaveLength(3)
    await setConfig({ ...DEFAULT_CHAOS_CONFIG, dailyRescues: 4 })
    expect(await credit(p, 1_000, 'chaos_rescue', 'r5')).toEqual({ credited: 1_000, capped: false })
    await setConfig({ ...DEFAULT_CHAOS_CONFIG, dailyRescues: 0 })
    expect(await credit(p, 1_000, 'chaos_rescue', 'r6')).toEqual({ credited: 0, capped: true })
  })

  it('starts the day again at the economy-day boundary, in the economy’s zone', async () => {
    const p = await seedPlayer()
    for (let i = 1; i <= 3; i += 1) await credit(p, 1_000, 'chaos_rescue', `r${String(i)}`)
    await credit(p, 97_000, 'chaos_crit', 'c1')
    expect(await credit(p, 500, 'chaos_crit', 'c2')).toEqual({ credited: 0, capped: true })

    // The rows carry the database's own clock; the service's clock is a parameter, so move it to either side of the
    // midnight that follows the rows (Ho Chi Minh, not UTC).
    const [last] = rowsOf<{ at: string | Date }>(await db.execute(sql`select max(created_at) as at from point_transactions`))
    const written = new Date(last!.at).getTime()
    const boundary = nextDayStartMs(written, TZ)
    expect(dayKey(boundary, TZ)).not.toBe(dayKey(boundary - 1, TZ))

    clock = boundary - 1
    expect(await credit(p, 500, 'chaos_crit', 'c3')).toEqual({ credited: 0, capped: true })
    expect(await credit(p, 500, 'chaos_rescue', 'r4')).toEqual({ credited: 0, capped: true })

    clock = boundary
    expect(await credit(p, 500, 'chaos_rescue', 'r5')).toEqual({ credited: 500, capped: false })
    // The cap is whole again: the day's earlier rows (and r5's, which the database stamped with its own clock) are before the boundary.
    expect(await credit(p, 100_000, 'chaos_crit', 'c4')).toEqual({ credited: 100_000, capped: false })
  })

  it('writes nothing for a replayed key and answers with the amount already written under it', async () => {
    const p = await seedPlayer()
    await credit(p, 70_000, 'chaos_crit', 'k1')
    expect(await credit(p, 60_000, 'chaos_fortune', 'k2')).toEqual({ credited: 30_000, capped: true })
    const before = await ledger(p)

    expect(await credit(p, 60_000, 'chaos_fortune', 'k2')).toEqual({ credited: 30_000, capped: true })
    expect(await credit(p, 70_000, 'chaos_crit', 'k1')).toEqual({ credited: 70_000, capped: false })
    expect(await ledger(p)).toEqual(before)
    // A key whose credit was cut to nothing stays claimed: the retry is not a second chance at tomorrow's cap.
    expect(await credit(p, 1_000, 'chaos_crit', 'k3')).toEqual({ credited: 0, capped: true })
    clock += 2 * 24 * 60 * 60 * 1000
    expect(await credit(p, 1_000, 'chaos_crit', 'k3')).toEqual({ credited: 0, capped: true })
    expect(await ledger(p)).toEqual(before)
  })

  it('serialises concurrent credits of one player, so the cap holds', async () => {
    const p = await seedPlayer()
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => credit(p, 30_000, 'chaos_crit', `k${String(i)}`)))
    expect(results.map((r) => r.credited).sort((x, y) => y - x)).toEqual([30_000, 30_000, 30_000, 10_000, 0])
    expect((await ledger(p)).filter((r) => r.reason === 'chaos_crit').reduce((s, r) => s + r.amount, 0)).toBe(100_000)
  })

  it('pays nothing for an amount that is not a positive whole number, and claims no key for it', async () => {
    const p = await seedPlayer()
    for (const amount of [0, -5, 1.5, Number.NaN]) expect(await credit(p, amount, 'chaos_crit', 'bad')).toEqual({ credited: 0, capped: false })
    expect(await ledger(p)).toEqual([])
    expect(rowsOf(await db.execute(sql`select key from ledger_keys`))).toEqual([])
  })

  it('refuses a player who is not there, and a reason that is not a chaos credit, leaving the key free', async () => {
    await expect(credit('00000000-0000-4000-8000-0000000000ff', 100, 'chaos_crit', 'ghost')).rejects.toBeInstanceOf(UnknownPlayerError)
    await expect(credit('not-a-uuid', 100, 'chaos_crit', 'ghost')).rejects.toBeInstanceOf(UnknownPlayerError)
    const p = await seedPlayer()
    await rejects(credit(p, 100, 'gm_grant' as 'chaos_crit', 'wrong'), 'INVALID_CHAOS_REASON')
    expect(rowsOf(await db.execute(sql`select key from ledger_keys`))).toEqual([])
  })

  it('keeps the books: balances are untouched, the sources and the table transfers cancel, and the stack gain equals the sources', async () => {
    const [a, b] = [await seedPlayer(), await seedPlayer()]
    let paid = 0
    for (const [i, [who, amount, reason]] of ([[a, 30_000, 'chaos_crit'], [b, 80_000, 'chaos_fortune'], [a, 90_000, 'chaos_crit'], [b, 5_000, 'chaos_rescue'], [a, 2_000, 'chaos_rescue']] as const).entries()) {
      paid += (await credit(who, amount, reason, `k${String(i)}`)).credited
    }
    const [totals] = rowsOf<{ balances: string | number; ledger: string | number; sources: string | number; toTable: string | number }>(
      await db.execute(sql`select (select coalesce(sum(balance), 0) from players) as balances,
        (select coalesce(sum(amount), 0) from point_transactions) as ledger,
        (select coalesce(sum(amount), 0) from point_transactions where reason in ('chaos_rescue', 'chaos_crit', 'chaos_fortune')) as sources,
        (select coalesce(sum(amount), 0) from point_transactions where reason = 'chaos_to_table') as "toTable"`),
    )
    expect(Number(totals!.balances)).toBe(2 * BALANCE)
    expect(Number(totals!.ledger)).toBe(0)
    // Σ stacks gained (what the rooms add) = Σ source rows = −Σ chaos_to_table.
    expect(Number(totals!.sources)).toBe(paid)
    expect(Number(totals!.toTable)).toBe(-paid)
    // The second Bạo kích of the first player is cut to the cap (70 000 of 90 000), and the Cấp cứu after it finds none left.
    expect(paid).toBe(30_000 + 80_000 + 70_000 + 5_000 + 0)
  })
})
