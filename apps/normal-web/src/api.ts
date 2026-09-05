/**
 * The Normal REST client. It mirrors `apps/normal-server/src/http/*.ts` exactly — same paths, same headers,
 * same failure envelope (spec §19.2) — and knows nothing else: no retries, no caching, no state.
 *
 * The one difference from Lite's client is the whole point of this edition: **there is no token here**. The
 * session is a `HttpOnly` cookie the server set, which this code can neither read nor forge; every request
 * carries `credentials: 'same-origin'` and the browser attaches it. That is also why the WebSocket needs no
 * `HELLO` — the upgrade authenticates from the same cookie.
 */

/** The CSRF token the server demands on every mutating request; only fetch/XHR can set it. */
export const REQUESTED_WITH = 'bind-poker'

/** The code an `ApiError` carries when the request never reached the server at all. */
export const NETWORK_ERROR_CODE = 'NETWORK'

/** The code the server answers with when the session cookie is missing, expired or unknown. */
export const UNAUTHENTICATED_CODE = 'UNAUTHENTICATED'

/* ── catalogue and configuration (no session required) ─────────────────────── */

export type ItemCategory = 'base' | 'face' | 'clothing' | 'hair' | 'accessory' | 'jewelry' | 'title' | 'badge'
export type Rarity = 'common' | 'rare' | 'epic'

export interface ConfigDto {
  edition: string
  wsPath: string
  economy: {
    startingBalance: number
    blindWagerTiers: number[]
    holdemBlindTiers: { smallBlind: number; bigBlind: number }[]
    reliefThreshold: number
    reliefTarget: number
  }
  languages: string[]
  /** Normal-only (§22.5): how long a disconnected seat is held. */
  reconnectWindowSec: number
}

/** `apps/normal-server/src/inventory/items.ts` — the catalogue row, verbatim. */
export interface ItemDto {
  id: string
  category: ItemCategory
  rarity: Rarity
  /** An i18n key of the form `items.<id>`, resolved in the `normal` namespace. */
  nameKey: string
  /** `<category>/<id>` — which SVG layer the avatar renderer draws. */
  assetKey: string
  isDefault: boolean
}

export interface AchievementRewardDto {
  points?: number
  itemId?: string
}

export interface AchievementDefDto {
  id: string
  category: string
  metric: string
  threshold: number
  reward: AchievementRewardDto
}

/* ── identity ──────────────────────────────────────────────────────────────── */

/** `POST /api/auth/register`, `POST /api/auth/login` and `GET /api/auth/me` all answer with this. */
export interface AuthMeDto {
  playerId: string
  displayName: string
  balance: number
}

export interface AvatarConfigDto {
  base: string
  face: string
  clothing: string
  hair: string
  /** A hex colour applied to the hair layer, not an item id. */
  hairColor: string
  accessory?: string
  jewelry?: string
  title?: string
  badge?: string
}

/** One day of the monthly check-in schedule; the same 31 rows for every player. */
export interface CalendarEntryDto {
  day: number
  points: number
  /** A rarity label for the random tiers, an item id for day 28, `null` for a points-only day. */
  item: string | null
}

/** `GET /api/rewards/daily`, and the `daily` block of `GET /api/me`. */
export interface DailyStatusDto {
  claimable: boolean
  day: number
  streak: number
  reward: number
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  calendar: CalendarEntryDto[]
}

/** `POST /api/rewards/daily/claim`. The refusal is a 409 `ALREADY_CLAIMED` carrying `claimed: false`. */
export interface DailyClaimDto {
  claimed: true
  day: number
  points: number
  item: string | null
  items: string[]
  /** §13.2's substitute when a random tier had nothing unowned left; 0 otherwise. */
  fallbackPoints: number
  balance: number
  streak: number
}

export type ReliefRefusal = 'balance' | 'cooldown'

/** The `relief` block of `GET /api/me`. */
export interface ReliefStatusDto {
  eligible: boolean
  reason: ReliefRefusal | null
  retryAt: number | null
  threshold: number
  target: number
}

/** `POST /api/economy/relief`. The refusal is a 409 `NOT_ELIGIBLE` carrying `granted`, `reason` and `retryAt`. */
export interface ReliefDto {
  granted: true
  amount: number
  balance: number
}

/** `GET /api/me`: Lite's body field for field, plus the Normal-only additions. */
export interface MeDto {
  playerId: string
  displayName: string
  email: string | null
  balance: number
  avatar: AvatarConfigDto
  stats: { handsPlayed: number; handsWon: number }
  daily: DailyStatusDto
  relief: ReliefStatusDto
  createdAt: number
  lastLoginAt: number | null
}

