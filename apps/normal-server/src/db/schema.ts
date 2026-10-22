/**
 * Postgres schema for the Normal edition (spec §18.2).
 *
 * Conventions
 * - Money is `bigint` mapped to a JavaScript `number`: balances and nets are bounded by the point
 *   economy and stay far below 2^53, so the driver never has to hand back a `bigint` that every
 *   caller would then have to widen.
 * - Timestamps are `timestamptz`. The server reasons in UTC and only the economy's day boundary is
 *   timezone-aware (`ECONOMY_TIMEZONE`), so a column that stored local time would be a trap.
 * - Identity: a `users` row is the account (email + password), a `players` row is the game profile.
 *   They share the same id — one profile per account — which keeps every game-side foreign key on
 *   `players.id` without a second lookup.
 *
 * Two rulings differ from a literal reading of §18.2, both recorded in the Plan 5 ledger:
 * (a) `users.email` is `text` stored lowercased rather than `citext`: same uniqueness semantics
 *     without depending on an extension being installed in the target database.
 * (b) `games.id` is the engine's `handId` (text), and `game_players` is keyed by `(game_id, seat)`
 *     with a *nullable* `player_id` plus `label`/`is_bot`. §18.2's `pk(game_id, player_id)` cannot
 *     hold a bot seat, because a bot has no `players` row at all.
 */
import { sql } from 'drizzle-orm'
import { bigint, bigserial, boolean, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

/** `timestamptz not null default now()` — the shape every "when did this happen" column wants. */
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** Accounts. Nothing game-related lives here: this table exists to answer "who is signing in". */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercased, so the unique index is case-insensitive in effect — see the CHECK below. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Plan 25: who may open `/api/gm/*`. Read on every guarded request, so a change takes effect at once. */
  role: text('role').$type<'player' | 'gm'>().notNull().default('player'),
  /** Plan 25: set = the account may not sign in; its sessions were revoked when it was set. */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedReason: text('locked_reason'),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [
  // Without `citext`, "lowercased" is a promise made by whichever code inserts. One path that forgets
  // — a seed script, an admin tool, a future OAuth link — is two accounts for one address and a login
  // that resolves to whichever row the query folds to. The database keeps the promise instead.
  check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  check('users_role_known', sql`${t.role} in ('player', 'gm')`),
])

/** The game profile: one row per account, sharing its id. `balance` is the single source of points. */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 20 }).notNull(),
  /** The folded, unique form of `display_name` (`@bp/core`'s `displayNameKey`) — what "name taken" means. */
  nameKey: text('name_key').notNull().unique(),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  avatarConfig: jsonb('avatar_config').$type<Record<string, unknown>>().notNull().default({}),
  equippedTitle: text('equipped_title'),
  equippedBadge: text('equipped_badge'),
  lastReliefAt: timestamp('last_relief_at', { withTimezone: true }),
  /**
   * Plan 27: lifetime reputation, only ever raised — the materialised `Σ reputation_events.delta`, written in the
   * same transaction as its event. Not points: never in the ledger, never bought, never moved between players.
   */
  reputation: integer('reputation').notNull().default(0),
  /** Plan 27: the highest rank 1..5 ever reached. A GM raising a threshold never lowers it (spec R15). */
  rank: integer('rank').notNull().default(1),
  /** Plan 27: when the welcome outfit was picked; null = the lobby still offers it. */
  welcomeClaimedAt: timestamp('welcome_claimed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  // The ledger is the story of the balance, but this is what makes "points were never conjured"
  // enforceable: no settlement, purchase or relief may take a player below zero, ever.
  check('players_balance_non_negative', sql`${t.balance} >= 0`),
])

/**
 * Session cookies. `id` is `hex(HMAC-SHA256(SESSION_SECRET, token))` — see `auth/session-service.ts` —
 * so a stolen row is not a session, and an attacker who can write rows still cannot mint an id for a
 * token of their choosing without also holding the secret from the server's environment.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sessions_user_idx').on(t.userId),
  index('sessions_expires_idx').on(t.expiresAt),
])

/**
 * The points ledger: every movement of points, player-side and sink-side.
 *
 * `player_id` is nullable on purpose. A sink row — the table fee of a settled hand, or a carry-over
 * pot nobody could receive — is points that left balances and went to no player; it is recorded with
 * a null player so that `Σ balances + Σ sinks` stays constant and §12.5's monitoring query can read
 * both halves out of one table.
 *
 * Because a null player *means* sink, the ledger is `ON DELETE restrict`: deleting an account whose
 * rows are still here would rewrite that player's whole history — credits included — into sink rows,
 * and take their balance out of the economy unaccounted. Erasing a player is therefore a service that
 * has to zero the balance through the ledger first, not a `DELETE` that quietly rewrites the past.
 */
