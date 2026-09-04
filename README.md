# Bind Poker

Real-time multiplayer poker (No-Limit Texas Hold'em + Blind Poker) with virtual points only.
Two editions from one codebase: **Normal** (public, PostgreSQL) and **Lite** (single Windows exe, SQLite).

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
- `apps/normal-server`, `apps/normal-web` (planned)

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
