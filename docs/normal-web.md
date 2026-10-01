# `@bp/normal-web`

## Purpose

The Normal edition's browser client: a Vite/React bundle that talks to
[`@bp/normal-server`](normal-server.md) over REST and one WebSocket, and draws the table with
[`@bp/ui-kit`](ui-kit.md). It is served by the server itself — the Docker image builds it and points
`PUBLIC_DIR` at it — so the app, the API and the socket share one origin and one cookie.

What it owns, and nothing else owns: the account screens (sign-in, profile, wardrobe,
achievements, daily reward, settings), the REST client, the session gate, and the mapping from the
server's avatar config to the kit's chibi — the wardrobe screen and the profile figure both go through
it. The lobby and the table come from the kit unchanged.

Its counterpart is `apps/lite/web`, which solves the same problem for a LAN executable and a bearer
token. Neither may import the other, and neither may import a server package; ESLint enforces both.

To *deploy* this, read [`deployment-normal.md`](deployment-normal.md) (Vietnamese, like every
operator guide here). This page is for changing the code, and is English, like every developer doc.

Spec: §15 avatars, §19.2 API, §24 footprint, §27.2 screens, §29 end-to-end; and
`docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` §5–§8 for the avatar. The pipeline, the
layer files and how to add an item are [`avatar-2d.md`](avatar-2d.md).

---

## Module map

```
apps/normal-web/
  index.html            the document: dark by default, the display face, #root
  vite.config.ts        base '/', dev proxy to :8080 for /api and /ws
  src/
    main.tsx            theme → i18n → <App api={createApi()} />
    App.tsx             the session gate in front of the hash routes; lazy account screens
    api.ts              the REST client: one `call`, the DTOs, ApiError
    guarded-api.ts      guardApi — one wrapper, so any screen's UNAUTHENTICATED ends the session once
    catalog-i18n.ts     itemName / achievementName / achievementDesc — never print a raw i18n key
    session-gate.ts     useSessionGate — boot probe, 401 handling, the reconnect probe
    session.ts          the last email typed, remembered for the sign-in card only
    prefs.ts            theme and language, per device
    notifications.ts    the kit's notification list, with achievement ids translated
    avatar/
      useAvatars.ts     the shared avatar cache (module scope, 60 s, one request per id)
      chibi.ts          chibiFromApi — an AvatarConfigDto (v3) + the catalogue → the kit's ChibiConfig
    screens/
      Shell.tsx         the rail and the page under it; publishes --bp-stage for the table
      AuthScreen.tsx    sign in and register, one card, two modes
      {Profile,Achievements,Daily,Settings}Screen.tsx   four of the five lazy account screens
      wardrobe/
        WardrobeScreen.tsx   the fifth — preview + expression stepper + seven tabs + the outfit bar
        BaseTab.tsx          the two fixed bases (f01/m01) — chosen, never locked
        ItemTab.tsx          one slot's tiles: owned and clickable, or locked with a reason
        OutfitBar.tsx        five saved snapshots — apply / save here / rename / delete
      TableChrome.tsx   makeChibiFor / makeCaptionFor — the two slots RoomScreen takes from this app
      catalog.ts        rarity → kit tone, and the category order, shared by two separate chunks
      format.ts         dates, moments and signed amounts in the player's language
      useAsync.ts       load once, expose { data, loading, reload, set } — every account screen's spine
    locales/{vi,en}/normal.json
  public/avatar/             the chibi's PNG layers + avatar-manifest.json (committed; see avatar-2d.md)
  scripts/avatar-pipeline.mjs  the asset pipeline: placeholder | ingest | check | sheet
  test/footprint.test.ts   the download budget, measured on `dist/` and on `public/avatar/`
  e2e/                     Playwright against the real server (support.ts is shared, not a test)
```

---

## The API client

`src/api.ts` mirrors `apps/normal-server/src/http/*.ts` exactly — same paths, same headers, same
failure envelope (§19.2) — and knows nothing else: no retries, no caching, no state.

The one difference from Lite's client is the whole point of this edition: **there is no token**. The
session is an `HttpOnly` cookie the server set, which this code can neither read nor forge. Every
request carries `credentials: 'same-origin'`, the browser attaches the cookie, and every mutating
request carries `X-Requested-With: bind-poker` — the CSRF guard's proof that a `fetch`, not a form
post from another origin, made the call.

