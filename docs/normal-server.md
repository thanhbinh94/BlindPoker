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
  grant-wardrobe-cli.ts  operator tool: give one account every catalogue item (DATABASE_URL only)
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
  inventory/         slots.ts (the slot/gender/base vocabulary) · manifest.ts (loads avatar-manifest.json)
                     bases.ts (the v3 fixed figures, held against the manifest; goes in Plan 19's D1)
                     bodies.ts (the v4 bodies, one per gender, held against the manifest) · items.ts (catalogue)
                     aliases.ts (old wardrobe ids → current ones, or null when dropped)
                     inventory-service.ts (ownership, alias-aware) · outfits-service.ts (five saved outfits)
                     avatar.ts (config v3 + validation) · avatar-migrate.ts (reads a v1/v2 config back as v3)
  achievements/      definitions.ts (loader) · achievement-service.ts (listens, grants)
  stats/             player-stats.ts (the 16 counters) · stats-service.ts (listens, counts)
  history/           history-service.ts (writes a settled hand, reads a player's last N)
  http/              routes.ts + routes-auth/-me/-rewards/-catalog/-outfits.ts · auth-guard.ts · types.ts

data/                items.json, item-aliases.json, avatar-bases.json, avatar-bodies.json, achievements.json — content, not code
                      avatar-manifest.json — Task 1's asset pipeline output, mirrored from normal-web
drizzle/             committed migration SQL (0000 generated; 0001_avatar_v2, 0002_outfits hand-written, data only)
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

with live table stacks (Hold'em buy-ins and, since the table limit, Blind seats) and carry-over pots
as the third term, held in memory until the seat is left, the pot is paid or released, or the server
drains. `app.test.ts` asserts it over a real settled hand.

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
- **The hand's `table_fee` sink row is what was lost** — in either mode, since the table limit
  (a Blind hand, like a Hold'em one, moves only table stacks and writes nothing but that row). The
  seats' chips had already moved, so balances are right, but `Σ balances + Σ sinks` has drifted by
  exactly `fee` and has to be put back by hand: one sink row (`player_id null`, `amount = fee`,
  `reason = kind = 'table_fee'`, `ref_id = games.id`).

`point_transactions` is `ON DELETE restrict` on `players`. Deleting an account whose ledger rows
remain would turn its whole history — credits included — into sink rows and take its balance out of
the economy unaccounted. Erasing a player is a service that zeroes the balance *through the ledger*
first, not a `DELETE`.

---

## Adding a cosmetic item

`data/items.json` is the source of truth; the `items` table is a projection of it, upserted on every
boot so that foreign keys have something to point at. Nothing writes items at run time.

Since Plan 11 a figure is a fixed base (`f01`/`m01`) with PNG layers stacked on it, so an item names
a **slot** and one **asset**, shared by every base — a hat drawn once is worn by both:

1. Add an object to `data/items.json`:

   ```json
   { "id": "head_visor_neon01", "slot": "head", "rarity": "rare",
     "nameKey": "items.head_visor_neon01", "assetKey": "head/head_visor_neon01", "isDefault": false,
     "asset": { "layer": 80, "file": "item_head_visor_neon01_L80", "fitsAvatarCrop": true } }
   ```

   `slot` ∈ `hairStyle` `head` `face` `outfit` `aura` `frame` `hairColor` `eyeColor` `skinColor` `title`
   `badge` (`SLOTS` in `inventory/slots.ts`); `rarity` ∈ `common` `rare` `epic`.
   `hairStyle`/`head`/`face`/`outfit`/`aura`/`frame` are `DRAWN_SLOTS` and must carry `asset`; the three
   colour slots and `title`/`badge` draw nothing and must not. `asset.layer` is fixed by the slot (10 aura ·
   40 outfit · 60 hairStyle · 70 face · 80 head · 90 frame — `SLOT_LAYER` in `inventory/items.ts`) and
   `asset.file` must name an entry in `data/avatar-manifest.json` (Task 1's asset pipeline output,
   mirrored from `normal-web`) whose own `layer` agrees. A `head` may set `hidesHairFront`/`hidesHairBack`
   when it should cover the hair layers, and the manifest entry of its layer must say the same (bug 7).

   A **colour** (`hairColor`, `eyeColor`, `skinColor`) is an item with no asset and a required `colour`, a
   lowercase `#rrggbb`; the client paints it over the figure's own masked pixels. `free: true` (only ever on
   a non-default `common`) means every player owns it without an inventory row.

   A **hairstyle** (Plan 19) is two layers and three fields of its own, all required on `hairStyle` and
   refused on every other slot:

   ```json
   { "id": "hair_f_bob01", "slot": "hairStyle", "rarity": "common", "nameKey": "items.hair_f_bob01",
     "assetKey": "hairStyle/hair_f_bob01", "isDefault": false, "free": true,
     "gender": "f", "counterpart": "hair_m_tousled01", "naturalColour": "#5e3e6f",
     "asset": { "layer": 60, "file": "item_hair_f_bob01_L60", "back": "item_hair_f_bob01_L20", "fitsAvatarCrop": true } }
   ```

   `file` is the front half (L60, over the face), `back` the half behind the body (held to manifest layer
   20). `gender` is the body it is drawn for; `counterpart` is the hairstyle of the other gender a gender
   swap changes it to; `naturalColour` is the colour it is drawn in (the "Tự nhiên" swatch — for the six
   that replace the old bases, the base's own hair, measured). `asset.variants` and `asset.tint` are refused
   on a hairstyle. `asset.hairTint` is **derived** at load, like `tintMeanL`: `files` = `[back, file]`
   filtered to the layers with a non-empty hair mask, `meanL` = the front layer's mask (else the back's);
   absent when neither has one. `/api/catalog/items` serves it with the rest of the asset.

   An item that is drawn differently on a male and a female figure adds `asset.variants` — a file per
   `wear`, still **one item** with one id (2026-09-20):

   ```json
   "asset": { "layer": 40, "file": "item_outfit_dealer01_L40",
              "variants": { "m": "item_outfit_dealer01_m_L40" }, "fitsAvatarCrop": true }
   ```

   Keys are `f` and `m` (`GENDERS`) — the `wear` every base declares in `data/avatar-bases.json`, and the
   gender of a v4 body — and each file is held to the manifest exactly as `file` is. A base whose wear
   is not listed wears `file`. The
   catalogue row, ownership, achievements, the daily calendar and the outfits table are all unchanged
   by this: only the layer `/api/catalog/items` hands the client differs, and the client picks between
   them with the `wear` of the base it is drawing (`docs/avatar-2d.md` §3.1).

2. Run the asset pipeline (`apps/normal-web/scripts/avatar-pipeline.mjs ingest`, then `check`) so the
   file exists at both densities and is listed in the manifest, and add the `nameKey` string to the
   vi and en bundles.

3. Restart. `loadItemCatalog` validates the file against the manifest and **refuses to start** on a
   duplicate id, an unknown slot or rarity, a drawn slot with no asset (or a `title`/`badge` with
   one), an asset naming a file the manifest does not have or whose layer disagrees, a required slot
   with no default or with two, a default in an optional slot, or an absent `badge_monthly` /
   `title_devoted` — each of those would otherwise surface much later and much worse (a day-28 claim
   failing on a foreign key, on the 28th). Then, last, the two hairstyle cross-checks: each
   `DEFAULT_HAIR` id (`hair_f_bob01`, `hair_m_tousled01` — `inventory/slots.ts`) must be a free hairstyle
   of its gender, and every hairstyle's `counterpart` must be a hairstyle of the other gender (the pairing
   need not be symmetric: a future rare style may point at a free one). `inventory/items.test.ts` holds
   every asset against a fixture manifest the same way.

Things worth knowing before you pick a rarity:

- The **daily random draw** (days 7, 14, 21) picks an unowned item of that rarity, restricted to
  `DAILY_DRAW_SLOTS` (`head`/`face`/`aura`/`frame`/`hairColor`/`eyeColor` — `outfit` is drawable
  geometry but chosen deliberately, not handed out at random, and a `hairStyle` or a `skinColor` is a
  look the player picks, never a prize) and excluding every item named as an achievement reward and
  every `free` item. A new `common` or `rare` in one of those slots enlarges that pool; an `epic` never
  enters it.
- Making an item `isDefault: true` grants it to every **new** account. Existing players do not get
  it retroactively — that is what a data migration is for, and `drizzle/0002_outfits.sql` is the
  worked example: it inserts `outfit_casual01` and grants it to every `players` row, because
  `outfit` is required and nobody may be left without one.

### The bodies: `avatar-bodies.json`

Plan 19 (avatar v4) draws a figure on one body per **gender** instead of a fixed base: a bald body in
neutral underwear, its skin the "cream" tone, with the hair, the skin tone and the eyes chosen as items.
`data/avatar-bodies.json` names, for exactly `f` and `m`, the body layer, the six face layers and the
natural eye colour:

```json
{ "f": { "body": "body_f_L30",
         "faces": { "neutral": "body_f_face_neutral_L50", "happy": "…", "sad": "…", "surprised": "…", "closed": "…", "sleep": "…" },
         "naturalEyeColour": "#2e6a9b" },
  "m": { … } }
```

`loadBodies` (`inventory/bodies.ts`) reads it at boot against the avatar manifest and **refuses to start**
on a missing or unknown gender, a missing or unknown expression, a file the manifest does not have or
whose layer is not 30 (body) / 50 (faces), or a natural eye colour that is not a lowercase `#rrggbb`. Each
body's `tint` is **derived** from the manifest's masks, never written in the file: `skin` = the body and
every face with a non-empty skin mask, at the body's own `meanL`; `eyes` = the faces with a non-empty eye
mask, at `face_neutral`'s. The file ships with the server build (`SIDECARS` in `scripts/build.mjs`).

`GET /api/catalog/avatar` answers `{ frame, crop, bases, bodies, manifestVersion }`: `bodies` is both
`BodyDef`s, f then m, each `{ gender, body, faces, naturalEyeColour, tint? }`. `bases` (the v3 registry)
stays until the wire switches to v4 configs; until then the configuration contract is still v3, and the
new free hairstyles and skin colours simply appear in `/api/me/inventory` with `source: "free"`.

### Old wardrobe ids: `item-aliases.json`

Plan 11 replaced the whole slot vocabulary (`hair`/`top`/`bottom`/`shoes`/`hat`/`accessory`/`jewelry`
became `head`/`face`/`outfit`/`aura`/`frame`), but `inventory.item_id` rows are never rewritten — an
old id like `hat_crown` still means something, forever, to whoever already owns it.
`data/item-aliases.json` is old id → current id, or `null` for an id the new wardrobe dropped
outright (a headband, a ring, a pair of jeans); `inventory/aliases.ts` loads it and refuses a cycle.
`resolveItemId(id, aliases)` is `aliases.get(id) ?? id` and is applied everywhere an id might be one
of the old ones: `validateAvatarConfig`'s inputs, `inventory-service.ts`'s `owns`/`missingOf` (which
widen every id they are asked about to its whole alias class, so an inventory row under the old id
satisfies the new one), `grant`, which always writes the current id, and `GET /api/me/inventory`
(`http/routes-me.ts`), which resolves each row before joining the catalogue and collapses a player who
somehow holds both the old and the new row into one entry, keeping the old id as `acquiredAs`.

### The v1/v2 → v3 avatar migration

`items.category` is still the column name; it holds the current slot. `players.avatar_config` is
**not** rewritten: `readAvatarConfig` (`inventory/avatar-migrate.ts`) repairs anything that does not
validate on the way out — `body` → a chosen `base`, `hat`/`accessory`/`jewelry` resolved through the
alias map into `head`/`face`/`aura`, `top`/`bottom`/`shoes`/`clothing` collapsed into one `outfit`
(a v2 `clothing_suit` becomes `outfit_tuxedo01`; anything else falls back to the default outfit) —
while `PUT /api/me/avatar` accepts v3 only and answers `MISSING_LAYER` to anything else.

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

**A migration that also has to move data — `0001_avatar_v2.sql`, `0002_outfits.sql` — is hand-written**
rather than generated, in `0001`'s own style (its header comment says so), because `db:generate` diffs
`schema.ts` against `drizzle/meta/<n>_snapshot.json` and produces schema DDL only; it has no way to know
that existing rows need granting, remapping or backfilling. The snapshot still has to move, though:
`drizzle-kit` reads the latest `meta/<n>_snapshot.json` as "what the database already looks like" the
*next* time `db:generate` runs, and a hand-written migration that changes `schema.ts` (a new table, a
new column) without a matching snapshot leaves that file lying about the schema's real shape — the next
`generate` would then diff against the wrong baseline and emit DDL for changes that already shipped by
hand. `0002_snapshot.json` was produced by generating against a temporarily-reverted journal (so
`drizzle-kit` computed the real diff — one new table, `avatar_outfits` — from `0001`), then keeping only
the resulting snapshot and restoring the hand-written `0002_outfits.sql` (with its `INSERT`s intact) and
the original journal entry. The rule going forward: after a hand-written migration lands, generate a
throwaway migration once to capture the snapshot it implies, keep the snapshot, and discard the SQL file
`generate` wrote (the hand-written one already covers the DDL, plus the data move `generate` cannot see).

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
  and has no `players` row. Its engine-side id lives in `label`, which also survives a deleted
  account (`player_id` is `ON DELETE SET NULL`). `history-service` left-joins `players` on it, so a
  `HistorySeat` carries **both** `playerId` (the join key — `null` for a bot or a gone account) and
  `label` (the current display name for a human, `Bot n` for a bot — read back from the engine id
  `bot:<roomId>:<i>`, n = i + 1 — and the recorded label otherwise). A client filtering its own
  seat out of a hand must compare `playerId`: display names are not unique. A `HistoryEntry` also
  carries `roomName`, read from the config stored with the hand (`null` when a row has none).
- **`AUTO_MIGRATE` is read in `main.ts`, not in `loadConfig`** — it is a property of this startup,
  not of the server; `buildApp` could not use it.
- **The mutating rate limiter keys on a hash of the session cookie, not on `playerId`.** Fastify
  runs instance-wide `preHandler` hooks before a route's own, so `req.user` does not exist yet when
  the hook runs. Same granularity, no live token retained in a map.
- **`PATCH /api/me` does not rename a seated player** until they next join a room: the room actor
  keeps the identity it was given at bind.
