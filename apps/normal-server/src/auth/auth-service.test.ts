import { ECONOMY } from '@bp/core'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDb } from '../db/client.js'
import { dailyLogins, inventory, items, playerStats, pointTransactions, sessions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { NormalRepositories } from '../repos/index.js'
import { createRepositories } from '../repos/index.js'
import type { AuthService } from './auth-service.js'
import { AuthError, createAuthService } from './auth-service.js'
import { verifyPassword } from './password.js'
import type { SessionService } from './session-service.js'
import { createSessionService } from './session-service.js'

// The uniform-timing rule is a claim about *what the login path calls*, not about how long a test
// took: a stopwatch assertion on a CI runner would be flaky theatre. Wrapping `verifyPassword` —
// vitest hoists this above the imports — is how "the unknown address verified a password too"
// becomes something a test can actually see.
vi.mock('./password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./password.js')>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

/** 8 MiB, one pass: the production cost is pinned by `password.test.ts`, not paid for by every sign-up here. */
const CHEAP = { memoryCost: 8_192, timeCost: 1, parallelism: 1 }
const SECRET = 's'.repeat(32)
const START = Date.UTC(2026, 8, 4, 3, 0)
const DEFAULT_ITEMS = ['avatar_default', 'title_rookie']

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let sessionService: SessionService
let auth: AuthService
let nowMs = START
let logins: { playerId: string; at: number }[] = []
let defaults = DEFAULT_ITEMS

const GOOD = { email: 'Binh@Example.com ', password: 'a good password', displayName: 'Bình An' }

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
  sessionService = createSessionService(db, { secret: SECRET, now: () => nowMs })
  auth = createAuthService({
    db,
    repos,
    sessions: sessionService,
    catalog: { defaults: () => defaults },
    now: () => nowMs,
    argon2Params: CHEAP,
    onLogin: (playerId, at) => logins.push({ playerId, at }),
  })
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  nowMs = START
  logins = []
  defaults = DEFAULT_ITEMS
  vi.mocked(verifyPassword).mockClear()
  await db.insert(items).values(DEFAULT_ITEMS.map((id) => ({ id, category: 'avatar', rarity: 'common', nameKey: id, assetKey: id, isDefault: true })))
})
afterEach(async () => {
  await db.execute(sql`truncate table sessions, inventory, items, daily_logins, player_stats, point_transactions, players, users restart identity cascade`)
})

async function expectAuthError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AuthError)
  await promise.catch((err: unknown) => {
    expect((err as AuthError).code).toBe(code)
  })
}

