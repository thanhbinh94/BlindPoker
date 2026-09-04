# `@bp/normal-server`

## Purpose

The Normal edition's backend: accounts with passwords, a PostgreSQL-backed economy, cosmetics,
achievements, and the HTTP + WebSocket surface the web client (Plan 6) will talk to. It is the
edition-shaped shell around three packages that know nothing about it —
[`@bp/core`](../packages/core) (the pure engine), [`@bp/server-kit`](server-kit.md) (rooms, seats,
timers, bots, the WebSocket protocol) and `@bp/http-kit` (Fastify plumbing shared with Lite).

Its counterpart is `apps/lite`, which solves the same problem for one Windows executable and SQLite.
Neither may import the other; ESLint enforces it.

To *deploy* this, read [`deployment-normal.md`](deployment-normal.md) (Vietnamese, like every operator guide in this repository). This page is for changing the code, and is English, like every developer doc.

Spec: §10 accounts, §12–15 economy/daily/achievements/avatar, §18.2 schema, §19.2 API, §22.5 env.

---

## Module map

```
src/
  main.ts            entry point: env → config → pool → migrate → buildApp → listen → SIGTERM
  migrate-cli.ts     the same config load, then migrations only, then exit
  app.ts             buildApp(): wiring, in the one order that works (below)
  config.ts          loadConfig(env) — reports every problem at once, then throws
  trust-proxy.ts     TRUST_PROXY parsing, and the client address for the WS upgrade Fastify never sees
  events.ts          the process-local event bus
  errors.ts          ServiceError — a deliberate refusal, carrying the API's error code

  db/
    client.ts        createPgDb(url) → { db, close, ping }; AppDb/AppTx, the driver-neutral types
    schema.ts        the whole schema (§18.2)
    migrate.ts       runMigrations(); packageRoot() — how anything shipped beside dist/ is found
    pg-errors.ts     reading Postgres' error codes without matching on message text
    test-db.ts       a migrated throwaway database (PGlite, or real Postgres — see Testing)

  repos/             the data layer server-kit is handed, plus what this edition needs
    player-repo.ts   players + display names
    balance-repo.ts  the ledger: apply(), creditWithin(tx, …), LedgerReader (history + §12.5 sums)
    history-repo.ts  games / game_players
    index.ts         createRepositories(db) → NormalRepositories

  auth/              password.ts (argon2id) · session-service.ts · cookie.ts · auth-service.ts
  economy/           daily-rules.ts (pure) · economy-service.ts (daily claim, relief)
  inventory/         items.ts (catalogue) · inventory-service.ts (ownership) · avatar.ts (validation)
  achievements/      definitions.ts (loader) · achievement-service.ts (listens, grants)
  stats/             player-stats.ts (the 16 counters) · stats-service.ts (listens, counts)
  history/           history-service.ts (writes a settled hand, reads a player's last N)
  http/              routes.ts + routes-auth/-me/-rewards/-catalog.ts · auth-guard.ts · types.ts

data/                items.json, achievements.json — content, not code
drizzle/             generated, committed migration SQL
test/build.test.ts   the build itself, as a test
```

Two directories are read from **disk** at run time rather than compiled in: `drizzle/` and `data/`.
`packageRoot()` in `db/migrate.ts` finds them by walking up from `import.meta.url` to the directory
whose `package.json` is named `@bp/normal-server` — which works from `src/` under vitest, from
`dist/` after a build, and from `/app` inside the image, and is why the Dockerfile must keep
`package.json`, `dist/`, `drizzle/` and `data/` as siblings.

---

## The wiring order in `buildApp`

Most of it is arbitrary. Three steps are not, and each one is a bug if moved:

1. **`catalog.seed(db)` runs before any service exists.** Every cosmetic reward is a foreign key
   into `items`; a daily claim on the 7th against an unseeded table is a constraint violation.
2. **`stats.start()` is subscribed before `achievements.start()`.** The bus calls subscribers in
   subscription order and awaits each one, so the counters are written before the achievement layer
   reads them. Reversed, "did the counter land yet" becomes a race with no fix at the call site.
3. **`economy` is constructed with `reservedItemIds` = every `reward.itemId` in the achievement
   definitions.** That is what stops the daily random draw from handing out an item somebody was
   supposed to earn.

`buildApp` does not listen — `main.ts` calls `fastify.listen`. The WebSocket upgrade handler is
already attached when it returns.

---

## The event bus

`events.ts` is one process-local bus. The progression layer is a chain of reactions — a settled hand
moves counters, moved counters unlock achievements, an unlocked achievement credits points and
pushes a notification — and each link is a module with no business knowing the next one. The bus is
what lets `stats` be written without ever naming `achievements`.

```ts
type AppEvent =
  | DomainEvent                                                        // from server-kit
  | { type: 'DAILY_CLAIMED'; playerId; day; streak }
  | { type: 'STATS_UPDATED'; playerId; changedMetrics: StatMetric[] }
```