/** `GET /api/me/stats` — all sixteen counters of §10.3. */
export interface PlayerStatsDto {
  handsPlayedHoldem: number
  handsWonHoldem: number
  handsPlayedBlind: number
  handsWonBlind: number
  botHands: number
  currentWinStreak: number
  bestWinStreak: number
  currentLoseStreak: number
  bestLoseStreak: number
  bestHandRank: number
  biggestWin: number
  roomsJoined: number
  gamesCompleted: number
  totalLoginDays: number
  loginStreak: number
  bestLoginStreak: number
}

export interface HistorySeatDto {
  /** The engine-side id the seat was recorded under: a player id for humans, a bot id for bots. */
  label: string
  seat: number
  isBot: boolean
  net: number
  won: boolean
}

/** `GET /api/me/history` — newest first. */
export interface HistoryEntryDto {
  handId: string
  roomId: string
  mode: string
  startedAt: number
  endedAt: number
  /** The reading player's own net for the hand. */
  net: number
  won: boolean
  /** A `HandCategory` ordinal (0 = high card … 9 = royal flush), or `null` when the hand never showed down. */
  bestCategory: number | null
  cancelled: boolean
  players: HistorySeatDto[]
}

/** One row of `GET /api/me/ledger`. `createdAt` is epoch milliseconds. */
export interface LedgerEntryDto {
  id: number
  amount: number
  reason: string
  refId: string | null
  createdAt: number
}

export interface LedgerPageDto {
  entries: LedgerEntryDto[]
  /** The cursor for the next page, or `null` at the end of the history. */
  nextBefore: number | null
}

/** One owned item, already joined against the catalogue by the server. */
export interface OwnedItemDto {
  itemId: string
  category: ItemCategory | null
  rarity: Rarity | null
  nameKey: string | null
  assetKey: string | null
  /** How it was acquired: `default`, `daily`, `achievement`. */
  source: string
  acquiredAt: number
}

export interface InventoryDto {
  items: OwnedItemDto[]
  avatar: AvatarConfigDto
}

/** `GET /api/players/:id/avatar` — what the table draws for the other seats. */
export interface PlayerAvatarDto {
  playerId: string
  displayName: string
  avatar: AvatarConfigDto
}

/** `GET /api/me/achievements`: definition and this player's progress in one row. */
export interface AchievementProgressDto {
  id: string
  category: string
  metric: string
  threshold: number
  reward: AchievementRewardDto
  progress: number
  /** Epoch milliseconds, or `null` while it is still locked. */
  unlockedAt: number | null
}

/**
 * Every REST failure, including the ones that never left the browser. `status` is `0` and `code` is
 * `NETWORK` when `fetch` itself rejected — the screens need to tell "the server said no" apart from
 * "there was no server".
 *
 * `extra` carries the fields the server puts *beside* the envelope rather than inside it —
 * `retryAfterSec`, `claimed`, `granted`, `reason`, `retryAt` — because a client that asked to claim
 * needs to know why it was told no, not merely that it was.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The one refusal every screen handles the same way: hand the session gate back to the sign-in page. */
  get unauthenticated(): boolean {
    return this.status === 401
  }

  /** Seconds to wait after a `RATE_LIMITED`, when the server said; `null` otherwise. */
  get retryAfterSec(): number | null {
    const value = this.extra.retryAfterSec
    return typeof value === 'number' ? value : null
  }
}

export interface NormalApi {
  config(): Promise<ConfigDto>
  catalogItems(): Promise<{ items: ItemDto[] }>
  catalogAchievements(): Promise<{ achievements: AchievementDefDto[] }>

  register(input: { email: string; password: string; displayName: string }): Promise<AuthMeDto>
  login(input: { email: string; password: string }): Promise<AuthMeDto>
  logout(): Promise<void>
  authMe(): Promise<AuthMeDto>

  me(): Promise<MeDto>
  rename(displayName: string): Promise<{ playerId: string; displayName: string }>

  stats(): Promise<PlayerStatsDto>
  history(limit?: number): Promise<HistoryEntryDto[]>
  ledger(opts?: { limit?: number; before?: number }): Promise<LedgerPageDto>

  inventory(): Promise<InventoryDto>
  setAvatar(config: AvatarConfigDto): Promise<{ config: AvatarConfigDto }>
  playerAvatar(playerId: string): Promise<PlayerAvatarDto>

  achievements(): Promise<AchievementProgressDto[]>

