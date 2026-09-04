# Bind Poker

Real-time multiplayer poker (No-Limit Texas Hold'em + Blind Poker) with virtual points only.
Two editions from one codebase, sharing the engine, the room layer and the HTTP plumbing:

| | **Normal** | **Lite** |
| --- | --- | --- |
| For | A public server on the Internet | One trusted LAN |
| Ships as | A Docker image, behind Caddy | One Windows `.exe` |
| Database | PostgreSQL 16 (Drizzle) | SQLite (`node:sqlite`), beside the exe |
| Identity | Email + password (argon2id), session cookie | A display name and a bearer token |
| Has | Cosmetics, inventory, avatars, achievements, points ledger | Points, daily reward, relief |
| Needs | A host, a domain, TLS | A double-click |
| Deploy guide | [`docs/deployment-normal.md`](docs/deployment-normal.md) | [`docs/deployment-lite.md`](docs/deployment-lite.md) |

Both are points-only: nothing here is purchasable and nothing converts to money.

Design: `docs/superpowers/specs/2026-09-04-bind-poker-design.md`.

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
- `packages/http-kit` — shared Fastify plumbing: `.env` reading, JSON logger, rate limiter, static assets, security headers, CSRF guard, error envelope
- `packages/ui-kit` — shared React UI: game client, i18n (vi/en), theme, poker table, lobby, screens (see docs/ui-kit.md)
- `apps/lite` — the Lite edition: Fastify + `node:sqlite` server, React web app, single-exe build
- `apps/normal-server` — the Normal edition's backend: accounts, PostgreSQL, economy, cosmetics, achievements (see docs/normal-server.md)
- `apps/normal-web` (planned)
- `deploy/normal` — the Compose stack for the Normal edition: app + Postgres + Caddy, backup and restore

## Normal edition

A server for the open Internet: real accounts, PostgreSQL, HTTPS. It runs as a four-service Docker
Compose stack — the app, `postgres:16`, a one-shot migration job, and Caddy terminating TLS.

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
pnpm build:normal                           # typecheck + esbuild → dist/main.js, dist/migrate-cli.js
pnpm --filter @bp/normal-server dev         # build, then run (needs a real DATABASE_URL)
```

> Before deploying, run that suite once against a **real** PostgreSQL with `TEST_DATABASE_URL` set:
> PGlite is single-connection, so the row-lock serialization tests (`SELECT … FOR UPDATE`, which the
> whole money design rests on) only actually execute there. Exact commands: deployment guide §2.

- Operations, backup, upgrade, security — Vietnamese, like every operator guide here:
  [`docs/deployment-normal.md`](docs/deployment-normal.md)
- Module map, event bus, ledger conventions, adding an item or achievement — English, like every
  developer doc here: [`docs/normal-server.md`](docs/normal-server.md)
- Restore procedure: [`deploy/normal/restore.md`](deploy/normal/restore.md)

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
