import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { SessionService } from './session-service.js'
import { createSessionService } from './session-service.js'

const SECRET = 'a'.repeat(32)
const HOUR = 3_600_000
const DAY = 86_400_000
const START = Date.UTC(2026, 8, 4, 3, 0)

let test: TestDb
let db: AppDb
let nowMs = START

const service = (opts: { secret?: string; ttlDays?: number; touchIntervalMs?: number } = {}): SessionService =>
  createSessionService(db, { secret: SECRET, ...opts, now: () => nowMs })

async function rows(): Promise<{ id: string; expiresAt: Date; lastSeenAt: Date; userAgent: string | null }[]> {
  return db.select({ id: sessions.id, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent }).from(sessions)
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(() => {
  nowMs = START
})
afterEach(async () => {
  await db.execute(sql`truncate table sessions, players, users restart identity cascade`)
})

/** One account per test: `sessions.user_id` is a foreign key, so there has to be something to point at. */
async function seedUser(): Promise<string> {
  const [row] = await db.insert(users).values({ email: 'binh@example.com', passwordHash: 'argon2' }).returning({ id: users.id })
  return row!.id
}

describe('create', () => {
  it('returns a base64url token and stores the keyed digest of it, never the token', async () => {
    const userId = await seedUser()
    const { token, expiresAt } = await service().create(userId, 'Firefox/1.0')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(expiresAt.getTime()).toBe(nowMs + 30 * DAY)

    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.id).toBe(createHmac('sha256', SECRET).update(token).digest('hex'))
    expect(stored[0]!.id).not.toBe(token)
    expect(stored[0]!.userAgent).toBe('Firefox/1.0')
  })

  it('gives two calls two different tokens, and truncates an absurd user agent', async () => {
    const userId = await seedUser()
    const svc = service()
    const a = await svc.create(userId, undefined)
    const b = await svc.create(userId, 'x'.repeat(1000))
    expect(a.token).not.toBe(b.token)
    const stored = await rows()
    expect(stored).toHaveLength(2)
    expect(stored.find((r) => r.userAgent === null)).toBeDefined()
    expect(stored.find((r) => r.userAgent?.length === 256)).toBeDefined()
  })

  it('honours a shorter ttl', async () => {
    const userId = await seedUser()
    const { expiresAt } = await service({ ttlDays: 1 }).create(userId, undefined)
    expect(expiresAt.getTime()).toBe(nowMs + DAY)
  })
})

describe('resolve', () => {
  it('returns the account and the stored id behind a live token', async () => {
    const userId = await seedUser()
    const svc = service()
    const { token } = await svc.create(userId, undefined)
    expect(await svc.resolve(token)).toEqual({ userId, sessionId: createHmac('sha256', SECRET).update(token).digest('hex') })
  })

  it('returns null for a token nobody issued, and for an empty one', async () => {
    const userId = await seedUser()
    const svc = service()
    await svc.create(userId, undefined)
    expect(await svc.resolve('made-up-token')).toBeNull()
    expect(await svc.resolve('')).toBeNull()
  })

  it('does not resolve a token issued under a different secret', async () => {
    const userId = await seedUser()
    const { token } = await service().create(userId, undefined)
    expect(await service({ secret: 'b'.repeat(32) }).resolve(token)).toBeNull()
  })

  it('refuses an expired session and deletes the row it just read', async () => {
    const userId = await seedUser()
    const svc = service({ ttlDays: 1 })
    const { token } = await svc.create(userId, undefined)
    nowMs += DAY
    expect(await svc.resolve(token)).toBeNull()
    expect(await rows()).toHaveLength(0)
  })
})

describe('sliding expiry', () => {
  it('extends a session that is used, at most once per touch interval', async () => {
    const userId = await seedUser()
    const svc = service({ touchIntervalMs: HOUR })
    const { token } = await svc.create(userId, undefined)
    const issued = (await rows())[0]!.expiresAt.getTime()

    // Inside the interval: a read, and nothing written.
    nowMs += HOUR - 1
    await svc.resolve(token)
    expect((await rows())[0]!.expiresAt.getTime()).toBe(issued)

    // Past it: the whole ttl, counted from now.
    nowMs += 1
    await svc.resolve(token)
    const extended = await rows()
    expect(extended[0]!.expiresAt.getTime()).toBe(nowMs + 30 * DAY)
    expect(extended[0]!.lastSeenAt.getTime()).toBe(nowMs)
  })

  it('keeps a session alive indefinitely while it is used, and lets an idle one die', async () => {
    const userId = await seedUser()
    const svc = service({ ttlDays: 30, touchIntervalMs: HOUR })
    const used = await svc.create(userId, undefined)
    const idle = await svc.create(userId, undefined)

    for (let i = 0; i < 10; i++) {
      nowMs += 20 * DAY
      expect(await svc.resolve(used.token)).not.toBeNull()
    }
    expect(await svc.resolve(idle.token)).toBeNull()
  })

  it('touch extends without a resolve', async () => {
    const userId = await seedUser()
    const svc = service()
    const { token } = await svc.create(userId, undefined)
    const sessionId = createHmac('sha256', SECRET).update(token).digest('hex')
    nowMs += DAY
    await svc.touch(sessionId)
    expect((await rows())[0]!.expiresAt.getTime()).toBe(nowMs + 30 * DAY)
  })
})

describe('revoke', () => {
  it('drops the one session behind a token and leaves the others', async () => {
    const userId = await seedUser()
    const svc = service()
    const a = await svc.create(userId, undefined)
    const b = await svc.create(userId, undefined)
    await svc.revoke(a.token)
    expect(await svc.resolve(a.token)).toBeNull()
    expect(await svc.resolve(b.token)).not.toBeNull()
  })

  it('is silent about a token that was never a session', async () => {
    await expect(service().revoke('never-issued')).resolves.toBeUndefined()
    await expect(service().revoke('')).resolves.toBeUndefined()
  })

  it('revokeAll drops every session of one account', async () => {
    const userId = await seedUser()
    const svc = service()
    const a = await svc.create(userId, undefined)
    const b = await svc.create(userId, undefined)
    await svc.revokeAll(userId)
    expect(await svc.resolve(a.token)).toBeNull()
    expect(await svc.resolve(b.token)).toBeNull()
    expect(await rows()).toHaveLength(0)
  })
})