There is deliberately no `LOGIN` event: a "login day" is the daily check-in (§10.3 ruling), not a
sign-in, so nothing ever subscribed to one. `auth-service` still takes an optional `onLogin` hook for
whatever wants the fact later; `app.ts` passes none.

Three properties are load-bearing:

- **Sequential, in subscription order** — see point 2 above.
- **`publish` resolves only after every subscriber finishes.** That is what lets a test
  `await bus.publish(…)` and then assert on the database. The room actor deliberately does *not*
  wait: it calls `void bus.publish(e)`, because the game loop must not block on bookkeeping.
- **A failing subscriber is logged, never rethrown.** One achievement that could not be granted must
  not stop the next subscriber, and must not surface as an unhandled rejection inside whatever
  published the event.

`bus.idle()` waits for every publish already in flight, including ones a subscriber started
(a stats write raises `STATS_UPDATED`). `close()` awaits it between closing the listener and closing
the pool, so the last hand of a drain is fully accounted for.

---

## Ledger conventions

`point_transactions` is the only record of points moving. Everything — settlement, table fees, daily
rewards, relief, achievements — goes through `balances.apply()` or `balances.creditWithin(tx, …)`,
inside a transaction, and the `players.balance` update and its ledger rows are written together.

| Column | Meaning |
| --- | --- |
| `player_id` | The player, **or NULL for a sink row**: points that left balances and went to no player. |
| `amount` | Signed, from the player's point of view. A sink row records the amount *positively* — "this many points left player balances". |
| `reason` | What kind of movement this was. `settlement`, `table_fee`, `daily`, `daily_item_fallback`, `relief`, `achievement`, … |
| `ref_id` | What it was about: a `handId`, a room id, a claim id. Indexed, because "did this hand's settlement already land?" is a question reconciliation asks. |
| `kind` | Set on sink rows only. |

**A sink row's `reason` *is* its `kind`.** The same string is written to both columns: `reason` so
that `group by reason` in a §12.5 report sees fees beside every other flow, and `kind` so the row
satisfies the constraint `player_id is not null or kind is not null`. That constraint is the other
half of "a null player means sink" — a row with neither a player nor a kind cannot exist to be
miscounted as one.

The invariant this buys (spec §18.4):

```
Σ players.balance  +  Σ point_transactions where player_id is null  =  constant
```

with live Hold'em stacks and carry-over pots as the third term, held in memory until the hand ends
or the server drains. `app.test.ts` asserts it over a real settled hand.

### When a settlement failed

`balances.apply` can throw — a pool exhausted, a statement timeout, the database briefly gone. The
room records the hand anyway, with the reason in `games.settlement_error`, logs it, and still emits
`HAND_SETTLED` so nothing downstream stalls. Two things follow, and they are the reason the column is
worth querying:

```sql
select id, room_id, mode, fee, settlement_error, ended_at
  from games where settlement_error is not null order by ended_at desc;
```

- **No counter moved.** `stats-service` skips a flagged hand exactly as it skips a cancelled one, so
  no achievement can be bought by a failed write. `app.ts` raises one `error` line —
  `hand settlement failed` with the `handId`, `roomId` and `fee` — through `logSettlementFailure`.
- **A Hold'em hand's `table_fee` sink row is what was lost.** The seats' chips had already moved, so
  balances are right, but `Σ balances + Σ sinks` has drifted by exactly `fee` and has to be put back
  by hand: one sink row (`player_id null`, `amount = fee`, `reason = kind = 'table_fee'`,
  `ref_id = games.id`). A Blind hand moved nothing at all and needs nothing.

`point_transactions` is `ON DELETE restrict` on `players`. Deleting an account whose ledger rows
remain would turn its whole history — credits included — into sink rows and take its balance out of
the economy unaccounted. Erasing a player is a service that zeroes the balance *through the ledger*
first, not a `DELETE`.

---

## Adding a cosmetic item

`data/items.json` is the source of truth; the `items` table is a projection of it, upserted on every
boot so that foreign keys have something to point at. Nothing writes items at run time.

1. Add an object to `data/items.json`:

   ```json
   { "id": "hair_braid", "category": "hair", "rarity": "rare",
     "nameKey": "items.hair_braid", "assetKey": "hair/hair_braid", "isDefault": false }
   ```

   `category` ∈ `base` `face` `clothing` `hair` `accessory` `jewelry` `title` `badge`;
   `rarity` ∈ `common` `rare` `epic`.

2. Add the SVG layer under `assetKey` in `normal-web` (Plan 6) and the `nameKey` string to the vi and
   en bundles.

3. Restart. `loadItemCatalog` validates the file and **refuses to start** on a duplicate id, an
   unknown category or rarity, a missing default for a required avatar layer, or an absent
   `badge_monthly` / `title_devoted` — each of those would otherwise surface much later and much
   worse (a day-28 claim failing on a foreign key, on the 28th).

Things worth knowing before you pick a rarity:

- The **daily random draw** (days 7, 14, 21) picks an unowned item of that rarity, excluding
  `title` and `badge` categories entirely and excluding every item named as an achievement reward.
  A new `common` or `rare` in a normal category enlarges that pool; an `epic` never enters it.