  daily(): Promise<DailyStatusDto>
  claimDaily(): Promise<DailyClaimDto>
  relief(): Promise<ReliefDto>
}

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  path: string
  body?: unknown
}

/** The side fields the server sets next to `error`, copied onto the `ApiError` as `extra`. */
const SIDE_FIELDS = ['retryAfterSec', 'claimed', 'granted', 'reason', 'retryAt'] as const

/**
 * A failure body is `{ error: { code, message } }` with the side fields beside it; anything else (a proxy's
 * HTML 502) falls back to the status.
 */
function failure(status: number, payload: unknown, call: Call): ApiError {
  const body = payload as Record<string, unknown> | null
  const error = (body?.error ?? null) as { code?: unknown; message?: unknown } | null
  const code = typeof error?.code === 'string' ? error.code : `HTTP_${status}`
  const message = typeof error?.message === 'string' ? error.message : `${call.method} ${call.path} failed with ${status}`
  const extra: Record<string, unknown> = {}
  for (const key of SIDE_FIELDS) if (body !== null && key in body) extra[key] = body[key]
  return new ApiError(status, code, message, extra)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

/** `?limit=20&before=41` — only the parameters that were actually given. */
function query(params: Record<string, number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}

export function createApi(fetchImpl?: typeof fetch, base = ''): NormalApi {
  const send = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))

  async function call<T>(spec: Call): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (spec.method !== 'GET') headers['x-requested-with'] = REQUESTED_WITH
    // The session is a cookie this code cannot read; `same-origin` is what puts it on the wire. It is not
    // `include`: the API is always served from this page's own origin, and `include` would additionally send
    // credentials to a cross-origin host if a base were ever misconfigured to one.
    const init: RequestInit = { method: spec.method, headers, credentials: 'same-origin' }
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(spec.body)
    }

    let res: Response
    try {
      res = await send(`${base}${spec.path}`, init)
    } catch (cause) {
      throw new ApiError(0, NETWORK_ERROR_CODE, cause instanceof Error ? cause.message : String(cause))
    }

    // 204 has no body at all; `readJson` already tolerates that, and the caller of a `void` route ignores it.
    const payload = await readJson(res)
    if (!res.ok) throw failure(res.status, payload, spec)
    return payload as T
  }

  return {
    config: () => call<ConfigDto>({ method: 'GET', path: '/api/config' }),
    catalogItems: () => call<{ items: ItemDto[] }>({ method: 'GET', path: '/api/catalog/items' }),
    catalogAchievements: () => call<{ achievements: AchievementDefDto[] }>({ method: 'GET', path: '/api/catalog/achievements' }),

    register: (input) => call<AuthMeDto>({ method: 'POST', path: '/api/auth/register', body: input }),
    login: (input) => call<AuthMeDto>({ method: 'POST', path: '/api/auth/login', body: input }),
    logout: async () => {
      await call<unknown>({ method: 'POST', path: '/api/auth/logout' })
    },
    authMe: () => call<AuthMeDto>({ method: 'GET', path: '/api/auth/me' }),

    me: () => call<MeDto>({ method: 'GET', path: '/api/me' }),
    rename: (displayName) => call<{ playerId: string; displayName: string }>({ method: 'PATCH', path: '/api/me', body: { displayName } }),

    stats: () => call<PlayerStatsDto>({ method: 'GET', path: '/api/me/stats' }),
    history: (limit) => call<HistoryEntryDto[]>({ method: 'GET', path: `/api/me/history${query({ limit })}` }),
    ledger: (opts) => call<LedgerPageDto>({ method: 'GET', path: `/api/me/ledger${query({ limit: opts?.limit, before: opts?.before })}` }),

    inventory: () => call<InventoryDto>({ method: 'GET', path: '/api/me/inventory' }),
    setAvatar: (config) => call<{ config: AvatarConfigDto }>({ method: 'PUT', path: '/api/me/avatar', body: config }),
    playerAvatar: (playerId) => call<PlayerAvatarDto>({ method: 'GET', path: `/api/players/${encodeURIComponent(playerId)}/avatar` }),

    achievements: () => call<AchievementProgressDto[]>({ method: 'GET', path: '/api/me/achievements' }),

    daily: () => call<DailyStatusDto>({ method: 'GET', path: '/api/rewards/daily' }),
    claimDaily: () => call<DailyClaimDto>({ method: 'POST', path: '/api/rewards/daily/claim' }),
    relief: () => call<ReliefDto>({ method: 'POST', path: '/api/economy/relief' }),
  }
}