A refusal arrives as an `ApiError` with the server's own `code`, and screens translate the codes they
have words for and fall back to the kit's generic failure for the rest. `NETWORK` is the code the
client invents when the request never reached the server at all.

## The session gate

`useSessionGate` (`src/session-gate.ts`) is the only piece here with a rule of its own, and it is
shaped by what the session *is*. With no token to read, the only way to know whether this browser is
signed in is to ask: the app boots into `checking`, calls `GET /api/auth/me` once, and then shows
either the lobby or the sign-in card. Rendering the card while that probe is in flight would flash a
login form at a signed-in player on every reload, which is why `checking` is a state and not a
spinner.

Two consequences worth knowing before changing anything here:

- **The socket opens only when the gate says signed in.** `useGameClient` is created with
  `autoConnect: false` and one effect connects it, because a socket opened without a session is
  refused at the upgrade and would back off forever.
- **A dead session looks like a bad network.** The server authenticates the upgrade from the cookie,
  so an expired session is an HTTP 401 on the handshake — which the browser reports as an ordinary
  failed connection. After `RECONNECT_PROBE_MS` (10 s) of uninterrupted reconnecting the gate asks
  `GET /api/auth/me`: a 401 signs the player out with `session.expired`; anything else means the
  network is merely bad.
- **A live socket proves nothing.** Identity is bound once, at the upgrade, so a session that dies
  under an established socket is invisible to it: only a REST call notices. `guardApi` (`src/guarded-api.ts`)
  wraps the api handed to every signed-in screen, and an `ApiError` whose **code** is `UNAUTHENTICATED`
  calls `gate.onUnauthenticated()` once — debounced, so three parallel 401s are one sign-out — and
  rethrows. It guards on the code and not the status because `POST /api/auth/login` answers
  `401 BAD_CREDENTIALS` for a wrong password, which is a form error; the sign-in card and the gate's
  own probes therefore keep the **raw** api.

Every session ending goes through one path (`endSession` in `App.tsx`): the socket is disconnected,
the kit's client state is `reset()` (it outlives the session, so otherwise the next player on a shared
machine is greeted with the previous one's name and points), and `resetAvatarCache()` drops the faces.
While a session is live the app prefers the **gate's** identity over the socket's for the rail, the
lobby bar and the avatar, and takes the live balance from the socket only while the two agree on the
player id.

---

## Avatars

An avatar is a **chibi**, drawn as a stack of same-origin PNG `<img>`s — a fixed base (`f01`/`m01`,
chosen rather than owned) plus whatever is equipped in each slot, on a 384×448 frame (design §3, §5).
Nothing is rendered on the server and nothing is rendered by this app either: every picture is the
browser laying out `<img>` tags, and `@bp/ui-kit`'s `Chibi` (`packages/ui-kit/src/avatar2d/`) is the one
component that does it. This app's own job is smaller than the 3D system's was — turn the server's
config into the shape `Chibi` draws, and wire a save back to every place a face is shown.

```
AvatarConfigDto (v3)      base + outfit + head?/face?/aura?/frame? + title?/badge?
   │
   ├─ chibiFromApi()  ──►   ChibiConfig                the kit's own shape: a BaseRef + WearRefs
   │                          │
   │                          └─ hashChibi()  ──►  '1aa20c85'   the configuration's identity
   │
   └─ <Chibi subject frame expression>  ──►  a stack of <img>   seat plates, the lobby bar, wardrobe
                                                                  tiles, the profile figure
```

**`chibiFromApi`** (`src/avatar/chibi.ts`) is the whole bridge: it resolves `base` against the
catalogue's two bases and every optional slot against `items.json`, and it is written to never throw at
an id it does not recognise — a browser holding yesterday's bundle can meet ids the server added since.
An unknown base answers `null` for the whole chibi (there is no body to draw it on); an unknown optional
item is simply omitted, the same way an unknown badge drops from a seat caption rather than printing a
raw key; an unknown `outfit` falls back to the catalogue's default outfit, and only if that is *also*
missing does the whole function give up.