- Making an item `isDefault: true` grants it to every **new** account. Existing players do not get
  it retroactively.

## Adding an achievement

`data/achievements.json`, one object per achievement:

```json
{ "id": "blind_wins_500", "category": "blind", "metric": "handsWonBlind",
  "threshold": 500, "reward": { "points": 30000 } }
```

`metric` must be a key of `PlayerStats` (`stats/player-stats.ts`); `reward` is `{ points }`,
`{ itemId }` or both. An `itemId` must exist in `items.json` — and adding one automatically removes
that item from the daily draw pool, because `app.ts` passes every reward id as `reservedItemIds`.

Restart and it is live: the achievement service evaluates definitions whose metric appears in a
`STATS_UPDATED` event, so a player who is already past the threshold unlocks it on their next
counted hand — not retroactively at boot.

**Adding a new *metric* is a schema change**: a column on `player_stats`, a migration
(`pnpm --filter @bp/normal-server db:generate`, then commit the generated SQL), and the counting
logic in `stats/stats-service.ts`.

---

## Running the tests

```bash
pnpm --filter @bp/normal-server test
```

Every database test spins up its own **PGlite** — real Postgres compiled to WebAssembly, in this
process — and runs the committed migrations against it. Nothing to install, no container, no shared
state between test files. That is why `vitest.config.ts` raises the timeouts.

To run the same suites against a **real** PostgreSQL:

```bash
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres pnpm --filter @bp/normal-server test
```

`createTestDb()` then creates a fresh database per call (`bp_test_<random>`) and drops it on close.
A whole database rather than a schema, because the generated migration writes its foreign keys as
`REFERENCES "public"."players"`: under a different `search_path` the tables would be created in the
throwaway schema while every foreign key still pointed at `public`.

**Run this once against a real server before every deploy, and record the output.** PGlite is the
same Postgres, but it is single-connection, so anything about genuine concurrency —
`SELECT … FOR UPDATE` under contention in settlement, above all — is only really exercised here:
`balance-repo.test.ts` picks `Promise.all` over back-to-back on exactly this condition, and one case
in `economy-service.test.ts` is `it.skip` without it. There is no CI in this repository, so nothing
else will do it for you. `docs/deployment-normal.md` §2 has the exact commands for standing the
Compose `db` service up for the run.

`test/build.test.ts` runs the actual build and boots what it produced; `CI_SKIP_BUILD=1` skips it.

---

## Local development

There is no PGlite fallback in the runtime: `createPgDb` speaks `pg` and only `pg`. Shipping a WASM
Postgres inside the production image to serve a developer convenience is the wrong trade, so a
developer needs a real database. The cheapest one is the stack's own `db` service, alone:

```bash
docker compose -f deploy/normal/docker-compose.yml up -d db
```

That needs `deploy/normal/.env` to exist (copy `.env.example`) for `POSTGRES_PASSWORD`, and it
publishes nothing — reach it from the host by adding a `ports: ["5432:5432"]` override, or run any
local Postgres instead. Then, in `apps/normal-server/.env` or your shell:

```bash
DATABASE_URL=postgres://postgres:<password>@localhost:5432/bind_poker
SESSION_SECRET=at-least-thirty-two-characters-long-please
ALLOWED_ORIGINS=http://localhost:5173
COOKIE_SECURE=false            # a browser will not send a Secure cookie over http://
```

```bash
pnpm --filter @bp/normal-server dev      # build, then node dist/main.js
```

`dev` builds first: there is no watch mode and no ts-node here — the build is ~10 s and the thing
you run is then exactly the thing that ships. `AUTO_MIGRATE` defaults to true, so the schema is
applied on start.

If you only want to check that something compiles and passes:

```bash
pnpm --filter @bp/normal-server typecheck
pnpm --filter @bp/normal-server test
pnpm lint
```

---

## Deviations from a literal reading of the spec

Recorded here as well as in the spec's decision log, because these are the ones you will trip over
while reading the code:

- **`users.email` is `text` with a `CHECK (email = lower(email))`**, not `citext` — same semantics,
  no extension required in the target database.
- **`games.id` is the engine's `handId`** (text), and cancelled hands are recorded too, with
  `settlement_error` holding the reason settlement was refused.
- **`game_players` is keyed `(game_id, seat)`** with a nullable `player_id`: a bot occupies a seat
  and has no `players` row. Its engine-side id lives in `label`.
- **`AUTO_MIGRATE` is read in `main.ts`, not in `loadConfig`** — it is a property of this startup,
  not of the server; `buildApp` could not use it.
- **The mutating rate limiter keys on a hash of the session cookie, not on `playerId`.** Fastify
  runs instance-wide `preHandler` hooks before a route's own, so `req.user` does not exist yet when
  the hook runs. Same granularity, no live token retained in a map.
- **`PATCH /api/me` does not rename a seated player** until they next join a room: the room actor
  keeps the identity it was given at bind.