export const pointTransactions = pgTable('point_transactions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'restrict' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  refId: text('ref_id'),
  kind: text('kind'),
  createdAt: createdAt(),
}, (t) => [
  // The other half of "no player means sink": a sink says which kind it is, so a row with neither a
  // player nor a kind — an orphan — cannot exist to be counted as one.
  check('point_transactions_sink_has_kind', sql`${t.playerId} is not null or ${t.kind} is not null`),
  index('point_transactions_player_created_idx').on(t.playerId, t.createdAt),
  index('point_transactions_reason_created_idx').on(t.reason, t.createdAt),
  // "Did this hand's settlement already land?" — reconciliation reads the ledger by reference.
  index('point_transactions_ref_idx').on(t.refId),
  // The GM's per-day source/sink table (Plan 26) scans a time window without a player or a reason.
  index('point_transactions_created_at_idx').on(t.createdAt),
])

/**
 * The keys `BalanceRepository.apply` has claimed (Plan 20). A room names every write it may retry —
 * `cash_out:<room>:<sitting>`, `buy_in:…`, `buy_in_refund:…`, `carry_over:<room>:<release>` — and `apply`
 * inserts the key first, in the batch's own transaction: a key already here makes the call a no-op, so a
 * write that committed but whose acknowledgement was lost is not applied again when it is retried. A
 * rejected batch rolls its key back with it. Additive on purpose: no ledger row carries a key, so
 * `point_transactions` and everything that reads it are untouched.
 */
export const ledgerKeys = pgTable('ledger_keys', {
  key: text('key').primaryKey(),
  createdAt: createdAt(),
})

/** Everything a GM did (Plan 25). Append-only: no API updates or deletes a row. `actorUserId` null = the server CLI. */
export const GM_ACTION_KINDS = ['grant_points', 'adjust_points', 'grant_item', 'grant_wardrobe', 'lock', 'unlock', 'kick', 'close_room', 'promote', 'demote', 'unlock_achievement', 'reset_checkin', 'set_gift_month', 'clear_gift_month', 'grant_reputation', 'set_reputation_rules', 'set_reputation_ranks', 'set_shop_prices', 'set_shop_featured', 'set_welcome_choices'] as const
export type GmActionKind = (typeof GM_ACTION_KINDS)[number]

export const gmActions = pgTable('gm_actions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').$type<GmActionKind>().notNull(),
  targetPlayerId: uuid('target_player_id').references(() => players.id, { onDelete: 'set null' }),
  targetRoomId: text('target_room_id'),
  amount: bigint('amount', { mode: 'number' }),
  itemId: text('item_id'),
  reason: text('reason').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [
  index('gm_actions_created_idx').on(t.createdAt),
  index('gm_actions_target_idx').on(t.targetPlayerId, t.createdAt),
])

/** One row per completed (or cancelled) hand — `id` is the engine's `handId`. */
export const games = pgTable('games', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  mode: text('mode').notNull(),
  /** The public room config: never the room password (server-kit's `PublicRoomConfig`). */
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  fee: bigint('fee', { mode: 'number' }).notNull().default(0),
  cancelled: boolean('cancelled').notNull().default(false),
  /** Set when settlement was refused: the hand is still recorded so an operator can reconcile it. */
  settlementError: text('settlement_error'),
}, (t) => [
  index('games_room_started_idx').on(t.roomId, t.startedAt),
])

/**
 * A seat in a recorded hand. Keyed by `(game_id, seat)` rather than `(game_id, player_id)`: bots
 * occupy seats, have no `players` row, and are distinguished by `is_bot` with their engine-side id
 * kept in `label`.
 */
export const gamePlayers = pgTable('game_players', {
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  seat: integer('seat').notNull(),
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
  /** The engine-side seat id (a player id for humans, a bot id for bots) — survives a deleted account. */
  label: text('label').notNull(),
  isBot: boolean('is_bot').notNull().default(false),
  net: bigint('net', { mode: 'number' }).notNull(),
  won: boolean('won').notNull().default(false),
  /** `HandCategory` as its numeric rank; null when the hand never reached a showdown for this seat. */
  bestCategory: integer('best_category'),
}, (t) => [
  primaryKey({ columns: [t.gameId, t.seat] }),
  index('game_players_player_idx').on(t.playerId),
])

