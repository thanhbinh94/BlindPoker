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
 * one they draw nothing of their own — recolouring the body's own hair or eye pixels is not a PNG
 * layer — but a colour is still an item, which is what buys it validation, ownership and a place in
 * the daily draw for free (`apps/normal-server/src/inventory/slots.ts`, verbatim).
 *
 * 2026-10-03 (Plan 19, avatar v4): the fixed base is gone. A figure is a body per **gender**, chosen
 * rather than owned, wearing a `hairStyle` item — two layers, L20 behind the body and L60 in front of
 * the face — and recoloured by a third colour, `skinColor`. `hairStyle` is required of every figure but
 * validated on its own rather than through `REQUIRED_SLOTS` (the server's `HAIR_SLOT`): that list means
 * "exactly one `isDefault` item", and a hairstyle's default depends on the gender.
 */
export type ItemSlot = 'hairStyle' | 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'hairColor' | 'eyeColor' | 'skinColor' | 'title' | 'badge'

/** Which body a figure is drawn on (spec §4.3), and which cut of a gendered outfit it wears. */
export type Gender = 'f' | 'm'

/** Required of every figure, but not one of `REQUIRED_SLOTS` (see `ItemSlot`). */
export const HAIR_SLOT = 'hairStyle' as const

/** The one slot with exactly one `isDefault` item; a figure with no outfit is not a figure. */
export const REQUIRED_SLOTS = ['outfit'] as const

/** Everything else may be left empty: four cosmetic slots, three colours and the two name decorations. */
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'skinColor', 'title', 'badge'] as const

/** The three colour slots (design §3.1, §5.2; spec §4.2) — every id in one names a `colour` item, not a layer. */
export const COLOUR_SLOTS = ['hairColor', 'eyeColor', 'skinColor'] as const

/** The slots drawn as a PNG layer — exactly the items that carry `asset` (`title`/`badge` are words). */
export const DRAWN_SLOTS = ['hairStyle', 'head', 'face', 'outfit', 'aura', 'frame'] as const

/** The slots a daily-reward draw may land on (§13.2, design §5.2): `outfit` is drawable but chosen
 * deliberately, not handed out alongside a hat or an aura. `hairColor`/`eyeColor` are here even
 * though they draw nothing — a rare colour is exactly as much a prize as a rare hat. A hairstyle and a
 * skin colour never are: a look is chosen, not handed out (spec §4.2). */
export const DAILY_DRAW_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor'] as const

/** Every slot, in the order a configuration lists them: the hairstyle, the outfit, then the rest. */
export const SLOTS: readonly ItemSlot[] = [HAIR_SLOT, ...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]

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

/** One recolourable region across a set of layers (design §4.1, §5.2): the layer files whose mask of that kind is
 * non-empty, and the one reference lightness each is tinted against — `apps/normal-server/src/inventory/bodies.ts`'s
 * `MaskSet`, verbatim. */
export interface MaskSetDto {
  meanL: number
  files: string[]
}

/** One PNG layer, shared by every body (design §3, §4.4) — `apps/normal-server/src/inventory/items.ts`'s
 * `AssetRef`, verbatim. */
export interface AssetRefDto {
  layer: number
  /** A name in the avatar manifest's `files`, without the `@1x`/`@2x` density suffix. For a hairstyle, its front
   * half (L60), drawn in front of the face. */
  file: string
  /** The layer to draw instead of `file` on a body of that gender — one item, one id, two cuts (2026-09-20; it was
   * keyed by a base's `wear` until Plan 19). A gender with no entry wears `file`. Never on a hairstyle. */
  variants?: Record<string, string>
  /** A hairstyle's back half (`item_hair_<code>_L20`), drawn behind the body. Only on `hairStyle`. */
  back?: string
  /** Where a hairstyle can be recoloured by `hairColor`: `[back, file]` filtered to the layers with a hair mask, at
   * the hairstyle's own reference lightness. Absent until the pipeline has cut one. Only on `hairStyle`. */
  hairTint?: MaskSetDto
  /** A head that hides the hairstyle's front (L60) or back (L20) half. */
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  /** A head that covers the crown (2026-10-06): both hair layers are drawn through its `<file>_hairclipmask`. */
  clipsHair?: boolean
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
  /** The hex a `hairColor`/`eyeColor`/`skinColor` item paints with (design §3.2). Present there, absent elsewhere. */
  colour?: string
  /** Owned by every player without an `inventory` row (design §3.2); `/api/me/inventory` reports it with
   *  `source: "free"`. */
  free?: true
  /** The body a hairstyle is drawn for. Present on `hairStyle`, absent elsewhere. */
  gender?: Gender
  /** The hairstyle of the other gender a gender swap changes this one to. Present on `hairStyle`, absent elsewhere. */
  counterpart?: string
  /** The colour this hairstyle is drawn in, a lowercase hex. Present on `hairStyle`, absent elsewhere. Nothing here
   * draws it: the Màu tóc tab's "Tự nhiên" swatch is the half-and-half mark (only Màu da's is filled, `NATURAL_SKIN`). */
  naturalColour?: string
}

