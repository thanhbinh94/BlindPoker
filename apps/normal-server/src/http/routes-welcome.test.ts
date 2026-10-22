/**
 * The welcome gift over HTTP (Plan 27, spec §4 C1).
 *
 * `welcome-service.test.ts` holds the rules — once per account, the choice, the owned item, the newcomer day. What is
 * checked here is the translation: the session gate, the body shape refused before the service is asked, and each
 * refusal as a 409 carrying its code in the error envelope.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import type { WelcomeStatus } from '../economy/welcome-service.js'
import { buildTestApp, resetDb, XRW, type Account, type Harness } from '../test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const status = async (): Promise<WelcomeStatus> => {
  const res = await h.app.fastify.inject({ url: '/api/welcome', headers: { cookie: me.cookie } })
  expect(res.statusCode).toBe(200)
  return res.json() as WelcomeStatus
}

const claim = (payload: unknown) => h.app.fastify.inject({ method: 'POST', url: '/api/welcome/claim', headers: h.auth(me), payload: payload as Record<string, unknown> })

const errorCode = (res: { json: () => unknown }): unknown => (res.json() as { error?: { code?: unknown } }).error?.code

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

describe('the welcome routes', () => {
  it('GET /api/welcome needs a session and answers the shape', async () => {
    const anonymous = await h.app.fastify.inject({ url: '/api/welcome' })
    expect(anonymous.statusCode).toBe(401)

    const shape = await status()
    expect(shape.claimed).toBe(false)
    expect(shape.choices).toHaveLength(3)
    for (const choice of shape.choices) expect(choice).toEqual({ itemId: expect.any(String) as string, owned: false })
  })

  it('POST /api/welcome/claim grants the choice, worn, with the reputation', async () => {
    const [choice] = (await status()).choices
    const res = await claim({ itemId: choice!.itemId })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, itemId: choice!.itemId, reputation: 100, rank: 2, rankUp: true })

    const after = await status()
    expect(after.claimed).toBe(true)
    expect(after.choices.find((c) => c.itemId === choice!.itemId)?.owned).toBe(true)
    const inventory = await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: me.cookie } })
    expect(JSON.stringify(inventory.json())).toContain(choice!.itemId)
  })

  it('POST /api/welcome/claim refuses with 409 and the code, and a bad body with 400', async () => {
    const anonymous = await h.app.fastify.inject({ method: 'POST', url: '/api/welcome/claim', headers: XRW, payload: { itemId: null } })
    expect(anonymous.statusCode).toBe(401)

    for (const body of [{}, { itemId: 42 }, { itemId: '' }, { itemId: 'x'.repeat(101) }]) {
      const res = await claim(body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(errorCode(res), JSON.stringify(body)).toBe('INVALID_BODY')
    }

    const notAChoice = await claim({ itemId: 'head_crown_gold01' })
    expect(notAChoice.statusCode).toBe(409)
    expect(errorCode(notAChoice)).toBe('NOT_A_CHOICE')
    // Nothing is owned yet, so "reputation only" is not on offer either.
    const nothing = await claim({ itemId: null })
    expect(nothing.statusCode).toBe(409)
    expect(errorCode(nothing)).toBe('NOT_A_CHOICE')

    const [first, second] = (await status()).choices
    expect((await claim({ itemId: first!.itemId })).statusCode).toBe(200)
    const again = await claim({ itemId: second!.itemId })
    expect(again.statusCode).toBe(409)
    expect(errorCode(again)).toBe('WELCOME_CLAIMED')
  })

  it('POST /api/welcome/claim refuses an owned choice ALREADY_OWNED', async () => {
    const [choice] = (await status()).choices
    await db.transaction((tx) => h.app.services.inventory.grant(tx, me.playerId, choice!.itemId, 'test'))
    const res = await claim({ itemId: choice!.itemId })
    expect(res.statusCode).toBe(409)
    expect(errorCode(res)).toBe('ALREADY_OWNED')
  })
})
