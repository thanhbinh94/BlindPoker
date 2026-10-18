import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rowsOf, type AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { UnknownAccountError } from '../inventory/grant-wardrobe.js'
import { buildTestApp, GOOD_ACCOUNT, resetDb, type Account, type Harness } from '../test-harness.js'
import { grantGm, LastGmError, LockedAccountError } from './grant-gm.js'

const SECOND_ACCOUNT = { email: 'boss@example.com', password: 'a boss password', displayName: 'Ông Chủ' }

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const roleOf = async (p: string) => rowsOf<{ role: string }>(await db.execute(sql`select role from users where id = ${p}`))[0]?.role
const logOf = async (p: string) =>
  rowsOf<{ action: string; actor_user_id: string | null; reason: string }>(
    await db.execute(sql`select action, actor_user_id, reason from gm_actions where target_player_id = ${p} order by id`),
  )

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  h = await buildTestApp(db)
  me = await h.register()
})
afterEach(async () => {
  await h.app.close()
  await resetDb(db)
})

describe('grantGm — the CLI behind grant-gm-cli', () => {
  it('promotes an account: role gm, one log row with no actor and the reason cli', async () => {
    const r = await grantGm(db, GOOD_ACCOUNT.email.toUpperCase())
    expect(r).toEqual({ playerId: me.playerId, displayName: GOOD_ACCOUNT.displayName, role: 'gm', changed: true })
    expect(await roleOf(me.playerId)).toBe('gm')
    expect(await logOf(me.playerId)).toEqual([{ action: 'promote', actor_user_id: null, reason: 'cli' }])
  })

  it('is idempotent: a second run changes nothing and writes no second log row', async () => {
    await grantGm(db, GOOD_ACCOUNT.email)
    const again = await grantGm(db, GOOD_ACCOUNT.email)
    expect(again).toMatchObject({ role: 'gm', changed: false })
    expect(await logOf(me.playerId)).toHaveLength(1)
  })

  it('--revoke demotes a gm when another gm remains, logged as demote', async () => {
    const other = await h.register(SECOND_ACCOUNT)
    await grantGm(db, GOOD_ACCOUNT.email)
    await grantGm(db, SECOND_ACCOUNT.email)
    const r = await grantGm(db, GOOD_ACCOUNT.email, { revoke: true })
    expect(r).toMatchObject({ role: 'player', changed: true })
    expect(await roleOf(me.playerId)).toBe('player')
    expect(await roleOf(other.playerId)).toBe('gm')
    expect((await logOf(me.playerId)).map((l) => l.action)).toEqual(['promote', 'demote'])
  })

  it('--revoke of a player is a no-op, and --revoke of the only gm throws LastGmError', async () => {
    expect(await grantGm(db, GOOD_ACCOUNT.email, { revoke: true })).toMatchObject({ role: 'player', changed: false })
    await grantGm(db, GOOD_ACCOUNT.email)
    await expect(grantGm(db, GOOD_ACCOUNT.email, { revoke: true })).rejects.toBeInstanceOf(LastGmError)
    expect(await roleOf(me.playerId)).toBe('gm')
    expect(await logOf(me.playerId)).toHaveLength(1)
  })

  it('--revoke, which locks the gm set before the target row, still refuses the last gm and still demotes one of two', async () => {
    const other = await h.register(SECOND_ACCOUNT)
    await grantGm(db, GOOD_ACCOUNT.email)
    await grantGm(db, SECOND_ACCOUNT.email)
    await grantGm(db, SECOND_ACCOUNT.email, { revoke: true })
    await expect(grantGm(db, GOOD_ACCOUNT.email, { revoke: true })).rejects.toBeInstanceOf(LastGmError)
    expect(await roleOf(me.playerId)).toBe('gm')
    expect(await roleOf(other.playerId)).toBe('player')
  })

  it('refuses to promote a locked account (LockedAccountError) and writes nothing', async () => {
    await db.execute(sql`update users set locked_at = now(), locked_reason = 'spam' where id = ${me.playerId}`)
    await expect(grantGm(db, GOOD_ACCOUNT.email)).rejects.toBeInstanceOf(LockedAccountError)
    expect(await roleOf(me.playerId)).toBe('player')
    expect(await logOf(me.playerId)).toEqual([])
  })

  it('refuses an email no account has', async () => {
    await expect(grantGm(db, 'nobody@example.com')).rejects.toBeInstanceOf(UnknownAccountError)
  })
})