/** The body a figure of one gender is drawn on (spec §4.3) — `apps/normal-server/src/inventory/bodies.ts`'s
 * `BodyDef`, verbatim. Chosen, never owned: bald, the skin in its "cream" tone, the hair an item of its own. */
export interface BodyDto {
  gender: Gender
  /** `body_<g>_L30`. */
  body: string
  /** `body_<g>_face_<expression>_L50`, one per expression (`neutral`, `happy`, `sad`, `surprised`, `closed`, `sleep`). */
  faces: Record<string, string>
  /** The iris colour the faces were drawn with, a lowercase `#rrggbb`. */
  naturalEyeColour: string
  /** Where this body can be recoloured — skin by `skinColor`, eyes by `eyeColor` — derived from the manifest's masks,
   * absent until the pipeline has cut them. */
  tint?: { skin?: MaskSetDto; skinLine?: MaskSetDto; layerSkin?: MaskSetDto; eyes?: MaskSetDto }
}

/** `GET /api/catalog/avatar`: the frame, the crop and the two bodies, `f` then `m` — public, like
 * `/api/catalog/items`, because a body is chosen rather than owned and the wardrobe needs it before it needs a
 * session. */
export interface AvatarCatalogDto {
  frame: { w: number; h: number }
  crop: { x: number; y: number; size: number }
  bodies: BodyDto[]
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

/** What an account may do beyond playing (spec 2026-10-18): a `gm` gets the console behind `#/gm`. */
export type Role = 'player' | 'gm'

/** `POST /api/auth/register`, `POST /api/auth/login` and `GET /api/auth/me` all answer with this. */
export interface AuthMeDto {
  playerId: string
  displayName: string
  balance: number
  role: Role
}

/**
 * One player's figure — `AvatarConfigV4` on the server, and the avatar cache's whole key (spec
 * `2026-10-03-avatar-v4-design.md` §4.1).
 *
 * `v` is stored and sent so a future shape can tell itself apart from this one; the server refuses a
 * `PUT` that is not v4 (`MISSING_LAYER`). A figure is a `gender` — which body it is drawn on, chosen
 * rather than owned — plus items: a `hairStyle` of that gender and an `outfit`, both required, and
 * everything else an optional PNG layer, a colour or a word. Every read answers v4: the server repairs an
 * older stored config on the way out without rewriting it.
 */
export interface AvatarConfigDto {
  v: 4
  /** Chosen, not owned. */
  gender: Gender
  /** A `hairStyle` item whose own `gender` is this one (`WRONG_GENDER` otherwise). */
  hairStyle: string
  outfit: string
  head?: string
  face?: string
  aura?: string
  frame?: string
  /** Item ids, not hex — `chibiFromApi` resolves them through the catalogue (design §5.2). */
  hairColor?: string
  eyeColor?: string
  skinColor?: string
  title?: string
  badge?: string
}

/** One day of a month's check-in schedule; the same 31 rows for every player (spec 2026-10-12 §4.3). */
export interface CalendarEntryDto {
  day: number
  points: number
  /** A rarity label for a draw day, the first item id for a fixed day, `null` for a points-only day. */
  item: string | null
  /** Every item a fixed day grants, in the schedule's order — what the calendar names; empty on any other day. */
  items: string[]
}

/** `GET /api/rewards/daily`, and the `daily` block of `GET /api/me`. */
export interface DailyStatusDto {
  claimable: boolean
  day: number
  /** The month's claim count (Plan 27 Part G), not a run of consecutive days: a missed day keeps it. */
  streak: number
  reward: number
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  /** `YYYY-MM` in the server's economy timezone: the month `calendar` describes. */
  month: string
  calendar: CalendarEntryDto[]
  /** Plan 27 C2: the newcomer calendar while it runs; absent with no welcome claim, once finished, and from an older server. */
  newcomer?: NewcomerStatusDto
}

/** `apps/normal-server/src/economy/economy-service.ts`'s `NewcomerStatus`, verbatim. */
export interface NewcomerStatusDto {
  /** The newcomer day today's claim is (or was) for: in `claimedDays` means already counted today, otherwise the one today's claim reaches. */
  day: number
  /** The newcomer days (1–7) already counted, ascending; day 1 is the welcome claim. */
  claimedDays: number[]
  /** Always false while reported: a finished calendar is left out. */
  finished: boolean
  /** What day 7 pays now (`rules.newcomer_day7`); absent from a server older than the Plan 27 fix wave. */
  day7Reputation?: number
}

/** `NewcomerClaim`: what a check-in added to the newcomer calendar, present only when it advanced it. */
export interface NewcomerClaimDto {
  /** The newcomer day reached, 2–7. */
  day: number
  /** The item day 3 or day 7 handed out, or null. */
  item: string | null
  /** The substitute when day 3 or day 7 had nothing unowned left; 0 otherwise. Already in `balance`. */
  fallbackPoints: number
  /** Reputation day 7 added; 0 on other days. */
  reputation: number
  /** True when this claim completed day 7. */
  finished: boolean
}

/**
 * An item the check-in schedule names, at its first tier and month from this month on (spec 2026-10-12 §4.4) —
 * `apps/normal-server/src/economy/daily-gifts.ts`'s `DailyGiftNotice`, verbatim.
 */
export interface DailyGiftNoticeDto {
  itemId: string
  /** The streak tier whose claim grants it, 1–31. */
  day: number
  /** `YYYY-MM` of the first month, this one or later, that names it; `null` for a gift of every month (the default). */
  month: string | null
}

/** `GET /api/catalog/items`. `dailyGifts` is absent from a server older than Plan 22: read it as none. */
export interface CatalogItemsDto {
  items: ItemDto[]
  dailyGifts?: DailyGiftNoticeDto[]
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
  /** The month's claim count after this claim (Plan 27 Part G), not a run of consecutive days. */
  streak: number
  /** Plan 27 C2: present only when this claim advanced the newcomer calendar. */
  newcomer?: NewcomerClaimDto
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
  role: Role
  avatar: AvatarConfigDto
  stats: { handsPlayed: number; handsWon: number }
  daily: DailyStatusDto
  relief: ReliefStatusDto
  createdAt: number
  lastLoginAt: number | null
  /** Plan 27: lifetime reputation — only ever grows, never points (spec 2026-10-21 §2 A1). */
  reputation: number
  /** Plan 27: the highest rank 1..5 reached — a high-water mark, so it may sit above what `ranks` gives today (R15). */
  rank: number
  /** Plan 27: the ladder, ascending by rank, for the profile's "còn N tới <next>" bar. */
  ranks: RankThresholdDto[]
}

/** One step of the reputation ladder (`reputation_ranks`). */
export interface RankThresholdDto {
  rank: number
  threshold: number
}

/**
 * Plan 27: why an item is not for sale, in the server's precedence order (spec 2026-10-21 §3 B1) — the source label a
 * shop card shows in place of "Mua".
 */
export type ShopLockDto =
  | { kind: 'achievement'; achievementId: string }
  | { kind: 'gift_month'; month: string }
  | { kind: 'gift_default' }
  | { kind: 'free' }
  | { kind: 'default' }
  | { kind: 'disabled' }
  | { kind: 'unpriced' }

/** One catalogue item as the shop sees it, for the player asking. */
export interface ShopEntryDto {
  itemId: string
  slot: ItemSlot
  rarity: Rarity
  /** Points; 0 for an `unpriced` item, which is locked, not free. */
  price: number
  /** The rank 1..5 the item needs, judged against `me.rank` (the high-water mark). */
  minRank: number
  /** `lock === null && !owned` — rank and balance are for the client to show and the server to judge. */
  purchasable: boolean
  owned: boolean
  lock: ShopLockDto | null
}

/** `GET /api/shop`: every catalogue item, the week's shelf (≤ 6 ids) and the player's standing. */
export interface ShopViewDto {
  /** ISO week in the economy's zone, `YYYY-Www`. */
  weekKey: string
  featured: string[]
  /** `gm` when a GM arranged this week's shelf, `auto` for the server's weekly rotation. */
  featuredSource: 'gm' | 'auto'
  entries: ShopEntryDto[]
  me: { balance: number; reputation: number; rank: number; ranks: RankThresholdDto[] }
}

/** `POST /api/shop/buy`: the balance after the purchase; `repeated` when this `purchaseId` had already bought it. */
export interface BuyResultDto {
  balance: number
  itemId: string
  repeated: boolean
}

/** `GET /api/welcome`: whether the welcome gift is taken, and its three choices with which ones the player owns. */
export interface WelcomeStatusDto {
  claimed: boolean
  choices: { itemId: string; owned: boolean }[]
  /** What the gift's reputation is now (`rules.welcome`); absent from a server older than the Plan 27 fix wave. */
  reputation?: number
}

/** `POST /api/welcome/claim`: the item granted and worn (`null` for reputation only), and the standing after it. */
export interface WelcomeClaimDto {
  ok: true
  itemId: string | null
  reputation: number
  rank: number
  rankUp: boolean
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

/** One card a chaos hand used: the seat that held it, the card's id, and how it ended (`applied`, `blocked`, `reflected` or `fizzled`). */
export interface HistoryChaosUseDto {
  seat: number
  cardId: string
  outcome: string
}

export interface HistorySeatDto {
  /**
   * The account that sat here, or `null` for a bot (and for a human whose account has since been deleted).
   * This is the join key — filtering the reader's own seat out of a hand compares *this*, never `label`,
   * which two accounts may legitimately share and which the reader may even share with an opponent.
   */
  playerId: string | null
  /** What to print: the account's display name for a human, "Bot n" for a bot (the server reads it back from the engine id). */
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
  /** What the table was called when the hand was dealt; `null` for a hand stored without a name. */
  roomName: string | null
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
  /**
   * Plan 37: the chaos cards this hand used ("Thẻ đã dùng"). Absent for a hand that used none, and for every hand of a
   * table without chaos.
   */
  chaosUsed?: HistoryChaosUseDto[]
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
  /** Plan 27: the player's rank 1..5, shown beside the name on their seat. Absent from a server older than Plan 27. */
  rank?: number
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

/* ── the game master's console (`apps/normal-server/src/http/routes-gm.ts`) ─────────────────── */

/** One row of a player search: the address is masked, because a list is read over a shoulder. */
export interface GmPlayerSummaryDto {
  playerId: string
  displayName: string
  emailMasked: string
  role: Role
  locked: boolean
  balance: number
  createdAt: number
  lastLoginAt: number | null
}

/** `GET /api/gm/players/:id`: the whole account, the address unmasked. */
export interface GmPlayerDetailDto {
  playerId: string
  displayName: string
  email: string
  role: Role
  locked: { at: number; reason: string } | null
  balance: number
  createdAt: number
  lastLoginAt: number | null
  stats: PlayerStatsDto
  room: { roomId: string; code: string; name: string; seat: number | null } | null
  inventoryCount: number
  /** Ids of every achievement this player has unlocked, so the GM's picker can disable them. */
  unlockedAchievementIds: string[]
  /** Plan 27: the reputation total, and the rank 1..5 reached (the high-water mark). */
  reputation: number
  rank: number
}

/** One catalogue item in the GM's price table (`GET /api/gm/shop`): its stored row, or the rarity's seed when it has none. */
export interface GmShopPriceRowDto {
  itemId: string
  slot: ItemSlot
  rarity: Rarity
  /** False for an item with no price row yet ("chưa định giá"). */
  priced: boolean
  pricePoints: number
  minRank: number
  enabled: boolean
  salePrice: number | null
  /** Why the item does not sell now, as the shop judges it; `null` when it does. */
  lock: ShopLockDto | null
}

/** `GET /api/gm/shop`: what the Cửa hàng tab edits. */
export interface GmShopConfigDto {
  prices: GmShopPriceRowDto[]
  /** The current ISO week and the eight after it: the GM's shelf (`gm`), or the rotation the week falls back to (`auto`). */
  featured: { weekKey: string; itemIds: string[]; source: 'gm' | 'auto' }[]
  welcomeChoices: string[]
  /** The slots a welcome choice may come from. */
  welcomeSlots: ItemSlot[]
  reputation: { rules: Record<string, number>; ranks: RankThresholdDto[] }
}

/** One edit of a price row: the item, and only the fields that change. */
export interface GmPriceChangeDto {
  itemId: string
  pricePoints?: number
  minRank?: number
  enabled?: boolean
}

export type ChaosTierDto = 'silver' | 'gold' | 'diamond'

/** The chaos settings (Plan 37): what the Thẻ hỗn loạn tab edits in its last block. */
export interface ChaosConfigDto {
  tierWeights: Record<ChaosTierDto, number>
  pointsThreshold: number
  draftMs: number
  dailyCapPoints: number
  dailyRescues: number
}

/** One catalogue card on the Thẻ hỗn loạn tab: the file's facts, the GM's rule if any, and whether it is drawn now. */
export interface GmChaosCardDto {
  id: string
  tier: ChaosTierDto
  /** The card's family (`swap`, `luck`, `debuff` …): a label key, not a sentence. */
  family: string
  effect: string
  modes: string[]
  /** What the file says; applies with no rule, or outside the rule's window. */
  fileEnabled: boolean
  /** A rule's times are epoch ms of an economy-day start; `null` is open. */
  rule: { enabled: boolean; weight: number; startsAt: number | null; endsAt: number | null } | null
  activeNow: boolean
}

/** `GET /api/gm/chaos`. */
export interface GmChaosDto {
  cards: GmChaosCardDto[]
  config: ChaosConfigDto
}

/** One edit of a card's rule: the whole rule, or `clear: true` to hand the card back to the file. */
export type GmChaosRuleChangeDto =
  | { cardId: string; enabled: boolean; weight: number; startsAt: number | null; endsAt: number | null }
  | { cardId: string; clear: true }

/** A room as the console lists it — `GET /api/gm/rooms` rows and `GET /api/gm/rooms/:id` alike. */
export interface GmRoomDto {
  roomId: string
  code: string
  name: string
  mode: 'holdem' | 'blind'
  status: 'OPEN' | 'IN_GAME'
  isPrivate: boolean
  hasPassword: boolean
  players: number
  maxPlayers: number
  hostPlayerId: string
  hostDisplayName: string
  carryOverPot: number
  handInProgress: boolean
  createdAt: number
  members: { playerId: string; displayName: string; isBot: boolean; seat: number | null; stack: number; connected: boolean }[]
}

/** One line of the append-only log; `actor` is `null` for an action taken from the server's own command line. */
export interface GmActionDto {
  id: number
  at: number
  actor: { userId: string; displayName: string } | null
  action: string
  target: { playerId: string; displayName: string } | null
  roomId: string | null
  amount: number | null
  itemId: string | null
  reason: string
  details: Record<string, unknown> | null
}

export interface GmOverviewDto {
  online: number
  rooms: number
  accounts: number
  locked: number
  gms: number
  /** The last 24 hours of the ledger: what came into the economy, what left it, and the same by reason. */
  points24h: { sources: number; sinks: number; byReason: { reason: string; total: number }[] }
  /** Plan 27: Σ reputation, and how many accounts stand at each rank (index 0 is rank 1). */
  reputation: { total: number; byRank: number[] }
}

/** One economy day of the ledger: sources signed per reason, sinks positive per reason, and what is left (`net`). */
export interface DaySumsDto {
  day: string
  sources: Record<string, number>
  sinks: Record<string, number>
  net: number
}

/** What a grant of items answers: the ids that were new, and how many the player already had. */
export interface GmGrantDto {
  granted: string[]
  alreadyOwned: number
}

/** `GET /api/gm/players/:id/checkin`: what today's check-in gave. `day` is the stored streak tier, meaningful only when `claimedToday`. */
export interface GmCheckinDto {
  claimedToday: boolean
  day: number
  streak: number
  points: number
  itemIds: string[]
}

/** What unlocking an achievement for a player answers: the reward paid through the same path as earning it. */
export interface GmUnlockDto {
  actionId: number
  reward: { points?: number; itemId?: string }
  balance: number
}

/** What reopening today's check-in took back. */
export interface GmResetCheckinDto {
  actionId: number
  undone: { points: number; itemIds: string[] }
  balance: number
}

/** One day's check-in rule in a gift schedule: a random draw of a rarity, or a fixed list of items. */
export type GiftRuleDto = { draw: 'common' | 'rare' } | { fixed: string[] }

/** One month of the gift schedule as `GET /api/gm/gifts` lists it; `days` holds only that month's own rules. */
export interface GiftMonthDto {
  /** `YYYY-MM`. */
  month: string
  /** The rules this month sets, keyed by streak day ("7", "28"…); a day not named here falls back to the default. */
  days: Record<string, GiftRuleDto>
  /** `db` when a game master edited it, `file` when it comes from `daily-gifts.json`. */
  source: 'file' | 'db'
  updatedAt: number | null
  updatedBy: string | null
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
  catalogItems(): Promise<CatalogItemsDto>
  catalogAchievements(): Promise<{ achievements: AchievementDefDto[] }>
  /** The rig every chibi is drawn on: the frame, the avatar crop and the two bodies (spec §4.3). */
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

