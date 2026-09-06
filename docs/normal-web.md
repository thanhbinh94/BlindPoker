# `@bp/normal-web`

## Purpose

The Normal edition's browser client: a Vite/React bundle that talks to
[`@bp/normal-server`](normal-server.md) over REST and one WebSocket, and draws the table with
[`@bp/ui-kit`](ui-kit.md). It is served by the server itself — the Docker image builds it and points
`PUBLIC_DIR` at it — so the app, the API and the socket share one origin and one cookie.

What it owns, and nothing else owns: the account screens (sign-in, profile, wardrobe, inventory,
achievements, daily reward, settings), the REST client, the session gate, and the 3D avatar — the
portrait renderer every screen draws faces with, and the stage the profile and the wardrobe turn. The
lobby and the table come from the kit unchanged.

Its counterpart is `apps/lite/web`, which solves the same problem for a LAN executable and a bearer
token. Neither may import the other, and neither may import a server package; ESLint enforces both.

To *deploy* this, read [`deployment-normal.md`](deployment-normal.md) (Vietnamese, like every
operator guide here). This page is for changing the code, and is English, like every developer doc.

Spec: §15 avatars, §19.2 API, §24 footprint, §27.2 screens, §29 end-to-end; and
`docs/superpowers/specs/2026-09-05-avatar-3d-design.md` §5–§8 for the avatar. The assets themselves are
[`avatar-assets.md`](avatar-assets.md).

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
    avatar3d/          the 3D avatar; everything that imports three is behind one dynamic import()
      config.ts         the palettes, withSlot/switchBody/avatarPayload, portraitRelevant, frameForSlot
      hash.ts           canonicalConfig + hashConfig — the 8-hex identity of a configuration
      Portrait.tsx      <img> around a blob: URL, initial-letter fallback; PartPortrait for tiles
      usePortrait.ts    the hook: cache → queue → render, with an AbortSignal per caller
      portrait-cache.ts memory Map + IndexedDB (bp.portraits, 200 entries, LRU)
      portraits.ts      *the* three.js entry: one hidden renderer, the render queue, re-exports the stage
      assets.ts         the manifest and loadNode(key); wires MeshoptDecoder
      assemble.ts       a config → a posed, recoloured Group
      framing.ts        the two crops (head-and-shoulders, full-body), as pure functions
      stage.ts          the full-body stage: scene, camera, yaw, event-driven drawing
      AvatarStage.tsx   the component around it; LazyStage.tsx is its one React.lazy
      description.ts    the configuration as one sentence, for the stage's accessible name
    screens/
      Shell.tsx         the rail and the page under it; publishes --bp-stage for the table
      AuthScreen.tsx    sign in and register, one card, two modes
      {Profile,Wardrobe,Inventory,Achievements,Daily,Settings}Screen.tsx   the six lazy account screens
      TableChrome.tsx   makeAvatarFor / makeCaptionFor — the two slots RoomScreen takes from this app
      catalog.ts        rarity → kit tone, and the category order, shared by two separate chunks
      format.ts         dates, moments and signed amounts in the player's language
      useAsync.ts       load once, expose { data, loading, reload, set } — every account screen's spine
    locales/{vi,en}/normal.json
  public/avatar3d/         the built .glb bundles + manifest.json (committed; see avatar-assets.md)
  scripts/avatar-assets.mjs  the asset pipeline; avatar-shots.mjs renders a contact sheet of it
  test/footprint.test.ts   the download budget, measured on `dist/`
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

An avatar is a **3D character**, and every place one appears except two is a *picture of it* rendered by
the player's own browser. Nothing is uploaded and nothing is rendered on the server (avatar-3d design
§2, §5).

```
AvatarConfigDto (v2)      body + skin + eyes + hairColor + 7 item slots + title/badge
   │
   ├─ hashConfig()  ──►   '1aa20c85'   the identity of a configuration, and the cache key
   │
   ├─ Portrait  ──►  <img data-hash> 128 px      seat plates, the lobby bar, rows, wardrobe tiles
   └─ AvatarStage ──►  <canvas> in a role="img"  the profile header and the wardrobe, only
```

