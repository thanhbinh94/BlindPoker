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
- `packages/ui-kit` — shared React UI: game client, i18n (vi/en), theme, poker table, lobby, screens (see docs/ui-kit.md)
- `apps/normal-server`, `apps/normal-web`, `apps/lite` (planned)
