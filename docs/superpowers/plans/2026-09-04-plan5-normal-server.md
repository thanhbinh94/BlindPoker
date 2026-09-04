# Bind Poker — Plan 5: Normal server (`apps/normal-server`: Fastify + PostgreSQL/Drizzle, auth, ledger, economy, stats, achievements, inventory) + shared `@bp/http-kit` — M6 (+ M8 server half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Normal edition's server: email + password accounts with server-side sessions (cookie), PostgreSQL persistence through Drizzle with a full points ledger (`point_transactions`, sink rows), the three `@bp/server-kit` repositories, daily reward with cosmetic items, relief, statistics, data-driven achievements, inventory/avatar, hand history, REST per spec §19.2, the WebSocket game server authenticated at HTTP upgrade by cookie, static serving of the Normal web build, migrations, Docker Compose (app + Postgres + Caddy), backup and deployment docs. Extract the HTTP helpers both editions share into `@bp/http-kit` and make Lite use it (no duplicated app code).

**Architecture:** `packages/http-kit` (Node-only, no `@bp/*` deps except none; fastify as a peer) holds what Lite already proved: `.env` parsing, rate limiter, asset sources (dir/SEA) + SPA static route, security headers, `HttpError` + error envelope handler, bearer/loopback helpers, tolerant JSON parser. `apps/normal-server` composes `@bp/core` (rules, economy constants, display-name rule), `@bp/server-kit` (rooms/gateway), `@bp/http-kit` and its own modules: `db` (Drizzle schema + migrations; runtime `pg`, tests `@electric-sql/pglite` — same query builder, so repositories are tested without Docker), `auth`, `repos`, `economy`, `stats`, `achievements`, `inventory`, `history`, `http`. Modules react to server-kit `DomainEvent`s through a small in-process event bus; nothing edition-specific leaks into shared packages.

**Tech Stack:** Node 22, Fastify 5, `@fastify/cookie` 11, `pg` 8.23, `drizzle-orm` 0.45 + `drizzle-kit` 0.31, `@electric-sql/pglite` 0.5 (tests), `argon2` 0.45 (argon2id; prebuilt binaries on win32/linux x64), Vitest 2, Docker (multi-stage image), Caddy 2 (HTTPS).

**Spec:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §10 (player system), §12 (economy, ledger, monitoring), §13 (daily incl. items), §14 (achievements), §15 (avatar/inventory), §16.2 (cookie at upgrade), §18.2/§18.4 (Normal DB), §19.2 (REST), §22.5 (env), §23 (security), §24 (performance targets), §28.1 (deployment), §29.4 (Normal tests), §32.

## Global Constraints

- Node `>=22.13`, pnpm 9 (`export PATH="$PATH:$(npm prefix -g)"` in bash when missing).
- Dependency direction: `apps/normal-server → core, server-kit, http-kit`; `apps/lite → core, server-kit, ui-kit, http-kit`; `http-kit → (none of @bp/*)`. `tooling/arch/boundaries.test.ts` `ALLOWED` and `eslint.config.js` are updated in Task 1. Normal-only deps (`pg`, `drizzle-orm`, `argon2`, `@fastify/cookie`) live only in `apps/normal-server`; Lite's footprint test must keep passing.
- Money: every balance change is one `BalanceRepository.apply` transaction with per-player netting, `SELECT … FOR UPDATE`, one `point_transactions` row per entry, and a sink row (`player_id NULL`, `kind`) when `meta.fee > 0`; balances never negative (DB `CHECK`). Daily/relief/achievement credits are single transactions that also stamp their state.
- Security (§23): argon2id (`memoryCost 65536, timeCost 3, parallelism 1`); session id = 32 random bytes base64url, stored as sha256 hex; cookie `bp_session` `HttpOnly; Secure (configurable for local http); SameSite=Lax; Path=/`; sliding 30-day expiry (touch at most once per hour); login rate limit 5/min per IP+email with uniform timing (always hash); `X-Requested-With: bind-poker` on mutating routes; `ALLOWED_ORIGINS` **required**; `SESSION_SECRET` (≥ 32 chars) required and used to HMAC the session id before storage (defense in depth) ; errors never leak internals; no secrets in logs.
- Config via env only (`.env` for dev via http-kit): required `DATABASE_URL`, `SESSION_SECRET`, `ALLOWED_ORIGINS`; optional `PORT` 8080, `HOST` 0.0.0.0, `LOG_LEVEL`, `ECONOMY_TIMEZONE`, `RECONNECT_WINDOW_SEC`, `PUBLIC_DIR`, `COOKIE_SECURE` (default true), `TRUST_PROXY` (default false).
- Tests: Vitest; DB tests run on PGlite in-process (`createTestDb()` applies the SQL migrations); when `TEST_DATABASE_URL` is set the same suites also run against real Postgres (skip otherwise). Test files colocated; `.js` imports; every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Consumed APIs
```ts
// @bp/server-kit: createGameServer, Repositories{players,balances,history}, BalanceEntry{playerId,delta,reason,refId?}, SettlementMeta{refId,fee,kind}, InsufficientBalanceError, HandSummary{handId,roomId,mode,config,startedAt,endedAt,fee,cancelled,players[{playerId,seat,isBot,net,won,bestCategory}]}, DomainEvent (ROOM_CREATED|ROOM_JOINED|HAND_SETTLED), SessionResolver{fromUpgrade(req)}, GameServer{handleUpgrade,notify,balanceChanged,shutdown}, GatewayOptions.allowedOrigins: string[] | 'same-host'
// @bp/core: ECONOMY, DAILY_REWARD_POINTS, dailyRewardPoints, validateDisplayName/normalizeDisplayName/displayNameKey, HandCategory, HAND_CATEGORY_KEYS
// Lite reference code to generalise into http-kit: apps/lite/server/src/{config.ts (parseDotenv), http/assets.ts, http/rate-limit.ts, http/routes.ts (HttpError, CSP, headers hook, CSRF hook, error handler, bearerToken, isLoopbackAddress, static route), app.ts (tolerant JSON parser)}
```

## File Structure (this plan)