/**
 * The cosmetic catalogue, seeded from `data/items.json` on start-up.
 *
 * `slot` is stored in the column still called `category`. Plan 8 renamed the concept — a v2 item
 * fills a slot of a 3D figure (`hair`, `top`, `bottom`, `shoes`, `hat`, `accessory`, `jewelry`,
 * `title`, `badge`) rather than naming an SVG category — but renaming the column would have been a
 * table rewrite and an index rebuild to buy nothing: the values are what changed, and
 * `0001_avatar_v2.sql` changed those. The mapping is here so that no query has to remember it.
 *
 * `asset_key` is likewise kept, now holding the manifest node prefix `<slot>/<id>`. The geometry
 * itself lives in `data/items.json` under `asset` and is never projected into this table.
 */
export const items = pgTable('items', {
  id: text('id').primaryKey(),
  slot: text('category').notNull(),
  rarity: text('rarity').notNull(),
  nameKey: text('name_key').notNull(),
  assetKey: text('asset_key').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
}, (t) => [
  index('items_category_rarity_idx').on(t.slot, t.rarity),
])

/** What a player owns. `source` records how they got it (default, reward, achievement, …). */
export const inventory = pgTable('inventory', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  /** Which claim the item came from (`daily:<playerId>:<date>`), so a GM can take back exactly that claim (Plan 26). Null for older rows. */
  ref: text('ref'),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.playerId, t.itemId] }),
])

/**
 * A GM's override of one month of the daily-gift calendar (Plan 26). `month` is `YYYY-MM`; `days` is the same
 * `{ "<day>": rule }` object `daily-gifts.json` holds for a month. A month with no row here falls back to the file.
 */
export const giftMonths = pgTable('gift_months', {
  month: text('month').primaryKey(),
  days: jsonb('days').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

/** Achievement progress. `unlocked_at` is null while the achievement is still in progress. */
export const playerAchievements = pgTable('player_achievements', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  achievementId: text('achievement_id').notNull(),
  progress: bigint('progress', { mode: 'number' }).notNull().default(0),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.playerId, t.achievementId] }),
])

/**
 * Daily check-in state (spec §13). `last_claim_date` is a plain `date` in the economy timezone —
 * the streak rule is "was the previous claim yesterday", a question about calendar days, not instants.
 */
export const dailyLogins = pgTable('daily_logins', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  streak: integer('streak').notNull().default(0),
  lastClaimDate: date('last_claim_date', { mode: 'string' }),
  /** Days already claimed inside `month`; resets when the month rolls over. */
  claimedDays: integer('claimed_days').notNull().default(0),
  /** `YYYY-MM` in the economy timezone, empty until the first claim. */
  month: text('month').notNull().default(''),
  /**
   * Plan 27: days claimed in a row (yesterday claimed → +1, else 1), for the two login-streak achievements. Since
   * Plan 27 `streak` counts the month's claims and forgives a missed day, so the run of consecutive days lives here.
   */
  consecutive: integer('consecutive').notNull().default(0),
})

/**
 * Plan 27: the newcomer's seven-day calendar, created when the welcome outfit is claimed. `day` counts days with a
 * claim, not calendar days, so a missed day loses nothing; `claimed_days` lists the newcomer days (1..7) already claimed;
 * `last_day_key` is the economy day (`YYYY-MM-DD`) of the last increment, so one day never advances it twice.
 */