**The portrait path.** `usePortrait(config)` answers `{ url, status, hash }`. It looks the hash up in a
memory `Map`, then in IndexedDB (`bp.portraits`, 200 entries, LRU by `lastUsed`), and only then queues a
render. `portraits.ts` owns **one** hidden 256×256 `WebGLRenderer` for the whole app and a sequential
queue in front of it: nine seats asking at once is nine renders through one canvas, not nine canvases.
The output is drawn down to 128 px through a 2D canvas (that supersampling is most of why a 32 px seat
plate reads at all) and saved as a WebP `Blob`, published as an object URL.

`Portrait` renders that as `<img data-hash>` inside a `<span data-portrait={status} data-size>`. Given no
`label` it is `aria-hidden` decoration — a seat plate prints the name beside it — and until the picture
arrives, or forever on a machine with no WebGL2, it draws the first letter of the name. **Nothing in this
path may break a screen**: no context, a `.glb` that 404s, a `toBlob` that returns nothing and a lost
context all end at that letter.

**The stage.** `AvatarStage` is the live figure: a `role="img"` frame with `aria-roledescription`, an
`aria-label` that describes the outfit in words (`description.ts`), a drag/arrow-key yaw of ±60°, and a
`<canvas>` inside it. It is the app's **second and last** WebGL context, and it is event-driven — a frame
is drawn when something changes, so a stage nobody is touching costs what a static image costs. It is
reached only through `LazyStage.tsx`'s one `React.lazy`, whose fallback is a `Portrait`, and that is also
what a browser with no WebGL gets for good.

**One dynamic import.** `usePortrait` and `AvatarStage` both reach three.js through the single specifier
`import('./portraits.js')` — which is why `portraits.ts` re-exports `createStage` rather than letting
`stage.ts` import three on its own. One specifier is one chunk, and one chunk is what the footprint
budget can name. A static import of anything under `avatar3d/` that pulls three would put ~150 KB gzip in
front of the sign-in card; `test/footprint.test.ts` fails on the string `THREE.WebGLRenderer` appearing
in the entry.

**Where the geometry comes from** is [`avatar-assets.md`](avatar-assets.md): five `.glb` files and a
`manifest.json` under `public/avatar3d/`, built from CC0 packs by `scripts/avatar-assets.mjs`, loaded by
`assets.ts` (which must wire `MeshoptDecoder` first), turned into a scene by `assemble.ts`. `skin`, `eyes`
and `hair` materials are recoloured from the player's configuration; `cloth_primary` takes the item's
published tint; the rest keeps what the build baked.

### The wardrobe

`/avatar` — `WardrobeScreen.tsx`. A stage on the left, and on the right, one group per thing that can
change: body (two radios), skin (8 named swatches), eyes (6), hair colour (8 presets plus a free hex box),
then a tile group per geometric slot listing **only what the player owns**, then title and badge as
selects. Every group is a `fieldset`/`legend` of radios named `wardrobe-<group>`; every tile is a `label`
around its input, so the whole 44 px square is the target.

Three things there are not obvious from the markup:

- **A tile's thumbnail is a portrait of the whole figure with that one item swapped in** (`PartPortrait`),
  not a picture of the item. The crop follows the slot (`frameForSlot()`): head-and-shoulders for
  everything worn above the chest, and the **whole standing figure** for the two slots that crop cannot
  contain — a pair of trousers and a pair of shoes, which framed on the head would give every tile in
  those two groups the same face. `portraitRelevant()` then strips everything the tile's own crop cannot
  show (`title` and `badge` in both; `bottom` and `shoes` in the head one), so choosing a hair colour
  does not change the cache key of forty tiles. The crop is part of the portrait hash, so the two are
  two cache entries rather than one picture served for both.
- **Changing body is a migration.** The server refuses a configuration wearing an item that was never
  modelled for that body, so `switchBody` re-dresses the slots that would have become invalid and says in
  a `role="status"` *which* — a top that silently became the default tee is a top the player thinks they
  lost. It needs `GET /api/catalog/items` for the variants, which is fetched beside the inventory and is
  allowed to fail on its own (a failed catalogue answers "everything fits").
- **Leaving with unsaved changes is guarded twice**: `beforeunload` for a reload or a closed tab, and a
  capture-phase click on any `a[href^="#"]` for the rail, which is how every other route here is reached.
  Both armed only while there is something to lose.

Saving is `PUT /api/me/avatar` with the full v2 payload (an empty optional slot is *absent*, not `''`),
then `invalidate(myId)` so the lobby bar and the seat plates pick the new face up.

