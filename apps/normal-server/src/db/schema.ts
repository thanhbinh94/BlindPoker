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
import { bigint, bigserial, boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/** `timestamptz not null default now()` — the shape every "when did this happen" column wants. */
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** Accounts. Nothing game-related lives here: this table exists to answer "who is signing in". */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercased, so the unique index is case-insensitive in effect — see the CHECK below. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [
  // Without `citext`, "lowercased" is a promise made by whichever code inserts. One path that forgets
  // — a seed script, an admin tool, a future OAuth link — is two accounts for one address and a login
  // that resolves to whichever row the query folds to. The database keeps the promise instead.
  check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
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
  createdAt: createdAt(),
}, (t) => [
  // The ledger is the story of the balance, but this is what makes "points were never conjured"
  // enforceable: no settlement, purchase or relief may take a player below zero, ever.
  check('players_balance_non_negative', sql`${t.balance} >= 0`),
])

/** Session cookies. `id` is the SHA-256 hex of the cookie value, so a stolen row is not a session. */
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

/** The cosmetic catalogue, seeded from `data/items.json` on start-up. */
export const items = pgTable('items', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  rarity: text('rarity').notNull(),
  nameKey: text('name_key').notNull(),
  assetKey: text('asset_key').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
}, (t) => [
  index('items_category_rarity_idx').on(t.category, t.rarity),
])

/** What a player owns. `source` records how they got it (default, reward, achievement, …). */
export const inventory = pgTable('inventory', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.playerId, t.itemId] }),
])

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