export const newcomerProgress = pgTable('newcomer_progress', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  day: integer('day').notNull().default(1),
  claimedDays: jsonb('claimed_days').$type<number[]>().notNull().default([]),
  lastDayKey: text('last_day_key'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

/*
 * Plan 27's configuration tables (reputation rules and ranks, shop prices, the weekly shelf, the shop config) keep
 * `updated_by` as a plain uuid with no foreign key on purpose: a key to `users` would let `truncate users … cascade`
 * (the test harness's reset) and any cascade from an account wipe the seeded configuration with it.
 */

/**
 * Plan 27: every rise of a player's reputation. `delta` is always positive (reputation only grows); the unique
 * `(player_id, reason, ref_id)` makes a replayed event — a hand settled twice, a retried claim — a no-op. `ref_id` is
 * required, because a null would escape that uniqueness.
 */
export const reputationEvents = pgTable('reputation_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  refId: text('ref_id').notNull(),
  createdAt: createdAt(),
}, (t) => [
  check('reputation_events_delta_positive', sql`${t.delta} > 0`),
  uniqueIndex('reputation_events_player_reason_ref_uq').on(t.playerId, t.reason, t.refId),
  index('reputation_events_player_created_idx').on(t.playerId, t.createdAt),
])

/** Plan 27: how much reputation each source pays (`hand_played`, `hand_won`, `daily_login`, …). A GM edits it. */
export const reputationRules = pgTable('reputation_rules', {
  key: text('key').primaryKey(),
  amount: integer('amount').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Plan 27: the reputation each rank 1..5 starts at. A GM edits it; raising one never lowers `players.rank`. */
export const reputationRanks = pgTable('reputation_ranks', {
  rank: integer('rank').primaryKey(),
  threshold: integer('threshold').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('reputation_ranks_rank_range', sql`${t.rank} BETWEEN 1 AND 5`),
])

/**
 * Plan 27: the shop's price list, one row per item. No foreign key to `items`: that table is reloaded from
 * `data/items.json` at every boot. Seeded by code at boot, not by the migration. `sale_price` is unused for now.
 */
export const shopPrices = pgTable('shop_prices', {
  itemId: text('item_id').primaryKey(),
  pricePoints: integer('price_points').notNull(),
  minRank: integer('min_rank').notNull(),
  enabled: boolean('enabled').notNull(),
  salePrice: integer('sale_price'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('shop_prices_min_rank_range', sql`${t.minRank} BETWEEN 1 AND 5`),
  check('shop_prices_price_non_negative', sql`${t.pricePoints} >= 0`),
])

/** Plan 27: a GM's pick for one week's shelf (`week_key` is the ISO week); a week without a row rotates automatically. */
export const shopFeatured = pgTable('shop_featured', {
  weekKey: text('week_key').primaryKey(),
  itemIds: jsonb('item_ids').$type<string[]>().notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Plan 27: the shop's small settings as key → JSON (today only `welcome_choices`, the three welcome outfits). */
export const shopConfig = pgTable('shop_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Lifetime counters, updated by the stats module from domain events (never by the history writer). */
export const playerStats = pgTable('player_stats', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  handsPlayedHoldem: integer('hands_played_holdem').notNull().default(0),
  handsWonHoldem: integer('hands_won_holdem').notNull().default(0),
  handsPlayedBlind: integer('hands_played_blind').notNull().default(0),
  handsWonBlind: integer('hands_won_blind').notNull().default(0),
  botHands: integer('bot_hands').notNull().default(0),
  currentWinStreak: integer('current_win_streak').notNull().default(0),
  bestWinStreak: integer('best_win_streak').notNull().default(0),
  currentLoseStreak: integer('current_lose_streak').notNull().default(0),
  bestLoseStreak: integer('best_lose_streak').notNull().default(0),
  /** Best `HandCategory` rank ever shown down; 0 while the player has never reached a showdown. */
  bestHandRank: integer('best_hand_rank').notNull().default(0),
  biggestWin: bigint('biggest_win', { mode: 'number' }).notNull().default(0),
  roomsJoined: integer('rooms_joined').notNull().default(0),
  gamesCompleted: integer('games_completed').notNull().default(0),
  totalLoginDays: integer('total_login_days').notNull().default(0),
  loginStreak: integer('login_streak').notNull().default(0),
  bestLoginStreak: integer('best_login_streak').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Five saved outfits per player (design §5.3, same contract as the outfits Plan 10 already speced).
 *
 * Keyed by `(player_id, slot)` rather than a surrogate id: a player has at most five, `slot` is the
 * position in the bar the client draws, and there is never a reason to address a saved outfit any
 * other way. `config` is the same avatar config jsonb `players.avatar_config` stores — an outfit is a
 * config a player set aside, not a different kind of thing. Rows written since Plan 19 hold an
 * `AvatarConfigV4`; older ones hold v3 and are read through `readAvatarConfig` (`outfits-service.ts`).
 */
export const avatarOutfits = pgTable('avatar_outfits', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  slot: smallint('slot').notNull(),
  name: varchar('name', { length: 24 }).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.playerId, t.slot] }),
  check('avatar_outfits_slot_range', sql`${t.slot} BETWEEN 1 AND 5`),
])