### Adding an item, end to end

1. **The mesh.** Add it to `apps/normal-web/scripts/avatar-map.json`, run `pnpm avatar:assets`, and look
   at it on both bodies with `node scripts/avatar-shots.mjs new <id>` — see "Add an item" and "Judging a
   map change" in [`avatar-assets.md`](avatar-assets.md).
2. **The catalogue.** Add the row to `apps/normal-server/data/items.json` with its `slot`, `rarity`,
   `isDefault` and `variants.<body>.{file,node}` pointing at the manifest's key — see
   [`normal-server.md`](normal-server.md). `apps/normal-server/test/catalog-manifest.test.ts` checks the
   two agree.
3. **The name, in both languages.** `items.<id>` in `src/locales/vi/normal.json` *and*
   `src/locales/en/normal.json`. `locales.test.ts` fails if either is missing, if one language has a key
   the other does not, or if a name exists for an id the server does not serve.
4. **How it is won.** A grant in `data/achievements.json` or the daily calendar, or nothing — an item
   nobody owns is an item nobody sees, because the wardrobe lists the inventory and not the catalogue.
5. **Commit the map, the changed `.glb` files, `manifest.json` and the catalogue together.** The assets
   are a committed build artefact and `avatar-assets.test.ts` re-hashes them against the manifest.

There is no drawing step and no per-item code: the renderer is generic over `<slot>/<itemId>/<body>`.

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
and holds five budgets:

| | Budget | Today |
|---|---:|---:|
| entry chunk (first paint) | 500 KB | 107 KB |
| every JS chunk together | 900 KB | 270 KB |
| the stylesheet | 60 KB | 12 KB |
| the `avatar3d` chunk (three.js + the renderer, lazy) | 200 KB | 150 KB |
| `dist/avatar3d/` — the `.glb` bundles, raw bytes | 6 MB total, 1.5 MB per file | 910 KB / 505 KB |

The first three are roughly four times what is spent: their job is to catch a *step change* (a chart
library, a locale bundle that stopped being split), not to fail on the kilobyte a feature costs. The
avatar3d chunk is a real target rather than headroom — it is ~25 % over what the graph costs, and what it
guards against is somebody importing a control, a post-processing pass or a loader for a format nothing
uses. The asset budget is the same one `scripts/avatar-assets.mjs` enforces at build time and
`test/avatar-assets.test.ts` holds against `public/`; measuring `dist/` too is what would catch a build
config that stopped copying those files verbatim.

Three structural assertions sit beside the numbers. The entry chunk is read off `dist/index.html`'s module
script rather than guessed from a file name; the six account screens must each still be a chunk of their
own; and the entry must not contain the string `THREE.WebGLRenderer`, which is how a static import of
three.js from outside `avatar3d/` is caught. Every block **skips with a warning** when `dist/` is missing,
so `pnpm test` on a fresh checkout stays green and says what it had nothing to measure. Run
`pnpm build:normal` (or `pnpm --filter @bp/normal-web build`) first to make it measure.

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

`normal.spec.ts` and `avatar3d.spec.ts` share `e2e/support.ts` — the account, the cookie session, the
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
- **The avatar, on a GPU** (`avatar3d.spec.ts`). Every other test of `src/avatar3d/` replaces the
  renderer with a double, which says nothing about whether a picture comes out. This one asserts that a
  portrait is an `<img data-hash>` with `naturalWidth > 0` on the lobby bar and on a seat plate, that a
  stage (`role="img"` with a `<canvas>`) is on the profile and in the wardrobe, that three configurations
  give three different hashes, that a save survives a reload and reaches a *second browser* at the same
  hash, and — `@mobile` — that the wardrobe at 375 px does not scroll sideways and its save button is
  reachable and 44 px tall. Two timings are logged: how long from joining a room until every seat
  portrait is drawn (asserted ≤ 2 s, design §7; ~0.3 s with one bot and warm caches) and how long a cold
  browser takes to draw its first face (~3.4 s, most of it the lazy chunk and the `.glb` files).

Every selector is a user-visible one: a role and its accessible name, in Vietnamese. It fails when
the thing a player reaches for stops being reachable, not when a class name changes. Screenshots
(both viewports) land in `e2e/screenshots/`, which is not committed.

The suite is **not** part of `pnpm test`: it needs a build and a browser download.
