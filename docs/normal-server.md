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
  grant-gm-cli.ts    operator tool: make an account a GM, or take the role back (--revoke); DATABASE_URL only
  reputation-backfill-cli.ts  operator tool, once per Plan 27 upgrade: credit every account the reputation its
                     history earned (--dry-run first); DATABASE_URL only — see "Reputation, the shop and the welcome gift"
  e2e-entry.ts       the e2e server's own entry; e2e-promote.ts is its one extra route (never in dist/)
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
  economy/           daily-rules.ts (pure) · daily-gifts.ts (the gift schedule, loaded and checked) · gift-schedule-store.ts (the file plus a GM's months) · economy-service.ts (daily claim with the newcomer calendar, relief)
                     · welcome-service.ts (the welcome gift, Plan 27)
  reputation/        reputation-service.ts (rules, ranks, grants, the HAND_SETTLED listener) · backfill.ts (the CLI's logic)
  shop/              shop-service.ts (the shelves, locks, the purchase, the GM's edits) · shop-prices-seed.ts (seeded at boot)
  inventory/         slots.ts (the slot and gender vocabulary) · manifest.ts (loads avatar-manifest.json)
                     bodies.ts (the v4 bodies, one per gender, held against the manifest) · items.ts (catalogue)
                     aliases.ts (old wardrobe ids → current ones, or null when dropped)
                     inventory-service.ts (ownership, alias-aware) · outfits-service.ts (five saved outfits, read as v4)
                     avatar.ts (config v4 + validation) · avatar-migrate.ts (reads a v1/v2/v3 config back as v4)
                     colour.ts (Lab and ΔE76, for the migration's eye rule)
  achievements/      definitions.ts (loader) · achievement-service.ts (listens, grants)
  stats/             player-stats.ts (the 16 counters) · stats-service.ts (listens, counts)
  history/           history-service.ts (writes a settled hand, reads a player's last N)
  gm/                gm-service.ts (points, items, lock, role, reads, the action log) · gm-rooms.ts (list, kick, close:
                     a thin layer over the live rooms) · grant-gm.ts (the CLI's logic) · mask-email.ts
  http/              routes.ts + routes-auth/-me/-rewards/-catalog/-outfits/-gm/-shop/-welcome.ts · auth-guard.ts · types.ts

data/                items.json, item-aliases.json, avatar-bodies.json, achievements.json, daily-gifts.json — content, not code
                      avatar-manifest.json — Task 1's asset pipeline output, mirrored from normal-web
drizzle/             committed migration SQL (0000 generated; 0001_avatar_v2, 0002_outfits hand-written, data only;
                      0003_ledger_keys generated, then guarded with IF NOT EXISTS — the keys `balances.apply` claims;
                      0004_gm generated, then guarded with IF NOT EXISTS — users.role, locked_at, locked_reason and gm_actions;
                      0005_plan26 — gift_months, inventory.ref; 0006_plan27 — reputation, shop, newcomer and welcome tables,
                      players.reputation/rank/welcome_claimed_at, daily_logins.consecutive, and the month-count data step)
test/build.test.ts   the build itself, as a test
```

Two directories are read from **disk** at run time rather than compiled in: `drizzle/` and `data/`.
`packageRoot()` in `db/migrate.ts` finds them by walking up from `import.meta.url` to the directory
whose `package.json` is named `@bp/normal-server` — which works from `src/` under vitest, from
`dist/` after a build, and from `/app` inside the image, and is why the Dockerfile must keep
`package.json`, `dist/`, `drizzle/` and `data/` as siblings.

---

## The wiring order in `buildApp`

Most of it is arbitrary. Four steps are not, and each one is a bug if moved:

1. **`catalog.seed(db)` runs before any service exists.** Every cosmetic reward is a foreign key
   into `items`; a daily claim on the 7th against an unseeded table is a constraint violation.
2. **`stats.start()` is subscribed before `achievements.start()`.** The bus calls subscribers in
   subscription order and awaits each one, so the counters are written before the achievement layer
   reads them. Reversed, "did the counter land yet" becomes a race with no fix at the call site.
3. **`economy` is constructed with `reservedItemIds` = every `reward.itemId` in the achievement
   definitions, and with `gifts` = `loadDailyGifts(catalog)`.** Both are kept off the daily random
   draw: an item somebody was supposed to earn, or one the schedule promises for a month.
   `loadDailyGifts` runs right after `loadAchievements` and before `seed`, so a bad schedule stops
   the boot before anything is written.
4. **The Plan 27 seeds run at boot, next to `catalog.seed`** (`seedReputationDefaults`, `seedShopPrices`,
   `seedShopConfig`, all `ON CONFLICT DO NOTHING`): the test harness truncates `users … cascade` between tests, and
   `shop_prices` needs one row per catalogue item, which a migration cannot read. `reputation.start()` subscribes
   after `achievements.start()`, so a hand's reputation is granted after its counters and unlocks.

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
  | { type: 'DAILY_CLAIMED'; playerId; day; streak; consecutive }   // streak = the month's claims (Plan 27)
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
| `reason` | What kind of movement this was. `settlement`, `table_fee`, `daily`, `daily_item_fallback`, `relief`, `achievement`, `gm_grant`, `gm_adjust`, … The last two are a GM's (Plan 25): both are **sources** like `daily`, and their `ref_id` is `gm:<gm_actions.id>`, so the ledger row and the log row point at each other. |
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

Since Plan 19 a figure is one of two bodies (`f`, `m`) with PNG layers stacked on it, so an item names
a **slot** and one **asset**, shared by both bodies — a hat drawn once is worn by both (a hairstyle is the one
drawn-per-gender item, below):

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
   `asset.clipsHair` (2026-10-06) is never written in `items.json`: it is set on any item whose layer's manifest
   entry carries a `masks.hairClip` (the beret, the beanie and the nón lá, so every colour of them), and tells the
   client to draw both hair layers through that `<file>_hairclipmask`.

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
   swap changes it to; `naturalColour` is the colour it is drawn in (the "Tự nhiên" swatch — measured from the
   art with `avatar-pipeline.mjs colours`; for the six that took over from the flat bases' hair it is that hair's colour, so an old player keeps their look). `asset.variants` and `asset.tint` are refused
   on a hairstyle. `asset.hairTint` is **derived** at load, like `tintMeanL`: `files` = `[back, file]`
   filtered to the layers with a non-empty hair mask, `meanL` = the front layer's mask (else the back's);
   absent when neither has one. `/api/catalog/items` serves it with the rest of the asset.

   An item that is drawn differently on a male and a female figure adds `asset.variants` — a file per
   `wear`, still **one item** with one id (2026-09-20):

   ```json
   "asset": { "layer": 40, "file": "item_outfit_dealer01_L40",
              "variants": { "m": "item_outfit_dealer01_m_L40" }, "fitsAvatarCrop": true }
   ```

   Keys are `f` and `m` (`GENDERS`) — the gender of a v4 body, which is the `wear` it dresses in — and each
   file is held to the manifest exactly as `file` is. A body whose gender is not listed wears `file`. The
   catalogue row, ownership, achievements, the daily calendar and the outfits table are all unchanged
   by this: only the layer `/api/catalog/items` hands the client differs, and the client picks between
   them with the gender of the body it is drawing (`layerFileFor`; `docs/avatar-2d.md` §3.1).

2. Run the asset pipeline (`apps/normal-web/scripts/avatar-pipeline.mjs ingest`, then `check`) so the
   file exists at both densities and is listed in the manifest, and add the `nameKey` string to the
   vi and en bundles.

3. Restart. `loadItemCatalog` validates the file against the manifest and **refuses to start** on a
   duplicate id, an unknown slot or rarity, a drawn slot with no asset (or a `title`/`badge` with
   one), an asset naming a file the manifest does not have or whose layer disagrees, a required slot
   with no default or with two, or a default in an optional slot — each of those would otherwise
   surface much later and much worse. (Whether the gifts the check-in names exist is `loadDailyGifts`'
   to check since Plan 22 — see "Changing the daily gifts".) Then, last, the two hairstyle cross-checks: each
   `DEFAULT_HAIR` id (`hair_f_bob01`, `hair_m_tousled01` — `inventory/slots.ts`) must be a free hairstyle
   of its gender, and every hairstyle's `counterpart` must be a hairstyle of the other gender (the pairing
   need not be symmetric: a future rare style may point at a free one). `inventory/items.test.ts` holds
   every asset against a fixture manifest the same way.

Things worth knowing before you pick a rarity:

- The **daily random draw** (the tiers `data/daily-gifts.json` makes draws — days 7, 14 and 21 by
  default) picks an unowned item of that rarity, restricted to
  `DAILY_DRAW_SLOTS` (`head`/`face`/`aura`/`frame`/`hairColor`/`eyeColor` — `outfit` is drawable
  geometry but chosen deliberately, not handed out at random, and a `hairStyle` or a `skinColor` is a
  look the player picks, never a prize) and excluding every item named as an achievement reward, every
  item the gift schedule names, and every `free` item. A new `common` or `rare` in one of those slots
  enlarges that pool; an `epic` never enters it.
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
         "naturalEyeColour": "#2a6492" },
  "m": { … } }
```

`loadBodies` (`inventory/bodies.ts`) reads it at boot against the avatar manifest and **refuses to start**
on a missing or unknown gender, a missing or unknown expression, a file the manifest does not have or
whose layer is not 30 (body) / 50 (faces), or a natural eye colour that is not a lowercase `#rrggbb`. Each
body's `tint` is **derived** from the manifest's masks, never written in the file: `skin` = the body and
every face with a non-empty skin mask, at the body's own `meanL`; `eyes` = the faces with a non-empty eye
mask, at `face_neutral`'s. The file ships with the server build (`SIDECARS` in `scripts/build.mjs`).

`GET /api/catalog/avatar` answers `{ frame, crop, bodies, manifestVersion }`: `bodies` is both
`BodyDef`s, f then m, each `{ gender, body, faces, naturalEyeColour, tint? }`. There is no `bases` any more: the
wire speaks v4 since Plan 19's A5, and the old base registry (its JSON file, `inventory/bases.ts`, `loadBases` and
the `BaseId` vocabulary) was deleted by the switch-over (D1): an old account's base is read once, in
`avatar-migrate.ts` (below). The free hairstyles and skin colours appear in `/api/me/inventory` with
`source: "free"`.

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

### The avatar configuration: v4

Plan 19 replaces the fixed base with a gender and three items (spec §4.1). `inventory/avatar.ts`:

```ts
{ v: 4, gender: 'f' | 'm', hairStyle, outfit,          // required
  skinColor?, hairColor?, eyeColor?,                     // colours: absent = the body's / hairstyle's own
  head?, face?, aura?, frame?, title?, badge? }          // every value an item id
```

`hairStyle` must be a hairstyle drawn for `gender`. A new account is `{ v: 4, gender: 'f', hairStyle:
'hair_f_bob01', outfit: 'outfit_casual01' }` (`defaultAvatar`). Every hairstyle and skin colour a player
starts with is `free`, so wearing one is always owned — but `itemIdsOf` lists them (hairstyle first, in
`SLOTS` order) and `applyAvatarConfig` asks, as for any item. A `PUT` is a full replace: the stored value
is rebuilt key by key, so an omitted slot is emptied and an unknown key never reaches the database.

`validateAvatarConfig(input, catalog)` has five error codes and answers the first check that fails, in this
order (spec §4.1, ruling 9) — the structural complaint always first:

1. not an object → `MISSING_LAYER`;
2. `v` is not `4` → `MISSING_LAYER` (a v3 body included: v1–v3 are readable, not writable);
3. the body still carries `base`, whatever its value → `INVALID_BASE` (v4 has no such field);
4. `gender` is not `'f'`/`'m'` → `MISSING_LAYER`;
5. `hairStyle` or `outfit` is not a non-empty string → `MISSING_LAYER`;
6. an optional slot that is neither absent/`null` (empty) nor a non-empty string → `INVALID_ITEM`;
7. for every slot in `SLOTS`: an id the catalogue does not have → `INVALID_ITEM`; one that belongs to another
   slot (a skin colour as a hairstyle, a face piece as a hat) → `WRONG_CATEGORY`;
8. the hairstyle is drawn for the other gender → `WRONG_GENDER`.

### Reading old configurations: v1/v2/v3 → v4

`items.category` is still the column name; it holds the current slot. `players.avatar_config` is **never
rewritten** by a migration: `readAvatarConfig(stored, catalog, aliases, bodies)` (`inventory/avatar-migrate.ts`)
repairs anything that does not validate on the way out, and the column changes only when the player presses
Save. Saved outfits, `avatar_outfits.config`, go through the same read: `GET /api/me/outfits` lists each row as
the v4 it reads as, and `POST /api/me/outfits/:slot/apply` reads the row, checks the player owns every item of that
v4 (`ITEM_NOT_OWNED` otherwise) and stores it — so applying an outfit saved before Plan 19 writes v4 into
`players.avatar_config`, never an old base (R6). Listing never rewrites the row. A valid v4 passes straight
through. Otherwise:

- **A stored `v: 4`** (a withdrawn item, a hairstyle of the other gender) is repaired as itself: the gender
  kept if it is one (else `f`), the hairstyle kept if it is drawn for that gender (else `DEFAULT_HAIR`), every
  other slot kept if the catalogue still has it in that slot — and checked again, falling back to the default.
- **Anything else** is repaired as a v3 first, as it always was — `body` → a base (`female` f01, `male` m01,
  none f01), `hat`/`accessory`/`jewelry` resolved through the alias map into `head`/`face`/`aura`,
  `top`/`bottom`/`shoes`/`clothing` collapsed into one `outfit` (a v2 `clothing_suit` becomes
  `outfit_tuxedo01`; anything else falls back to the default outfit) — now **keeping** `hairColor` and
  `eyeColor` (spec §4.5: the v3 repair used to drop them). Then the base becomes a gender, a hairstyle and a
  skin colour (`V3_BASES`, table 4.5), and every other slot is carried across:

| Old base | gender | hairStyle | skinColor | eyeColor (from the eye rule) |
| --- | --- | --- | --- | --- |
| f01 | f | `hair_f_bob01` | — (the bodies' own "cream") | — (`keepEyes`) |
| f02 | f | `hair_f_hime01` | `skin_porcelain01` | `eyecolor_grey01` |
| f03 | f | `hair_f_wavy01` | `skin_tan01` | `eyecolor_green01` (pinned) |
| m01 | m | `hair_m_tousled01` | `skin_lighttan01` | — (`keepEyes`) |
| m02 | m | `hair_m_neat01` | `skin_fair01` | `eyecolor_grey01` |
| m03 | m | `hair_m_curly01` | `skin_deep01` | — (the m body's own eyes: nearer than `eyecolor_brown01`) |
| anything else | f | `hair_f_bob01` | — | — |

**The eye rule.** A body's face layers carry their own eyes, so an old base whose eyes were another colour
would come back with someone else's. The rule exists to keep a look, not to move it (Plan 19 final review). When
the config has no `eyeColor` of its own, the old base's iris (`V3_BASES[base].naturalEye`, measured from the
committed art, ruling 6) is more than `EYE_KEEP_DELTA_E` = 12 (ΔE76 in CIE Lab, `inventory/colour.ts`) from the
new body's `naturalEyeColour`, and the pick — the row's pinned one, else the nearest free eye colour (ties to the
earlier catalogue row) — is **nearer that iris than the body's own eyes are**, the config is given the pick
(`eyeRuleColour`); otherwise it keeps the body's eyes. A chosen eye colour always wins. f01 and m01 never get one
(`keepEyes`): the bodies are drawn from them, so their eyes are the bodies' own. f03's iris measures nearer
`eyecolor_amber01` than `eyecolor_green01` (ΔE 39.7 against 40.5) but reads as green, so green is pinned (ruling 6) —
and the pin is held to the same comparison. With the shipped bodies' natural eyes, measured on the real art
(`avatar-pipeline.mjs colours`: f `#2a6492`, m `#945e26`, in `avatar-bodies.json`), the distances from each old iris
are:

| Old base | iris | to the body's eyes | to the pick | outcome |
| --- | --- | --- | --- | --- |
| f02 | `#6b5771` | 25.1 | `eyecolor_grey01` 23.7 | grey01 |
| f03 | `#a9a564` | 70.1 | `eyecolor_green01` (pinned) 40.5 | green01 |
| m02 | `#998c91` | 44.8 | `eyecolor_grey01` 10.6 | grey01 |
| m03 | `#ad6f4a` | 12.7 | `eyecolor_brown01` 22.9 | none: brown01 would move the look further than the body's eyes do |

`avatar-migrate.test.ts` pins that table literally against `loadBodies()`, and the rule's mechanics on fixture bodies
with the provisional values (f `#2e6a9b`, m `#cc924c`).

**The wire is v4** (Plan 19, A5, with the client in the same commit). `PUT /api/me/avatar` and
`PUT /api/me/outfits/:slot` validate with `validateAvatarConfig`, so a v3 body is `MISSING_LAYER` and any `base`
key `INVALID_BASE`; `GET /api/me`, `GET /api/me/inventory`, `GET /api/players/:id/avatar`, `GET /api/me/outfits` and
`POST /api/me/outfits/:slot/apply` answer v4 through `readAvatarConfig`; a new account is registered wearing
`catalog.defaultAvatar()` (v4). The database is written only by a save, an apply and `PUT /api/me/avatar` — a read
never rewrites a row (spec §4.5).

## Changing the daily gifts

The check-in's item column is data: `data/daily-gifts.json` (spec
`docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`).
The points column is not — it is `DAILY_REWARD_POINTS` in `@bp/core`, shared with Lite, which has no item column at all
(§13.3).

```json
{
  "default": { "7": { "draw": "common" }, "14": { "draw": "rare" }, "21": { "draw": "rare" },
               "28": { "fixed": ["badge_monthly", "title_devoted"] } },
  "months": {
    "2026-11": { "28": { "fixed": ["badge_monthly", "title_devoted", "head_tophat01"] } }
  }
}
```

- A key under `default` or a month is a **tier** (1–31), not a calendar date: since Plan 27 (spec G) tier N is the
  player's N-th claim of the month, consecutive or not (`daily_logins.streak` keeps its name and holds that count). The
  count restarts every month, so tier 28 is claimed on the 28th to the 31st, depending on how many days were missed.
  The consecutive run lives in `daily_logins.consecutive` and feeds only the two streak achievements.
- A rule is `{ "draw": "common" | "rare" }` — an unowned item of that rarity from `DAILY_DRAW_SLOTS`, minus every
  reserved id, or `NO_ITEM_FALLBACK_POINTS` under `daily_item_fallback` when none is left — or `{ "fixed": [ids] }`,
  exactly those items, skipping any the player owns and never paid for.
- A month's rule for a tier **replaces** the default's for that tier. Write a `fixed` list in full: to add a gift to
  day 28, list `badge_monthly` and `title_devoted` again.
- A gift named in the `default` is always listed to the wardrobe with no month ("Quà điểm danh ngày 28"), even during a
  month whose own entry drops it. So a month entry should keep the default's pair (the shipped months all do), or the
  hint stays as it is.
- The claim reads the month it is made in (`monthKey` in `ECONOMY_TIMEZONE`). `GET /api/rewards/daily` serves the
  current month's calendar (`month`, and each fixed tier's `items`). `GET /api/catalog/items` carries `dailyGifts`:
  each named item's first tier and month from the current month on, `month: null` for the default's — what the
  wardrobe's locked tiles say.
- Every id in any `fixed` list, past months included, is kept off the random draw, like the achievements' rewards.
- Prefer an epic, or an item outside the draw slots, for a dated month's `fixed` list. A common or a rare of
  `head`/`face`/`aura`/`frame`/`hairColor`/`eyeColor` that only a past month names stays off the draw for good, while
  `dailyGifts` stops listing it once its month is over — so its locked tile falls back to "Có thể nhận từ quà điểm danh
  (thường/hiếm)", which the draw will never keep. Put such an item in the `default`, or schedule it again, or accept the
  wrong hint (`docs/known-limitations.md`, UI).
- Each `draw` tier pays `NO_ITEM_FALLBACK_POINTS` (10,000, `daily_item_fallback`) to a player who owns its whole pool:
  adding draw tiers raises what a month can pay (conservation is unaffected).
- The calendar always shows 31 tiers, so a `default` tier 29–31 is advertised in a 30-day month and in February, where
  the month's count never reaches it. Prefer month entries for those tiers.

To add or change a month:

1. Edit the file. An item new to the catalogue goes in first (`items.json` and both locales — "Adding a cosmetic item").
2. Check it: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`. That suite loads this
   very file against the real catalogue. It also pins what the user decided on 12/10: October 2026 as it was — read
   through the `default`, so **a change to the default turns it red** — and the six months 11/2026 to 04/2027, which
   `src/http/routes-rewards.test.ts` (`grants the shipped November gift over HTTP`, `serves the calendar of the
   current month, with the item ids of a fixed day`) and `src/app.test.ts` (`serves the named daily gifts beside the
   catalogue, from the current month on`) also read. (The service tests in `economy-service.test.ts` write their own
   schedule out, so an edit to the file never reaches them.) Adding a month, or
   giving an item again in a later month, turns none of them red. Changing the default or one of those months changes
   a promise: do it on the user's word, and in the same commit either write today's column out as an explicit
   `"2026-10"` entry or update the test.
3. Merge as usual, then restart. The file is read at boot, not built in: on the LAN host check `/health` for
   `"rooms":0` (`stop.ps1` is a hard kill), then `stop.ps1` and `run.ps1 -NoMigrate` — no `build:normal` is needed for
   a change to this file alone. In Docker `data/` is inside the image, so `up -d --build`. No migration either way.

**A GM edits a month without a restart (Plan 26).** The JSON file is the *default*; the months a GM sets live in the
table `gift_months` (`month` text primary key, `days` jsonb — the same `{ "<tier>": rule }` object a month holds in the
file — `updated_at`, `updated_by`, migration 0005) and **replace** that month's entry in the file as a whole. The old way
above still works and still sets the default and the file's months; a month with no row falls back to it, and deleting a
row brings the file's entry back. `GiftScheduleStore` (`src/economy/gift-schedule-store.ts`) builds the schedule the
economy reads from the file and the rows (`current()`), and rebuilds it after a write commits (`reload()`). The economy
takes `current()` once per claim and keeps that copy, so a claim that began before a change finishes under the schedule it
began with and the next claim sees the new one.

- `GET /api/gm/gifts` → `{ default, months }`: the file's default, and one row per month from the current one for 13
  months (each `{ month, days, source: 'file' | 'db', updatedAt, updatedBy }`, plus any later month the file or a GM
  names). `PUT /api/gm/gifts/:month` `{ days, reason }` replaces a month; `DELETE /api/gm/gifts/:month` `{ reason }` drops
  the GM's row. Each is a `gm_actions` row in the same transaction (`set_gift_month`, with `details: { month, days }`;
  `clear_gift_month`, with `details: { month }`), so the Nhật ký shows who changed what and why.
- Refused, before any row is written: `INVALID_MONTH` (400, not `YYYY-MM`); `INVALID_GIFTS` (400, with the parser's own
  message — the checks above, run against the file with the rows laid over it — or a fixed item whose slot is not one of
  `DAILY_DRAW_SLOTS`, `title`, `badge`, because a required slot cannot be taken back when a check-in is undone);
  `MONTH_IN_PAST` (409); `TIER_LOCKED` (409: in the current month, a tier up to today's date has been reached, so its
  rule cannot change — later tiers can, and saying what is already so is no change); `NOTHING_TO_CLEAR` (409, a `DELETE`
  of a month that has no row; nothing is logged).
- A stored month that no longer validates at boot (the catalogue changed under it) is logged at `warn`, skipped — the
  file's entry or the default applies — and the boot goes on. The file alone is still refused, as below.

The file is checked at boot — `readDailyGiftsRaw` reads it, `parseDailyGifts` (through `loadDailyGifts` in the tests) checks it —
and the server **refuses to start** — `invalid daily gift schedule <path>: <problem>` — on: an id the catalogue does
not hold, or one every player already owns (`isDefault`, `free`); a tier outside 1–31, written with a leading zero, or
past the end of its month (`2027-02` has no tier 29); an empty `fixed` list; the same id twice in a tier, or on two
tiers of one month (the default's tiers included); a draw that is not `common` or `rare`, or a rule that is not exactly
one of `draw` and `fixed`; a month key that is not `YYYY-MM`; the same month key written twice (`month 2026-11 appears
twice`: JSON keeps only the last of two equal keys, so a copied month whose key was not renamed would otherwise replace
the first); a top-level key other than `default` and `months`; no `default`. A file that is not JSON is
`could not read daily gift schedule <path>: …`. One thing it cannot see: two equal *tier* keys inside one month — JSON
again keeps the last, silently.

## The GM role

Spec: `docs/superpowers/specs/2026-10-18-gm-role-design.md`; SRS §10.2, §18.2, §19.2, §20.2, §23, §27.2.

**Tables.** `users` carries `role` (`player` | `gm`, a CHECK), `locked_at` and `locked_reason`: the login account holds
them, not `players`, because a lock blocks sign-in and a role belongs to whoever holds the password. `gm_actions` is the
append-only log (`actor_user_id` NULL means the CLI; `target_player_id` and `actor_user_id` are `ON DELETE SET NULL`, so a
row outlives the accounts it names; `action` is free text in SQL, with the kinds held by `GmActionKind` in TypeScript).
Migration `drizzle/0004_gm.sql` is additive and guarded with `IF NOT EXISTS`; the index names carry `_idx`
(`gm_actions_created_idx`, `gm_actions_target_idx`).

**The guard.** `requireGm` (`http/auth-guard.ts`) runs `requireUser` and then checks `req.user.role`, which `requireUser`
read from the database on this very request (`RequestUser.role`). A locked account is treated as signed out by the same
path, and `identityForToken` refuses it, so a session that survived a lock still cannot open a socket. Nothing is cached:
a demotion or a lock is effective on the player's next request.

**`gm/gm-service.ts`.** Every write validates first (a reason of 3 to 200 characters, an amount within `POINTS_CAP`
10,000,000, a known non-free item), then does the effect and its `gm_actions` row in **one transaction**, and only after
the commit sends `BALANCE`, the `GM_NOTICE`, revokes sessions, kicks and closes the socket. A lock runs in that order:
`sessions.revokeAll`, `Room.adminKick`, the notice, `Gateway.disconnect` (close code 4003 `LOCKED`); a failing revocation
or kick is warned and the remaining steps still run, because the lock is committed. Points move through
`creditWithin` with reason `gm_grant` (positive) or `gm_adjust` (negative); a deduction past the balance is refused whole,
no log row either. Refusals worth knowing: `INVALID_REASON` (400, any POST without a usable reason), `INVALID_AMOUNT`,
`INVALID_ITEM`, `INVALID_ROLE`, `INSUFFICIENT_BALANCE` (409), `ALREADY_LOCKED` / `NOT_LOCKED` / `LAST_GM` (409),
`TARGET_IS_LOCKED` (409, promoting a locked account), `SELF_TARGET` and `TARGET_IS_GM` (403). **Lock order of a role
change:** a demotion first locks every GM row in id order (`select id from users where role = 'gm' order by id for
update`) and only then the target's row, the same as `grantGm --revoke`; every demotion takes its locks in that one order,
so two GMs demoting each other serialise and the second answers `LAST_GM` instead of deadlocking. Search takes a lowercase email prefix or part of a display name, masks the address
(`mask-email.ts`), and lists every account for an empty query (capped at 100). Inside a transaction only `tx` is used:
PGlite serves `query()` and `transaction()` through one lock, so a plain-`db` read there would wait on itself.

**`gm/gm-rooms.ts`** is a thin layer over the live rooms: `list()` (private rooms included, closed ones skipped), `get()`,
`kick()` (`Room.adminKick`, so `'now'` or `'after_hand'`; a bot is refused) and `close()` (`Room.shutdown('closed_by_gm')`,
which returns every stack and any carried pot through the room's own cash-out). Rooms are in memory, so these are not
transactional: a close is logged first and a failed close adds a second line with `details.error`; a kick is logged once,
after the deed, with `details.effective` (`now` or `after_hand`) or the reason it failed; if that log write fails after a
kick that happened, the route warns (`gm kick not logged`) and still answers `200 { effective }`. Only a `RoomError` from
the room becomes a 4xx; anything else is rethrown and stays a 500. The GM's reason stays in the
log; the broadcast reason is the fixed string `closed_by_gm`.

**Routes.** `http/routes-gm.ts` mounts twenty-nine routes under `/api/gm/` behind `requireGm` (fifteen from Plan 25,
seven from Plan 26, seven from Plan 27), with CSRF and the `/api/*` rate limits as usual. `GET /api/gm/rooms/:id` returns the `AdminRoomSummary` (members included), not `room.view()`.
Search is a `POST` so an address never sits in a URL or an access log.

**The second batch (Plan 26, spec 2026-10-20 Part A).** Four capabilities, seven of the twenty-nine routes, all through the
same door as the first batch: a reason of 3 to 200 characters first, the effect and its `gm_actions` row in one
transaction, the player's `BALANCE` and `GM_NOTICE` only after the commit.

- **Unlock an achievement.** `POST /api/gm/players/:id/achievements/:achievementId/unlock`. `unlockWithin`
  (`achievements/achievement-service.ts`, the same function a self-earned unlock runs) pays the *full* reward under the
  reason `gm_achievement` (ref `gm:<id>`) and grants the reward item through the inventory service. Refused: `INVALID_ACHIEVEMENT` (400), `ALREADY_UNLOCKED` (409), a locked target (409). The notice names the
  achievement (`GM_NOTICE` with `achievementId`). `GmPlayerDetail.unlockedAchievementIds` lets the screen's picker grey out
  what the player already has.
- **Reset today's check-in.** `GET /api/gm/players/:id/checkin` previews it (`{ claimedToday, day, streak, points,
  itemIds }`: what today's claim paid, so the dialog can name it); `POST …/checkin/reset` undoes it. Today's claim is the
  **latest** one for the ref `daily:<playerId>:<date>`: its `daily_login` / `daily_item_fallback` rows are taken back as one
  negative row `gm_checkin_undo` (a **negative source**, like `gm_adjust`: balance and ledger fall by the same amount, so
  `Σ balances + Σ sinks` is conserved), its items are revoked (`InventoryService.revoke`, which also clears the slot, the
  equipped title or badge, and strips the item from the player's saved outfits), `last_claim_date` goes back to
  yesterday, and `streak` (the month's count), `consecutive` (Plan 27), `claimed_days` and `total_login_days` each step
  back by one (never below 0), so the next claim is the same tier and draws afresh. The reset leaves the newcomer
  calendar and any reputation the claim paid alone (Plan 27; `docs/known-limitations.md`). Items found by `inventory.ref` (`findByRef`, set since migration 0005). Refused whole, nothing written, no
  log row: `NOT_CLAIMED_TODAY`, `INSUFFICIENT_BALANCE` (the player has spent the points). A second reset after a reclaim
  takes back one claim, not two.
- **Edit the gift schedule.** The three `/api/gm/gifts` routes above, backed by `gift_months` and `GiftScheduleStore`.
- **Sources and sinks per day.** `GET /api/gm/stats/daily?days=7|30` → exactly `days` entries, ascending, the last one
  today, each `{ day, sources: { <reason>: n }, sinks: { <reason>: n }, net }` with empty days as zeros; any other span is
  `400 INVALID_DAYS`.
  `LedgerReader.sumsByDay` (`repos/balance-repo.ts`) groups `point_transactions` by `(created_at at time zone <tz>)::date`,
  the same economy day the check-in uses; `GmService.dailyStats` classifies each reason as a source or a sink.

Migration `drizzle/0005_plan26.sql` is additive and guarded: `gift_months`, `inventory.ref` and an index on
`point_transactions(created_at)`. A deploy writes it once (`run.ps1` without `-NoMigrate`; Docker runs it at boot).

**Test hook.** `AppDeps.extraRoutes` mounts extra routes on the built app. Only the e2e entry uses it, for
`POST /e2e/promote` (`src/e2e-promote.ts`, loopback only, behind CSRF); that file is not in `tsconfig.build.json` and
`test/build.test.ts` proves `dist/` has no such route.

### Granting the first GM

Only a GM can promote, so the first one is made on the server, with the CLI. It reads `DATABASE_URL` from the environment
or from `.env` in the working directory, and writes a `gm_actions` row with no actor and the reason `cli`:

```bash
node dist/grant-gm-cli.js <email>             # make the account a GM (a second run changes nothing)
node dist/grant-gm-cli.js <email> --revoke    # take the role back; refused for the only GM
```

The account must already exist: sign up on the site first. On the VPS stack run it inside the container:
`docker compose exec app node dist/grant-gm-cli.js <email>` (`docs/deployment-normal.md` §5). On the Windows LAN host, set
`DATABASE_URL` from the kit's `.env` the way `deploy/normal-windows/README.md` §9b does for `grant-wardrobe-cli`, then run
the same command (§9d there). Exit code 1 for an unknown address, the last GM or a locked account (unlock it first), 2 for a
usage or configuration problem. It writes the user's database, so the operator runs it, not an automated session.

A GM then promotes and demotes others on the "Quản trị" screen. A GM cannot change their own role, and the last GM cannot
be demoted.

---

## Reputation, the shop and the welcome gift (Plan 27)

Spec: `docs/superpowers/specs/2026-10-21-plan27-shop-reputation-welcome-blind-zero-design.md` (Parts A, B, C, G);
plan `docs/superpowers/plans/2026-10-22-plan27-shop-reputation-welcome-blind-zero.md` with its amendments P1–P36.
Migration `drizzle/0006_plan27.sql` is additive and guarded; its config seeds are repeated **in code at boot** (wiring
step 4), and `shop_prices` is seeded only there.

**Reputation (`reputation/reputation-service.ts`).** A whole number per account, `players.reputation`, that only
rises, and `players.rank` 1..5, the **highest rank reached** (`GREATEST(rank, rankOf(reputation))`, so a GM raising a
threshold never lowers anyone). It is not points: not a `TxReason`, not in the conservation sum, never bought,
transferred or taken back — a GM can only add. Every rise is a row of `reputation_events(player_id, delta > 0,
reason, ref_id)` with a unique `(player_id, reason, ref_id)`, written in the **same transaction** as the total, so a
replayed event adds nothing; `players.reputation = Σ delta` is pinned by an invariant test. The amounts are
`reputation_rules` (eight keys; defaults `hand_played` 1, `hand_won` 3 more, `daily_login` 10, `achievement_small` 50
(reward ≤ 5,000 points), `achievement_big` 150, `achievement_item` 500, `welcome` 100, `newcomer_day7` 200; a rule set
to 0 grants nothing), and the ladder is `reputation_ranks` (0 · 100 · 400 · 1,800 · 5,000; rank 1 at 0, thresholds
strictly rising, `INVALID_RANKS` otherwise). Where the grants happen:

- A hand: the `HAND_SETTLED` listener, after commit like `stats` (R13), one transaction **per seat** (a seat that fails is
  logged and the next is still paid), human seats only, never a cancelled hand or a failed settlement; ref = handId.
- A check-in: inside `claimDaily`'s transaction, ref `daily:<pid>:<day>`. An achievement: inside `unlockWithin`, so a GM
  unlock pays it too, ref `ach:<pid>:<id>`. The welcome gift and newcomer day 7: inside their own transactions.
- Inside a caller's transaction the amount and the ladder are read **through `tx`** (`grantRuleWithin`; Ruling 3,
  P7 — PGlite has one connection). `rules()` / `ranks()` are cached for views only (≤ 5 s; a GM save calls
  `invalidate()`).
- A rise in rank sends `NOTIFICATION { kind: 'RANK_UP', payload: { rank } }` after the commit, once per claim even when
  two grants land in it. `GET /api/me` carries `reputation`, `rank` and `ranks`; `GET /api/players/:id/avatar` carries
  `rank` only (R9) — the seat, the lobby bar and the GM's room members read it from the web's avatar cache.

**The shop (`shop/shop-service.ts`).** `GET /api/shop` → `{ weekKey, featured, featuredSource: 'gm' | 'auto', entries,
me: { balance, reputation, rank, ranks } }`, one entry per catalogue item with its price, `minRank`, `owned` and
`lock`. A lock, in precedence order: `default`, `free`, `achievement` (an achievement's reward), `gift_month` /
`gift_default` (read from the **live** gift schedule at every read and every purchase: an item of the current or a later
month does not sell, a past month's does — R20), `unpriced` (no `shop_prices` row: an item added to `items.json` later
does not sell until a GM prices it), `disabled`. The seed (`shop-prices-seed.ts`): common 10,000 at rank 1, rare 30,000
at rank 3, epic 150,000 at rank 4; off sale for defaults, `free` items and achievement rewards. "Kệ tuần này" is
`shop_featured[weekKey]` when a GM set it, else six sellable items rotated by ISO week and judged as of the week's
Monday, so a lock lifting mid-week does not reshuffle it.

`POST /api/shop/buy { itemId, purchaseId }` (`purchaseId` a lower-case UUID per click, resent on a retry) runs in one
transaction: an item already granted under `shop:<pid>:<purchaseId>` → `repeated: true` (this survives the boot-time
prune of `ledger_keys`, P15); then the key; then the price, lock and rank checks; then `creditWithin` with the player's
row `shop_purchase` (−price, ref = itemId) and the sink row `shop` (`SettlementMeta.kind`), **debit before grant**;
then `inventory.grant(…, 'shop', ref)`, whose `false` (a racing buy) rolls the debit back as `ALREADY_OWNED`. Refusals:
`UNKNOWN_ITEM` 404; `SHOP_DISABLED`, `RANK_TOO_LOW`, `ALREADY_OWNED`, `INSUFFICIENT_POINTS`, `PURCHASE_UNDONE` (the id
was used for an item a GM has since revoked) 409, each with a message of its own; a malformed body 400 `BAD_REQUEST`. `shop` is in `SINK_REASONS` and
`shop_purchase` is a transfer like `buy_in`, so the overview and "Theo ngày" count a purchase once. Conservation: 40
random buys across three players keep `Σ balances + Σ sinks`, and the shop sink equals what was paid.

**The welcome gift (`economy/welcome-service.ts`).** `GET /api/welcome` → `{ claimed, choices: [{ itemId, owned }] }`;
`POST /api/welcome/claim { itemId: string | null }`. One transaction, guard first (`UPDATE players SET
welcome_claimed_at … WHERE welcome_claimed_at IS NULL RETURNING id`): grant the item (source `welcome`), wear it
(`wearItemWithin`, `inventory/avatar.ts`, through `tx`), `+rules.welcome` reputation (ref `welcome`), and day 1 of the
newcomer calendar with `last_day_key` = today. `null` is allowed only when every choice is owned (reputation only,
R17). Refusals, each 409: `WELCOME_CLAIMED`, `NOT_A_CHOICE`, `ALREADY_OWNED`; a body without `itemId` (or a bad one) 400
`BAD_REQUEST`. The choices are
`shop_config.welcome_choices` (default `outfit_dealer01`, `outfit_tet_red01`, `head_conical_hat01`).

**The newcomer calendar (`claimDaily`).** `newcomer_progress(player_id, day, claimed_days, last_day_key, finished_at)`.
A claim on a later economy day than `last_day_key` advances `day` by one **inside the claim's transaction**: day 3 pays
an unowned common, day 7 an unowned rare plus `rules.newcomer_day7` reputation and finishes; an empty pool pays
`NO_ITEM_FALLBACK_POINTS` under `daily_item_fallback` with ref `newcomer:<pid>:<day>` — outside the GM undo's reach.
`DailyClaimOk.newcomer` is `{ day, item: string | null, fallbackPoints, reputation, finished }`, present only when the
claim advanced the calendar; `GET /api/rewards/daily` carries `newcomer` until it finishes.

**The GM's seven routes.** `POST /api/gm/players/:id/reputation` (1 to 100,000, a reason; `gm_actions` kind
`grant_reputation`, event `gm_grant` with ref `gm:<actionId>`; a locked account can receive it), `GET /api/gm/shop`
(prices with each row's lock, the featured weeks, the welcome choices, the rules and the ranks), `PUT
/api/gm/shop/prices` (a non-empty change list, else `INVALID_PRICES`; `sale_price` refused this round, R5), `PUT
/api/gm/shop/featured/:week` (`YYYY-Www`, ≤ 6 sellable items, `[]` hands the week back to the rotation; a malformed key
400 `INVALID_WEEK`, a past week 409 `WEEK_IN_PAST`), `PUT /api/gm/shop/welcome` (three distinct sellable items of the
outfit, head, face, aura or frame slots, else `INVALID_WELCOME`), `PUT /api/gm/reputation/rules` and `PUT
/api/gm/reputation/ranks` (`INVALID_RULES` / `INVALID_RANKS`, then `invalidate()`). Each write logs one `gm_actions`
row with its reason (`set_shop_prices`, `set_shop_featured`, `set_welcome_choices`, `set_reputation_rules`,
`set_reputation_ranks`). A config write with no GM account behind it (the CLI's actor) is `FORBIDDEN`. The overview
adds the number of players at each rank.

**The backfill (`reputation-backfill-cli.ts`, `reputation/backfill.ts`).** For each player without a `backfill`
event: (hands played × `hand_played`) + (hands won × `hand_won`) + (login days × `daily_login`) + each unlocked
achievement's rule, minus the live events whose reason mirrors those counters (`hand_played`, `hand_won`,
`daily_login`, `achievement` — never `welcome`, `newcomer_day` or `gm_grant`; Ruling 9), clamped at 0, written as one
event `('backfill', 'plan27')` per player. No `RANK_UP`. A rerun skips every credited player. Prints
`players=<n> applied=<n> ranks=[r1,…,r5]`, prefixed `(dry run) ` under `--dry-run`; exit 0, 2 without `DATABASE_URL`,
1 on an error. Run it once per upgrade at a quiet moment (the operator's steps: `docs/deployment-normal.md` §7).

---

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