```text
packages/http-kit/package.json                 @bp/http-kit — peerDependencies: fastify; no runtime deps
packages/http-kit/src/{index.ts,dotenv.ts,rate-limit.ts,assets.ts,http-errors.ts,security.ts,json-body.ts,static-route.ts,auth-headers.ts,logger.ts} + tests
apps/lite/server/src/*                         (modify) import from @bp/http-kit; delete the moved files
apps/normal-server/package.json                @bp/normal-server
apps/normal-server/tsconfig.json, vitest.config.ts, drizzle.config.ts
apps/normal-server/drizzle/*.sql               generated migrations (committed)
apps/normal-server/data/{items.json,achievements.json}
apps/normal-server/src/config.ts               NormalConfig, loadConfig (required vars)
apps/normal-server/src/db/{schema.ts,client.ts,migrate.ts,test-db.ts}
apps/normal-server/src/events.ts               AppEventBus (typed emitter over DomainEvent + app events)
apps/normal-server/src/repos/{balance-repo.ts,player-repo.ts,history-repo.ts,index.ts}
apps/normal-server/src/auth/{password.ts,session-service.ts,auth-service.ts,cookie.ts}
apps/normal-server/src/economy/{daily.ts (reuse rules from Lite via http-kit? no — pure fns copied into @bp/core? see Task 5),economy-service.ts}
apps/normal-server/src/stats/stats-service.ts
apps/normal-server/src/achievements/{definitions.ts,achievement-service.ts}
apps/normal-server/src/inventory/{items.ts,inventory-service.ts,avatar.ts}
apps/normal-server/src/history/history-service.ts
apps/normal-server/src/http/{routes-auth.ts,routes-me.ts,routes-rewards.ts,routes-catalog.ts,routes.ts}
apps/normal-server/src/{app.ts,main.ts}
apps/normal-server/Dockerfile, .dockerignore
deploy/normal/{docker-compose.yml,Caddyfile,.env.example,backup.sh,restore.md}
docs/deployment-normal.md, docs/normal-server.md
```

---

### Task 1: Extract `@bp/http-kit` from Lite and make Lite use it

**Files:**
- Create: `packages/http-kit/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/dotenv.ts`, `src/rate-limit.ts`, `src/assets.ts`, `src/http-errors.ts`, `src/security.ts`, `src/json-body.ts`, `src/static-route.ts`, `src/auth-headers.ts`, tests moved/adapted from Lite (`dotenv.test.ts`, `rate-limit.test.ts`, `assets.test.ts`, `auth-headers.test.ts`, `static-route.test.ts`)
- Modify: `apps/lite/server/src/{config.ts,app.ts,http/routes.ts,main.ts}` (import from `@bp/http-kit`; delete `http/assets.ts`, `http/rate-limit.ts` and their tests once moved), `apps/lite/package.json` (dep `@bp/http-kit`), `tooling/arch/boundaries.test.ts` (`'@bp/http-kit': []`, add to lite + normal-server allowlists), `tooling/arch/node-builtins.js` (unchanged), `eslint.config.js` (http-kit may use Node built-ins; forbid `@bp/*` and `react` inside it), `README.md` layout

**Interfaces (exact):**
```ts
// dotenv.ts
export function parseDotenv(text: string): Record<string, string>
export function readDotenv(path: string): Record<string, string>          // {} when missing
// rate-limit.ts
export interface RateLimitVerdict { allowed: boolean; retryAfterSec: number }
export interface RateLimiter { check(key: string): RateLimitVerdict }
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter
// assets.ts
export interface Asset { body: Buffer; type: string; immutable: boolean }
export interface AssetSource { get(path: string): Asset | null; has(path: string): boolean }
export function normalizePath(raw: string): string | null
export function assetSourceFromDir(dir: string): AssetSource
export function assetSourceFromSea(manifest: string[], read?: (key: string) => ArrayBuffer): AssetSource
export function contentType(path: string): string
// http-errors.ts
export class HttpError extends Error { constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) }
export const FASTIFY_CODES: Record<number, string>
export function registerErrorHandler(app: FastifyInstance, log: { error(msg: string, data?: object): void }): void   // HttpError → envelope; Fastify errors → FASTIFY_CODES; 5xx logged, message hidden
// security.ts
export interface SecurityHeadersOptions { csp: string; noStorePrefixes?: string[] }   // default ['/api', '/health']
export const DEFAULT_CSP: string   // Lite's current CSP string
export function registerSecurityHeaders(app: FastifyInstance, opts?: Partial<SecurityHeadersOptions>): void
export const REQUESTED_WITH = 'bind-poker'
export function registerCsrfGuard(app: FastifyInstance): void      // mutating methods need X-Requested-With
// json-body.ts
export function registerTolerantJsonParser(app: FastifyInstance): void
// static-route.ts
export function registerStaticRoute(app: FastifyInstance, assets: AssetSource | null, opts?: { reserved?: string[]; immutableCache?: string }): void  // '/*' with SPA fallback for extension-less paths, 404 JSON under reserved prefixes
// auth-headers.ts
export function bearerToken(header: string | undefined): string
export function isLoopbackAddress(address: string | undefined): boolean
export function secretEquals(given: string, expected: string): boolean
// logger.ts — the JSON-line stdout logger Lite builds inline in apps/lite/server/src/main.ts, generalised
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export function createJsonLogger(level: LogLevel, out?: (line: string) => void): Logger   // Logger shape = server-kit's { debug, info, warn, error }(msg, data?) — re-declare it structurally here (http-kit must not depend on server-kit)
```

- [ ] **Step 1: Create the package** (`"peerDependencies": { "fastify": "^5.1.0" }`, devDeps fastify/typescript/vitest/@types/node; tsconfig `types: ["node"]`; vitest node env). Move the code verbatim from Lite with the generalisations above (the Lite CSP becomes `DEFAULT_CSP`; `registerStaticRoute` takes the reserved list). Move the tests with them.
- [ ] **Step 2: Refactor Lite** to import everything from `@bp/http-kit`; delete the moved files; Lite's `routes.ts` keeps only Lite routes + admin stop. Run `pnpm install` (workspace link), `pnpm --filter @bp/lite test` (unchanged 227 tests), `pnpm --filter @bp/http-kit test`.
- [ ] **Step 3: Boundaries** — `ALLOWED['@bp/http-kit'] = []`, `'@bp/lite'` += `'@bp/http-kit'`, `'@bp/normal-server'` = `['@bp/core','@bp/server-kit','@bp/http-kit']`; eslint block for `packages/http-kit/**` forbidding `@bp/*`, `react`, `**/apps/**`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`; rebuild Lite (`pnpm --filter @bp/lite build`) and confirm footprint/smoke stay green (http-kit is bundled in; no new forbidden deps). Commit:
```bash
git add -A
git commit -m "refactor: extract @bp/http-kit from Lite (dotenv, rate limit, assets, headers, errors, static route)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `apps/normal-server` scaffold, config, Drizzle schema, migrations, DB clients (pg + PGlite)