  /** Plan 27: the shop's shelves, locks and the player's standing. */
  shop(): Promise<ShopViewDto>
  /**
   * Buys one item for points. `purchaseId` is a fresh lower-case UUID per press of "Mua" (`crypto.randomUUID()`), and
   * the *same* one on a retry: the server charges once per id and answers a repeat `repeated: true`. A malformed id is
   * `400 BAD_REQUEST`. A refusal rejects with an `ApiError` whose `status` is 409 and whose `code` is `SHOP_DISABLED`,
   * `RANK_TOO_LOW`, `ALREADY_OWNED`, `INSUFFICIENT_POINTS` or `PURCHASE_UNDONE` (read from the `{ error: { code } }` envelope by `failure`;
   * there are no side fields), or 404 `UNKNOWN_ITEM`.
   */
  shopBuy(itemId: string, purchaseId: string): Promise<BuyResultDto>
  /** Plan 27: the welcome gift's state — the lobby opens the dialog while `claimed` is false. */
  welcome(): Promise<WelcomeStatusDto>
  /**
   * Takes the welcome gift: one unowned choice, granted and worn at once, with the `welcome` reputation; `null` only
   * when every choice is already owned (reputation alone). A refusal rejects with an `ApiError` of status 409 and
   * code `WELCOME_CLAIMED`, `NOT_A_CHOICE` or `ALREADY_OWNED`; a malformed body is 400 `BAD_REQUEST`.
   */
  welcomeClaim(itemId: string | null): Promise<WelcomeClaimDto>

