# Security

What this codebase defends against, where each defence lives, and which test would fail if it were
removed. It is the developer-facing companion to spec §23 — the operator guides
([`deployment-normal.md`](deployment-normal.md), [`deployment-lite.md`](deployment-lite.md)) are in
Vietnamese and cover running the thing; this is in English, like the other developer docs here.

Two facts frame everything below.

- **The stakes are points, not money.** Nothing here is purchasable and nothing converts to
  currency. That does not make abuse acceptable, but it does mean the threat model is "a player
  cheats, floods or reads someone else's data", not "an attacker steals funds".
- **The two editions have different threat models.** Normal is on the open Internet with real
  accounts and passwords. Lite is one `.exe` on a LAN with no password at all: whoever holds a
  bearer token *is* that player, deliberately (§23, last row). Where a defence differs, both columns
  say so.

---

## 1. Threat table (spec §23)

| Threat | Enforcement (file) | Test that proves it |
| --- | --- | --- |
| Client manipulates cards, the RNG or the pot | Everything is decided server-side. The client is only ever sent a `HandView` filtered to its own seat (`packages/core/src/hand/view.ts` — `playerView`), the shuffle is `packages/core/src/cards/shuffle.ts` driven by `cryptoRng` (`randomInt`, `packages/server-kit/src/infra/rng.ts`), and pots are built in `packages/core/src/betting/pots.ts`. A seeded RNG exists only for tests and replays. | `packages/server-kit/src/gateway/gateway.test.ts` → "deals private cards only to their owner…"; `packages/core/src/betting/pots.test.ts`; `packages/core/src/cards/cards.test.ts` → "spreads the first card roughly uniformly" |
| Wrong, duplicate or out-of-turn actions | `legalActions` (`packages/core/src/hand/engine.ts`) decides what a seat may do; the room actor runs one message at a time and correlates on `reqId`, refusing a stale `baseSeq` (`packages/server-kit/src/room/room.ts`, `hand-runner.ts`). A retransmitted `reqId` replays the original answer rather than acting twice. | `packages/server-kit/src/gateway/gateway.test.ts` → "enforces turn order, staleness, duplicates and legality" and "replays the original ERROR when a failed request is retransmitted with the same reqId" |
| Sign-in brute force *(Normal)* | argon2id at m=64 MiB, t=3, p=1 (`apps/normal-server/src/auth/password.ts`, `ARGON2_PARAMS`); five attempts a minute keyed on `ip\|email` (`apps/normal-server/src/http/routes-auth.ts`); ten sign-ups a minute per address. An unknown address verifies against `DUMMY_HASH` so the timing of "no such account" matches "wrong password". | `apps/normal-server/src/auth/password.test.ts` → "hashes with argon2id at the production parameters" and "is a real argon2id hash at the production cost that nothing verifies against"; `apps/normal-server/src/auth/auth-service.test.ts` → "answers a wrong password and an unknown address identically, and verifies a hash in both cases"; `apps/normal-server/src/http/routes-auth.test.ts` → "rate limits five attempts a minute per address and place" |
| Session hijack *(Normal)* | The cookie is `HttpOnly; SameSite=Lax; Path=/` and `Secure` unless `COOKIE_SECURE=false` (`apps/normal-server/src/auth/cookie.ts`). The database stores `hex(HMAC-SHA256(SESSION_SECRET, token))`, never the token, so a dump of `sessions` is not a set of cookies. Logout revokes; a fresh sign-in rotates the id; expired rows are swept hourly. | `apps/normal-server/src/auth/session-service.test.ts` → "returns a base64url token and stores the keyed digest of it, never the token" and "does not resolve a token issued under a different secret"; `apps/normal-server/src/auth/auth-service.test.ts` → "rotates: the session presented is revoked and a new one issued"; `apps/normal-server/src/app.test.ts` → "deletes rows past their expiry and leaves the live ones alone" |
| Session hijack *(Lite)* | A 32-byte bearer token in `localStorage`, stored as a digest server-side. There is no password behind it — see the last row. | `apps/lite/server/src/session/session-service.test.ts` → "stores the sha256 hex of the token, not the token itself", "generates a fresh 32-byte base64url token per player when no random() override is given" and "returns null for an unknown token" |
| CSRF | `SameSite=Lax` plus a mandatory `X-Requested-With: bind-poker` on every `POST`/`PUT`/`PATCH`/`DELETE`, checked in an instance-wide `preHandler` before auth and before the rate limiter (`packages/http-kit/src/security.ts`, `registerCsrfGuard`). Only fetch/XHR can set a custom header, and doing so cross-origin forces a preflight neither server answers. The WebSocket upgrade checks `Origin` instead (below). | `packages/http-kit/src/security.test.ts` → the four `registerCsrfGuard` cases; **and, over the whole surface**, `apps/normal-server/src/app.test.ts` and `apps/lite/server/src/app.test.ts` → "every mutating route is guarded > refuses each of them without X-Requested-With" |
| WebSocket cross-origin | `Gateway.originAllowed` (`packages/server-kit/src/gateway/gateway.ts`). Normal names the origins explicitly (`ALLOWED_ORIGINS`, required); Lite defaults to `'same-host'` — the page's `Origin` must match the request's `Host`, and a client that sends no `Origin` at all (not a browser, so no site to forge from) is let through. The refusal is a `403` written to the socket before any WebSocket exists. | `packages/server-kit/src/gateway/gateway.test.ts` → the four "origin policy" cases; `apps/normal-server/src/app.test.ts` → "refuses an origin that is not in ALLOWED_ORIGINS, and any path but /ws"; `apps/lite/server/src/app.test.ts` → "defaults to the same-host origin policy" and "honours an explicit ALLOWED_ORIGINS list instead" |
| XSS | React escapes everything it renders; `dangerouslySetInnerHTML` appears nowhere; an avatar is `<img>` PNG layers (same-origin files, or a recoloured copy of one shown as a `blob:` URL), never injected markup. CSP is `default-src 'self'` with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (`packages/http-kit/src/security.ts`, `DEFAULT_CSP`; Normal's `normalCsp` in `apps/normal-server/src/app.ts` adds the two Google Fonts hosts, `blob:` on `img-src` for the recoloured avatar layers, and an explicit `script-src 'self'` — see the note below). Display names are validated and normalized in `@bp/core` before they are stored. | `tooling/arch/security-static.test.ts` → "uses dangerouslySetInnerHTML nowhere"; `packages/http-kit/src/security.test.ts` → "names every directive the spec §19.3 header list requires"; `packages/core/src/protocol/display-name.test.ts` |
| Clickjacking | `frame-ancestors 'none'` in the CSP, plus `X-Frame-Options: DENY` for the older browsers and embedded webviews that only understand that. Set on an `onRequest` hook, so they are on 404s and 500s too. | `packages/http-kit/src/security.test.ts` → "sets the header set on every response, misses included"; both editions' `app.test.ts` → "sets them on a 404 and on a 500, and lets nothing of the error into the body" |
| SQL injection | Normal: Drizzle, parameterized (`apps/normal-server/src/repos/`, `db/schema.ts`); the one hand-written statement, the truncate in the test harness, is a test. Lite: `node:sqlite` prepared statements with bound parameters (`apps/lite/server/src/repos/sqlite-repos.ts`). Every request body is validated before it reaches a query. | `apps/normal-server/src/repos/player-repo.test.ts` → "returns null for an id that is not there, and for one that is not a uuid" (a hostile string reaches a *bound parameter*, and the driver refuses it rather than the query being rebuilt around it) and "refuses a name another player already holds, whatever its case"; `apps/lite/server/src/repos/sqlite-repos.test.ts` → "finds by name through the key, so case and composition do not matter"; `packages/core/src/protocol/display-name.test.ts` for the validation in front of them |
| Path traversal in the static route | Percent-decoding first, then backslash folding, then a `..` segment rejects the whole path (`packages/http-kit/src/assets.ts`). `api`, `ws` and `health` are reserved prefixes the SPA fallback may never answer for. | `packages/http-kit/src/assets.test.ts`; `packages/http-kit/src/static-route.test.ts`; `apps/lite/server/src/app.test.ts` → "never falls back for API, ws or traversal paths"; `apps/normal-server/src/app.test.ts` → "never lets the fallback answer for the API, the socket or the probe" |
| WebSocket abuse | 20 messages/second with a burst of 20, 4 KiB max payload, three malformed messages closes the socket, a 5 s `HELLO` timeout, heartbeat every 15 s (`packages/server-kit/src/gateway/gateway.ts`, `DEFAULT_GATEWAY_OPTIONS`). A player may hold **one** room, not the three §23 allows for (`RoomManager`, `ALREADY_IN_ROOM`). | `packages/server-kit/src/gateway/gateway.test.ts` → "rate-limits floods, closes after repeated invalid messages, and rejects oversized payloads" and "does not treat a rejected room config as protocol abuse" |
| REST flooding | Normal: every mutating `/api` request passes **two** buckets — 60/min per session (keyed on a SHA-256 of the cookie) and 120/min per address, so rotating the cookie buys nothing — plus 240/min per address for reads; sign-in and sign-up have their own tighter limiters (`apps/normal-server/src/http/routes.ts`). Lite: 60/min per address for mutating `/api`, with 10/min on session creation and 5/min on the admin stop (`apps/lite/server/src/http/routes.ts`). | Both editions' `app.test.ts` → "every mutating route is guarded > meters each of them, whether by the general bucket or by one of its own"; `apps/normal-server/src/app.test.ts` → "meters a caller that rotates its cookie" |
| WebSocket upgrade flooding *(Normal)* | 30 upgrades a minute per address, decided **before** the session lookup, and a `503` past `MAX_CONNECTIONS` (`apps/normal-server/src/app.ts`). | `apps/normal-server/src/app.test.ts` → "refuses past the limit with a 429 before it ever looks a session up" and "answers 503 once it is holding as many connections as it is configured for" |
| Spoofed client address | `TRUST_PROXY` is a list of hops, and `TRUST_PROXY=true` is **refused at startup**: trusting every hop makes `req.ip` the left-most `X-Forwarded-For` entry, which the client writes, voiding every address-keyed limit (`apps/normal-server/src/config.ts`, `trust-proxy.ts`). Lite builds Fastify with `trustProxy: false` outright. | `apps/normal-server/src/config.test.ts` → "refuses a bare true, and says what to write instead"; `apps/normal-server/src/app.test.ts` → "ignores a spoofed X-Forwarded-For from an address that is not a trusted proxy" |
| Information disclosure | Every failure is `{ error: { code, message } }`. A 4xx keeps its message; anything ≥ 500 is logged in full and answered with a fixed `INTERNAL` — no stack, no driver text (`packages/http-kit/src/http-errors.ts`). No token, password, cookie, request body or full email address is passed to a logging call — held to it by a static scan whose exact reach §3 states. `/api/players/:id/avatar` is behind auth so it cannot be used to enumerate accounts, and it answers 404 identically for an unknown id and a malformed one. | `packages/http-kit/src/http-errors.test.ts` → "hides an unexpected failure behind INTERNAL and logs it in full"; `tooling/arch/security-static.test.ts` → "passes no token, password, cookie, email or request body to a logging call"; both editions' `app.test.ts` → "…lets nothing of the error into the body" |
| Weak or missing secrets | `SESSION_SECRET` must be ≥ 32 characters or the server refuses to start; so must a `postgres://` `DATABASE_URL` and at least one absolute origin in `ALLOWED_ORIGINS`. Every problem is reported in one run (`apps/normal-server/src/config.ts`). Nothing is defaulted to a value baked into this repository. | `apps/normal-server/src/config.test.ts` → "rejects a short session secret", "lists every missing required var in one error" |
| Admin shutdown abuse *(Lite)* | Three guards, cheapest refusal first: 5/min rate limit → the socket peer must be on the loopback → the run token compared in constant time (`apps/lite/server/src/http/routes.ts`, `packages/http-kit/src/auth-headers.ts`). The token is 32 fresh random bytes per boot, published in `bind-poker.run.json` beside the data file. | `apps/lite/server/src/app.test.ts` → "refuses a caller that is not on the loopback with 403", "refuses a wrong run token with 401, even from the loopback", "rate limits to 5 attempts per minute" |
| Oversized request bodies | 16 KiB `bodyLimit` in both editions (`app.ts`); Fastify's 413 is translated into the shared `PAYLOAD_TOO_LARGE` envelope. | `packages/http-kit/src/http-errors.test.ts` → "gives Fastify’s own 4xx a stable code and keeps its status" |
| Lite has no password | Accepted and documented, not mitigated: whoever holds the token is that player, and the edition is meant for one trusted LAN. `ALLOWED_ORIGINS` empty means `'same-host'`, and `HOST=127.0.0.1` limits it to the one machine. An optional PIN is on the roadmap (§34). | — (a stated limitation, §23) |
| **Quản trị** — a player reaches the GM routes *(Normal, Plan 25)* | Every `/api/gm/*` route sits behind `requireGm` (`apps/normal-server/src/http/auth-guard.ts`): `requireUser`, then the role read from the database **on that request** (`RequestUser.role`), never from the cookie or the client. The web client only uses the role to show the entry; the `#/gm` route and the Settings row are a convenience, and the server is the lock. | `apps/normal-server/src/http/auth-guard.test.ts` → "answers 403 FORBIDDEN to a player and 200 to a gm, reading the role on every request"; `apps/normal-server/src/http/routes-gm.test.ts` → "answers 401 to nobody and 403 FORBIDDEN to a player on every route" |
| **Quản trị** — a demoted or locked GM keeps working | No cache: a demotion or a lock is effective on the next request. A locked account is refused at sign-in (`ACCOUNT_LOCKED`, only after the password was checked, so the code does not reveal that an address exists), its sessions are revoked and its socket is closed (close code 4003), and `identityForToken` refuses a session that survived. | `apps/normal-server/src/http/auth-guard.test.ts` → "treats a locked account as signed out, whatever cookie it still holds"; `apps/normal-server/src/http/routes-auth.test.ts` → "is refused at sign-in with 403 ACCOUNT_LOCKED and the reason, after the password was checked"; `apps/normal-server/src/auth/auth-service.test.ts` → "returns null for a locked account whose session survived, so it cannot open a socket" |
| **Quản trị** — a GM abuses the power, or an account is taken over | Every write has a reason of 3 to 200 characters and a `gm_actions` row **in the same transaction** as its effect (no grant without its log line, no log line for a rolled-back grant); the log is append-only, with no route that edits or deletes it. One grant moves at most 10,000,000 points; a deduction cannot overdraw; `gm_grant` and `gm_adjust` are ledger sources, so `Σ balances + Σ sinks` stays true. A GM cannot lock themselves or another GM, cannot change their own role, and the last GM cannot be demoted. The player is told of every action (`GM_NOTICE`). | `apps/normal-server/src/gm/gm-service.test.ts` → "takes points back with reason gm_adjust, and refuses all of it when the balance is short — no action row either", "never locks a gm, and never lets a gm change their own role", "promotes and demotes with a log line, and refuses to demote the last gm"; `apps/normal-server/src/http/routes-gm.test.ts` → "every POST without a reason is exactly 400 INVALID_REASON, whatever else the body or the target is" |
| **Quản trị** — personal data leaks through the console | The player search returns a masked address (`t***@gmail.com`); the full one only on one player's page. Search is a `POST`, so the address typed never sits in a URL or an access log. | `apps/normal-server/src/gm/mask-email.test.ts` → "keeps the first letter and the domain"; `apps/normal-server/src/http/routes-gm.test.ts` → "searches by POST and masks emails; the detail shows the full one; a player gets 403" |
| **Quản trị** — the first GM, and the test hook | The first GM is made only by the operator's CLI on the server (`grant-gm-cli`, `DATABASE_URL` only; no environment variable and no API can create one). The e2e-only `POST /e2e/promote` is mounted through `AppDeps.extraRoutes` by the e2e entry alone, is loopback-only and CSRF-guarded, and the production bundle contains no such route. | `apps/normal-server/src/e2e-promote.test.ts` → "has no /e2e/promote route", "refuses a request that did not come from loopback, and promotes nobody"; `apps/normal-server/src/gm/grant-gm.test.ts` → "--revoke of a player is a no-op, and --revoke of the only gm throws LastGmError" |
| **Quản trị** — a GM shares the player's password | Accepted and documented, not mitigated: a GM account is an ordinary account with a role, so one password (and a session cookie) is all it takes, and there is no 2FA. Advice to the operator: a long password used nowhere else. The overview's 24 h totals by reason are the check on grants, since there is no daily cap. | — (a stated limitation; `docs/known-limitations.md`) |

### What Normal's CSP adds beyond the default

`normalCsp` changes `DEFAULT_CSP` in four places (`apps/normal-server/src/app.ts`; the whole header is
pinned in `app.test.ts`, which also asserts `img-src`, `style-src`, `font-src` and `script-src` one by
one): three widenings and one directive written out. Only one of them is for the avatar.

**`style-src` and `font-src` gain the two Google Fonts hosts** `normal-web` (Plan 6) loads its display
face from — see the doc comment beside `FONTS_STYLESHEET_HOST`/`FONTS_FILE_HOST`.

**`img-src` gains `blob:`** — `img-src 'self' data: blob:` — for the recoloured avatar layers (Plan 13:
hair colour, eye colour, the coloured outfits and hats). `packages/ui-kit/src/avatar2d/tinted.ts` paints a
layer onto an offscreen `<canvas>` in the page and shows the result through an object URL; a policy that
allows only `'self' data:` makes the browser refuse that URL, which is what blanked the head on a hair colour
and left an eye colour unchanged (review 2026-09-29, No15 and No16). Nothing else accepts `blob:`:
`script-src`, `connect-src`, `default-src` and `object-src` are untouched, so a `blob:` URL can still neither
run as script nor be fetched by the page. It also opens no new source — only script already running on this
origin can mint one, and it points at bytes this document itself holds — and `data:`, already allowed, is the
wider of the two. `data:` URLs were the alternative and were rejected: they would mean base64-encoding ~96
cached layers of several hundred KB each on the main thread. If a tinted image ever fails to load anyway,
`Chibi` draws the plain layer instead of a broken one, and the tint e2e (`apps/normal-web/e2e/avatar-tint.spec.ts`)
asserts every layer of the wardrobe preview really decoded and that the recoloured ones are `blob:` images,
so a silent fallback fails the test.

**`script-src 'self'`**, written out explicitly even though it says nothing `default-src 'self'` did
not already say on its own. Before Plan 11 this line carried `'wasm-unsafe-eval'`, for the 3D avatar's
WebAssembly meshopt decoder; since the avatar is `<img>` PNG layers, nothing in this app needs
WebAssembly or anything else wider than the default, and that keyword is gone. The `blob:` images above
are pictures, not scripts, so this line is untouched by them. The explicit line stays anyway: a
directive added here later narrows a policy that already named `script-src`, rather than falling back to
`default-src` silently the way it would if the line were simply removed.

Lite keeps `DEFAULT_CSP` unchanged: it does not recolour avatar layers, so its `img-src` stays
`'self' data:` and nothing in it accepts `blob:`.

### Guarded surface, by edition

The guard tests above are parametrised over the routes *enumerated out of the finished app*
(`packages/http-kit/src/testing/routes.ts`), so a route added later is covered the day it is added
rather than the day somebody remembers. Both suites also pin the full route list, so a new endpoint
cannot appear without a deliberate edit to the test.

`mutatingRoutes` returns **every** mutating route, not only the ones under `/api` — deliberately, so
the test is not scoped by the same assumption as the code it tests. Both editions' limiter hooks key
on `/api/`; if a `POST /upload` were ever mounted outside it, the hook would miss it and a loop
filtered the same way would never notice. Instead the loop covers the whole set, each edition's test
asserts that its exemption list (`UNMETERED_BY_DESIGN`) is empty and that nothing mutating is mounted
outside `/api`, and the routes that step over the general bucket are pinned by name with the tighter
limiter each carries (`OWN_LIMITER`, exported from both editions' `http/routes.ts`).

**Normal** — mutating `/api` routes, all CSRF-guarded, all metered:

| Route | Limiter |
| --- | --- |
| `POST /api/auth/register` | its own, 10/min per address |
| `POST /api/auth/login` | its own, 5/min per address+email |
| `POST /api/auth/logout` | general write bucket (60/min per session **and** 120/min per address) |
| `PATCH /api/me` | general write bucket |
| `PUT /api/me/avatar` | general write bucket |
| `POST /api/rewards/daily/claim` | general write bucket |
| `POST /api/economy/relief` | general write bucket |
| the eight `POST /api/gm/*` routes (player search, points, items, lock, unlock, role; room kick and close), all behind `requireGm` (Plan 25) | general write bucket |

The table names the account routes and the GM routes; the enumeration out of the finished app in the guard tests is the
complete list.

**Lite** — mutating `/api` routes, all CSRF-guarded, all metered:

| Route | Limiter |
| --- | --- |
| `POST /api/session` | its own, 10/min per address |
| `POST /api/admin/shutdown` | its own, 5/min per address (plus loopback + run token) |
| `POST /api/rewards/daily/claim` | general write bucket, 60/min per address |
| `POST /api/economy/relief` | general write bucket, 60/min per address |

> The last two rows are new. Lite shipped with no limiter on either: both open a SQLite write
> transaction and both were reachable as fast as a loop could send them by anyone holding one valid
> token. `WRITE_RATE_LIMIT` in `apps/lite/server/src/http/routes.ts` closes that, and spec §19.3
> records it.

---

## 2. Dependency audit

Run from the repository root. `--prod` is the one that matters for what ships; the full run also
covers the toolchain, which never leaves a developer's machine or CI.

```bash
pnpm audit --prod        # what a deployed server actually runs
pnpm audit               # everything, toolchain included
pnpm outdated -r         # recorded, not acted on
```

### 2026-09-05

`pnpm audit --prod` — **no known vulnerabilities.** 634 production dependencies.

`pnpm audit` (all) — 7 advisories, **every one of them in a build- or test-only package**, none of
which is installed on a server or shipped inside the Lite executable:

| Severity | Package | Where | Disposition |
| --- | --- | --- | --- |
| critical | `vitest` < 3.2.6 | root + every workspace, devDependency | The advisory is against the **Vitest UI server** (`vitest --ui`), which this repository never starts: `pnpm test` is `vitest run`, and no script passes `--ui` or `--api`. Fixing it means Vitest 2 → 3 across eight packages, which is a change of its own; tracked, not taken here. |
| high | `vite` ≤ 6.4.2 | dev server / bundler for the three web packages | `server.fs.deny` bypass — a **dev server** issue. The Vite dev server runs only for `pnpm dev:normal-web` on a developer's own machine; production is a static bundle served by Fastify. |
| moderate | `vite` ≤ 6.4.1, ≤ 6.4.2 | same | Path traversal in optimized-deps `.map` handling, and a `launch-editor` NTLM issue. Both dev-server-only, same reasoning. |
| moderate | `esbuild` ≤ 0.24.2 | `apps/lite`, `apps/normal-server` devDependency; also under `vite` | "Any website can send requests to the development server" — the esbuild **dev server**, which is never started here: both apps use esbuild as a one-shot bundler (`scripts/`), and the binary is not in the runtime image or the exe. |

Nothing was force-resolved and no override was added: an override on a transitive `vite` under
Vitest would pin a version Vitest 2 was not built against, trading a dev-only advisory for a broken
test runner. The upgrade that actually clears the list is Vitest 3 + Vite 6, and it belongs in its
own change.

`pnpm outdated -r` on the same date: `react`/`react-dom` 18 → 19, `i18next` 23 → 26, `vite` 5 → 8,
`vitest` 2 → 5, `typescript` 5.9 → 7, `jsdom` 25 → 30, `eslint` 9 → 10, plus the `@types` that
follow React. All are majors; none is a security fix for something that ships. Recorded here so the
next person knows the distance, not scheduled.

---

## 3. Secrets

| Secret | Lives in | Rotating it |
| --- | --- | --- |
| `SESSION_SECRET` *(Normal)* | The environment, or `.env` in the working directory. `deploy/normal/.env` for the Compose stack. Never logged, never in an error message. | **Signs everyone out.** Session ids are `HMAC-SHA256(secret, token)`, so every stored id becomes unreachable at once. Passwords are unaffected — argon2 hashes carry their own salt. |
| `POSTGRES_PASSWORD` *(Normal)* | `deploy/normal/.env`; interpolated into `DATABASE_URL`. Read by `initdb` on the **first** start only. | Requires an `ALTER ROLE` inside the database as well as an edit to `.env` — deployment guide §8. Use a URL-safe alphabet (`openssl rand -hex 24`): a `/` in the password ends the URL's authority section and `migrate` refuses to start. |
| Password hashes *(Normal)* | `users.password_hash`, argon2id, salt and cost encoded in the value. | Nothing to rotate. Raising `ARGON2_PARAMS` affects new hashes only; old ones keep verifying at the cost they were made with. |
| Session tokens | Only ever in the client (an `HttpOnly` cookie for Normal, `localStorage` for Lite). The server stores a keyed digest. | `POST /api/auth/logout` revokes one; `sessions.revokeAll(userId)` revokes an account's. |
| Run token *(Lite)* | 32 random bytes generated per boot, written to `bind-poker.run.json` beside the data file (mode `0600` where the platform has it) and removed on a clean stop. Never persisted across restarts. | Restart the exe. |

Rules that hold everywhere:

- `.env` is gitignored; `.env.example` is not. **Never put a real value in a `.env.example`.** The
  `SESSION_SECRET` placeholder in `deploy/normal/.env.example` is deliberately shorter than 32
  characters, so a copied-and-forgotten file stops the server instead of bringing up a stack whose
  signing key is published in this repository.
- Configuration is read once, at startup, and every problem is reported together
  (`apps/normal-server/src/config.ts`). A server that starts is a server whose configuration was
  understood.
- Nothing secret reaches the log — enforced as far as a static check can, and reviewed for the rest.
  `tooling/arch/security-static.test.ts` parses every non-test `.ts`/`.tsx` under both apps' `src/`
  and all four packages' `src/` with the TypeScript compiler, and fails if a `token`, `password`,
  `secret`, `cookie`, `authorization`, `credential`, `email` or `body` is *passed* to a logging
  call. It reads arguments, not prose, so `log.warn('wrong run token', { remote })` stays legal.

  **It is a heuristic over one call shape**, and the shape is `<receiver>.<log|info|warn|error|debug|trace>(…)`
  where the receiver's last segment is `console`, `log` or `logger` — `deps.log.warn`,
  `this.deps.log.warn` and `console.error` all count. What it cannot see:

  - an **aliased or wrapped** logger — `const l = deps.log; l.warn({ token })`,
    `log.child({ … }).warn(…)`, or a helper of one's own that takes a payload and logs it;
  - a value that arrives by **concatenation or a rename** — `log.info('t=' + t)`, or
    `const t = session.token` logged as `{ t }`. It matches names, and only whole ones:
    `accessToken` counts, `bodyLimit` does not;
  - anything **outside those roots**: `tooling/`, `scripts/`, `deploy/`, the SEA build, and every
    test file.

  So it catches the obvious mistake on the day it is written, every day thereafter; code review
  still owns the rest. One call is exempt by name, with its reason in the test: Lite's `--check`
  CLI printing the `/health` body it has just read.

---

## 4. What the operator still has to do

None of this is in the code, and all of it is load-bearing.

1. **Terminate TLS in front of the Normal server.** It speaks plain HTTP. The Compose stack in
   `deploy/normal/` puts Caddy in front and gets a Let's Encrypt certificate for `$DOMAIN` on first
   start; DNS must already point at the host and ports 80/443 must be reachable. Without HTTPS the
   session cookie travels in clear and `COOKIE_SECURE=true` means the browser never sends it at all.
2. **Set `TRUST_PROXY` to the hops you actually have.** The default is `false`, which is correct for
   a server reached directly. Behind the Compose stack it is `uniquelocal` (Caddy sits on the bridge
   network with an RFC1918 address); behind a proxy on the same host, `loopback`; behind a named load
   balancer, that balancer's address. `TRUST_PROXY=true` is refused at startup — see the threat table.
   Get this wrong in the permissive direction and every address-keyed rate limit is bypassed by one
   header; get it wrong in the restrictive direction and every player behind the proxy shares one
   bucket.
3. **Set `ALLOWED_ORIGINS` to the public origin, not the internal one.** It is what the browser sends
   as `Origin` on the WebSocket upgrade. Absolute, no path, no trailing slash.
4. **Back the database up, and test a restore.** `deploy/normal/` has the backup job and
   [`deploy/normal/restore.md`](../deploy/normal/restore.md) has the procedure. Points are the whole
   product here; §18.4's invariant (`Σ balances + Σ sinks` is constant) can only be checked against
   data that still exists. For Lite the "backup" is copying `bind-poker.sqlite` (and its `-wal`)
   while the server is stopped.
5. **Know that rotating `SESSION_SECRET` signs everyone out.** It is the right response to a
   suspected leak, and it is a visible event for every player — plan it, do not discover it.
6. **Keep Lite off the open Internet.** It has no passwords by design. `HOST=0.0.0.0` serves the
   whole LAN; `HOST=127.0.0.1` serves only that machine. Do not port-forward it.
7. **Watch `/health`.** Both editions answer the same shape (`status`, `uptime`, `connections`,
   `rooms`, `db`); Normal adds `edition` and `version` and really pings the pool, with a 2-second
   deadline so a stuck database is a `503` rather than silence.
8. **Read the settlement alerts.** A hand recorded but never paid logs `hand settlement failed` with
   its `handId` — the one condition where §18.4's invariant has drifted and somebody has to reconcile
   by hand. The query is in [`normal-server.md`](normal-server.md).
9. **Give a GM a long password used nowhere else, and make the first GM yourself.** A GM account is an ordinary account
   with a role: one password and one session cookie, no 2FA. Run `node dist/grant-gm-cli.js <email>` on the server for the
   first one ([`normal-server.md`](normal-server.md), "Granting the first GM"), and read the Quản trị overview's 24-hour
   points by reason now and then: there is no daily cap on grants, so that is the check.

---

## 5. Reporting

This is a hobby-scale project with no bug-bounty programme. If you find something, open an issue
with enough detail to reproduce it — and if it is exploitable against a live deployment, say so in
the issue title so it is triaged first.