describe('register', () => {
  it('builds the whole account in one go: user, profile, ledgered starting balance, stats, daily login, default items', async () => {
    const { userId, token, expiresAt } = await auth.register(GOOD)

    const [user] = await db.select().from(users)
    expect(user).toMatchObject({ id: userId, email: 'binh@example.com', lastLoginAt: null })
    expect(user!.passwordHash.startsWith('$argon2id$')).toBe(true)

    expect(await repos.players.findById(userId)).toEqual({ playerId: userId, displayName: 'Bình An', balance: ECONOMY.startingBalance })
    expect((await repos.players.findByIdFull(userId))!.avatarConfig).toEqual({})

    const ledger = await db.select().from(pointTransactions)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ playerId: userId, amount: ECONOMY.startingBalance, reason: 'starting_balance', refId: userId, kind: null })

    expect(await db.select().from(playerStats)).toHaveLength(1)
    expect(await db.select().from(dailyLogins)).toHaveLength(1)
    const owned = await db.select().from(inventory)
    expect(owned.map((r) => r.itemId).sort()).toEqual([...DEFAULT_ITEMS].sort())
    expect(owned.every((r) => r.source === 'default')).toBe(true)

    // And the caller is signed in.
    expect(expiresAt.getTime()).toBe(nowMs + 30 * 86_400_000)
    expect(await sessionService.resolve(token)).toEqual({ userId, sessionId: expect.any(String) })
  })

  it('stores the address lowercased and trimmed, and the name normalized', async () => {
    const { userId } = await auth.register({ ...GOOD, displayName: '  Bình   An  ' })
    const [user] = await db.select({ email: users.email }).from(users)
    expect(user!.email).toBe('binh@example.com')
    expect((await repos.players.findById(userId))!.displayName).toBe('Bình An')
  })

  it('works for an account with no default items to grant', async () => {
    defaults = []
    const { userId } = await auth.register(GOOD)
    expect(await db.select().from(inventory)).toEqual([])
    expect(await repos.balances.get(userId)).toBe(ECONOMY.startingBalance)
  })

  it('refuses an address that is not one', async () => {
    for (const email of ['', 'binh', 'binh@', '@example.com', 'binh@example', 'binh example@x.com', `${'a'.repeat(250)}@example.com`]) {
      await expectAuthError(auth.register({ ...GOOD, email }), 'INVALID_EMAIL')
    }
    expect(await db.select().from(users)).toEqual([])
  })

  it('refuses a password that is too short, too long, or its own address', async () => {
    await expectAuthError(auth.register({ ...GOOD, password: 'short12' }), 'INVALID_PASSWORD')
    await expectAuthError(auth.register({ ...GOOD, password: 'x'.repeat(129) }), 'INVALID_PASSWORD')
    await expectAuthError(auth.register({ ...GOOD, email: 'binhlathanh@example.com', password: 'binhlathanh' }), 'INVALID_PASSWORD')
    await expectAuthError(auth.register({ ...GOOD, email: 'binhlathanh@example.com', password: 'BinhLaThanh' }), 'INVALID_PASSWORD')
  })

  it('refuses a display name the shared validator refuses', async () => {
    await expectAuthError(auth.register({ ...GOOD, displayName: 'x' }), 'INVALID_NAME')
    await expectAuthError(auth.register({ ...GOOD, displayName: 'x'.repeat(21) }), 'INVALID_NAME')
    await expectAuthError(auth.register({ ...GOOD, displayName: 'Bình!' }), 'INVALID_NAME')
    await expectAuthError(auth.register({ ...GOOD, displayName: '_Bình' }), 'INVALID_NAME')
  })

  it('refuses a second account on the same address, whatever the casing', async () => {
    await auth.register(GOOD)
    await expectAuthError(auth.register({ ...GOOD, email: 'BINH@example.com', displayName: 'Someone Else' }), 'EMAIL_TAKEN')
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('refuses a display name another account already folds to', async () => {
    await auth.register(GOOD)
    await expectAuthError(auth.register({ ...GOOD, email: 'other@example.com', displayName: 'BÌNH AN' }), 'DISPLAY_NAME_TAKEN')
  })

  it('writes nothing at all when the second half of the account cannot be built', async () => {
    await auth.register(GOOD)
    await expectAuthError(auth.register({ ...GOOD, email: 'other@example.com', displayName: 'Bình An' }), 'DISPLAY_NAME_TAKEN')

    // The users insert succeeded before the players insert refused: the transaction has to have
    // taken it back with it, or the address is now unusable by anyone including its owner.
    expect(await db.select().from(users).where(eq(users.email, 'other@example.com'))).toEqual([])
    expect(await db.select().from(pointTransactions)).toHaveLength(1)
    expect(await db.select().from(sessions)).toHaveLength(1)
  })
})

describe('register: an unexpected database fault', () => {
  it('never lets the driver error out, because its message carries the address and the password hash', async () => {
    // A default item that is not in `items`: a foreign-key violation on the last insert of the
    // transaction, which is exactly the class of fault that used to reach the log verbatim.
    defaults = ['no_such_item']

    let thrown: unknown
    await auth.register(GOOD).catch((err: unknown) => {
      thrown = err
    })
    expect(thrown).toBeInstanceOf(Error)

    const err = thrown as Error & { cause?: unknown; sqlstate?: string; constraint?: string }
    const everything = `${String(err)} ${err.stack ?? ''} ${JSON.stringify(err)}`
    expect(everything).not.toContain('binh@example.com')
    expect(everything).not.toContain('$argon2id$')
    expect(err.message).toContain('register failed')
    expect(err.sqlstate).toBe('23503')
    expect(err.cause).toBeUndefined()

    // And the transaction took the half-built account back with it.
    expect(await db.select().from(users)).toEqual([])
    expect(await db.select().from(pointTransactions)).toEqual([])
  })

  it('still answers the two collisions it understands', async () => {
    await auth.register(GOOD)
    await expectAuthError(auth.register({ ...GOOD, displayName: 'Someone Else' }), 'EMAIL_TAKEN')
  })
})

