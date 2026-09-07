# Bind Poker

Real-time multiplayer poker (No-Limit Texas Hold'em + Blind Poker) with virtual points only.
The server is the only authority: it shuffles, it decides what is legal, it settles the pot. A
client displays state and sends actions, and never learns another player's cards.

Two editions from one codebase, sharing the engine, the room layer and the HTTP plumbing:

| | **Normal** | **Lite** |
| --- | --- | --- |
| For | A public server on the Internet | One trusted LAN |
| Ships as | A Docker image, behind Caddy | One Windows `.exe` |
| Database | PostgreSQL 16 (Drizzle) | SQLite (`node:sqlite`), beside the exe |
| Identity | Email + password (argon2id), session cookie | A display name and a bearer token |
| Web UI | Built into the image, served at `/` from the same origin | Embedded in the exe |
| Has | Cosmetics, inventory, avatars, achievements, points ledger | Points, daily reward, relief |
| Needs | A host, a domain, TLS | A double-click |
| Deploy guide | [`docs/deployment-normal.md`](docs/deployment-normal.md) | [`docs/deployment-lite.md`](docs/deployment-lite.md) |

Both are points-only: nothing here is purchasable and nothing converts to money. There are no
deposits, no withdrawals, no payment gateway and no marketplace, by design and permanently.

## Documentation

**Start here**

- [`docs/superpowers/specs/2026-09-04-bind-poker-design.md`](docs/superpowers/specs/2026-09-04-bind-poker-design.md)
  — the specification: rules, architecture, protocol, database, deployment, testing, risks,
  assumptions, decision log. Vietnamese.
- [`docs/acceptance-checklist.md`](docs/acceptance-checklist.md) — all 64 acceptance items of
  `requirement.txt` §40 and §66, each with a test, an e2e step or a manual step with its expected
  result, and a status. Every citation in it is machine-checked by `pnpm test`.
- [`docs/known-limitations.md`](docs/known-limitations.md) — what this does not do, why, and where
  each one is tracked.
- [`CHANGELOG.md`](CHANGELOG.md) — one section per plan, with the merge commit.

**Reference**

- [`docs/test-matrix.md`](docs/test-matrix.md) — which test holds up which requirement of spec
  §29.2, §29.3 and §30.
- [`docs/security.md`](docs/security.md) — what each threat is defended by, which test proves it,
  how secrets are handled, the dated dependency audit, and what an operator still has to do (TLS,
  `TRUST_PROXY`, backups).
- [`docs/server-kit.md`](docs/server-kit.md) — rooms, gateway, timers, reconnect, bots, the soak
  driver.
- [`docs/ui-kit.md`](docs/ui-kit.md) — the shared React client, theme tokens, i18n, and its known
  gaps.
- [`docs/normal-server.md`](docs/normal-server.md) — module map, event bus, ledger conventions,
  adding an item or an achievement.
- [`docs/normal-web.md`](docs/normal-web.md) — API client, session gate, the 3D avatar and the
  wardrobe, footprint, e2e.
- [`docs/avatar-assets.md`](docs/avatar-assets.md) — the avatar asset pipeline: what is in the five
  `.glb` files, how to add an item, and how a map change is judged.
- [`deploy/normal/restore.md`](deploy/normal/restore.md) — the restore procedure.

Developer docs are in English; the two deployment guides and the Lite operator README are in
Vietnamese, because that is who runs them.

## Development

```bash
pnpm install
pnpm test        # every workspace, plus the architecture and acceptance checks in tooling/
pnpm typecheck
pnpm lint
```

Node 22.13 or newer, pnpm 9. `pnpm test` needs no database, no Docker and no network: the Normal
suite runs on in-process PGlite, the Lite suite on an in-memory SQLite. It does run the real Normal
production build (about 15 s); `CI_SKIP_BUILD=1` skips that file.

Per package, when you want a shorter loop:

```bash
pnpm --filter @bp/core test           # the engine — 166 tests
pnpm --filter @bp/server-kit test     # rooms, gateway, soak — 92
pnpm --filter @bp/ui-kit test         # the shared client — 129
pnpm --filter @bp/http-kit test       # shared HTTP plumbing — 75
pnpm --filter @bp/normal-server test  # 364, on in-process PGlite
pnpm --filter @bp/normal-web test     # 219, jsdom
pnpm --filter @bp/lite test           # 224, including footprint budgets and the exe smoke test
```

The end-to-end suites are **not** part of `pnpm test` — they need a build and a one-off Chromium
download. Each edition's section below says how to run its own.

## Layout

- `packages/core` — pure game engine, bot, protocol (no I/O, no dependencies)
- `packages/server-kit` — rooms, WebSocket gateway, timers, reconnect, bots (see `docs/server-kit.md`)
- `packages/http-kit` — shared Fastify plumbing: `.env` reading, JSON logger, rate limiter, static
  assets, security headers, CSRF guard, error envelope; `@bp/http-kit/testing` enumerates an
  assembled app's routes so a guard can be asserted over the whole surface
- `packages/ui-kit` — shared React UI: game client, i18n (vi/en), theme, poker table, lobby, screens
  (see `docs/ui-kit.md`)
- `apps/lite` — the Lite edition: Fastify + `node:sqlite` server, React web app, single-exe build
- `apps/normal-server` — the Normal edition's backend: accounts, PostgreSQL, economy, cosmetics,
  achievements (see `docs/normal-server.md`)
- `apps/normal-web` — the Normal edition's browser client: Vite/React on `@bp/ui-kit`, served by the
  server itself (see `docs/normal-web.md`)
- `deploy/normal` — the Compose stack for the Normal edition: app + Postgres + Caddy, backup and
  restore
- `deploy/normal-windows`, `deploy/oracle` — the two free-tier kits: a Windows LAN trial and an
  Oracle Cloud Always Free deployment (see **Chạy thử miễn phí** below)
- `tooling/arch` — the checks that are about the repository rather than a package: the dependency
  graph, the static security scan, and the acceptance-checklist link check

## Normal edition

A server for the open Internet: real accounts, PostgreSQL, HTTPS. It runs as a four-service Docker
Compose stack — the app, `postgres:16`, a one-shot migration job, and Caddy terminating TLS. The
image carries the web client too: the builder runs the Vite build and the runtime serves it from
`/app/public`, so `https://$DOMAIN` is the app and `https://$DOMAIN/api/…` is its API — one origin,
one cookie, nothing extra to deploy.

```bash
cd deploy/normal
cp .env.example .env && $EDITOR .env     # DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET
docker compose config                    # substitutes everything; fails loudly on a missing value
docker compose up -d --build
curl -fsS https://$DOMAIN/health         # {"ok":true,…,"db":"ok"}
```

DNS for `$DOMAIN` must already point at the host, and ports 80 and 443 must be reachable — Caddy
gets a Let's Encrypt certificate on its first start. Start-up order is enforced, not timed: `db`
becomes healthy, the `migrate` service applies the committed migrations and exits, then `app` starts.

> **This image has never been built.** The Compose file is validated by `docker compose config`, and
> the bundle has been run standalone against its production-only `node_modules` — but no
> `docker build` has been executed for this stack. Treat the first deploy as a supervised trial and
> read `docker compose logs migrate` before `app`. Details in the deployment guide, §2, and in
> [`docs/known-limitations.md`](docs/known-limitations.md).

Without Docker, for development:

```bash
pnpm --filter @bp/normal-server test        # on in-process PGlite — no database needed
pnpm --filter @bp/normal-web test           # the web app's own suite, jsdom
pnpm build:normal                           # web → apps/normal-web/dist, then server → dist/main.js
pnpm --filter @bp/normal-server dev         # build, then run (needs a real DATABASE_URL)
pnpm dev:normal-web                         # Vite on :5173, proxying /api and /ws to :8080
```

Or run the whole thing — real API, real web build, throwaway in-process database — with one command
and no PostgreSQL at all:

```bash
pnpm build:normal
node apps/normal-server/scripts/e2e-server.mjs   # http://127.0.0.1:8091, PGlite, serves the UI
```

> Before deploying, run that suite once against a **real** PostgreSQL with `TEST_DATABASE_URL` set:
> PGlite is single-connection, so the row-lock serialization tests (`SELECT … FOR UPDATE`, which the
> whole money design rests on) only actually execute there. Exact commands: deployment guide §2.

### End-to-end check (optional)

A Playwright pass over the built app against the real server on an in-process PGlite: one account
registers, signs out, signs back in, plays a Blind hand against a bot to settlement — and the balance
in the database is reconciled against the payout and the table fee printed on the result card. It
also claims the daily reward and checks the rail and the table at 375 px. A second spec drives the 3D
avatar on a real WebGL context: portraits with pixels in the lobby and on a seat, the wardrobe's save →
reload → second-browser round trip, and the editor at 375 px.

```bash
pnpm build:normal
pnpm --filter @bp/normal-web exec playwright install chromium
pnpm e2e:normal
```

Screenshots (desktop and 375×812) land in `apps/normal-web/e2e/screenshots/`, which is not committed.

## Chạy thử miễn phí

Two runbooks for running the Normal edition at **no monthly cost**, in the order you would use them.
Both are Vietnamese, because they are operator documents; both reuse what is already in the repo
rather than adding an alternative build.

| | [`deploy/normal-windows`](deploy/normal-windows/README.md) | [`deploy/oracle`](deploy/oracle/README.md) |
| --- | --- | --- |
| For | A first look, and a few people on one LAN | A public server, indefinitely |
| Runs on | A Windows machine you already have | An ARM VM on Oracle Cloud **Always Free** |
| Needs | Node 22, `pnpm build:normal`, a free PostgreSQL (Neon) | An Oracle account, an SSH key, ~20 minutes |
| Ships as | `run.ps1` / `stop.ps1` + `.env.example` | An idempotent `bootstrap.sh` + a cron example |
| Gets you | `http://<LAN IP>:8080`, no TLS | `https://<your domain>`, Let's Encrypt via Caddy |
| Cost | 0 | 0 |

The Oracle kit's `bootstrap.sh` prepares the machine only — iptables above Oracle's default REJECT,
swap, Docker Engine + Compose v2 for the architecture `dpkg` reports, unattended-upgrades, and the
checkout in `/opt/bind-poker` — and then hands over to the ordinary
[`deploy/normal`](docs/deployment-normal.md) stack. Re-running it is safe: every step checks before
it acts and prints what it did or skipped. It is syntax-checked and its idempotency guards are
asserted by `pnpm test`; it has never been *executed*, because there is no ARM Ubuntu machine here.
Its runbook's §8 is written for that first ARM build.

What each of them costs you in limitations — a sleeping free database, Oracle's idle reclaim, a
Windows stop that is a hard kill — is in
[`docs/known-limitations.md`](docs/known-limitations.md) under **Operations**.

## Lite edition

One Windows executable — server, web UI and SQLite database in a single file. No Node install, no
database server, no Internet: it is meant for a LAN.

```bash
pnpm build:lite                    # web → dist/public, server → dist/server.cjs, exe → release/lite
pnpm --filter @bp/lite start       # run the built server without packaging it (needs dist/)
pnpm --filter @bp/lite test        # footprint budgets + exe smoke test
```

`pnpm build:lite` needs **Windows x64 and Node 22** (a SEA blob only loads in the Node build that
made it); on any other platform the exe step is skipped and the rest still builds. The release
directory holds `bind-poker-lite.exe`, `.env.example` and `README-lite.md`.

Configuration is environment variables, or a `.env` beside the exe: `PORT`, `HOST`, `SQLITE_PATH`,
`LOG_LEVEL`, `ECONOMY_TIMEZONE`, `LITE_HAND_LOG`, `ALLOWED_ORIGINS`, `PUBLIC_DIR`.

Shut it down with `--stop`, `Ctrl`+`C` / `Ctrl`+`Break`, or NSSM. A hard kill (`taskkill`, closing
the window) leaves written balances correct but loses chips still on a table — see
[`docs/known-limitations.md`](docs/known-limitations.md).

- Operator guide (Vietnamese, ships with the exe): `apps/lite/release-src/README-lite.md`
- Build and deployment guide: [`docs/deployment-lite.md`](docs/deployment-lite.md)

### End-to-end check (optional)

A Playwright pass over the *built* app — two players and a bot play a Blind hand, one of them
reloads mid-hand, and the balances in the database are reconciled against the result card on screen.
It is not part of `pnpm test`: it needs `pnpm build:lite` to have run and a one-off browser download
(~150 MB).

```bash
pnpm --filter @bp/lite exec playwright install chromium
pnpm --filter @bp/lite e2e
```

Screenshots (desktop and 375×812) land in `apps/lite/e2e/screenshots/`, which is not committed.

## Assets and licensing

One kind of third-party art asset is in this repository, and it is **CC0**: the Normal edition's 3D
avatar geometry. `apps/normal-web/public/avatar3d/` holds five `.glb` files and a `manifest.json`
built from two [Quaternius](https://quaternius.com/) packs —
[Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and
[Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy),
both **CC0 1.0 / public domain**. CC0 places no condition on use, modification or redistribution and
requires no attribution; the credit here is courtesy. The source archives themselves are *not*
committed (400 MB) — `assets/avatar-src/README.md` records their URLs, download date and SHA-256, and
[`docs/avatar-assets.md`](docs/avatar-assets.md) describes the pipeline that produced the committed
output from them.

Everything else is drawn here: cards, chips and the table are CSS and SVG written in this repository,
and the eleven hats, glasses and pieces of jewellery in the wardrobe are generated from primitives by
the asset script rather than taken from either pack. No font file is bundled either — `--font-display`
names a face and falls back to Cambria / Constantia / Segoe UI, all of which carry the precomposed
Vietnamese glyphs.
