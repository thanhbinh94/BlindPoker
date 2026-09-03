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
- `packages/server-kit` — rooms, WebSocket gateway, timers (planned)
- `packages/ui-kit` — shared React components, i18n (planned)
- `apps/normal-server`, `apps/normal-web`, `apps/lite` (planned)