**`data-chibi-hash`** (`hashChibi`, in the kit) is the configuration's identity — two different
configurations must not share one, and the same configuration must arrive at the same one wherever it
is drawn. `test/footprint.test.ts` and `e2e/avatar2d.spec.ts` both key off it, and so does the wardrobe's
own outfit bar, which is a snapshot of a whole `AvatarConfigDto` rather than of any one item.

**Bots never go through this path.** A bot has no account and no `GET /api/players/<id>/avatar` to
answer for it (`TableChrome.makeChibiFor` never asks); `PokerTable` draws `botChibi(player.playerId)`
instead — the kit's own robot art, unaffected by any wardrobe.

**Where the layer files come from** is [`avatar-2d.md`](avatar-2d.md): `scripts/avatar-pipeline.mjs`
turns a green-screened AI-generated picture into `@1x`/`@2x` PNGs under `public/avatar/`, validates the
result against ten acceptance criteria, and writes `avatar-manifest.json`. Until the real art lands,
`avatar:placeholder` writes synthetic layers so every screen and every test here runs against something
(`docs/known-limitations.md`).

### The wardrobe

`/avatar` — `wardrobe/WardrobeScreen.tsx`. A `Chibi` preview on the left, sized 192 px, with an
expression stepper under it to try each of the six faces — `‹  Vui  ›`, a previous and a next button around the
current face's name, wrapping at both ends, ArrowLeft/ArrowRight too (review 2026-09-29, No10; `wardrobe/StagePanel.tsx`) —
and the save button below it; seven tabs on the right —
**Nhân vật** (base), then a tile grid per equipped slot (**Mũ**, **Mặt**, **Quần áo**, **Aura**,
**Khung**), then **Danh hiệu & Huy hiệu** (title and badge together, the two slots with no picture).
The outfit bar sits under both columns, five slots wide.