  /** The five saved-outfit slots (design §5.3); a `null` entry is an empty slot. */
  outfits(): Promise<{ outfits: (OutfitDto | null)[] }>
  /** Saves the current draft into one slot, replacing whatever was there. */
  saveOutfit(slot: number, name: string, config: AvatarConfigDto): Promise<OutfitDto>
  deleteOutfit(slot: number): Promise<{ removed: boolean }>
  /** Wears a saved outfit — the server's answer is the config now equipped, mirroring `setAvatar`'s reply. */
  applyOutfit(slot: number): Promise<{ config: AvatarConfigDto }>

  /* The game master's console. Every call below is refused `403 FORBIDDEN` to a player: the server is the gate, and
   * this client does not pretend otherwise. Every POST carries the GM's reason, which the server validates and logs. */
  gmOverview(): Promise<GmOverviewDto>
  /** The ledger per economy day, oldest first: exactly `days` entries ending today. */
  gmDailyStats(days: 7 | 30): Promise<DaySumsDto[]>
  /** A POST, not a GET, on purpose: a search string in a URL ends up in logs and in history. Metered as a write. */
  gmSearch(q: string, opts?: { limit?: number; before?: string }): Promise<{ players: GmPlayerSummaryDto[]; nextBefore: string | null }>
  gmPlayer(playerId: string): Promise<GmPlayerDetailDto>
  gmPlayerLedger(playerId: string, opts?: { limit?: number; before?: number }): Promise<LedgerPageDto>
  gmPlayerHistory(playerId: string, limit?: number): Promise<HistoryEntryDto[]>
  /** A positive amount credits, a negative one debits; the server logs it as `grant_points` or `adjust_points`. */
  gmPoints(playerId: string, amount: number, reason: string): Promise<{ balance: number; actionId: number }>
  gmGrantItem(playerId: string, itemId: string, reason: string): Promise<GmGrantDto>
  gmGrantWardrobe(playerId: string, reason: string): Promise<GmGrantDto>
  /** Unlocks one achievement with its full reward; refused `ALREADY_UNLOCKED` when the player has it. */
  gmUnlockAchievement(playerId: string, achievementId: string, reason: string): Promise<GmUnlockDto>
  /** A read-only preview of today's check-in, so the console can say what a reset would take back. */
  gmCheckin(playerId: string): Promise<GmCheckinDto>
  /** Undoes today's check-in (points and items) so the player can claim again; refused `NOT_CLAIMED_TODAY` otherwise. */
  gmResetCheckin(playerId: string, reason: string): Promise<GmResetCheckinDto>
  /** The default schedule and one row per month from this one on (a month's own rules, and where they came from). */
  gmGifts(): Promise<{ default: Record<string, GiftRuleDto>; months: GiftMonthDto[] }>
  /** Replaces the month's own rules; refused `TIER_LOCKED` for a day already past this month, `INVALID_GIFTS` for a bad list. */
  gmSetGiftMonth(month: string, days: Record<string, GiftRuleDto>, reason: string): Promise<{ actionId: number }>
  /** Drops the month's edits back to the default; refused `NOTHING_TO_CLEAR` when it has none. */
  gmClearGiftMonth(month: string, reason: string): Promise<{ actionId: number }>
  gmLock(playerId: string, reason: string): Promise<{ locked: true }>
  gmUnlock(playerId: string, reason: string): Promise<{ locked: false }>
  gmSetRole(playerId: string, role: Role, reason: string): Promise<{ role: Role }>
  gmRooms(): Promise<{ rooms: GmRoomDto[] }>
  gmRoom(roomId: string): Promise<GmRoomDto>
  gmKick(roomId: string, playerId: string, reason: string): Promise<{ effective: 'now' | 'after_hand' }>
  gmCloseRoom(roomId: string, reason: string): Promise<{ closed: true; refunded: number }>
  gmActions(opts?: { limit?: number; before?: number; player?: string; room?: string }): Promise<{ actions: GmActionDto[]; nextBefore: number | null }>
  /** Plan 27: the price table, nine weeks of shelves, the welcome choices and reputation's rules and ranks. */
  gmShop(): Promise<GmShopConfigDto>
  /** Edits price rows (only the fields given); refused `INVALID_PRICES` for a bad row. */
  gmSetShopPrices(changes: GmPriceChangeDto[], reason: string): Promise<{ actionId: number; changed: number }>
  /** Sets a week's shelf (≤ 6 items); `[]` hands the week back to the rotation. */
  gmSetShopFeatured(weekKey: string, itemIds: string[], reason: string): Promise<{ actionId: number }>
  /** Sets the three welcome choices. */
  gmSetWelcomeChoices(itemIds: string[], reason: string): Promise<{ actionId: number }>
  gmSetReputationRules(rules: Record<string, number>, reason: string): Promise<{ actionId: number }>
  /** Replaces the ladder; refused `INVALID_RANKS` unless rank 1 is 0 and the thresholds rise. */
  gmSetReputationRanks(ranks: RankThresholdDto[], reason: string): Promise<{ actionId: number }>
  /** Adds 1..100 000 reputation; there is no call that takes it away. */
  gmGrantReputation(playerId: string, amount: number, reason: string): Promise<{ actionId: number; reputation: number; rank: number }>
  /** Plan 37: the 47 chaos cards with their rules, and the chaos settings. */
  gmChaos(): Promise<GmChaosDto>
  /** Writes the changed cards' rules under one reason; refused `INVALID_CHAOS_RULES` (e.g. a tier left under three cards). */
  gmSetChaosRules(changes: GmChaosRuleChangeDto[], reason: string): Promise<{ actionId: number; changed: number }>
  /** Replaces the chaos settings; refused `INVALID_CHAOS_CONFIG` for a number out of range. */
  gmSetChaosConfig(config: ChaosConfigDto, reason: string): Promise<{ actionId: number }>
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
function query(params: Record<string, number | string | undefined>): string {
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
    catalogItems: () => call<CatalogItemsDto>({ method: 'GET', path: '/api/catalog/items' }),
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
        // `reload` rather than `no-store`: past the browser's cache to the server, and the fresh answer written back
        // over the stale one, so a reload or another screen inside the `max-age` reads it too (Plan 27: a rank-up,
        // then F5, seated the old rank while `no-store` left the stale entry in place).
        ...(opts?.fresh === true ? { cache: 'reload' as const } : {}),
      }),

