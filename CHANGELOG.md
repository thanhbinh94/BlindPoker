# Changelog

Bind Poker is built one plan at a time; each plan lands on `master` as a single merge commit. This
file has one section per plan, newest first, with the merge commit that carried it.

Nothing here has been released. Versions in `package.json` are `0.1.0` throughout; the sections
below are the real history.

---

## Plan 7 — Hardening — *unreleased (branch `feat/plan7-hardening`)*

The M9 milestone: prove what was built, close what the earlier plans left open, and write the
acceptance record.

- **A real multiplayer soak.** `runSoak` drives 6 clients over 3 rooms for 20 hands each (spec
  §29.3) through actual WebSockets, then asserts the invariants: money conserved, no `seq` gaps, no
  resyncs, latency inside budget. Measured 2026-09-05 over nine runs on the development machine
  (Windows 11 / Node 22.13) — 60–62 hands, 0 gaps, 0 resyncs, not one point created or destroyed,
  and p95 action → broadcast of 3–14 ms (Hold'em) / 4–34 ms (Blind) against §24's 50 ms, worst
  single sample 75 ms. The spread is machine load: the low end is the soak file alone, the high end
  the same runs sharing the machine with the rest of the suite. The test's own assertion is
  `< 200 ms`.
- **Edge-case coverage, written down.** `docs/test-matrix.md` maps every row of spec §29.2, §29.3
  and §30 to the test that holds it up — 42 rows, 11 of them new here, 1 partly covered with the
  reason stated, none skipped. The `reqId` replay contract was ruled on (it is per connection) and
  `docs/server-kit.md` corrected to match.
- **`SIT_OUT` / `SIT_IN`.** A seated player can sit out and back in: the current hand plays out, the
  ones after it are skipped, and five skipped hands in a row return the seat and the stack. Protocol
  in `@bp/core`, enforcement in `@bp/server-kit`, a toggle in the `@bp/ui-kit` room tray.
- **A security pass.** Every mutating route in *both* editions is now enumerated out of the
  assembled app and asserted to be CSRF-guarded and metered — Lite's general limiter was missing
  some. Added a static scan that no token, password, cookie, email or request body reaches a logging
  call, the `react-hooks` ESLint plugin, and `docs/security.md`: a threat table with the test that
  proves each row, a dated dependency audit, and what the operator still has to do.
- **Contrast and start-up.** The light theme's gold reached AA (3.93 → 4.93 on `--bg`), the three
  parchment islands that carried a copy of the old value came with it, and the remaining sub-AA
  pairs are pinned as `BELOW_AA` so they cannot quietly get worse. Lite's second-instance guard now
  verifies the live instance instead of trusting a stale run file.
- **The acceptance record.** `docs/acceptance-checklist.md` answers all 64 items of requirement.txt
  §40 and §66 with a citation each, machine-checked by `tooling/arch/acceptance-links.test.ts`;
  `docs/known-limitations.md` says what the thing does not do and why; this changelog; and the final
  README and spec pass.

## Plan 6 — Normal web — `035acd4` (2026-09-05)

The Normal edition's browser client, and the image that serves it.

- Vite/React app on `@bp/ui-kit`, served by the Normal server itself from `/app/public`: one origin,
  one cookie, nothing extra to deploy.
- Session gate on the cookie alone — no token in JavaScript, no `HELLO` on the socket — with a
  reconnect probe that tells a dead session apart from a bad network.
- Account screens: sign-in and registration, profile with sixteen counters and a paged ledger, daily
  check-in with the 31-day calendar, inventory, achievements, and an avatar editor.
- Avatars as SVG components keyed by the catalogue's `assetKey`, cached per player id, with a
  neutral silhouette for anyone the cache has not answered for yet.
- A Playwright pass over the built app against the real server on in-process PGlite: register, sign
  out, sign back in, play a Blind hand to settlement, and reconcile the balance against the payout
  and the fee from three independent sources.

## Plan 5 — Normal server — `bfb443d` (2026-09-05)

The Normal edition's backend, and the HTTP plumbing both editions share.

- PostgreSQL 16 + Drizzle with committed SQL migrations, run as a one-shot Compose job; the whole
  test suite runs on in-process PGlite through the same driver-neutral `AppDb`.
- Accounts: argon2id at OWASP parameters, a session whose database id is `HMAC(SESSION_SECRET,
  token)` so a stolen dump is not a set of cookies, rotated on sign-in and swept on expiry.
- A points ledger that is the single source of truth: every movement is a row, sinks included, and
  `Σ balance + Σ sink rows` is the invariant.
- Economy and progression: the 31-day daily table with item tiers, relief with a 24-hour cooldown,
  a 2% table fee, 32 achievements unlocked from a domain event bus, and an item catalogue.
- `@bp/http-kit` extracted: `.env` reading, JSON logger, rate limiter, static assets, security
  headers, CSRF guard and error envelope — identical in both editions, so kept in one place.
- A four-service Compose stack (app, `postgres:16`, migrate, Caddy) with backup and restore
  procedures.

## Plan 4 — Lite edition — `e70fcfb` (2026-09-04)

One Windows executable: server, web UI and database in a single file.

- Fastify + `node:sqlite` (WAL, `PRAGMA user_version` migrations), no native modules, no database
  server, no Internet.
- A React web app embedded in the executable as a SEA asset and read through `sea.getAsset()`;
  in development the same server reads `dist/public`.
- Sessions are a display name and a bearer token — no password, deliberately, for one trusted LAN.
- A single-exe build via Node SEA, with footprint budgets (JS, CSS, executable size) and a smoke
  test that boots the real `.exe`, reads `/health` and checks the exit code.
- A run file beside the data directory: a second instance on the same directory refuses to start,
  `--stop` drains the rooms and gives every buy-in back, and the wreckage of a hard kill is detected
  rather than trusted.

## Plan 3 — `@bp/ui-kit` — `b0b89c8` (2026-09-04)

The shared React client both editions render.

- A game client — connection with backoff and `HELLO` replay, a reducer that mirrors `playerView`
  frame by frame, snapshot/`RESYNC` recovery — verified against the engine over whole random hands.
- The poker table: a ring layout that becomes a two-row stack on narrow screens, seats for two to
  nine, community cards, pot, turn timer, and an action tray that holds its height between turns.
- Lobby, room and result screens, with the app supplying avatars and captions through slots so the
  kit never learns what a cosmetic is.
- i18n in Vietnamese and English with key parity enforced, and a theme in light, dark and night-felt
  variants driven entirely by tokens.

## Plan 2 — `@bp/server-kit` — `57675a0` (2026-09-04)

Rooms, realtime and everything around a hand that is not the hand itself.

- A WebSocket gateway with origin policy, authentication, heartbeat, per-connection ordering, flood
  and payload limits, and a 32-deep `reqId` replay buffer per connection.
- Rooms as serialized actors: joins, seat changes, actions, disconnects and hand completion never
  interleave, so a timer and an action arriving together apply exactly one of the two.
- Reconnect with a 90-second window and a full snapshot rather than a replay; expiry stands the
  player up and returns the stack.
- Bots scheduled with a think delay, timers for turns and decisions, carry-over pot release, and a
  shutdown path that cancels hands, refunds and notifies.
- Repository interfaces (players, balances, history) that an edition implements — the seam where
  PostgreSQL and SQLite plug in without the engine noticing.

## Plan 1 — Core engine — `546e460` (2026-09-04)

The pure game engine: no I/O, no edition, no dependencies.

- No-Limit Texas Hold'em: blinds, streets, min-raise, all-in that does not reopen raising, side
  pots, run-out, showdown, odd chips clockwise from the button, a 2% table fee capped at one big
  blind.
- Blind Poker in both variants (2 and 3 cards) and both modes (A: no decision; B: play or fold),
  with the carry-over pot when everyone folds.
- A hand evaluator checked against brute force over every 5-card subset of random 7- and 8-card
  hands.
- A deterministic reducer with timers left outside it, a filtered `playerView` per seat, and a
  money-conservation invariant asserted on every simulated hand.
- The wire protocol, display-name normalization for Vietnamese, the economy constants, and the
  pnpm/TypeScript monorepo scaffold with the dependency-graph test that has guarded the boundaries
  ever since.