There is no separate inventory screen (review 2026-09-29, No5): what the account owns is this screen's default
list, and Profile links here and to the achievements only. `#/inventory` — an old bookmark or link — still opens
the wardrobe: `App` reads it as `/avatar` and swaps the address bar for `#/avatar` in place (`replaceState`; the
kit's router has no replace of its own), so "Back" does not bounce off it. The inventory's acquired date and
source ("Nhận ngày …", "Khởi đầu", "Miễn phí") and its "Đang sở hữu N món" total went with it, on purpose; the
wardrobe's "n/m đã có" counts remain.

- **`BaseTab`** is the one tab with nothing locked — the two bases are chosen, not owned (design §5.1) —
  and each tile previews that base wearing the draft's *current* outfit, so the choice reads as a
  silhouette rather than a wardrobe.
- **`ItemTab`** lists what the player owns — a colour-variant family shows when any member is owned
  (`slotCards`, `categories.ts`; review 2026-09-29 No11a) — and, with **Hiện cả món chưa có** ticked, the
  whole catalogue for its slot, locking anything the player does not own (`aria-disabled`, with a hint:
  the achievement that grants it, or a daily-calendar rarity, or "chưa mở"). A tile's own picture (`ItemPreview`) is
  the item's pipeline icon (`docs/avatar-2d.md` §4.2), and a colour variant's is that icon tinted to the variant's
  colour through `useTintedLayer` (review 2026-09-29 No8a). A family's card is the member being worn, when one is —
  its picture, name, "Đang dùng" and click — and its dot row lists the whole family, the original first as an
  untinted dot.
- **`OutfitBar`** is a bookmark of a *whole* `AvatarConfigDto`, not of one item — "Mặc bộ này" replaces the
  draft outright, "Lưu vào đây" snapshots whatever is currently equipped into that slot under a name up
  to 24 characters. Both round-trip the server (`PUT /api/me/outfits/:slot`, `POST
  /api/me/outfits/:slot/apply`) rather than only touching local state, so a saved outfit survives a
  reload.

Picking a tile only ever changes the in-memory draft (`withSlot`/`pickBase`); nothing reaches the
server until **Lưu tủ đồ** is pressed. Saving is `PUT /api/me/avatar` with the full v3 payload (an empty
optional slot is *absent* from the object, not `''`), and on success `invalidate(myId)` so the lobby bar
and every seat plate pick the new face up without a reload.

### Adding an item, end to end

1. **The picture.** Generate (or draw) it on F01 per `docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md`,
   then `pnpm --filter @bp/normal-web avatar:ingest <file> --as item:<slot>:<id>` — see
   [`avatar-2d.md`](avatar-2d.md) for the exact command and the ten checks `avatar:check` runs against it.
2. **The catalogue.** Add the row to `apps/normal-server/data/items.json` with its `slot`, `rarity`,
   `isDefault` and `asset.{layer,file}` naming the file the pipeline just wrote — see
   [`normal-server.md`](normal-server.md). The server validates the catalogue against the committed
   manifest at boot, so a row naming a file that was never ingested fails fast rather than 404ing per
   request.
3. **The name, in both languages.** `items.<id>` in `src/locales/vi/normal.json` *and*
   `src/locales/en/normal.json`. `locales.test.ts` fails if either is missing, if one language has a key
   the other does not, or if a name exists for an id the server does not serve. Renaming an id that ships
   already needs a row in `apps/normal-server/data/item-aliases.json` too, so an account that equipped the
   old id keeps wearing something rather than losing the slot.
4. **How it is won.** A grant in `data/achievements.json` or the daily calendar (`head`/`face`/`aura`/
   `frame` only — design §5.2), or nothing — an item nobody owns is an item nobody sees, because the
   wardrobe lists the inventory and not the catalogue.
5. **The contact sheet.** `pnpm --filter @bp/normal-web avatar:sheet` re-composites every item on both
   bases and all six expressions into `docs/avatar-2d-sheet.png` — the eyeballed gate before a picture is
   committed.
6. **Commit the new PNGs, `avatar-manifest.json` and the catalogue together.** The layers are a committed
   build artefact; nothing under `public/avatar/` may be generated at build time, because no CI runner has
   the AI tool or the `assets/avatar-src/` originals (gitignored).

There is no drawing step and no per-item code in this app: `Chibi` is generic over whatever layers
`chibiFromApi` hands it.

### The avatar cache

`useAvatars(api, ids)` is a module-scope cache shared by every screen: one request per player id per
minute, in-flight requests collapsed, failures cached too (a failing endpoint must not become a
request storm from a screen that redraws on every card). Bots are filtered out by the caller — they
have no account, so their id would be a guaranteed 404 apiece.

`invalidate(playerId)` drops an entry and refetches; the wardrobe calls it after a save. There are
**two** caches in the way, and it clears both: this module's Map, and the browser's own — the route
answers `Cache-Control: private, max-age=60`, so the refetch is issued as
`api.playerAvatar(id, { fresh: true })`, which sets `cache: 'no-store'`. Only the invalidated id is
marked; every other seat keeps the 60 s the header is there for.

`resetAvatarCache()` empties it. One caller in the app — a session ending — because the cache is
module scope and keyed by player id, so the account that just signed out would otherwise sit there
and be re-read as a 401 once per TTL.

---

## i18n

Two bundles, `vi` (default) and `en`, both under the `normal` namespace, merged into the kit's i18n
by `main.tsx`. The kit's own namespaces (`common`, `game`) stay the kit's: a key that belongs to the
table is added there, not here.

`src/locales/locales.test.ts` is the parity test and it checks four things: every dotted leaf exists
in both languages, no value is empty, every catalogue item id has an `items.<id>` name (and no name
exists for an id the server does not serve), and every achievement id has a `name` and a `desc`. It
reads the server's `data/*.json` directly — the only thing this app ever reads out of `normal-server`,
data rather than code, and only from a test.

---

## Tests

```bash
pnpm --filter @bp/normal-web test        # vitest: jsdom unit + screen tests, plus the footprint budget
pnpm --filter @bp/normal-web typecheck   # src, test/ and e2e/ are three separate projects
```

Screen tests render the real screen against a hand-written `NormalApi` stub and drive it through
`@testing-library/user-event`, addressing everything by role and accessible name. That is deliberate:
these tests are the accessibility check as well as the behaviour check, and a query that has to reach
for a class name is a screen a keyboard cannot use.

### Footprint

`test/footprint.test.ts` measures the emitted bundle — gzip, because that is what the wire carries —
and holds four budgets:

| | Budget | Today |
|---|---:|---:|
| entry chunk (first paint) | 130 KB | 108 KB |
| every JS chunk together | 900 KB | 119 KB |
| the stylesheet | 60 KB | 13 KB |
| `public/avatar/*@2x.png`, raw bytes (design §8) | 6 MB total | ~1.2 MB (placeholders) |

The first three are headroom rather than targets: their job is to catch a *step change* (a chart
library, a locale bundle that stopped being split), not to fail on the kilobyte a feature costs. The
avatar budget is the one design §8 actually sets a ceiling on — `@2x` only, since `@1x` is the same
pictures at a quarter the pixels and never dominates the total — and it does not skip on a missing
`dist/`: it reads `public/avatar/` directly, the committed layers rather than a build output, so it is
live on a fresh checkout that has not built anything.

One structural assertion sits beside the numbers: the entry chunk is read off `dist/index.html`'s module
script rather than guessed from a file name, and the five account screens must each still be a chunk of
their own — a screen that rejoined the entry is a chunk that stopped being emitted under its own name.
The three build-dependent blocks **skip with a warning** when `dist/` is missing, so `pnpm test` on a
fresh checkout stays green and says what it had nothing to measure. Run `pnpm build:normal` (or
`pnpm --filter @bp/normal-web build`) first to make them measure too.

---

## End-to-end

A Playwright pass over the built app against the **real** server: `apps/normal-server/src/e2e-entry.ts`
is the production `buildApp` — its routes, CSRF guard, cookie session, gateway and economy — on a
throwaway PGlite database, serving `apps/normal-web/dist` from the same origin. Nothing is mocked and
nothing is left behind; the database only ever existed inside the server process.

```bash
pnpm build:normal                                   # both halves; the e2e server refuses to start without dist/
pnpm --filter @bp/normal-web exec playwright install chromium   # once, ~150 MB
pnpm e2e:normal
```

`e2e/playwright.config.ts` runs one worker in `vi-VN` / `Asia/Ho_Chi_Minh` with two projects: desktop
(1440×900) and mobile (375×812, the `@mobile` tag). Its `webServer` is
`node ../normal-server/scripts/e2e-server.mjs`, which bundles the entry with esbuild to
`apps/normal-server/.e2e/server.mjs` — deliberately not `dist/`, which the server's own build guards
against ever containing PGlite — and runs it on `127.0.0.1:8091`.

`normal.spec.ts` and `avatar2d.spec.ts` share `e2e/support.ts` — the account, the cookie session, the
lobby, the create-room dialog and the two viewport assertions. It is a module the specs import, not a
test file; Playwright only collects `*.spec.ts`.

What the five tests are for:

- **The money.** One account plays a Blind hand against a bot to settlement, and the balance from
  `GET /api/me` (the database's own answer) is reconciled against the payout, the uncalled return and
  the table fee *as printed on the result card*. A settlement that quietly created or destroyed
  points fails here even though both halves would look consistent alone.
- **The session.** Register, sign out, sign back in — the only credential involved is the cookie.
- **The chrome on a phone.** The rail's four tabs must fit inside 375 px with nothing scrolling
  sideways, and the table must come up in the stack layout.
- **The wardrobe, end to end** (`avatar2d.spec.ts`). `Chibi.test.tsx` proves the layering and the hide
  rules under jsdom against a hand-built config; this file is the other half — that the *app* wires a
  saved choice back into the lobby bar, a seat plate and a second wardrobe visit consistently, on the
  placeholder layers `avatar:placeholder` writes. It switches base to m01 and saves, checks that a
  locked epic tile (`aria-disabled`) does not equip on click, sits at a table and asserts the seat's
  `data-chibi-hash` matches the bar's and its `<img>` names `base_m01_L30` while both bots' name
  `bot_`, then saves an outfit-bar snapshot, changes base again and applies the snapshot back — three
  hashes belonging to two configurations, since f01 with nothing else equipped is exactly what the
  account started as. Nothing here needs a GPU: a chibi is a stack of same-origin `<img>`s, unlike the
  3D `avatar3d.spec.ts` this file replaced.

Every selector is a user-visible one: a role and its accessible name, in Vietnamese. It fails when
the thing a player reaches for stops being reachable, not when a class name changes. Screenshots
(both viewports) land in `e2e/screenshots/`, which is not committed.

The suite is **not** part of `pnpm test`: it needs a build and a browser download.