describe('login', () => {
  it('signs in and stamps last_login_at', async () => {
    const registered = await auth.register(GOOD)
    nowMs += 60_000
    const { userId, token } = await auth.login({ email: 'BINH@example.com ', password: GOOD.password })
    expect(userId).toBe(registered.userId)
    expect(token).not.toBe(registered.token)
    const [user] = await db.select({ lastLoginAt: users.lastLoginAt }).from(users)
    expect(user!.lastLoginAt!.getTime()).toBe(nowMs)
    expect(await sessionService.resolve(token)).toMatchObject({ userId })
  })

  it('rotates: the session presented is revoked and a new one issued, even for the same account', async () => {
    const registered = await auth.register(GOOD)
    const { token } = await auth.login({ email: GOOD.email, password: GOOD.password, currentToken: registered.token })
    expect(await sessionService.resolve(registered.token)).toBeNull()
    expect(await sessionService.resolve(token)).not.toBeNull()
    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it('leaves other sessions of the same account alone', async () => {
    const first = await auth.register(GOOD)
    const second = await auth.login({ email: GOOD.email, password: GOOD.password })
    expect(await sessionService.resolve(first.token)).not.toBeNull()
    expect(await sessionService.resolve(second.token)).not.toBeNull()
  })

  it('calls the onLogin hook with the player and the moment, only on success', async () => {
    const { userId } = await auth.register(GOOD)
    expect(logins).toEqual([])
    nowMs += 1_000
    await auth.login({ email: GOOD.email, password: GOOD.password })
    expect(logins).toEqual([{ playerId: userId, at: nowMs }])
    await expectAuthError(auth.login({ email: GOOD.email, password: 'wrong password' }), 'BAD_CREDENTIALS')
    expect(logins).toHaveLength(1)
  })

  it('answers a wrong password and an unknown address identically, and verifies a hash in both cases', async () => {
    await auth.register(GOOD)
    vi.mocked(verifyPassword).mockClear()

    await expectAuthError(auth.login({ email: GOOD.email, password: 'wrong password' }), 'BAD_CREDENTIALS')
    const afterWrongPassword = vi.mocked(verifyPassword).mock.calls.length
    expect(afterWrongPassword).toBe(1)

    await expectAuthError(auth.login({ email: 'nobody@example.com', password: 'wrong password' }), 'BAD_CREDENTIALS')
    const dummyCall = vi.mocked(verifyPassword).mock.calls[1]!
    expect(vi.mocked(verifyPassword).mock.calls).toHaveLength(2)
    // Against a real argon2id hash, not a shortcut, and not against the password itself.
    expect(dummyCall[0].startsWith('$argon2id$')).toBe(true)
    expect(dummyCall[1]).toBe('wrong password')

    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it('does not sign in an address that is not even an address, but still without leaking that', async () => {
    await expectAuthError(auth.login({ email: 'not-an-address', password: 'a good password' }), 'BAD_CREDENTIALS')
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1)
  })
})

describe('logout', () => {
  it('revokes the session behind the token and nothing else', async () => {
    const first = await auth.register(GOOD)
    const second = await auth.login({ email: GOOD.email, password: GOOD.password })
    await auth.logout(first.token)
    expect(await sessionService.resolve(first.token)).toBeNull()
    expect(await sessionService.resolve(second.token)).not.toBeNull()
  })

  it('is silent about a token that is not a session', async () => {
    await expect(auth.logout('never-issued')).resolves.toBeUndefined()
    await expect(auth.logout('')).resolves.toBeUndefined()
  })
})

describe('identityForToken', () => {
  it('returns the identity the game loop is written against', async () => {
    const { userId, token } = await auth.register(GOOD)
    expect(await auth.identityForToken(token)).toEqual({ playerId: userId, displayName: 'Bình An', isBot: false })
  })

  it('returns null for an unknown, revoked or expired token', async () => {
    const { token } = await auth.register(GOOD)
    expect(await auth.identityForToken('made-up')).toBeNull()
    await auth.logout(token)
    expect(await auth.identityForToken(token)).toBeNull()
  })

  it('returns null when the session names an account with no player profile', async () => {
    const [user] = await db.insert(users).values({ email: 'orphan@example.com', passwordHash: 'argon2' }).returning({ id: users.id })
    const { token } = await sessionService.create(user!.id, undefined)
    expect(await auth.identityForToken(token)).toBeNull()
  })
})