    achievements: () => call<AchievementProgressDto[]>({ method: 'GET', path: '/api/me/achievements' }),

    daily: () => call<DailyStatusDto>({ method: 'GET', path: '/api/rewards/daily' }),
    claimDaily: () => call<DailyClaimDto>({ method: 'POST', path: '/api/rewards/daily/claim' }),
    relief: () => call<ReliefDto>({ method: 'POST', path: '/api/economy/relief' }),

    shop: () => call<ShopViewDto>({ method: 'GET', path: '/api/shop' }),
    shopBuy: (itemId, purchaseId) => call<BuyResultDto>({ method: 'POST', path: '/api/shop/buy', body: { itemId, purchaseId } }),
    welcome: () => call<WelcomeStatusDto>({ method: 'GET', path: '/api/welcome' }),
    welcomeClaim: (itemId) => call<WelcomeClaimDto>({ method: 'POST', path: '/api/welcome/claim', body: { itemId } }),

    outfits: () => call<{ outfits: (OutfitDto | null)[] }>({ method: 'GET', path: '/api/me/outfits' }),
    saveOutfit: (slot, name, config) =>
      call<OutfitDto>({ method: 'PUT', path: `/api/me/outfits/${slot}`, body: { name, config } }),
    deleteOutfit: (slot) => call<{ removed: boolean }>({ method: 'DELETE', path: `/api/me/outfits/${slot}` }),
    applyOutfit: (slot) => call<{ config: AvatarConfigDto }>({ method: 'POST', path: `/api/me/outfits/${slot}/apply` }),

