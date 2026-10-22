import { describe, expect, it, vi } from 'vitest'
import { ApiError, REQUESTED_WITH, createApi, type AvatarConfigDto } from './api.js'

/** A `Response` stand-in: jsdom has no fetch, so the tests never touch the real one. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
  } as unknown as Response
}

type Mock = ReturnType<typeof vi.fn>
const url = (mock: Mock): string => String(mock.mock.calls[0]?.[0])
const init = (mock: Mock): RequestInit => (mock.mock.calls[0]?.[1] ?? {}) as RequestInit
const headers = (mock: Mock): Record<string, string> => (init(mock).headers ?? {}) as Record<string, string>
const ok = (body: unknown = {}): Mock => vi.fn().mockResolvedValue(jsonResponse(200, body))
const apiOf = (mock: Mock, base?: string) => createApi(mock as unknown as typeof fetch, base)

const AVATAR: AvatarConfigDto = {
  v: 4,
  gender: 'f',
  hairStyle: 'hair_f_bob01',
  outfit: 'outfit_casual01',
  title: 'title_rookie',
}

describe('createApi — reads', () => {
  it.each([
    ['config', '/api/config'],
    ['catalogItems', '/api/catalog/items'],
    ['catalogAchievements', '/api/catalog/achievements'],
    ['avatarCatalog', '/api/catalog/avatar'],
    ['authMe', '/api/auth/me'],
    ['me', '/api/me'],
    ['stats', '/api/me/stats'],
    ['inventory', '/api/me/inventory'],
    ['achievements', '/api/me/achievements'],
    ['daily', '/api/rewards/daily'],
    ['outfits', '/api/me/outfits'],
  ])('GETs %s from %s with the session cookie and no CSRF header', async (method, path) => {
    const fetchImpl = ok({})
    await (apiOf(fetchImpl) as unknown as Record<string, () => Promise<unknown>>)[method]!()

    expect(url(fetchImpl)).toBe(path)
    expect(init(fetchImpl).method).toBe('GET')
    // The whole point of this edition: no Authorization header anywhere, the cookie does the work.
    expect(headers(fetchImpl).authorization).toBeUndefined()
    expect(init(fetchImpl).credentials).toBe('same-origin')
    expect(headers(fetchImpl)['x-requested-with']).toBeUndefined()
  })

  it('prefixes every path with the base', async () => {
    const fetchImpl = ok({})
    await apiOf(fetchImpl, 'http://127.0.0.1:8080').config()

    expect(url(fetchImpl)).toBe('http://127.0.0.1:8080/api/config')
  })

  it('asks for a bounded history and omits the parameter when none was given', async () => {
    const withLimit = ok([])
    await apiOf(withLimit).history(5)
    expect(url(withLimit)).toBe('/api/me/history?limit=5')

    const bare = ok([])
    await apiOf(bare).history()
    expect(url(bare)).toBe('/api/me/history')
  })

  it('pages the ledger on the cursor the previous page handed back', async () => {
    const page = ok({ entries: [], nextBefore: null })
    await apiOf(page).ledger({ limit: 50, before: 41 })
    expect(url(page)).toBe('/api/me/ledger?limit=50&before=41')

    const bare = ok({ entries: [], nextBefore: null })
    await apiOf(bare).ledger()
    expect(url(bare)).toBe('/api/me/ledger')
  })

  it('escapes a player id on its way into the avatar path', async () => {
    const fetchImpl = ok({})
    await apiOf(fetchImpl).playerAvatar('p 1/2')
    expect(url(fetchImpl)).toBe('/api/players/p%201%2F2/avatar')
  })

  it('reads an avatar through the browser cache by default', async () => {
    const fetchImpl = ok({})
    await apiOf(fetchImpl).playerAvatar('p1')
    // The route is `private, max-age=60`, and eight seat plates asking about each other is what that is for.
    expect(init(fetchImpl).cache).toBeUndefined()
  })

  it('bypasses the browser cache when the caller knows the answer changed', async () => {
    const fetchImpl = ok({})
    await apiOf(fetchImpl).playerAvatar('p1', { fresh: true })
    // Without this the re-read after `PUT /api/me/avatar` is served out of memory cache: the wardrobe shows
    // the face the player just replaced, for up to a minute. `reload`, not `no-store`: the fresh answer is written back,
    // so a reload or another screen inside that minute reads it too, not the stale one (a rank-up then F5, Plan 27).
    expect(init(fetchImpl).cache).toBe('reload')
  })
})

describe('createApi — writes', () => {
  it('POSTs a registration with the CSRF header and a JSON body', async () => {
    const dto = { playerId: 'p1', displayName: 'Bình', balance: 100_000 }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, dto))

    const me = await apiOf(fetchImpl).register({ email: 'a@b.com', password: 'hunter2hunter2', displayName: 'Bình' })

    expect(url(fetchImpl)).toBe('/api/auth/register')
    expect(init(fetchImpl).method).toBe('POST')
    expect(init(fetchImpl).credentials).toBe('same-origin')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(headers(fetchImpl)['content-type']).toBe('application/json')
    expect(init(fetchImpl).body).toBe(JSON.stringify({ email: 'a@b.com', password: 'hunter2hunter2', displayName: 'Bình' }))
    expect(me).toEqual(dto)
  })

  it('POSTs a sign-in', async () => {
    const fetchImpl = ok({ playerId: 'p1', displayName: 'Bình', balance: 10 })
    await apiOf(fetchImpl).login({ email: 'a@b.com', password: 'hunter2hunter2' })

    expect(url(fetchImpl)).toBe('/api/auth/login')
    expect(init(fetchImpl).body).toBe(JSON.stringify({ email: 'a@b.com', password: 'hunter2hunter2' }))
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('POSTs a sign-out and tolerates the empty 204 body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204))
    await expect(apiOf(fetchImpl).logout()).resolves.toBeUndefined()

    expect(url(fetchImpl)).toBe('/api/auth/logout')
    expect(init(fetchImpl).method).toBe('POST')
    expect(init(fetchImpl).body).toBeUndefined()
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('PATCHes a rename', async () => {
    const fetchImpl = ok({ playerId: 'p1', displayName: 'Bảo' })
    await apiOf(fetchImpl).rename('Bảo')

    expect(url(fetchImpl)).toBe('/api/me')
    expect(init(fetchImpl).method).toBe('PATCH')
    expect(init(fetchImpl).body).toBe(JSON.stringify({ displayName: 'Bảo' }))
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('PUTs the whole avatar config, because omitting a layer is how a title comes off', async () => {
    const fetchImpl = ok({ config: AVATAR })
    await apiOf(fetchImpl).setAvatar(AVATAR)

    expect(url(fetchImpl)).toBe('/api/me/avatar')
    expect(init(fetchImpl).method).toBe('PUT')
    expect(init(fetchImpl).body).toBe(JSON.stringify(AVATAR))
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it.each([
    ['claimDaily', '/api/rewards/daily/claim'],
    ['relief', '/api/economy/relief'],
  ])('POSTs %s with both headers and no body', async (method, path) => {
    const fetchImpl = ok({})
    await (apiOf(fetchImpl) as unknown as Record<string, () => Promise<unknown>>)[method]!()

    expect(url(fetchImpl)).toBe(path)
    expect(init(fetchImpl).method).toBe('POST')
    expect(init(fetchImpl).body).toBeUndefined()
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(init(fetchImpl).credentials).toBe('same-origin')
  })

  it('PUTs a name and a config into one outfit slot', async () => {
    const fetchImpl = ok({ slot: 2, name: 'Bộ 2', config: AVATAR, updatedAt: 0 })
    await apiOf(fetchImpl).saveOutfit(2, 'Bộ 2', AVATAR)

    expect(url(fetchImpl)).toBe('/api/me/outfits/2')
    expect(init(fetchImpl).method).toBe('PUT')
    expect(init(fetchImpl).body).toBe(JSON.stringify({ name: 'Bộ 2', config: AVATAR }))
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('DELETEs an outfit slot', async () => {
    const fetchImpl = ok({ removed: true })
    await apiOf(fetchImpl).deleteOutfit(3)

    expect(url(fetchImpl)).toBe('/api/me/outfits/3')
    expect(init(fetchImpl).method).toBe('DELETE')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('POSTs to apply a saved outfit slot', async () => {
    const fetchImpl = ok({ config: AVATAR })
    await apiOf(fetchImpl).applyOutfit(1)

    expect(url(fetchImpl)).toBe('/api/me/outfits/1/apply')
    expect(init(fetchImpl).method).toBe('POST')
    expect(init(fetchImpl).body).toBeUndefined()
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })
})

describe('createApi — failures', () => {
  it('turns an { error } body into an ApiError carrying status and code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: 'EMAIL_TAKEN', message: 'email in use' } }))

    const err = (await apiOf(fetchImpl)
      .register({ email: 'a@b.com', password: 'hunter2hunter2', displayName: 'Bình' })
      .catch((e: unknown) => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('EMAIL_TAKEN')
    expect(err.message).toBe('email in use')
    expect(err.extra).toEqual({})
  })

  it.each([
    [400, 'INVALID_EMAIL'],
    [400, 'INVALID_PASSWORD'],
    [400, 'INVALID_NAME'],
    [401, 'BAD_CREDENTIALS'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'DISPLAY_NAME_TAKEN'],
  ])('maps a %i response to code %s', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: code } }))

    const err = (await apiOf(fetchImpl)
      .me()
      .catch((e: unknown) => e)) as ApiError

    expect(err.status).toBe(status)
    expect(err.code).toBe(code)
    expect(err.unauthenticated).toBe(status === 401)
  })

  it('keeps retryAfterSec, which sits beside the envelope rather than inside it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'too many' }, retryAfterSec: 42 }))

    const err = (await apiOf(fetchImpl)
      .login({ email: 'a@b.com', password: 'hunter2hunter2' })
      .catch((e: unknown) => e)) as ApiError

    expect(err.code).toBe('RATE_LIMITED')
    expect(err.extra).toEqual({ retryAfterSec: 42 })
    expect(err.retryAfterSec).toBe(42)
  })

  it('keeps `claimed: false` on a refused daily claim', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: { code: 'ALREADY_CLAIMED', message: 'already' }, claimed: false }))

    const err = (await apiOf(fetchImpl)
      .claimDaily()
      .catch((e: unknown) => e)) as ApiError

    expect(err.code).toBe('ALREADY_CLAIMED')
    expect(err.extra).toEqual({ claimed: false })
  })

  it('keeps granted, reason and retryAt on a refused relief claim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'NOT_ELIGIBLE', message: 'cooldown' },
        granted: false,
        reason: 'cooldown',
        retryAt: 1_700_000_000_000,
      }),
    )

    const err = (await apiOf(fetchImpl)
      .relief()
      .catch((e: unknown) => e)) as ApiError

    expect(err.code).toBe('NOT_ELIGIBLE')
    expect(err.extra).toEqual({ granted: false, reason: 'cooldown', retryAt: 1_700_000_000_000 })
    expect(err.retryAfterSec).toBeNull()
  })

  it('falls back to an HTTP code when the failure body is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(502))

    const err = (await apiOf(fetchImpl)
      .config()
      .catch((e: unknown) => e)) as ApiError

    expect(err.status).toBe(502)
    expect(err.code).toBe('HTTP_502')
    expect(err.extra).toEqual({})
  })

  it('reports an unreachable server as ApiError NETWORK with status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    const err = (await apiOf(fetchImpl)
      .config()
      .catch((e: unknown) => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(err.code).toBe('NETWORK')
    expect(err.unauthenticated).toBe(false)
  })
})

describe('createApi — the GM routes', () => {
  const body = (mock: Mock): unknown => JSON.parse(String(init(mock).body))

  it('searches with a POST, the CSRF header and only the fields that were given', async () => {
    const fetchImpl = ok({ players: [], nextBefore: null })
    await apiOf(fetchImpl).gmSearch('x')

    expect(url(fetchImpl)).toBe('/api/gm/players/search')
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(body(fetchImpl)).toEqual({ q: 'x' })
  })

  it('sends the page size and the cursor of a search when it has them', async () => {
    const fetchImpl = ok({ players: [], nextBefore: null })
    await apiOf(fetchImpl).gmSearch('x', { limit: 20, before: 'p9' })

    expect(body(fetchImpl)).toEqual({ q: 'x', limit: 20, before: 'p9' })
  })

  it('moves points with the amount and the reason in the body', async () => {
    const fetchImpl = ok({ balance: 5, actionId: 1 })
    await apiOf(fetchImpl).gmPoints('p1', 12_000, 'thưởng')

    expect(url(fetchImpl)).toBe('/api/gm/players/p1/points')
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(body(fetchImpl)).toEqual({ amount: 12_000, reason: 'thưởng' })
  })

  it('reads the action log with only the filters that were given, newest page first', async () => {
    const fetchImpl = ok({ actions: [], nextBefore: null })
    await apiOf(fetchImpl).gmActions({ player: 'p1', before: 7 })

    expect(url(fetchImpl)).toBe('/api/gm/actions?player=p1&before=7')
    expect(init(fetchImpl).method).toBe('GET')
    expect(headers(fetchImpl)['x-requested-with']).toBeUndefined()
  })

  it('asks for the bare log when no filter is given', async () => {
    const fetchImpl = ok({ actions: [], nextBefore: null })
    await apiOf(fetchImpl).gmActions()

    expect(url(fetchImpl)).toBe('/api/gm/actions')
  })

  it.each([
    ['gmGrantItem', ['p1', 'head_crown', 'tặng'], '/api/gm/players/p1/items', { itemId: 'head_crown', reason: 'tặng' }],
    ['gmGrantWardrobe', ['p1', 'tặng'], '/api/gm/players/p1/items', { all: true, reason: 'tặng' }],
    ['gmLock', ['p1', 'gian lận'], '/api/gm/players/p1/lock', { reason: 'gian lận' }],
    ['gmUnlock', ['p1', 'nhầm'], '/api/gm/players/p1/unlock', { reason: 'nhầm' }],
    ['gmSetRole', ['p1', 'gm', 'tin cậy'], '/api/gm/players/p1/role', { role: 'gm', reason: 'tin cậy' }],
    ['gmUnlockAchievement', ['p1', 'login_days_7', 'thiếu thưởng'], '/api/gm/players/p1/achievements/login_days_7/unlock', { reason: 'thiếu thưởng' }],
    ['gmResetCheckin', ['p1', 'bấm nhầm'], '/api/gm/players/p1/checkin/reset', { reason: 'bấm nhầm' }],
    ['gmKick', ['r1', 'p2', 'ồn ào'], '/api/gm/rooms/r1/kick', { playerId: 'p2', reason: 'ồn ào' }],
    ['gmCloseRoom', ['r1', 'bảo trì'], '/api/gm/rooms/r1/close', { reason: 'bảo trì' }],
    ['gmGrantReputation', ['p1', 500, 'thưởng'], '/api/gm/players/p1/reputation', { amount: 500, reason: 'thưởng' }],
  ])('%s POSTs %s with the CSRF header', async (method, args, path, expected) => {
    const fetchImpl = ok({})
    await (apiOf(fetchImpl) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...(args as unknown[]))

    expect(url(fetchImpl)).toBe(path)
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(body(fetchImpl)).toEqual(expected)
  })

  it.each([
    ['gmOverview', [], '/api/gm/overview'],
    ['gmDailyStats', [30], '/api/gm/stats/daily?days=30'],
    ['gmPlayer', ['p 1'], '/api/gm/players/p%201'],
    ['gmPlayerLedger', ['p1', { limit: 50, before: 41 }], '/api/gm/players/p1/ledger?limit=50&before=41'],
    ['gmPlayerHistory', ['p1', 20], '/api/gm/players/p1/history?limit=20'],
    ['gmCheckin', ['p 1'], '/api/gm/players/p%201/checkin'],
    ['gmRooms', [], '/api/gm/rooms'],
    ['gmRoom', ['r1'], '/api/gm/rooms/r1'],
    ['gmShop', [], '/api/gm/shop'],
  ])('%s GETs %s with no CSRF header', async (method, args, path) => {
    const fetchImpl = ok({})
    await (apiOf(fetchImpl) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...(args as unknown[]))

    expect(url(fetchImpl)).toBe(path)
    expect(init(fetchImpl).method).toBe('GET')
    expect(headers(fetchImpl)['x-requested-with']).toBeUndefined()
  })

  it.each([
    ['gmSetShopPrices', [[{ itemId: 'outfit_dealer01', pricePoints: 1 }], 'giá'], '/api/gm/shop/prices', { changes: [{ itemId: 'outfit_dealer01', pricePoints: 1 }], reason: 'giá' }],
    ['gmSetShopFeatured', ['2026-W44', ['aura_ice01'], 'kệ'], '/api/gm/shop/featured/2026-W44', { itemIds: ['aura_ice01'], reason: 'kệ' }],
    ['gmSetWelcomeChoices', [['a', 'b', 'c'], 'quà'], '/api/gm/shop/welcome', { itemIds: ['a', 'b', 'c'], reason: 'quà' }],
    ['gmSetReputationRules', [{ daily_login: 15 }, 'nguồn'], '/api/gm/reputation/rules', { rules: { daily_login: 15 }, reason: 'nguồn' }],
    ['gmSetReputationRanks', [[{ rank: 1, threshold: 0 }], 'bậc'], '/api/gm/reputation/ranks', { ranks: [{ rank: 1, threshold: 0 }], reason: 'bậc' }],
  ])('%s PUTs %s with the CSRF header (Plan 27)', async (method, args, path, expected) => {
    const fetchImpl = ok({})
    await (apiOf(fetchImpl) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...(args as unknown[]))

    expect(url(fetchImpl)).toBe(path)
    expect(init(fetchImpl).method).toBe('PUT')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(body(fetchImpl)).toEqual(expected)
  })

  it('keeps the reason a locked account is refused with, beside the code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'ACCOUNT_LOCKED', message: 'locked' }, reason: 'gian lận' }))

    const err = (await apiOf(fetchImpl)
      .login({ email: 'a@b.c', password: 'x' })
      .catch((e: unknown) => e)) as ApiError

    expect(err.code).toBe('ACCOUNT_LOCKED')
    expect(err.extra).toEqual({ reason: 'gian lận' })
  })
})
