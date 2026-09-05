# `@bp/normal-web`

## Purpose

The Normal edition's browser client: a Vite/React bundle that talks to
[`@bp/normal-server`](normal-server.md) over REST and one WebSocket, and draws the table with
[`@bp/ui-kit`](ui-kit.md). It is served by the server itself — the Docker image builds it and points
`PUBLIC_DIR` at it — so the app, the API and the socket share one origin and one cookie.

What it owns, and nothing else owns: the account screens (sign-in, profile, wardrobe, inventory,
achievements, daily reward, settings), the REST client, the session gate, and the in-app SVG avatar
part library. The lobby and the table come from the kit unchanged.

Its counterpart is `apps/lite/web`, which solves the same problem for a LAN executable and a bearer
token. Neither may import the other, and neither may import a server package; ESLint enforces both.

To *deploy* this, read [`deployment-normal.md`](deployment-normal.md) (Vietnamese, like every
operator guide here). This page is for changing the code, and is English, like every developer doc.

Spec: §15 avatars, §19.2 API, §24 footprint, §27.2 screens, §29 end-to-end.

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
    session-gate.ts     useSessionGate — boot probe, 401 handling, the reconnect probe
    session.ts          the last email typed, remembered for the sign-in card only
    prefs.ts            theme and language, per device
    notifications.ts    the kit's notification list, with achievement ids translated
    avatar/
      parts.tsx         the vector library: one renderer per catalogue assetKey
      Avatar.tsx        the six layers, stacked, in a 64×64 box
      PartThumb.tsx     one part on its own, for a wardrobe tile
      useAvatars.ts     the shared avatar cache (module scope, 60 s, one request per id)
    screens/            Shell, Auth, Profile, Avatar, Inventory, Achievements, Daily, Settings
    locales/{vi,en}/normal.json
  test/footprint.test.ts   the download budget, measured on `dist/`
  e2e/                     Playwright against the real server
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

---

## Avatars

An avatar is a stack of at most six vectors drawn into the same 64×64 box, in `LAYER_ORDER`
(`base, face, clothing, hair, accessory, jewelry` — top layer last, spec §15.1). `title` and `badge`
are text, not layers.

Each layer is looked up in `PARTS` by the item's **`assetKey`** — `<category>/<id>`, exactly the
string `apps/normal-server/data/items.json` carries — and the rendered group carries it back as
`data-part`, beside `data-layer`. A key with no part is *skipped*, never thrown on: the server can
ship an item before the browser bundle that draws it (a deploy is two artefacts and they do not land
at the same instant), and the answer to that is a player missing a hat for a few minutes, not a table
that fails to render.

Hair colour is a free hex string rather than an item, so it arrives as the CSS custom property
`--avatar-hair` on the `<svg>` and every hair path fills from it.

### Adding an item's vector

The catalogue is the server's (`data/items.json`); this app only draws it. To add one:

1. **Server first.** Add the row to `apps/normal-server/data/items.json` — see "Adding a cosmetic
   item" in [`normal-server.md`](normal-server.md). Its `assetKey` must be `<category>/<id>`.
2. **Name it in both languages.** `items.<id>` in `src/locales/vi/normal.json` *and*
   `src/locales/en/normal.json`. `locales.test.ts` fails the build if either is missing, if one
   language has a key the other does not, or if a name exists for an id the server does not serve.
3. **Draw it** in `src/avatar/parts.tsx`, under the key `'<category>/<id>'`, using the skeleton
   documented at the top of that file: head at `cx 32`, eye line `y 25`, chin `y 39`, shoulders
   `y 44`. Hair parts fill with `hairFill(hairColor)`; everything else uses the kit's colour tokens
   with a literal fallback, or the fixed skin/cloth tones for the things that must not follow the
   theme (a face is not a theme colour).
4. **Keep it to a few paths.** A seat disc is 30 px across on a phone. What has to survive that size
   is *which* item is equipped, so variants differ in silhouette, not in detail.
5. `Avatar.test.tsx` walks the catalogue and asserts every `assetKey` has a renderer, so a row added
   without a vector fails there rather than in front of a player.

### The avatar cache

`useAvatars(api, ids)` is a module-scope cache shared by every screen: one request per player id per
minute, in-flight requests collapsed, failures cached too (a failing endpoint must not become a
request storm from a screen that redraws on every card). Bots are filtered out by the caller — they
have no account, so their id would be a guaranteed 404 apiece.

`invalidate(playerId)` drops an entry and refetches; the wardrobe calls it after a save.

> **Known gap.** `GET /api/players/:id/avatar` answers `Cache-Control: private, max-age=60`, so the
> refetch `invalidate` starts can be served from the *browser's* HTTP cache — which means the player
> who just saved a new face keeps seeing the old one on the lobby bar for up to a minute. Every other
> browser, and every other screen that reads the config directly (`GET /api/me/inventory`), is
> correct immediately. The fix is for that one refetch to bypass the HTTP cache; the e2e works around
> it by checking the saved face from a second context.

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
and holds three budgets: the entry chunk ≤ 500 KB, every chunk together ≤ 900 KB, the stylesheet
≤ 60 KB. At the time of writing the entry is ~109 KB and the whole app ~119 KB, so the budgets are
roughly four times what is spent: the job of the test is to catch a *step change* (a chart library, a
locale bundle that stopped being split), not to fail on the kilobyte a feature costs.

The entry chunk is read off `dist/index.html`'s module script rather than guessed from a file name,
and a fourth assertion keeps the six account screens in chunks of their own — they are `App.tsx`'s
only `import()`s and the reason the first paint stays small. Every block **skips with a warning** when
`dist/` is missing, so `pnpm test` on a fresh checkout stays green and says what it had nothing to
measure. Run `pnpm build:normal` (or `pnpm --filter @bp/normal-web build`) first to make it measure.

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

What the three tests are for:

- **The money.** One account plays a Blind hand against a bot to settlement, and the balance from
  `GET /api/me` (the database's own answer) is reconciled against the payout, the uncalled return and
  the table fee *as printed on the result card*. A settlement that quietly created or destroyed
  points fails here even though both halves would look consistent alone.
- **The session.** Register, sign out, sign back in — the only credential involved is the cookie.
- **The chrome on a phone.** The rail's four tabs must fit inside 375 px with nothing scrolling
  sideways, and the table must come up in the stack layout.

Every selector is a user-visible one: a role and its accessible name, in Vietnamese. It fails when
the thing a player reaches for stops being reachable, not when a class name changes. Screenshots
(both viewports) land in `e2e/screenshots/`, which is not committed.

The suite is **not** part of `pnpm test`: it needs a build and a browser download.