    gmOverview: () => call<GmOverviewDto>({ method: 'GET', path: '/api/gm/overview' }),
    gmDailyStats: (days) => call<DaySumsDto[]>({ method: 'GET', path: `/api/gm/stats/daily?days=${days}` }),
    gmSearch: (q, opts) =>
      call<{ players: GmPlayerSummaryDto[]; nextBefore: string | null }>({
        method: 'POST',
        path: '/api/gm/players/search',
        body: { q, ...(opts?.limit === undefined ? {} : { limit: opts.limit }), ...(opts?.before === undefined ? {} : { before: opts.before }) },
      }),
    gmPlayer: (playerId) => call<GmPlayerDetailDto>({ method: 'GET', path: `/api/gm/players/${encodeURIComponent(playerId)}` }),
    gmPlayerLedger: (playerId, opts) =>
      call<LedgerPageDto>({
        method: 'GET',
        path: `/api/gm/players/${encodeURIComponent(playerId)}/ledger${query({ limit: opts?.limit, before: opts?.before })}`,
      }),
    gmPlayerHistory: (playerId, limit) =>
      call<HistoryEntryDto[]>({ method: 'GET', path: `/api/gm/players/${encodeURIComponent(playerId)}/history${query({ limit })}` }),
    gmPoints: (playerId, amount, reason) =>
      call<{ balance: number; actionId: number }>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/points`, body: { amount, reason } }),
    gmGrantItem: (playerId, itemId, reason) =>
      call<GmGrantDto>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/items`, body: { itemId, reason } }),
    gmGrantWardrobe: (playerId, reason) =>
      call<GmGrantDto>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/items`, body: { all: true, reason } }),
    gmUnlockAchievement: (playerId, achievementId, reason) =>
      call<GmUnlockDto>({
        method: 'POST',
        path: `/api/gm/players/${encodeURIComponent(playerId)}/achievements/${encodeURIComponent(achievementId)}/unlock`,
        body: { reason },
      }),
    gmCheckin: (playerId) => call<GmCheckinDto>({ method: 'GET', path: `/api/gm/players/${encodeURIComponent(playerId)}/checkin` }),
    gmResetCheckin: (playerId, reason) =>
      call<GmResetCheckinDto>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/checkin/reset`, body: { reason } }),
    gmGifts: () => call<{ default: Record<string, GiftRuleDto>; months: GiftMonthDto[] }>({ method: 'GET', path: '/api/gm/gifts' }),
    gmSetGiftMonth: (month, days, reason) =>
      call<{ actionId: number }>({ method: 'PUT', path: `/api/gm/gifts/${encodeURIComponent(month)}`, body: { days, reason } }),
    gmClearGiftMonth: (month, reason) =>
      call<{ actionId: number }>({ method: 'DELETE', path: `/api/gm/gifts/${encodeURIComponent(month)}`, body: { reason } }),
    gmLock: (playerId, reason) => call<{ locked: true }>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/lock`, body: { reason } }),
    gmUnlock: (playerId, reason) => call<{ locked: false }>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/unlock`, body: { reason } }),
    gmSetRole: (playerId, role, reason) =>
      call<{ role: Role }>({ method: 'POST', path: `/api/gm/players/${encodeURIComponent(playerId)}/role`, body: { role, reason } }),
    gmRooms: () => call<{ rooms: GmRoomDto[] }>({ method: 'GET', path: '/api/gm/rooms' }),
    gmRoom: (roomId) => call<GmRoomDto>({ method: 'GET', path: `/api/gm/rooms/${encodeURIComponent(roomId)}` }),
    gmKick: (roomId, playerId, reason) =>
      call<{ effective: 'now' | 'after_hand' }>({ method: 'POST', path: `/api/gm/rooms/${encodeURIComponent(roomId)}/kick`, body: { playerId, reason } }),
    gmCloseRoom: (roomId, reason) =>
      call<{ closed: true; refunded: number }>({ method: 'POST', path: `/api/gm/rooms/${encodeURIComponent(roomId)}/close`, body: { reason } }),
    gmActions: (opts) =>
      call<{ actions: GmActionDto[]; nextBefore: number | null }>({
        method: 'GET',
        path: `/api/gm/actions${query({ player: opts?.player, room: opts?.room, limit: opts?.limit, before: opts?.before })}`,
      }),
    gmShop: () => call<GmShopConfigDto>({ method: 'GET', path: '/api/gm/shop' }),
    gmSetShopPrices: (changes, reason) =>
      call<{ actionId: number; changed: number }>({ method: 'PUT', path: '/api/gm/shop/prices', body: { changes, reason } }),
    gmSetShopFeatured: (weekKey, itemIds, reason) =>
      call<{ actionId: number }>({ method: 'PUT', path: `/api/gm/shop/featured/${encodeURIComponent(weekKey)}`, body: { itemIds, reason } }),
    gmSetWelcomeChoices: (itemIds, reason) => call<{ actionId: number }>({ method: 'PUT', path: '/api/gm/shop/welcome', body: { itemIds, reason } }),
    gmSetReputationRules: (rules, reason) => call<{ actionId: number }>({ method: 'PUT', path: '/api/gm/reputation/rules', body: { rules, reason } }),
    gmSetReputationRanks: (ranks, reason) => call<{ actionId: number }>({ method: 'PUT', path: '/api/gm/reputation/ranks', body: { ranks, reason } }),
    gmChaos: () => call<GmChaosDto>({ method: 'GET', path: '/api/gm/chaos' }),
    gmSetChaosRules: (changes, reason) =>
      call<{ actionId: number; changed: number }>({ method: 'PUT', path: '/api/gm/chaos/rules', body: { changes, reason } }),
    gmSetChaosConfig: (config, reason) => call<{ actionId: number }>({ method: 'PUT', path: '/api/gm/chaos/config', body: { config, reason } }),
    gmGrantReputation: (playerId, amount, reason) =>
      call<{ actionId: number; reputation: number; rank: number }>({
        method: 'POST',
        path: `/api/gm/players/${encodeURIComponent(playerId)}/reputation`,
        body: { amount, reason },
      }),
  }
}
