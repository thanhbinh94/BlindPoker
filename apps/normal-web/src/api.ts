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

/**
 * The slots an item can occupy — `apps/normal-server/src/inventory/slots.ts`, verbatim (design §5.1).
 * Plan 11 replaces the 3D figure with a base plus PNG layers: `hair`/`top`/`bottom`/`shoes` are gone
 * (a body is a fixed `base`, chosen rather than dressed piece by piece), `hat`/`accessory`/`jewelry`
 * become `head`/`face`/`aura`, and `frame` (the profile border) is new. `title` and `badge` are
 * unchanged: text beside a name, nothing to draw.
 *
 * 2026-09-24 (Plan 13): `hairColor` and `eyeColor` are two more optional slots. Unlike every other
 * one they draw nothing of their own — recolouring the base's own hair or eye pixels is not a PNG
 * layer — but a colour is still an item, which is what buys it validation, ownership and a place in
 * the daily draw for free (`apps/normal-server/src/inventory/slots.ts`, verbatim).
 */
export type ItemSlot = 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'hairColor' | 'eyeColor' | 'title' | 'badge'

/**
 * A fixed figure a chibi is drawn on — chosen, never owned (design §4.2, §5.1).
 *
 * 2026-09-17: an open id, matching the server's (`apps/normal-server/src/inventory/slots.ts`). The list
 * of bases is `data/avatar-bases.json` and reaches the client through `/api/catalog/avatar`, so the
 * wardrobe renders a tile per `BaseDto` it is given and never checks an id against a union of its own.
 */
export type BaseId = string

/** The one slot every configuration must fill; a figure with no outfit is not a figure. */
export const REQUIRED_SLOTS = ['outfit'] as const

/** Everything else may be left empty: six cosmetic slots and the two name decorations. */
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge'] as const

/** The two colour slots (design §3.1, §5.2) — every id in either one names a `colour` item, not a layer. */
export const COLOUR_SLOTS = ['hairColor', 'eyeColor'] as const

/** The slots drawn as a PNG layer — exactly the items that carry `asset` (`title`/`badge` are words). */
export const DRAWN_SLOTS = ['head', 'face', 'outfit', 'aura', 'frame'] as const

/** The slots a daily-reward draw may land on (§13.2, design §5.2): `outfit` is drawable but chosen
 * deliberately, not handed out alongside a hat or an aura. `hairColor`/`eyeColor` are here even
 * though they draw nothing — a rare colour is exactly as much a prize as a rare hat. */
export const DAILY_DRAW_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor'] as const

/** Every slot, in the order a configuration lists them: the one required slot, then the rest. */
export const SLOTS: readonly ItemSlot[] = [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]

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

/** One PNG layer, shared by every base (design §3, §4.4) — `apps/normal-server/src/inventory/items.ts`'s
 * `AssetRef`, verbatim. */
export interface AssetRefDto {
  layer: number
  /** A name in the avatar manifest's `files`, without the `@1x`/`@2x` density suffix. */
  file: string
  /** The layer to draw instead of `file` on a base of that `wear` — one item, one id, two cuts
   * (2026-09-20). A wear with no entry wears `file`. */
  variants?: Record<string, string>
  /** A head that hides the base's hair layers. */
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  /** Whether this layer falls inside the 208×208 avatar crop the portrait is cut from. */
  fitsAvatarCrop: boolean
  /** A colour variant (design §3.3): draw `file`, then tint the `<file>_tintmask` region with this hex.
   *  The original item this varies has no `tint` at all — only its variants do. */
  tint?: string
  /** `masks.tint.meanL` off the manifest entry for `file`, copied in at load time (design §5.2). */
  tintMeanL?: number
}

/** `apps/normal-server/src/inventory/items.ts` — the catalogue row, verbatim. */
export interface ItemDto {
  id: string
  slot: ItemSlot
  rarity: Rarity
  /** An i18n key of the form `items.<id>`, resolved in the `normal` namespace. */
  nameKey: string
  /** `<slot>/<id>` — a stable identifier for the item; the drawable file itself is `asset.file`. */
  assetKey: string
  isDefault: boolean
  /** The PNG layer to draw. Present for `DRAWN_SLOTS`, absent for `title` and `badge`. */
  asset?: AssetRefDto
  /** The hex a `hairColor`/`eyeColor` item paints with (design §3.2). Present there, absent elsewhere. */
  colour?: string
  /** Owned by every player without an `inventory` row (design §3.2); `/api/me/inventory` reports it with
   *  `source: "free"`. */
  free?: true
}

/** The rig every chibi is drawn on (design §5.1) — `apps/normal-server/src/inventory/bases.ts`'s
 * `BaseDef`, verbatim. */
export interface BaseDto {
  id: string
  nameKey: string
  /** The body this base wears its clothes on, `f` or `m`: which cut of `AssetRefDto.variants` it draws. */
  wear: string
  layers: { hairBack: string; body: string; hairFront: string }
  /** One face per expression (`neutral`, `happy`, `sad`, `surprised`, `closed`, `sleep`). */
  faces: Record<string, string>
  /** Where this base can be recoloured (design §4.1, §5.2), absent until the pipeline has cut masks
   *  for it. `files` are the layer file stems that carry a non-empty mask for that region; `meanL` is
   *  the whole base's reference lightness for it, shared by every layer so no seam shows. */
  tint?: { hair?: { meanL: number; files: string[] }; eyes?: { meanL: number; files: string[] } }
}

