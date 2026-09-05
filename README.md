# Bind Poker

Real-time multiplayer poker (No-Limit Texas Hold'em + Blind Poker) with virtual points only.
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

Both are points-only: nothing here is purchasable and nothing converts to money.

Design: `docs/superpowers/specs/2026-09-04-bind-poker-design.md`.
Which test holds up which requirement of §29.2, §29.3 and §30:
[`docs/test-matrix.md`](docs/test-matrix.md).
What each threat is defended by, which test proves it, how secrets are handled and what an operator
still has to do (TLS, `TRUST_PROXY`, backups): [`docs/security.md`](docs/security.md).

## Development

```bash
pnpm install
pnpm test        # all workspaces
pnpm typecheck
pnpm lint
```

## Layout

- `packages/core` — pure game engine, bot, protocol (no I/O)
- `packages/server-kit` — rooms, WebSocket gateway, timers, reconnect, bots (see docs/server-kit.md)
- `packages/http-kit` — shared Fastify plumbing: `.env` reading, JSON logger, rate limiter, static assets, security headers, CSRF guard, error envelope; `@bp/http-kit/testing` enumerates an assembled app's routes so a guard can be asserted over the whole surface
- `packages/ui-kit` — shared React UI: game client, i18n (vi/en), theme, poker table, lobby, screens (see docs/ui-kit.md)
- `apps/lite` — the Lite edition: Fastify + `node:sqlite` server, React web app, single-exe build
- `apps/normal-server` — the Normal edition's backend: accounts, PostgreSQL, economy, cosmetics, achievements (see docs/normal-server.md)
- `apps/normal-web` — the Normal edition's browser client: Vite/React on `@bp/ui-kit`, served by the server itself (see docs/normal-web.md)
- `deploy/normal` — the Compose stack for the Normal edition: app + Postgres + Caddy, backup and restore

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
> read `docker compose logs migrate` before `app`. Details in the deployment guide, §2.

Without Docker, for development:

```bash
pnpm --filter @bp/normal-server test        # 300+ tests, on in-process PGlite — no database needed
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

- Operations, backup, upgrade, security — Vietnamese, like every operator guide here:
  [`docs/deployment-normal.md`](docs/deployment-normal.md)
- Module map, event bus, ledger conventions, adding an item or achievement — English, like every
  developer doc here: [`docs/normal-server.md`](docs/normal-server.md)
- The browser client — API client, session gate, avatar parts, i18n, footprint, e2e:
  [`docs/normal-web.md`](docs/normal-web.md)
- Restore procedure: [`deploy/normal/restore.md`](deploy/normal/restore.md)

### End-to-end check (optional)

A Playwright pass over the built app against the real server on an in-process PGlite: one account
registers, signs out, signs back in, plays a Blind hand against a bot to settlement — and the balance
in the database is reconciled against the payout and the table fee printed on the result card. It
also claims the daily reward, saves an avatar, and checks the rail and the table at 375 px.

```bash
pnpm build:normal
pnpm --filter @bp/normal-web exec playwright install chromium
pnpm e2e:normal
```

Screenshots (desktop and 375×812) land in `apps/normal-web/e2e/screenshots/`, which is not committed.

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

- Operator guide (Vietnamese, ships with the exe): `apps/lite/release-src/README-lite.md`
- Build and deployment guide: `docs/deployment-lite.md`

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