**Files:**
- Create: `apps/normal-server/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/config.ts` (+ test), `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/test-db.ts`, `drizzle/0000_init.sql` (+ `meta/`), `src/db/schema.test.ts`
- Modify: root `package.json` (`build:normal` already exists → keep; add `"db:generate": "pnpm --filter @bp/normal-server db:generate"`), `.gitignore`

**Interfaces:**
```ts
// config.ts
export interface NormalConfig { port: number; host: string; databaseUrl: string; sessionSecret: string; allowedOrigins: string[]; logLevel: 'debug'|'info'|'warn'|'error'; timezone: string; reconnectWindowSec: number; publicDir: string | null; cookieSecure: boolean; trustProxy: boolean }
export function loadConfig(env: Record<string, string | undefined>): NormalConfig   // throws listing ALL missing/invalid required vars at once; SESSION_SECRET ≥ 32 chars; ALLOWED_ORIGINS non-empty CSV of absolute origins
// db/client.ts
export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>   // use drizzle's generic `PgDatabase` type alias `AppDb`
export function createPgDb(databaseUrl: string, opts?: { max?: number }): { db: AppDb; close(): Promise<void>; ping(): Promise<boolean> }
// db/migrate.ts
export async function runMigrations(db: AppDb, kind: 'pg' | 'pglite'): Promise<void>   // drizzle migrators with migrationsFolder resolved relative to the package root (works from dist/ too)
// db/test-db.ts
export async function createTestDb(): Promise<{ db: AppDb; close(): Promise<void> }>   // PGlite in-memory + runMigrations; if process.env.TEST_DATABASE_URL is set, use pg against a fresh schema (`CREATE SCHEMA test_<rand>` + search_path) and drop it on close
```
Schema (Drizzle `pgTable`s, spec §18.2 + Plan 4 lessons). **Rulings vs §18.2:** (a) `email` is `text` stored lowercased instead of `citext` — same uniqueness semantics without the extension; (b) `games.id` is `text` (the engine's `handId`), and `game_players` is keyed by `(game_id, seat)` with a nullable `player_id` plus `label`/`is_bot`, because bots have no `players` row — §18.2's `pk(game_id, player_id)` cannot hold bot seats; Task 7 amends the spec. `users(id uuid pk default random, email text unique not null (lowercased), password_hash text, created_at timestamptz default now, last_login_at timestamptz)`, `players(id uuid pk references users, display_name varchar(20) not null, name_key text unique not null, balance bigint not null check (balance >= 0), avatar_config jsonb not null default '{}', equipped_title text, equipped_badge text, last_relief_at timestamptz, created_at)`, `sessions(id text pk (sha256 hex), user_id uuid fk, expires_at timestamptz, user_agent text, created_at, last_seen_at)`, `point_transactions(id bigserial pk, player_id uuid null fk, amount bigint, reason text, ref_id text, kind text, created_at)` with indexes `(player_id, created_at)`, `(reason, created_at)`, `games(id text pk, room_id text, mode text, config jsonb, started_at, ended_at, fee bigint, cancelled boolean)`, `game_players(game_id fk, seat int, player_id uuid null fk, label text, is_bot boolean, net bigint, won boolean, best_category int null, pk(game_id, seat))`, `items(id text pk, category text, rarity text, name_key text, asset_key text, is_default boolean)`, `inventory(player_id fk, item_id fk, source text, acquired_at, pk)`, `player_achievements(player_id fk, achievement_id text, progress bigint, unlocked_at timestamptz null, pk)`, `daily_logins(player_id pk fk, streak int, last_claim_date date null, claimed_days int, month text)`, `player_stats(player_id pk fk, hands_played_holdem, hands_won_holdem, hands_played_blind, hands_won_blind, bot_hands, current_win_streak, best_win_streak, current_lose_streak, best_lose_streak, best_hand_rank, biggest_win, rooms_joined, games_completed, total_login_days, login_streak, best_login_streak (all int/bigint default 0), updated_at)`.

- [ ] **Step 1:** package (`dependencies`: `@bp/core`, `@bp/server-kit`, `@bp/http-kit`, `fastify`, `@fastify/cookie`, `pg`, `drizzle-orm`, `argon2`; devDeps: `@electric-sql/pglite`, `drizzle-kit`, `@types/pg`, `typescript`, `vitest`, `@bp/server-kit` testing via package export). Scripts: `test`, `typecheck`, `build` (esbuild? No — plain `tsc -p tsconfig.build.json` to `dist/` with `.js` output; migrations copied), `start` (`node dist/main.js`), `migrate` (`node dist/migrate-cli.js`), `db:generate` (`drizzle-kit generate`), `dev` (`node --watch --experimental-strip-types`? no — `tsc -w` + `node --watch dist/main.js` is fine; or use `tsx`? avoid new deps: use `pnpm build && node dist/main.js`).
- [ ] **Step 2:** schema + `drizzle-kit generate` → commit the SQL; `runMigrations` for both drivers; `createTestDb`. Tests: `config.test.ts` (missing required vars listed together; secret too short; origins must be absolute `http(s)://…`); `schema.test.ts` on PGlite: migrations apply, `players.balance` CHECK rejects negative, `users.email` unique, `name_key` unique, `point_transactions.player_id` nullable.
- [ ] **Step 3:** `pnpm install && pnpm --filter @bp/normal-server test && pnpm typecheck && pnpm lint && pnpm test` (boundary test green). Commit:
```bash
git add -A
git commit -m "chore(normal-server): scaffold, config with required vars, Drizzle schema, migrations, pg/PGlite clients

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Repositories over Drizzle — ledger-backed balances, players, history

**Files:**
- Create: `apps/normal-server/src/repos/balance-repo.ts`, `player-repo.ts`, `history-repo.ts`, `index.ts`, tests `balance-repo.test.ts`, `player-repo.test.ts`, `history-repo.test.ts`

**Interfaces:**
```ts
export interface NormalRepositories extends Repositories {   // server-kit's { players, balances, history }
  db: AppDb
  ledger: { list(playerId: string, opts?: { limit?: number; before?: number }): Promise<LedgerRow[]>; sums(sinceMs: number): Promise<{ reason: string; total: number }[]> }   // §12.5 monitoring
  players: PlayerRepository & { findByIdFull(id): Promise<PlayerRow | null>; updateProfile(id, patch: { displayName?: string }): Promise<void>; setLastRelief(id, at: Date): Promise<void> }
  history: GameHistoryRepository & { listForPlayer(playerId, limit): Promise<GameRow[]> }
  balances: BalanceRepository & { creditWithin<T>(tx: AppTx, entries: BalanceEntry[], meta?: SettlementMeta): Promise<void> }   // same logic usable inside an outer transaction (daily/relief/achievements)
}
export function createRepositories(db: AppDb): NormalRepositories
```
`apply(entries, meta)`: `db.transaction(async tx => creditWithin(tx, entries, meta))`; `creditWithin`: group by player; `SELECT id, balance FROM players WHERE id = ANY($1) FOR UPDATE` (ordered by id to avoid deadlocks); unknown id → throw; any `balance + net < 0` → throw `InsufficientBalanceError`; `UPDATE players SET balance = balance + net`; `INSERT point_transactions` one row per original entry; if `meta.fee > 0` insert `{ player_id: null, amount: -fee?` — convention: sink rows record `amount = fee` (positive) with `reason = 'sink'`, `kind = meta.kind`, `ref_id = meta.refId`. `recordHand(summary)`: insert `games` + `game_players` (bots with `player_id null`, `label = summary player id`), and — unless cancelled — update `player_stats` counters is NOT done here (stats module does it from the domain event); history only stores.

- [ ] **Step 1: Tests on `createTestDb()`** — atomic rollback (one negative net rolls back all, no ledger rows), netting (−300/+250 with 100 → 50), sink row shape, empty batch + fee → only the sink row, unknown player, concurrent applies on the same player (two overlapping `apply` calls via `Promise.all` on real Postgres when `TEST_DATABASE_URL` is set; on PGlite sequentially), `ledger.list` ordering + pagination, `ledger.sums` grouping, history insert incl. bots and cancelled flag, `listForPlayer`.
- [ ] **Step 2: Implement.** Use `bigint` columns mapped to `number` (`mode: 'number'`) — balances stay < 2^53.
- [ ] **Step 3:** `pnpm --filter @bp/normal-server test && pnpm typecheck && pnpm lint`. Commit `feat(normal-server): ledger-backed repositories with netted, locked settlement and sink rows`.

---

### Task 4: Authentication — passwords, sessions, cookie, resolver, routes

**Files:**
- Create: `src/auth/password.ts`, `session-service.ts`, `auth-service.ts`, `cookie.ts`, `src/http/routes-auth.ts`, tests for each

**Interfaces:**
```ts
// password.ts
export function hashPassword(plain: string): Promise<string>           // argon2id, memoryCost 65536, timeCost 3, parallelism 1
export function verifyPassword(hash: string, plain: string): Promise<boolean>
export const DUMMY_HASH: Promise<string>                                // hashed once at boot; verified against on unknown email so timing is uniform
export function validatePassword(p: string): { ok: true } | { ok: false; reason: 'length' | 'weak' }   // ≥ 8, ≤ 128 chars; not equal to email local part
// session-service.ts
export interface SessionService { create(userId: string, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }>; resolve(token: string): Promise<{ userId: string; sessionId: string } | null>; revoke(token: string): Promise<void>; revokeAll(userId): Promise<void>; touch(sessionId): Promise<void> }
export function createSessionService(db: AppDb, opts: { secret: string; ttlDays?: number (30); touchIntervalMs?: number (3600000); now?: () => number }): SessionService
//   token = 32 random bytes base64url; stored id = hex(HMAC-SHA256(secret, token)); resolve checks expires_at > now, extends (sliding) at most every touchInterval
// cookie.ts
export const SESSION_COOKIE = 'bp_session'
export function cookieOptions(secure: boolean): CookieSerializeOptions   // httpOnly, sameSite 'lax', path '/', secure, maxAge 30d
export function readSessionCookie(req: FastifyRequest): string | null
// auth-service.ts
export class AuthError extends Error { constructor(readonly code: 'EMAIL_TAKEN' | 'DISPLAY_NAME_TAKEN' | 'INVALID_EMAIL' | 'INVALID_PASSWORD' | 'INVALID_NAME' | 'BAD_CREDENTIALS') }
export interface AuthService {
  register(input: { email: string; password: string; displayName: string; userAgent?: string }): Promise<{ userId: string; token: string; expiresAt: Date }>   // one transaction: users + players (starting balance via balances.creditWithin with reason 'signup_bonus'? → use reason 'starting_balance', refId = userId) + default inventory items + player_stats + daily_logins rows
  login(input: { email: string; password: string; userAgent?: string; currentToken?: string | null }): Promise<{ userId: string; token: string; expiresAt: Date }>   // uniform timing; updates last_login_at; §23 "rotate id on login": always issues a NEW session and revokes `currentToken` if one was presented; publishes { type: 'LOGIN' } on the bus (Task 5) — accept an optional `onLogin?(playerId, at)` hook so Task 4 does not depend on Task 5
  logout(token: string): Promise<void>
  identityForToken(token: string): Promise<PlayerIdentity | null>    // used by SessionResolver.fromUpgrade (reads the cookie from req.headers.cookie)
}
export function createAuthService(deps: { db: AppDb; repos: NormalRepositories; sessions: SessionService; items: ItemCatalog (Task 5 — accept an interface `{ defaults(): string[] }`) ; now?: () => number }): AuthService
```
Routes (`routes-auth.ts`, spec §19.2): `POST /api/auth/register` (201, sets cookie, body `{ playerId, displayName, balance }`; 400 `INVALID_EMAIL|INVALID_PASSWORD|INVALID_NAME`; 409 `EMAIL_TAKEN|DISPLAY_NAME_TAKEN`), `POST /api/auth/login` (200 sets cookie; 401 `BAD_CREDENTIALS`; 429 `RATE_LIMITED` 5/min per `ip+email`), `POST /api/auth/logout` (204 clears cookie), `GET /api/auth/me` (200 `{ playerId, displayName, balance }` or 401). Email: trim + lowercase, RFC-lite regex, ≤ 254. `requireUser` preHandler decorates `req.user = { userId, playerId, displayName }`.

- [ ] **Step 1: Tests** — password hashing/verification (+ `DUMMY_HASH` timing use), session create/resolve/expiry/sliding touch/revoke, register happy + each failure, login wrong password vs unknown email both `BAD_CREDENTIALS` (and both call `verifyPassword` — assert via a spy), rate limit, cookie flags (`Set-Cookie` contains `HttpOnly; Secure; SameSite=Lax`), logout clears, `identityForToken`.
- [ ] **Step 2: Implement.** `@fastify/cookie` registered in Task 6's `buildApp`; routes use `reply.setCookie`. Keep argon2 params in one constant.
- [ ] **Step 3:** run, lint, commit `feat(normal-server): email/password accounts with argon2id, server-side sessions and cookie auth`.

---
### Task 5: Economy + progression — items catalog, daily reward (with items), relief, stats, achievements, inventory/avatar, hand history

**Files:**
- Create: `apps/normal-server/data/items.json`, `data/achievements.json`, `src/events.ts`, `src/inventory/items.ts`, `src/inventory/inventory-service.ts`, `src/inventory/avatar.ts`, `src/economy/daily-rules.ts`, `src/economy/economy-service.ts`, `src/stats/stats-service.ts`, `src/achievements/definitions.ts`, `src/achievements/achievement-service.ts`, `src/history/history-service.ts`, tests for each service on `createTestDb()`
- Reference (copy the pure day-key/monthly-reset rules from Lite; Lite's `apps/lite/server/src/economy/daily.ts` stays — do not move it into core: core must remain protocol/rules only, and the two editions' schedules differ by design in §13.3)

**Interfaces:**
```ts
// events.ts — one process-local bus; server-kit DomainEvents are re-published here plus app events
export type AppEvent = DomainEvent | { type: 'DAILY_CLAIMED'; playerId: string; day: number; streak: number } | { type: 'LOGIN'; playerId: string; at: number }
export interface AppEventBus { publish(e: AppEvent): Promise<void>; subscribe(fn: (e: AppEvent) => Promise<void> | void): () => void }
export function createEventBus(log): AppEventBus   // subscribers run sequentially in subscription order; an error is logged and does not stop the others
// inventory/items.ts — data/items.json (spec §15.1): [{ id, category: 'base'|'face'|'clothing'|'hair'|'accessory'|'jewelry'|'title'|'badge', rarity: 'common'|'rare'|'epic', nameKey, assetKey, isDefault }]
export type ItemCategory = 'base' | 'face' | 'clothing' | 'hair' | 'accessory' | 'jewelry' | 'title' | 'badge'
export interface ItemCatalog { all(): ItemDef[]; get(id): ItemDef | undefined; defaults(): string[]; byRarity(r: Rarity): ItemDef[]; seed(db: AppDb): Promise<void> /* upsert rows */ }
export function loadItemCatalog(path?: string): ItemCatalog   // validates: ids unique, ≥ 1 default per required layer (base, face, clothing, hair), every id referenced by achievements.json / daily rules exists
// inventory/inventory-service.ts
export interface InventoryService { list(playerId): Promise<{ itemId; source; acquiredAt }[]>; grant(tx: AppTx, playerId, itemId, source): Promise<boolean /* newly granted */>; owns(playerId, itemId): Promise<boolean>; unownedOfRarity(tx, playerId, rarity): Promise<string[]> }
// inventory/avatar.ts — spec §15.1: avatar_config { base, face, clothing, hair, hairColor, accessory?, jewelry?, title?, badge? } (item ids; hairColor is a hex string `#rrggbb`)
export interface AvatarConfig { base: string; face: string; clothing: string; hair: string; hairColor: string; accessory?: string; jewelry?: string; title?: string; badge?: string }
export interface AvatarView { config: AvatarConfig }   // returned by /api/me and PUT /api/me/avatar; also what server-kit's PlayerIdentity carries? No — identity stays { playerId, displayName, isBot }; the table shows avatars in Plan 6 via a lightweight `GET /api/players/:id/avatar` (add here: public, cached 60 s)
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog): { ok: true; value: AvatarConfig } | { ok: false; code: 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'INVALID_COLOR' | 'MISSING_LAYER' }   // full replace (PUT): every required layer present; each id exists and its category matches the slot
export async function applyAvatarConfig(db, inventory, playerId, config: AvatarConfig): Promise<AvatarView>   // every referenced item must be owned → else ServiceError('NOT_OWNED'); writes players.avatar_config + equipped_title/equipped_badge in one statement
export function defaultAvatar(catalog: ItemCatalog): AvatarConfig   // built from isDefault items at register time
// economy/daily-rules.ts (pure): dayKey(nowMs, tz), monthKey(nowMs, tz), nextStreak(state, todayKey) per §13.1 (yesterday → +1, today → claimed, else 1; month change → 1; cap 31; days 29–31 pay day 29), rewardForDay(day) = dailyRewardPoints(day) from core (verify core's table matches §13.2: day 28 = 40,000), itemRuleForDay(day): null | { kind: 'randomUnowned'; rarity: 'common' } (day 7) | { kind: 'randomUnowned'; rarity: 'rare' } (days 14, 21) | { kind: 'fixed'; itemIds: ['badge_monthly', 'title_devoted'] } (day 28); NO_ITEM_FALLBACK_POINTS = 10_000 (§13.2: when nothing unowned remains at that rarity, credit 10,000 points instead — as a second ledger entry reason 'daily_item_fallback', same refId)
// economy/economy-service.ts
export interface EconomyService {
  dailyStatus(playerId, now?): Promise<{ claimable: boolean; day: number; streak: number; reward: number; item: string | null; nextResetAt: number; calendar: { day; points; item: string | null }[] }>
  claimDaily(playerId, now?): Promise<{ ok: true; day; points; item: string | null; fallbackPoints: number; balance: number; streak } | { ok: false; code: 'ALREADY_CLAIMED' }>   // one transaction: daily_logins update + balances.creditWithin(reason 'daily_login', refId `daily:${playerId}:${dayKey}`) + item per itemRuleForDay (random pick uses an injectable rng; fallback credit when none unowned) ; publishes DAILY_CLAIMED; calls onBalanceChanged
  reliefStatus(playerId, now?): Promise<{ eligible: boolean; reason: 'balance' | 'cooldown' | null; retryAt: number | null; threshold: number; target: number }>
  claimRelief(playerId, now?): Promise<{ ok: true; amount; balance } | { ok: false; reason: 'balance' | 'cooldown'; retryAt: number | null }>   // spec §12.4: balance < ECONOMY.reliefThreshold and lastReliefAt ≥ 24 h ago → top up to reliefTarget (amount = target − balance), reason 'relief', refId `relief:${playerId}:${nowMs}`; sets last_relief_at in the same tx; the eligibility read uses the FOR UPDATE row inside the tx
}
export function createEconomyService(deps: { db; repos: NormalRepositories; inventory: InventoryService; catalog: ItemCatalog; bus: AppEventBus; timezone: string; onBalanceChanged(playerId, balance): void; now?: () => number }): EconomyService
// stats/stats-service.ts — subscribes to HAND_SETTLED (skip cancelled; bots ignored), ROOM_JOINED (rooms_joined), LOGIN/DAILY_CLAIMED (login days/streak)
export interface StatsService { get(playerId): Promise<PlayerStats>; start(): () => void }
// achievements/definitions.ts — data/achievements.json per spec §14.1: [{ id, category: 'login'|'holdem'|'blind'|'social', metric: keyof PlayerStats, threshold: number, reward: { points?: number; itemId?: string } }] — EXACTLY the 28 rows of §14.2 (login_days_7/30/100, login_streak_7/28, holdem_hands_10/100/1000, holdem_wins_10/100/500, win_streak_3/5/10, lose_streak_10, hand_flush/full_house/quads/straight_flush/royal with best_hand_rank 5/6/7/8/9, big_win_100k/500k, blind_hands_10/100/1000, blind_wins_10/100, bot_hands_50, rooms_10/100, games_50/500) with the rewards listed there (titles are items of category 'title': `title_devoted`, `title_hot_hand`; items `hat_crown`, `jacket_champion`, `ring_royal`, `badge_veteran` must exist in items.json)
export function loadAchievements(path?): AchievementDef[]
// stats publishes { type: 'STATS_UPDATED', playerId, changedMetrics: (keyof PlayerStats)[] } on the bus after each write (§14.1)
// achievements/achievement-service.ts — subscribes to STATS_UPDATED; for defs whose metric changed and not yet unlocked: if stats[metric] ≥ threshold → one tx: upsert player_achievements(progress, unlocked_at) + credit reward points (reason 'achievement', refId `ach:${playerId}:${id}`) + grant item (source 'achievement'); then `game.notify(playerId, { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id, reward } })` (core `ServerMessage` already has `NOTIFICATION{kind, payload}`) and `onBalanceChanged`. Progress rows for not-yet-unlocked defs are upserted too so `list()` shows progress.
export interface AchievementService { list(playerId): Promise<{ id; progress; target; unlockedAt: number | null }[]>; start(): () => void }
// history/history-service.ts — reads repos.history.listForPlayer + game_players; returns spec §19.2 shape { handId, roomId, mode, startedAt, endedAt, net, won, bestCategory, players: [{ label, seat, isBot, net, won }] }
```

- [ ] **Step 1: Data files** — `items.json` with ~40 items (§15.1) across the eight categories: defaults `base_01`, `face_01`, `clothing_tee`, `hair_short` (isDefault) plus commons/rares/epics per layer (e.g. `hair_long`, `hair_bun`, `clothing_aodai`, `clothing_suit`, `accessory_glasses`, `accessory_conical_hat`, `jewelry_ring`, `hat_crown` (accessory, epic), `jacket_champion` (clothing, epic), `ring_royal` (jewelry, epic)), titles `title_devoted`, `title_hot_hand`, badges `badge_monthly`, `badge_veteran`; `nameKey` = `items.<id>` (i18n strings land in Plan 6). `assetKey` = `<category>/<id>`. `achievements.json` = the 28 rows of §14.2.
- [ ] **Step 2: Tests (PGlite)** — daily: first claim day 1 → +reward and ledger row with refId; second claim same day → `ALREADY_CLAIMED` with no balance change; consecutive days advance streak; a missed day resets to day 1; month rollover resets streak to 1; streak caps at 31 and days 29–31 pay day-29 points; day 7 grants one random unowned common (seeded rng → deterministic) and when none remain credits 10,000 fallback with reason `daily_item_fallback`; day 28 grants `badge_monthly` + `title_devoted` once, fallback none (fixed items already owned → no extra credit — ruling: the 10,000 fallback applies only to the random tiers); `dailyStatus.calendar` has 31 entries with item markers. Relief: not eligible above threshold; eligible → credit + `last_relief_at`; cooldown; rapid double-claim yields exactly one credit (sequential on PGlite; `Promise.all` on real PG). Stats: HAND_SETTLED updates played/won per mode, streaks, best hand, biggest win, bot_hands; cancelled hands ignored; bots ignored. Achievements: `holdem_hands_10` unlocks on the 10th HAND_SETTLED with points credited once; re-publishing the same STATS_UPDATED does not double-credit (idempotent by `unlocked_at`); `hand_royal` grants `ring_royal`; `login_streak_7` from DAILY_CLAIMED streak; progress rows visible before unlock. Inventory/avatar: default items granted at register and `defaultAvatar` stored; config referencing an unowned item → `NOT_OWNED`; wrong category → `WRONG_CATEGORY`; missing required layer → `MISSING_LAYER`; bad hairColor → `INVALID_COLOR`; omitting `title` unequips it. History: `listForPlayer` returns own net/won and opponents' labels, newest first, limit.
- [ ] **Step 3: Implement** all services; keep every credit inside `db.transaction` using `balances.creditWithin`.
- [ ] **Step 4:** run, lint, commit `feat(normal-server): daily reward with items, relief, stats, achievements, inventory/avatar, history`.

---

### Task 6: HTTP routes, app wiring (game server with cookie auth, static, health), `main.ts`, integration tests

**Files:**
- Create: `src/http/routes-me.ts` (profile/avatar/inventory/achievements/stats/history/ledger), `src/http/routes-rewards.ts` (daily/relief), `src/http/routes-catalog.ts` (items, achievements definitions, config), `src/http/routes.ts` (registers all + health), `src/app.ts`, `src/main.ts`, `src/migrate-cli.ts`, `src/app.test.ts` (integration), `src/http/routes-me.test.ts`, `routes-rewards.test.ts`
- Modify: `apps/normal-server/package.json` (scripts `start`, `migrate`), `.env.example` at repo root (append Normal vars)

**Routes (spec §19.2; all under `/api`, JSON, cookie auth via `requireUser` except catalog/health):**
- `GET /health` → `{ ok, edition: 'normal', version, db: 'ok'|'down', uptimeSec }` (503 when db down); `GET /api/config` → `{ edition, economy: ECONOMY, reconnectWindowSec, limits }`.
- `GET /api/me` → `{ playerId, displayName, email, balance, avatar: AvatarConfig, stats: { handsPlayed, handsWon } (summary), daily: dailyStatus, relief: reliefStatus, createdAt, lastLoginAt }` (mirrors Lite's shape so ui-kit's PlayerBar/daily screens can be shared); `PATCH /api/me` `{ displayName }` (validate via core; 409 `DISPLAY_NAME_TAKEN`; the live table keeps the old name until the next join — document).
- `GET /api/me/stats`, `GET /api/me/history?limit=20` (max 50), `GET /api/me/ledger?limit=50&before=<id>`.
- `GET /api/me/inventory` → `{ items: [...], avatar }`; `PUT /api/me/avatar` body `AvatarConfig` → 200 `AvatarView`; 400 `INVALID_ITEM|WRONG_CATEGORY|INVALID_COLOR|MISSING_LAYER`; 403 `NOT_OWNED`. `GET /api/players/:id/avatar` (auth required, any player) → `{ playerId, displayName, avatar }`, `cache-control: private, max-age=60`.
- `GET /api/me/achievements` → `[{ id, category, metric, threshold, reward, progress, unlockedAt }]` (definition + progress in one list, §19.2); `GET /api/catalog/items`.
- `GET /api/rewards/daily` (status), `POST /api/rewards/daily/claim` (200 result / 409 `ALREADY_CLAIMED` with `claimed:false`), `POST /api/economy/relief` (200 `{ granted: true, amount, balance }` / 409 `NOT_ELIGIBLE` with `granted:false, reason:'balance'|'cooldown', retryAt`) — same paths and shapes as Lite §19.3 so the two web apps share client code.
- Rate limits: auth 5/min per ip+email; mutating `/api/*` 60/min per session; reads 240/min per ip.

**app.ts:**
```ts
export interface AppDeps { config: NormalConfig; db: AppDb; closeDb(): Promise<void>; pingDb(): Promise<boolean>; log: Logger; now?: () => number }
export async function buildApp(deps: AppDeps): Promise<{ fastify: FastifyInstance; game: GameServer; services: { auth; economy; stats; achievements; inventory; history; catalog; bus }; close(): Promise<void> }>
```
Wiring: Fastify `{ logger: false, trustProxy: config.trustProxy, bodyLimit: 16 KiB }`; `@fastify/cookie`; http-kit `registerTolerantJsonParser`, `registerSecurityHeaders({ csp: DEFAULT_CSP + " font-src https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com" })`, `registerCsrfGuard`, `registerErrorHandler`; `createGameServer({ repos, resolver: { fromUpgrade: req => auth.identityForToken(cookieFromHeader(req.headers.cookie)) }, log, roomOptions: { reconnectWindowMs }, gatewayOptions: { allowedOrigins: config.allowedOrigins }, onDomainEvent: e => void bus.publish(e) })` (real option names from `packages/server-kit/src/server.ts` `GameServerOptions`: `repos`, `resolver`, `clock`, `rng`, `log`, `bot`, `roomOptions`, `gatewayOptions`, `onDomainEvent`, `shutdownTimeoutMs`); `auth.login` gets `onLogin: (playerId, at) => bus.publish({ type: 'LOGIN', playerId, at })`; `log = createJsonLogger(config.logLevel)` from http-kit; `catalog.seed(db)` at boot; `stats.start()` before `achievements.start()`; static route from `config.publicDir` (warn when missing → API-only); reserved prefixes `['/api', '/ws', '/health']`; `close()` memoized: `game.shutdown()` → `fastify.close()` → unsubscribe → `closeDb()`.
`main.ts`: `loadConfig(process.env + readDotenv('.env'))`, create pg db, `runMigrations` (guarded by env `AUTO_MIGRATE` default `true`), `buildApp`, listen, SIGTERM/SIGINT → `close()` with a 15 s deadline; log startup line without secrets. `migrate-cli.ts`: run migrations and exit (used by Compose init).

- [ ] **Step 1: Integration tests** with `buildApp` on PGlite (`fastify.inject`): register → cookie → `GET /api/me` 200; no cookie → 401; CSRF header missing on POST → 403; WebSocket upgrade with the cookie authenticates (use server-kit `TestClient` with `headers: { cookie }` — verify `TestClient` supports headers; if not, add an optional `headers` option to it in server-kit testing — note in report); upgrade without cookie → 4001; avatar/daily/relief/history/achievements routes happy + error paths; `/health` 503 when `pingDb` returns false; `close()` idempotent; a full hand between two registered players via `createRoomHarness`-style flow settles into `point_transactions` with a `table_fee` sink row and updates stats (`hands_played_holdem = 1` for both).
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** `pnpm --filter @bp/normal-server test && pnpm typecheck && pnpm lint && pnpm test`. Commit `feat(normal-server): REST routes, cookie-authenticated game server, app wiring and entrypoint`.

---
### Task 7: Build, Docker image, Compose (app + Postgres + Caddy), backup, docs, spec updates

**Files:**
- Create: `apps/normal-server/tsconfig.build.json`, `apps/normal-server/Dockerfile`, `apps/normal-server/.dockerignore`, `deploy/normal/docker-compose.yml`, `deploy/normal/Caddyfile`, `deploy/normal/.env.example`, `deploy/normal/backup.sh`, `deploy/normal/restore.md`, `docs/deployment-normal.md`, `docs/normal-server.md`, `apps/normal-server/test/build.test.ts` (runs `pnpm build` and asserts `dist/main.js` + `drizzle/*.sql` copied; skips when `CI_SKIP_BUILD`)
- Modify: root `package.json` (`build:normal` = `pnpm --filter @bp/normal-server build` — Plan 6 will chain the web build), `README.md` (edition table + quick start), spec §18.2 (final table list: email text lowercased, `games.id text`, `game_players(game_id, seat)` with nullable `player_id` + `label` + `is_bot`), §19.2 (final route list incl. `/api/config`, `/api/me/ledger`, `/api/catalog/items`, `/api/players/:id/avatar`, exact success/reject shapes like §19.3), §13.2 (fallback rule applies to random tiers only), §22.5 (env vars incl. `SESSION_SECRET`, `COOKIE_SECURE`, `TRUST_PROXY`, `AUTO_MIGRATE`, `PUBLIC_DIR`), §28.1 (Compose topology with the `migrate` service), Appendix A decision log (Drizzle + PGlite tests, argon2id params, http-kit, HMAC'd session ids)

**Build:** `tsc -p tsconfig.build.json` → `dist/` (ESM, `.js`), then copy `drizzle/` and `data/` next to `dist/` (script `scripts/build.mjs` — Node only). `runMigrations` resolves `migrationsFolder` from `import.meta.url` upward to the package root so it works from `src` (tests) and `dist` (runtime).

**Dockerfile** (multi-stage): `node:22-alpine` builder — `corepack` may be unavailable → `npm i -g pnpm@9`; `pnpm install --frozen-lockfile`; `pnpm --filter @bp/normal-server... build`; `pnpm --filter @bp/normal-server deploy --prod /out` (pnpm deploy bundles workspace deps); runtime stage `node:22-alpine`, non-root `node` user, `WORKDIR /app`, copy `/out`, `ENV NODE_ENV=production`, `EXPOSE 8080`, `HEALTHCHECK` curl-less (`node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1))"`), `CMD ["node","dist/main.js"]`. argon2 needs a prebuilt musl binary — `argon2` publishes `linux-musl-x64` prebuilds; if the install falls back to building, add `python3 make g++` to the builder stage only.

**Compose:** services `db` (`postgres:16-alpine`, volume `pgdata`, `POSTGRES_PASSWORD` from env, healthcheck `pg_isready`), `migrate` (app image, `command: node dist/migrate-cli.js`, `depends_on: db: condition: service_healthy`), `app` (depends on migrate `service_completed_successfully`, env from `.env`, `AUTO_MIGRATE=false`, internal port 8080, restart unless-stopped), `caddy` (`caddy:2-alpine`, ports 80/443, `Caddyfile` with `{$DOMAIN}` → `reverse_proxy app:8080` incl. WebSocket, volumes `caddy_data`, `caddy_config`). `.env.example`: `DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ALLOWED_ORIGINS=https://${DOMAIN}`, `ECONOMY_TIMEZONE=Asia/Ho_Chi_Minh`, `TRUST_PROXY=true`. `backup.sh`: `docker compose exec -T db pg_dump -U postgres -Fc bind_poker > backups/bp-$(date +%F-%H%M).dump` + retention 14 days; `restore.md`: `pg_restore` steps and the "stop app first" warning.

**Docs:** `docs/deployment-normal.md` (prereqs, DNS, `.env`, `docker compose up -d`, first-run migration, logs, backup/restore, upgrade = pull + `up -d` (migrate service reruns), env reference, security notes: HTTPS only, `COOKIE_SECURE=true`, `TRUST_PROXY=true` behind Caddy only, rate limits are per-instance); `docs/normal-server.md` (module map, event bus, ledger conventions incl. sink rows, how to add an item/achievement, running tests with/without `TEST_DATABASE_URL`, local dev without Docker: `pnpm --filter @bp/normal-server dev` using a local Postgres URL or `DATABASE_URL=pglite://./data` — **Ruling:** support `pglite://<dir>` in `createPgDb`? No: keep runtime on `pg` only; document that dev needs a Postgres URL (Docker `db` service alone: `docker compose up -d db`) to avoid shipping PGlite in the runtime image).

- [ ] **Step 1:** build script + tsconfig.build + `build.test.ts`; `pnpm build:normal` succeeds; `node apps/normal-server/dist/main.js` with a bad `DATABASE_URL` fails fast with the config/DB error (no stack for config errors).
- [ ] **Step 2:** Dockerfile/.dockerignore/Compose/Caddyfile/.env.example/backup.sh/restore.md. If a Docker daemon is available, `docker compose -f deploy/normal/docker-compose.yml build` and run `up -d` then `curl /health`; if not available (expected on this machine), validate with `docker compose config` when the CLI exists, else lint by reading and record in the report that the image was not built. Also run the Postgres-backed suites if `TEST_DATABASE_URL` can be provided; otherwise state it.
- [ ] **Step 3:** docs + spec amendments + README. `pnpm test && pnpm typecheck && pnpm lint`. Commit `feat(normal-server): build, Docker image, Compose with Postgres and Caddy, backup and deployment docs`.

---

## Self-review (writer's checklist)

- **Spec coverage:** §10 accounts (Task 4), §12 ledger/relief/monitoring sums (Tasks 3, 5), §13 daily + items (Task 5), §14 achievements (Task 5), §15 avatar/inventory (Task 5/6), §16.2 cookie upgrade (Task 6), §18.2/§18.4 (Task 2/7), §19.2 (Task 6), §22.5 env (Task 2/7), §23 security (Tasks 4/6), §28.1 deploy (Task 7), §29.4 tests (all). Normal web UI for these (§19–§21 client side) is Plan 6. Admin/monitoring UI (§12.5) is exposed only as `ledger.sums` + `/health` here; a dashboard is not in scope for MVP (spec says "SQL queries suffice").
- **Placeholders:** none intentional; the "check the real signature" notes point at concrete files because those signatures exist in the repo (server-kit `createGameServer`, `notify`, `TestClient`).
- **Type consistency:** `NormalRepositories.balances.creditWithin(tx, entries, meta)` used by Task 4 (register), Task 5 (daily/relief/achievements); `ItemCatalog.defaults()` used by Task 4; `AppEventBus` from Task 5 consumed by Task 6 wiring; `readSessionCookie` (Task 4) used in Task 6 resolver; `AvatarView` shape is defined once in `inventory/avatar.ts` and reused by `/api/me` and `/api/me/avatar`.