/** `GET /api/catalog/avatar`: the frame, crop and both bases — public, like `/api/catalog/items`, because a
 * base is chosen rather than owned and the wardrobe needs it before it needs a session. */
export interface AvatarCatalogDto {
  frame: { w: number; h: number }
  crop: { x: number; y: number; size: number }
  bases: BaseDto[]
  manifestVersion: number
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

/**
 * One player's figure — `AvatarConfigV3` on the server, and the avatar cache's whole key (design §5.1).
 *
 * `v` is stored and sent so a future shape can tell itself apart from this one; the server refuses a
 * `PUT` that does not carry it. A figure is a fixed `base` plus whatever is equipped: `outfit` is the
 * one slot that must be filled, everything else is an optional PNG layer or a word.
 */
export interface AvatarConfigDto {
  v: 3
  /** Chosen, not owned. */
  base: BaseId
  outfit: string
  head?: string
  face?: string
  aura?: string
  frame?: string
  /** Item ids, not hex — `chibiFromApi` resolves them through the catalogue (design §5.2). */
  hairColor?: string
  eyeColor?: string
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
  /**
   * The account that sat here, or `null` for a bot (and for a human whose account has since been deleted).
   * This is the join key — filtering the reader's own seat out of a hand compares *this*, never `label`,
   * which two accounts may legitimately share and which the reader may even share with an opponent.
   */
  playerId: string | null
  /** What to print: the account's display name for a human, the engine-side id for a bot. */
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
  /** The item's current id — a legacy row is resolved through the server's alias map before this is set. */
  itemId: string
  /** The id this row was actually acquired under; equal to `itemId` unless that id has since been renamed. */
  acquiredAs: string
  slot: ItemSlot | null
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

/** One saved outfit slot (design §5.3) — `apps/normal-server/src/inventory/outfits-service.ts`'s row. */
export interface OutfitDto {
  slot: number
  name: string
  config: AvatarConfigDto
  updatedAt: number
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
  /** The rig every chibi is drawn on: the frame, the avatar crop and both bases (design §5.1). */
  avatarCatalog(): Promise<AvatarCatalogDto>

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
  /**
   * `fresh` bypasses the browser's HTTP cache for this one request.
   *
   * The server answers this route `Cache-Control: private, max-age=60`, which is right for eight seat plates
   * asking about each other — and wrong for the one moment a client *knows* the answer changed: right after
   * `PUT /api/me/avatar`. Without it the re-fetch is served from memory cache and the wardrobe shows the face
   * the player just replaced, for up to a minute.
   */
  playerAvatar(playerId: string, opts?: { fresh?: boolean }): Promise<PlayerAvatarDto>

  achievements(): Promise<AchievementProgressDto[]>

  daily(): Promise<DailyStatusDto>
  claimDaily(): Promise<DailyClaimDto>
  relief(): Promise<ReliefDto>

  /** The five saved-outfit slots (design §5.3); a `null` entry is an empty slot. */
  outfits(): Promise<{ outfits: (OutfitDto | null)[] }>
  /** Saves the current draft into one slot, replacing whatever was there. */
  saveOutfit(slot: number, name: string, config: AvatarConfigDto): Promise<OutfitDto>
  deleteOutfit(slot: number): Promise<{ removed: boolean }>
  /** Wears a saved outfit — the server's answer is the config now equipped, mirroring `setAvatar`'s reply. */
  applyOutfit(slot: number): Promise<{ config: AvatarConfigDto }>
}

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  /** Set only where a stale answer would be wrong rather than merely old; see `playerAvatar`. */
  cache?: RequestCache
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
    if (spec.cache !== undefined) init.cache = spec.cache
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
    avatarCatalog: () => call<AvatarCatalogDto>({ method: 'GET', path: '/api/catalog/avatar' }),

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
    playerAvatar: (playerId, opts) =>
      call<PlayerAvatarDto>({
        method: 'GET',
        path: `/api/players/${encodeURIComponent(playerId)}/avatar`,
        // `no-store` rather than `reload`: the answer this request exists to replace is already known wrong,
        // so there is nothing worth writing back into the cache either.
        ...(opts?.fresh === true ? { cache: 'no-store' as const } : {}),
      }),

    achievements: () => call<AchievementProgressDto[]>({ method: 'GET', path: '/api/me/achievements' }),

    daily: () => call<DailyStatusDto>({ method: 'GET', path: '/api/rewards/daily' }),
    claimDaily: () => call<DailyClaimDto>({ method: 'POST', path: '/api/rewards/daily/claim' }),
    relief: () => call<ReliefDto>({ method: 'POST', path: '/api/economy/relief' }),

    outfits: () => call<{ outfits: (OutfitDto | null)[] }>({ method: 'GET', path: '/api/me/outfits' }),
    saveOutfit: (slot, name, config) =>
      call<OutfitDto>({ method: 'PUT', path: `/api/me/outfits/${slot}`, body: { name, config } }),
    deleteOutfit: (slot) => call<{ removed: boolean }>({ method: 'DELETE', path: `/api/me/outfits/${slot}` }),
    applyOutfit: (slot) => call<{ config: AvatarConfigDto }>({ method: 'POST', path: `/api/me/outfits/${slot}/apply` }),
  }
}
