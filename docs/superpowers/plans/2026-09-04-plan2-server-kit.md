# Bind Poker — Plan 2: `@bp/server-kit` (rooms, WebSocket gateway, timers, reconnect, bots) — M4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the edition-agnostic realtime server library that both Lite and Normal embed: room lifecycle, seating and buy-ins, hand orchestration on top of `@bp/core` (turn timers, reveal pacing, bot turns, settlement to balances), disconnect/reconnect, a WebSocket gateway implementing the core protocol (auth hook, heartbeat, rate limit, `reqId` dedupe, `baseSeq` staleness), and an integration test suite over real WebSockets.

**Architecture:** `@bp/server-kit` depends only on `@bp/core` and `ws`. Every room is a `Room` actor with a serialized command queue; a `HandRunner` inside the room owns the `HandState`, all hand timers and bot scheduling, and feeds engine events back to the room, which fans them out per viewer via `filterEvent`/`playerView`. Persistence is behind three small repository interfaces (`PlayerRepository`, `BalanceRepository`, `GameHistoryRepository`) with in-memory implementations used by the tests; identity comes from a `SessionResolver` the edition supplies. `createGameServer()` wires it all and exposes an `handleUpgrade` for any HTTP server.

**Tech Stack:** Node 22.13, TypeScript 5.6 (ESM), `ws` 8, Vitest 2. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §11 (rooms), §12.3–12.4 (fee/relief context), §16 (realtime), §17 (state machine), §18.1 (repository interfaces), §20 (protocol), §22.3 (how editions plug in), §30 (edge cases). Where this plan names an interface differently from the spec's conceptual names (e.g. `BalanceRepository.apply` for the spec's `applySettlement`), the plan's names are the ones to implement.

## Global Constraints

- Node `>=22.13`, pnpm 9. In a bash shell without pnpm: `export PATH="$PATH:$(npm prefix -g)"`.
- `@bp/server-kit` `dependencies`: exactly `@bp/core` (workspace) and `ws`. It never imports `react`, `@bp/ui-kit`, or anything under `apps/`. Boundary rules are enforced by `eslint.config.js` and `tooling/arch/boundaries.test.ts` (both already list `@bp/server-kit → @bp/core`).
- Server-kit never contains `if (edition === ...)`; nothing in it knows about Normal or Lite.
- Server is authoritative: clients only ever receive `filterEvent(event, seat)` / `playerView(state, seat)` output; the raw `HandState` never leaves the room.
- Every room mutation runs inside that room's serialized queue (`room.enqueue`). No two commands for the same room interleave.
- Money invariant at the room level: for every completed hand, Σ balance deltas applied for human seats + fee + Σ bot net = 0; buy-in/cash-out are exact inverses. Tests assert this.
- Timers are fenced: a fired timer checks `handId`, `turnSeq`, and phase before acting.
- Message limits (spec §16.8/§23): 20 messages/s per connection (token bucket, burst 20), 4 KB max payload, heartbeat `PING` every 15 s, close after 30 s without `PONG`, `HELLO` must arrive within 5 s when the upgrade did not authenticate.
- Reconnect window 90 s; spectator grace 5 min; empty room closes after 60 s; next hand 5 s after settlement; reveal pacing 1.5 s; bot think delay 1–3 s; 3 consecutive timeouts → stood up after the hand. All are `RoomOptions`/`GatewayOptions` so tests can shorten them.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test files are colocated: `src/**/*.test.ts`. Imports use explicit `.js` extensions.

## Core API this plan consumes (already implemented in `packages/core`)

```ts
// engine
createHand({ handId, rules, seats: SeatInput[], button, carryOverIn? }, rng): { state, events }
applyCommand(state, cmd: {type:'ACTION',seat,action} | {type:'TIMEOUT',seat} | {type:'ADVANCE'} | {type:'CANCEL',reason}, rng): { state, events }
legalActions(state, seat): LegalActions   // kinds: [] when the seat cannot act
nextButton(prevButton: number | null, activeSeats: number[], rng): number
playerView(state, viewerSeat: number | null): HandView   // includes `legal` for the viewer
filterEvent(event, viewerSeat): GameEvent                 // blanks other seats' CARDS_DEALT.cards
blindRequiredStack(rules: BlindRules): number
createBotStrategy(): { decide(view, legal, rng): PlayerAction }
// state facts: state.phase ∈ 'BETTING'|'DECISION'|'REVEAL'|'COMPLETE'; state.actingSeat; state.turnSeq; state.result (COMPLETE): { stacks, fee, carryOverOut, showdown, payouts, uncalledReturned }
// events: HAND_STARTED, BLINDS_POSTED, CARDS_DEALT{seat,cards,cardCount}, TURN_CHANGED{seat,turnSeq,legal}, PLAYER_ACTED{seat,action,amount,stack,allIn,timedOut}, DECISION_PHASE{seats,turnSeq}, DECISION_MADE, DECISIONS_REVEALED, COMMUNITY_REVEALED, POT_UPDATED, SHOWDOWN, SETTLEMENT, HAND_CANCELLED, HAND_COMPLETE
// protocol
parseClientMessage(raw): { ok: true, value: ClientMessage } | { ok: false, code, message }
validateRoomConfig(raw), roomConfigToRuleset(config): Ruleset, engineErrorToErrorCode(code): ErrorCode
ECONOMY.{ handIntervalSec: 5, reconnectWindowSec: 90, consecutiveTimeoutsToStand: 3, ... }
types: RoomConfig, RoomSummary, RoomView, RoomPlayerView, RoomEvent, ClientMessage, ServerMessage, ErrorCode, PlayerIdentity, SeatStatus
```

## File Structure (this plan)

```text
packages/core/src/protocol/messages.ts          (modify) ROOM_SNAPSHOT gains `deadlineAt: number | null`
packages/server-kit/package.json                @bp/server-kit — deps: @bp/core, ws
packages/server-kit/tsconfig.json
packages/server-kit/vitest.config.ts
packages/server-kit/src/index.ts                public barrel
packages/server-kit/src/infra/clock.ts          Clock interface + realClock
packages/server-kit/src/infra/rng.ts            cryptoRng (crypto.randomInt)
packages/server-kit/src/infra/ids.ts            newId, newRoomCode
packages/server-kit/src/infra/logger.ts         Logger interface + consoleLogger + silentLogger
packages/server-kit/src/repositories.ts         PlayerRepository, BalanceRepository, GameHistoryRepository, SessionResolver, Repositories, HandSummary, InsufficientBalanceError
packages/server-kit/src/memory-repositories.ts  createMemoryRepositories() — in-memory impls for tests/dev
packages/server-kit/src/domain-events.ts        DomainEvent union (HAND_SETTLED, ROOM_CREATED, ROOM_JOINED)
packages/server-kit/src/room/types.ts           RoomPlayer, RoomOptions, DEFAULT_ROOM_OPTIONS, Outbox, RoomDeps, RoomError
packages/server-kit/src/room/hand-runner.ts     HandRunner: owns HandState, turn/decision/reveal timers, bot turns, auto-fold
packages/server-kit/src/room/room.ts            Room actor: membership, seats, host, hand lifecycle, settlement, disconnects, shutdown
packages/server-kit/src/room/room-manager.ts    RoomManager: create/get/list/close, lobby change notifications
packages/server-kit/src/gateway/rate-limit.ts   TokenBucket
packages/server-kit/src/gateway/connection.ts   ClientConnection: ws wrapper, send, reqId cache, heartbeat state
packages/server-kit/src/gateway/gateway.ts      Gateway: upgrade/HELLO auth, routing, ACK/ERROR, lobby subscriptions, duplicate sessions, heartbeat
packages/server-kit/src/server.ts               createGameServer(options) → GameServer
packages/server-kit/src/testing/test-client.ts  TestClient (exported for app-level tests in later plans)
packages/server-kit/src/testing/harness.ts      startTestServer(): http server on port 0 + memory repos + token resolver
```

---

### Task 1: Core protocol addition — `deadlineAt` on `ROOM_SNAPSHOT`

**Files:**
- Modify: `packages/core/src/protocol/messages.ts` (the `ROOM_SNAPSHOT` variant)
- Modify: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §20.2 (one line)

**Interfaces:**
- Produces: `{ t: 'ROOM_SNAPSHOT'; seq: number; room: RoomView; hand: HandView | null; deadlineAt: number | null }` — the epoch-ms deadline of the current turn/decision phase, so a reconnecting client can render its timer.

- [ ] **Step 1: Edit the type**

In `packages/core/src/protocol/messages.ts` change the `ROOM_SNAPSHOT` line to:
```ts
  | { t: 'ROOM_SNAPSHOT'; seq: number; room: RoomView; hand: HandView | null; deadlineAt: number | null }
```
In the spec §20.2 table, change the `ROOM_SNAPSHOT` payload cell to `{ seq, room: RoomView, hand?: HandView, deadlineAt: number | null }`.

- [ ] **Step 2: Verify**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: unchanged green (147 tests); no consumer of `ROOM_SNAPSHOT` exists yet.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/protocol/messages.ts docs/superpowers/specs/2026-09-04-bind-poker-design.md
git commit -m "feat(core): ROOM_SNAPSHOT carries the current turn deadline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `@bp/server-kit` scaffold, infrastructure, repositories, memory implementations

**Files:**
- Create: `packages/server-kit/package.json`, `packages/server-kit/tsconfig.json`, `packages/server-kit/vitest.config.ts`
- Create: `packages/server-kit/src/infra/clock.ts`, `packages/server-kit/src/infra/rng.ts`, `packages/server-kit/src/infra/ids.ts`, `packages/server-kit/src/infra/logger.ts`
- Create: `packages/server-kit/src/repositories.ts`, `packages/server-kit/src/memory-repositories.ts`, `packages/server-kit/src/domain-events.ts`
- Create: `packages/server-kit/src/index.ts`
- Create: `packages/server-kit/src/infra/ids.test.ts`, `packages/server-kit/src/memory-repositories.test.ts`

**Interfaces:**
- Produces (exact):
  ```ts
  // infra/clock.ts
  export interface TimerHandle { cancel(): void }
  export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): TimerHandle }
  export const realClock: Clock
  // infra/rng.ts
  export const cryptoRng: Rng
  // infra/ids.ts
  export function newId(): string                                   // UUID v4
  export function newRoomCode(isTaken: (code: string) => boolean): string  // 6 chars from ABCDEFGHJKLMNPQRSTUVWXYZ23456789
  // infra/logger.ts
  export interface Logger { debug(msg: string, data?: object): void; info(...): void; warn(...): void; error(...): void }
  export const consoleLogger: Logger; export const silentLogger: Logger
  // repositories.ts
  export interface PlayerRecord { playerId: string; displayName: string; balance: number }
  export type TxReason = 'settlement' | 'buy_in' | 'cash_out' | 'refund' | 'daily_reward' | 'relief' | 'achievement'
  export interface BalanceEntry { playerId: string; delta: number; reason: TxReason; refId?: string }
  export interface SettlementMeta { refId: string; fee: number }
  export class InsufficientBalanceError extends Error { constructor(public readonly playerId: string) }
  export interface PlayerRepository { findById(playerId: string): Promise<PlayerRecord | null> }
  export interface BalanceRepository {
    get(playerId: string): Promise<number>
    /** Atomic: all entries or none; throws InsufficientBalanceError if any balance would go below 0. */
    apply(entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
  }
  export interface HandSummaryPlayer { playerId: string; seat: number; isBot: boolean; net: number; won: boolean; bestCategory: HandCategory | null }
  export interface HandSummary { handId: string; roomId: string; mode: GameMode; config: RoomConfig; startedAt: number; endedAt: number; fee: number; cancelled: boolean; players: HandSummaryPlayer[] }
  export interface GameHistoryRepository { recordHand(summary: HandSummary): Promise<void> }
  export interface SessionResolver {
    fromUpgrade?(req: IncomingMessage): Promise<PlayerIdentity | null>
    fromToken?(token: string): Promise<PlayerIdentity | null>
  }
  export interface Repositories { players: PlayerRepository; balances: BalanceRepository; history: GameHistoryRepository }
  // memory-repositories.ts
  export interface MemoryRepositories extends Repositories { addPlayer(playerId: string, displayName: string, balance: number): PlayerRecord; records: Map<string, PlayerRecord>; hands: HandSummary[]; entries: { entry: BalanceEntry; meta?: SettlementMeta }[] }
  export function createMemoryRepositories(): MemoryRepositories
  // domain-events.ts
  export type DomainEvent =
    | { type: 'ROOM_CREATED'; roomId: string; hostPlayerId: string; config: RoomConfig }
    | { type: 'ROOM_JOINED'; roomId: string; playerId: string }
    | { type: 'HAND_SETTLED'; summary: HandSummary }
  ```

- [ ] **Step 1: Package files**

`packages/server-kit/package.json`:
```json
{
  "name": "@bp/server-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "@bp/core": "workspace:*", "ws": "^8.18.0" },
  "devDependencies": { "@types/ws": "^8.5.13", "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

`packages/server-kit/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src"] }
```

`packages/server-kit/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'server-kit', include: ['src/**/*.test.ts'], testTimeout: 15000, hookTimeout: 15000 } })
```

- [ ] **Step 2: Write failing tests**

`packages/server-kit/src/infra/ids.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { newId, newRoomCode } from './ids.js'

describe('ids', () => {
  it('newId returns unique UUIDs', () => {
    const a = newId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(newId()).not.toBe(a)
  })
  it('newRoomCode uses the safe alphabet and avoids taken codes', () => {
    const code = newRoomCode(() => false)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    const taken = new Set([code])
    let calls = 0
    const next = newRoomCode((c) => {
      calls++
      return taken.has(c)
    })
    expect(next).not.toBe(code)
    expect(calls).toBeGreaterThan(0)
  })
  it('newRoomCode gives up after 100 attempts', () => {
    expect(() => newRoomCode(() => true)).toThrow(/room code/)
  })
})
```

`packages/server-kit/src/memory-repositories.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createMemoryRepositories } from './memory-repositories.js'
import { InsufficientBalanceError } from './repositories.js'

describe('memory repositories', () => {
  it('stores players and balances', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 1000)
    expect(await repos.players.findById('p1')).toEqual({ playerId: 'p1', displayName: 'Ann', balance: 1000 })
    expect(await repos.players.findById('nope')).toBeNull()
    expect(await repos.balances.get('p1')).toBe(1000)
  })
  it('applies entries atomically and records them', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 1000)
    repos.addPlayer('p2', 'Bob', 500)
    await repos.balances.apply([{ playerId: 'p1', delta: -300, reason: 'settlement', refId: 'h1' }, { playerId: 'p2', delta: 280, reason: 'settlement', refId: 'h1' }], { refId: 'h1', fee: 20 })
    expect(await repos.balances.get('p1')).toBe(700)
    expect(await repos.balances.get('p2')).toBe(780)
    expect(repos.entries).toHaveLength(2)
    expect(repos.entries[0]!.meta).toEqual({ refId: 'h1', fee: 20 })
  })
  it('rejects the whole batch when any balance would go negative', async () => {
    const repos = createMemoryRepositories()
    repos.addPlayer('p1', 'Ann', 100)
    repos.addPlayer('p2', 'Bob', 100)
    await expect(repos.balances.apply([{ playerId: 'p1', delta: 50, reason: 'refund' }, { playerId: 'p2', delta: -150, reason: 'buy_in' }])).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await repos.balances.get('p1')).toBe(100)
    expect(await repos.balances.get('p2')).toBe(100)
  })
  it('rejects unknown players and records hands', async () => {
    const repos = createMemoryRepositories()
    await expect(repos.balances.get('ghost')).rejects.toThrow(/unknown player/)
    await repos.history.recordHand({ handId: 'h', roomId: 'r', mode: 'blind', config: { name: 'x', mode: 'blind', maxPlayers: 2, isPrivate: false, turnTimerSec: 15, autoStart: false }, startedAt: 1, endedAt: 2, fee: 0, cancelled: false, players: [] })
    expect(repos.hands).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @bp/server-kit test`
Expected: FAIL — modules not found (after `pnpm install` links the new workspace package and installs `ws`).

- [ ] **Step 4: Implement**

`packages/server-kit/src/infra/clock.ts`:
```ts
export interface TimerHandle {
  cancel(): void
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): TimerHandle
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms)
    return { cancel: () => clearTimeout(t) }
  },
}
```

`packages/server-kit/src/infra/rng.ts`:
```ts
import { randomInt } from 'node:crypto'
import type { Rng } from '@bp/core'

/** Cryptographically secure RNG for shuffles and button selection. */
export const cryptoRng: Rng = { int: (maxExclusive) => randomInt(maxExclusive) }
```

`packages/server-kit/src/infra/ids.ts`:
```ts
import { randomInt, randomUUID } from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const newId = (): string => randomUUID()

export function newRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    if (!isTaken(code)) return code
  }
  throw new Error('could not allocate a unique room code')
}
```

`packages/server-kit/src/infra/logger.ts`:
```ts
export interface Logger {
  debug(msg: string, data?: object): void
  info(msg: string, data?: object): void
  warn(msg: string, data?: object): void
  error(msg: string, data?: object): void
}

const line = (level: string, msg: string, data?: object) => JSON.stringify({ level, time: new Date().toISOString(), msg, ...(data ?? {}) })

export const consoleLogger: Logger = {
  debug: () => {},
  info: (msg, data) => console.log(line('info', msg, data)),
  warn: (msg, data) => console.warn(line('warn', msg, data)),
  error: (msg, data) => console.error(line('error', msg, data)),
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
```

`packages/server-kit/src/repositories.ts`:
```ts
import type { IncomingMessage } from 'node:http'
import type { GameMode, HandCategory, PlayerIdentity, RoomConfig } from '@bp/core'

export interface PlayerRecord {
  playerId: string
  displayName: string
  balance: number
}

export type TxReason = 'settlement' | 'buy_in' | 'cash_out' | 'refund' | 'daily_reward' | 'relief' | 'achievement'

export interface BalanceEntry {
  playerId: string
  delta: number
  reason: TxReason
  refId?: string
}

export interface SettlementMeta {
  refId: string
  fee: number
}

export class InsufficientBalanceError extends Error {
  constructor(public readonly playerId: string) {
    super(`insufficient balance for ${playerId}`)
    this.name = 'InsufficientBalanceError'
  }
}

export interface PlayerRepository {
  findById(playerId: string): Promise<PlayerRecord | null>
}

export interface BalanceRepository {
  get(playerId: string): Promise<number>
  /** Atomic: all entries or none. Throws InsufficientBalanceError when any resulting balance would be negative. */
  apply(entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
}

export interface HandSummaryPlayer {
  playerId: string
  seat: number
  isBot: boolean
  net: number
  won: boolean
  bestCategory: HandCategory | null
}

export interface HandSummary {
  handId: string
  roomId: string
  mode: GameMode
  config: RoomConfig
  startedAt: number
  endedAt: number
  fee: number
  cancelled: boolean
  players: HandSummaryPlayer[]
}

export interface GameHistoryRepository {
  recordHand(summary: HandSummary): Promise<void>
}

/** Supplied by the edition: turns an HTTP upgrade (cookie) and/or a HELLO token into a player identity. */
export interface SessionResolver {
  fromUpgrade?(req: IncomingMessage): Promise<PlayerIdentity | null>
  fromToken?(token: string): Promise<PlayerIdentity | null>
}

export interface Repositories {
  players: PlayerRepository
  balances: BalanceRepository
  history: GameHistoryRepository
}
```

`packages/server-kit/src/memory-repositories.ts`:
```ts
import { InsufficientBalanceError, type BalanceEntry, type HandSummary, type PlayerRecord, type Repositories, type SettlementMeta } from './repositories.js'

export interface MemoryRepositories extends Repositories {
  addPlayer(playerId: string, displayName: string, balance: number): PlayerRecord
  records: Map<string, PlayerRecord>
  hands: HandSummary[]
  entries: { entry: BalanceEntry; meta?: SettlementMeta }[]
}

export function createMemoryRepositories(): MemoryRepositories {
  const records = new Map<string, PlayerRecord>()
  const hands: HandSummary[] = []
  const entries: { entry: BalanceEntry; meta?: SettlementMeta }[] = []
  const must = (playerId: string): PlayerRecord => {
    const r = records.get(playerId)
    if (!r) throw new Error(`unknown player ${playerId}`)
    return r
  }
  return {
    records,
    hands,
    entries,
    addPlayer(playerId, displayName, balance) {
      const rec = { playerId, displayName, balance }
      records.set(playerId, rec)
      return rec
    },
    players: {
      async findById(playerId) {
        const r = records.get(playerId)
        return r ? { ...r } : null
      },
    },
    balances: {
      async get(playerId) {
        return must(playerId).balance
      },
      async apply(batch, meta) {
        const next = new Map<string, number>()
        for (const e of batch) {
          const current = next.get(e.playerId) ?? must(e.playerId).balance
          const after = current + e.delta
          if (after < 0) throw new InsufficientBalanceError(e.playerId)
          next.set(e.playerId, after)
        }
        for (const [playerId, balance] of next) must(playerId).balance = balance
        for (const entry of batch) entries.push(meta ? { entry, meta } : { entry })
      },
    },
    history: {
      async recordHand(summary) {
        hands.push(structuredClone(summary))
      },
    },
  }
}
```

`packages/server-kit/src/domain-events.ts`:
```ts
import type { RoomConfig } from '@bp/core'
import type { HandSummary } from './repositories.js'

export type DomainEvent =
  | { type: 'ROOM_CREATED'; roomId: string; hostPlayerId: string; config: RoomConfig }
  | { type: 'ROOM_JOINED'; roomId: string; playerId: string }
  | { type: 'HAND_SETTLED'; summary: HandSummary }
```

`packages/server-kit/src/index.ts`:
```ts
export * from './infra/clock.js'
export * from './infra/rng.js'
export * from './infra/ids.js'
export * from './infra/logger.js'
export * from './repositories.js'
export * from './memory-repositories.js'
export * from './domain-events.js'
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint && pnpm test`
Expected: server-kit 7 tests pass; the tooling boundary test still passes (server-kit is in `ALLOWED` with `@bp/core` only — `ws` is not an `@bp/` dependency).

- [ ] **Step 6: Commit**

```bash
git add packages/server-kit pnpm-lock.yaml
git commit -m "feat(server-kit): scaffold, clock/rng/ids/logger, repository interfaces and memory implementations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Room types and `HandRunner` (hand orchestration: timers, bots, reveal pacing, auto-fold)

**Files:**
- Create: `packages/server-kit/src/room/types.ts`, `packages/server-kit/src/room/hand-runner.ts`, `packages/server-kit/src/testing/manual-clock.ts`, `packages/server-kit/src/room/hand-runner.test.ts`
- Modify: `packages/server-kit/src/index.ts`

**Interfaces:**
- Consumes: Task 2 `Clock`, `TimerHandle`, `Logger`, `Repositories`, `DomainEvent`; core engine API.
- Produces (exact):
  ```ts
  // room/types.ts
  export interface RoomPlayer { identity: PlayerIdentity; seat: number | null; stack: number; ready: boolean; connected: boolean; joinedAt: number; sittingOut: boolean; consecutiveTimeouts: number; disconnectDeadline: number | null; standAfterHand: boolean; leaveAfterHand: boolean; cosmetics?: unknown }
  export interface RoomOptions { handIntervalMs: number; revealDelayMs: number; botDelayMs: [number, number]; reconnectWindowMs: number; spectatorGraceMs: number; emptyRoomCloseMs: number; consecutiveTimeoutsToStand: number; botStartingBalance: number; turnTimerMsOverride?: number }
  export const DEFAULT_ROOM_OPTIONS: RoomOptions   // 5000, 1500, [1000,3000], 90000, 300000, 60000, 3, 1_000_000
  export interface Outbox { send(playerId: string, msg: ServerMessage): void }
  export interface RoomDeps { clock: Clock; rng: Rng; repos: Repositories; outbox: Outbox; bot: BotStrategy; log: Logger; options: RoomOptions; onDomainEvent?: (e: DomainEvent) => void }
  export class RoomError extends Error { constructor(public readonly code: ErrorCode, message?: string) }
  // room/hand-runner.ts
  export interface HandRunnerDeps { clock: Clock; rng: Rng; bot: BotStrategy; log: Logger; turnTimerMs: number; revealDelayMs: number; botDelayMs: [number, number]; isBotSeat: (seat: number) => boolean; enqueue: (fn: () => void) => void; onEvents: (events: GameEvent[], deadlineAt: number | null) => void; onComplete: () => void }
  export class HandRunner {
    constructor(deps: HandRunnerDeps, input: CreateHandInput)
    readonly state: HandState            // getter; current engine state (never mutated in place)
    readonly startedAt: number
    readonly stacksBefore: ReadonlyMap<number, number>
    readonly isComplete: boolean
    start(): void                        // emits the creation events, schedules timers/bots
    submit(cmd: HandCommand): GameEvent[]  // throws EngineError; after COMPLETE throws EngineError('HAND_COMPLETE')
    markAutoFold(seat: number): void     // fold whenever it becomes that seat's turn (or immediately if it already is)
    cancel(reason: string): GameEvent[]
    dispose(): void                      // cancels all pending timers
  }
  // testing/manual-clock.ts
  export class ManualClock implements Clock { t: number; now(); setTimeout(); advance(ms: number): void; readonly pending: number }
  ```

Behaviour: after every command the runner cancels all its timers and, based on the new phase, schedules exactly one of — a turn timer (`BETTING`, `deadlineAt = now + turnTimerMs`, plus a bot timer if the acting seat is a bot), a decision timer (`DECISION`, one shared deadline; bot timers for every undecided bot seat), or a reveal timer (`REVEAL`, `revealDelayMs`, then `ADVANCE`). Timer callbacks go through `enqueue` and re-check `handId`/`turnSeq`/phase before acting (fencing). Bot actions are computed from `playerView(state, seat)` and `legalActions(state, seat)` only. `onEvents` is called once per command with the events and the new deadline; `onComplete` once when the hand reaches `COMPLETE`.

- [ ] **Step 1: Write `types.ts` and `ManualClock`**

`packages/server-kit/src/room/types.ts`:
```ts
import type { BotStrategy, ErrorCode, PlayerIdentity, Rng, ServerMessage } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import type { Clock } from '../infra/clock.js'
import type { Logger } from '../infra/logger.js'
import type { Repositories } from '../repositories.js'

export interface RoomPlayer {
  identity: PlayerIdentity
  seat: number | null
  /** Hold'em: chips on the table (already deducted from the balance). Blind: last known balance (bots: virtual balance). */
  stack: number
  ready: boolean
  connected: boolean
  joinedAt: number
  sittingOut: boolean
  consecutiveTimeouts: number
  disconnectDeadline: number | null
  /** Stand up (Hold'em: cash out) as soon as the current hand ends. */
  standAfterHand: boolean
  /** Remove from the room as soon as the current hand ends (implies standAfterHand). */
  leaveAfterHand: boolean
  cosmetics?: unknown
}

export interface RoomOptions {
  handIntervalMs: number
  revealDelayMs: number
  botDelayMs: [number, number]
  reconnectWindowMs: number
  spectatorGraceMs: number
  emptyRoomCloseMs: number
  consecutiveTimeoutsToStand: number
  botStartingBalance: number
  /** Test hook: overrides `config.turnTimerSec * 1000` when set. */
  turnTimerMsOverride?: number
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  handIntervalMs: 5_000,
  revealDelayMs: 1_500,
  botDelayMs: [1_000, 3_000],
  reconnectWindowMs: 90_000,
  spectatorGraceMs: 300_000,
  emptyRoomCloseMs: 60_000,
  consecutiveTimeoutsToStand: 3,
  botStartingBalance: 1_000_000,
}

export interface Outbox {
  send(playerId: string, msg: ServerMessage): void
}

export interface RoomDeps {
  clock: Clock
  rng: Rng
  repos: Repositories
  outbox: Outbox
  bot: BotStrategy
  log: Logger
  options: RoomOptions
  onDomainEvent?: (e: DomainEvent) => void
}

export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'RoomError'
  }
}
```

`packages/server-kit/src/testing/manual-clock.ts`:
```ts
import type { Clock, TimerHandle } from '../infra/clock.js'

interface Scheduled {
  at: number
  fn: () => void
  id: number
}

/** Deterministic clock for tests: time only moves when `advance()` is called; due timers fire in order. */
export class ManualClock implements Clock {
  t = 1_000_000
  private timers: Scheduled[] = []
  private nextId = 0

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer: Scheduled = { at: this.t + ms, fn, id: this.nextId++ }
    this.timers.push(timer)
    return { cancel: () => { this.timers = this.timers.filter((x) => x !== timer) } }
  }

  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x !== due)
      this.t = due.at
      due.fn()
    }
    this.t = target
  }

  get pending(): number {
    return this.timers.length
  }
}
```

- [ ] **Step 2: Write failing tests**

`packages/server-kit/src/room/hand-runner.test.ts`:
```ts
import { createBotStrategy, seededRng, type BlindRules, type GameEvent, type HoldemRules } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../infra/logger.js'
import { ManualClock } from '../testing/manual-clock.js'
import { HandRunner, type HandRunnerDeps } from './hand-runner.js'

const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
const BLIND_B: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }

function setup(rules: HoldemRules | BlindRules, seats: { seat: number; stack: number; isBot: boolean }[], over: Partial<HandRunnerDeps> = {}) {
  const clock = new ManualClock()
  const batches: { events: GameEvent[]; deadlineAt: number | null }[] = []
  let completed = 0
  const deps: HandRunnerDeps = {
    clock,
    rng: seededRng(5),
    bot: createBotStrategy(),
    log: silentLogger,
    turnTimerMs: 30_000,
    revealDelayMs: 1_500,
    botDelayMs: [1_000, 1_000],
    isBotSeat: (seat) => seats.find((s) => s.seat === seat)?.isBot ?? false,
    enqueue: (fn) => fn(),
    onEvents: (events, deadlineAt) => batches.push({ events, deadlineAt }),
    onComplete: () => completed++,
    ...over,
  }
  const runner = new HandRunner(deps, { handId: 'h1', rules, seats: seats.map((s) => ({ ...s, playerId: `p${s.seat}` })), button: 0, carryOverIn: 0 })
  runner.start()
  const all = () => batches.flatMap((b) => b.events)
  return { clock, runner, batches, all, completed: () => completed }
}

describe('HandRunner — hold’em', () => {
  it('emits creation events with a turn deadline and schedules one turn timer', () => {
    const { clock, runner, batches } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.events.map((e) => e.type)).toContain('TURN_CHANGED')
    expect(batches[0]!.deadlineAt).toBe(clock.now() + 30_000)
    expect(clock.pending).toBe(1)
    expect(runner.state.actingSeat).toBe(0) // heads-up: button acts first preflop
  })

  it('times out the acting seat and ignores a stale timer after the turn moved on', () => {
    const { clock, runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    runner.submit({ type: 'ACTION', seat: 0, action: { kind: 'call' } }) // turn moves to seat 1, old timer cancelled
    expect(clock.pending).toBe(1)
    clock.advance(30_000)
    const acted = all().filter((e) => e.type === 'PLAYER_ACTED')
    expect(acted.at(-1)).toMatchObject({ seat: 1, action: { kind: 'check' }, timedOut: true })
    expect(runner.state.street).toBe('FLOP')
  })

  it('lets a bot act after its think delay and finishes a hand against a passive human', () => {
    const { clock, runner, all, completed } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: true }])
    let guard = 0
    while (!runner.isComplete && guard++ < 50) {
      const s = runner.state
      if (s.phase === 'BETTING' && s.actingSeat === 0) {
        const legal = all().filter((e): e is Extract<GameEvent, { type: 'TURN_CHANGED' }> => e.type === 'TURN_CHANGED').at(-1)!.legal
        runner.submit({ type: 'ACTION', seat: 0, action: { kind: legal.kinds.includes('check') ? 'check' : 'call' } })
      } else {
        clock.advance(1_500) // bot delay or reveal pacing
      }
    }
    expect(runner.isComplete).toBe(true)
    expect(completed()).toBe(1)
    expect(all().at(-1)!.type).toBe('HAND_COMPLETE')
    expect(clock.pending).toBe(0)
    expect(() => runner.submit({ type: 'ADVANCE' })).toThrow(/HAND_COMPLETE/)
  })

  it('auto-folds a marked seat immediately when it is its turn, and later when its turn comes', () => {
    const { runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }, { seat: 2, stack: 1000, isBot: false }])
    expect(runner.state.actingSeat).toBe(0)
    runner.markAutoFold(2) // not its turn yet
    runner.markAutoFold(0) // acting now → folds immediately
    expect(runner.state.players[0]!.folded).toBe(true)
    expect(runner.state.actingSeat).toBe(1)
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'call' } }) // seat 2 would act next → auto-fold → seat 1 wins
    expect(runner.state.players[2]!.folded).toBe(true)
    expect(runner.isComplete).toBe(true)
    expect(all().some((e) => e.type === 'SETTLEMENT')).toBe(true)
  })

  it('cancel refunds and clears timers', () => {
    const { clock, runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    const events = runner.cancel('shutdown')
    expect(events.map((e) => e.type)).toEqual(['HAND_CANCELLED', 'HAND_COMPLETE'])
    expect(runner.state.players.every((p) => p.stack === 1000)).toBe(true)
    expect(clock.pending).toBe(0)
    expect(all().at(-1)!.type).toBe('HAND_COMPLETE')
  })
})

describe('HandRunner — blind mode B', () => {
  it('schedules bot decisions, times out the undecided human, reveals with pacing and completes', () => {
    const { clock, runner, all, completed } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: true }, { seat: 2, stack: 20000, isBot: true }], { turnTimerMs: 15_000 })
    expect(runner.state.phase).toBe('DECISION')
    expect(clock.pending).toBe(3) // decision timer + 2 bot timers
    clock.advance(1_000)
    expect(all().filter((e) => e.type === 'DECISION_MADE')).toHaveLength(2)
    expect(runner.state.phase).toBe('DECISION')
    clock.advance(14_000) // decision deadline → human folds
    expect(all().some((e) => e.type === 'DECISIONS_REVEALED')).toBe(true)
    while (!runner.isComplete) clock.advance(1_500)
    expect(completed()).toBe(1)
    expect(clock.pending).toBe(0)
  })

  it('auto-fold applies during DECISION', () => {
    const { runner } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: false }])
    runner.markAutoFold(0)
    expect(runner.state.players[0]!.decision).toBe('fold')
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'play' } })
    expect(runner.isComplete).toBe(true) // one player plays → wins immediately
  })

  it('a stale decision timer is ignored once the phase resolved', () => {
    const { clock, runner, all } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: false }], { turnTimerMs: 15_000 })
    runner.submit({ type: 'ACTION', seat: 0, action: { kind: 'fold' } })
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'fold' } }) // all fold → carry over → COMPLETE
    expect(runner.isComplete).toBe(true)
    const before = all().length
    clock.advance(20_000)
    expect(all().length).toBe(before)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @bp/server-kit test`
Expected: FAIL — `./hand-runner.js` not found.

- [ ] **Step 4: Implement `HandRunner`**

`packages/server-kit/src/room/hand-runner.ts`:
```ts
import {
  EngineError, applyCommand, createHand, legalActions, playerView,
  type BotStrategy, type CreateHandInput, type GameEvent, type HandCommand, type HandState, type PlayerAction, type Rng,
} from '@bp/core'
import type { Clock, TimerHandle } from '../infra/clock.js'
import type { Logger } from '../infra/logger.js'

export interface HandRunnerDeps {
  clock: Clock
  rng: Rng
  bot: BotStrategy
  log: Logger
  turnTimerMs: number
  revealDelayMs: number
  botDelayMs: [number, number]
  isBotSeat: (seat: number) => boolean
  /** Runs `fn` on the owning room's serialized queue (timer callbacks must never touch state directly). */
  enqueue: (fn: () => void) => void
  onEvents: (events: GameEvent[], deadlineAt: number | null) => void
  onComplete: () => void
}

/** Drives one hand of `@bp/core` inside a room: timers, reveal pacing, bot turns, auto-folds. */
export class HandRunner {
  private current: HandState
  private readonly initialEvents: GameEvent[]
  readonly startedAt: number
  readonly stacksBefore: ReadonlyMap<number, number>
  private timers: TimerHandle[] = []
  private readonly autoFold = new Set<number>()
  private completed = false

  constructor(
    private readonly deps: HandRunnerDeps,
    input: CreateHandInput,
  ) {
    const r = createHand(input, deps.rng)
    this.current = r.state
    this.initialEvents = r.events
    this.startedAt = deps.clock.now()
    this.stacksBefore = new Map(input.seats.map((s) => [s.seat, s.stack]))
  }

  get state(): HandState {
    return this.current
  }

  get isComplete(): boolean {
    return this.completed
  }

  start(): void {
    this.afterCommand(this.initialEvents)
  }

  submit(cmd: HandCommand): GameEvent[] {
    if (this.completed) throw new EngineError('HAND_COMPLETE')
    const r = applyCommand(this.current, cmd, this.deps.rng)
    this.current = r.state
    this.afterCommand(r.events)
    return r.events
  }

  markAutoFold(seat: number): void {
    this.autoFold.add(seat)
    this.applyAutoFolds()
  }

  cancel(reason: string): GameEvent[] {
    return this.submit({ type: 'CANCEL', reason })
  }

  dispose(): void {
    for (const t of this.timers) t.cancel()
    this.timers = []
  }

  private afterCommand(events: GameEvent[]): void {
    this.dispose()
    const s = this.current
    if (s.phase === 'COMPLETE') {
      this.completed = true
      this.deps.onEvents(events, null)
      this.deps.onComplete()
      return
    }
    let deadlineAt: number | null = null
    if (s.phase === 'BETTING' && s.actingSeat !== null) {
      const seat = s.actingSeat
      const turnSeq = s.turnSeq
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onTurnTimeout(seat, turnSeq))
      if (this.deps.isBotSeat(seat)) this.scheduleBot(seat, turnSeq)
    } else if (s.phase === 'DECISION') {
      const turnSeq = s.turnSeq
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onDecisionTimeout(turnSeq))
      for (const p of s.players) if (p.decision === null && this.deps.isBotSeat(p.seat)) this.scheduleBot(p.seat, turnSeq)
    } else if (s.phase === 'REVEAL') {
      this.schedule(this.deps.revealDelayMs, () => {
        if (!this.completed && this.current.phase === 'REVEAL') this.submit({ type: 'ADVANCE' })
      })
    }
    this.deps.onEvents(events, deadlineAt)
    this.applyAutoFolds()
  }

  private schedule(ms: number, fn: () => void): void {
    this.timers.push(this.deps.clock.setTimeout(() => this.deps.enqueue(fn), ms))
  }

  private scheduleBot(seat: number, turnSeq: number): void {
    const [min, max] = this.deps.botDelayMs
    const delay = min + this.deps.rng.int(Math.max(1, max - min + 1))
    this.schedule(delay, () => this.botAct(seat, turnSeq))
  }

  private applyAutoFolds(): void {
    for (;;) {
      if (this.completed) return
      const s = this.current
      let seat: number | null = null
      if (s.phase === 'BETTING' && s.actingSeat !== null && this.autoFold.has(s.actingSeat)) seat = s.actingSeat
      else if (s.phase === 'DECISION') seat = s.players.find((p) => p.decision === null && this.autoFold.has(p.seat))?.seat ?? null
      if (seat === null) return
      this.submit({ type: 'ACTION', seat, action: { kind: 'fold' } })
    }
  }

  private onTurnTimeout(seat: number, turnSeq: number): void {
    const s = this.current
    if (this.completed || s.phase !== 'BETTING' || s.actingSeat !== seat || s.turnSeq !== turnSeq) return
    this.submit({ type: 'TIMEOUT', seat })
  }

  private onDecisionTimeout(turnSeq: number): void {
    if (this.completed || this.current.phase !== 'DECISION' || this.current.turnSeq !== turnSeq) return
    const undecided = this.current.players.filter((p) => p.decision === null).map((p) => p.seat)
    for (const seat of undecided) {
      if (this.completed || this.current.phase !== 'DECISION') return
      this.submit({ type: 'TIMEOUT', seat })
    }
  }

  private botAct(seat: number, turnSeq: number): void {
    const s = this.current
    if (this.completed || s.turnSeq !== turnSeq) return
    if (s.phase === 'BETTING' && s.actingSeat !== seat) return
    if (s.phase === 'DECISION' && s.players.find((p) => p.seat === seat)?.decision !== null) return
    if (s.phase !== 'BETTING' && s.phase !== 'DECISION') return
    const legal = legalActions(s, seat)
    if (legal.kinds.length === 0) return
    const safe: PlayerAction = { kind: legal.kinds.includes('check') ? 'check' : 'fold' }
    let action: PlayerAction
    try {
      action = this.deps.bot.decide(playerView(s, seat), legal, this.deps.rng)
    } catch (err) {
      this.deps.log.error('bot.decide threw; using safe action', { seat, err: String(err) })
      action = safe
    }
    try {
      this.submit({ type: 'ACTION', seat, action })
    } catch (err) {
      if (!(err instanceof EngineError)) throw err
      this.deps.log.warn('bot action rejected; using safe action', { seat, action, code: err.code })
      this.submit({ type: 'ACTION', seat, action: safe })
    }
  }
}
```

Append to `packages/server-kit/src/index.ts`:
```ts
export * from './room/types.js'
export * from './room/hand-runner.js'
```
Create `packages/server-kit/src/testing/index.ts`:
```ts
export * from './manual-clock.js'
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint`
Expected: pass. If the bot-vs-passive-human test loops without completing, print `runner.state.phase`/`actingSeat` per iteration and fix the scheduling branch that stopped firing — the runner, not the test.

- [ ] **Step 6: Commit**

```bash
git add packages/server-kit
git commit -m "feat(server-kit): room types and HandRunner (turn/decision/reveal timers, bots, auto-fold)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: `Room` actor — membership, seats, host, snapshot, hand lifecycle

**Files:**
- Create: `packages/server-kit/src/room/room.ts`, `packages/server-kit/src/room/room.test.ts`, `packages/server-kit/src/testing/room-harness.ts`
- Modify: `packages/server-kit/src/room/hand-runner.ts` (add `wasCancelled` getter), `packages/server-kit/src/index.ts`, `packages/server-kit/src/testing/index.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces (exact):
  ```ts
  export interface RoomInit { roomId: string; code: string; config: RoomConfig; host: PlayerIdentity; deps: RoomDeps }
  export class Room {
    constructor(init: RoomInit)
    readonly roomId: string; readonly code: string; readonly config: RoomConfig; readonly rules: Ruleset
    hostPlayerId: string
    status: 'OPEN' | 'IN_GAME' | 'CLOSED'
    readonly players: Map<string, RoomPlayer>
    seq: number; carryOverPot: number; button: number | null; nextHandAt: number | null; deadlineAt: number | null
    onClosed: ((room: Room, reason: string) => void) | null
    onChanged: ((room: Room) => void) | null
    enqueue<T>(fn: () => T | Promise<T>): Promise<T>
    // all of the following run on the queue and reject with RoomError:
    join(identity: PlayerIdentity, password?: string): Promise<void>
    leave(playerId: string): Promise<void>
    sitDown(playerId: string, seat: number, buyIn?: number): Promise<void>
    standUp(playerId: string): Promise<void>
    setReady(playerId: string, ready: boolean): Promise<void>
    startGame(playerId: string): Promise<void>
    kick(hostId: string, targetId: string): Promise<void>
    action(playerId: string, action: PlayerAction, baseSeq: number): Promise<void>
    onDisconnect(playerId: string): Promise<void>
    onReconnect(playerId: string): Promise<void>
    shutdown(reason: string): Promise<void>
    // synchronous reads:
    snapshot(viewerId: string | null): Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>
    summary(): RoomSummary
    view(): RoomView
    hasPlayer(playerId: string): boolean
    readonly humanCount: number
    readonly handActive: boolean
  }
  // testing/room-harness.ts
  export interface RoomHarness { room: Room; clock: ManualClock; repos: MemoryRepositories; sent: Map<string, ServerMessage[]>; last(playerId, t): ServerMessage | undefined; ofType(playerId, t): ServerMessage[]; identity(id): PlayerIdentity; domainEvents: DomainEvent[] }
  export function createRoomHarness(config: RoomConfig, opts?: { players?: [id: string, balance: number][]; options?: Partial<RoomOptions>; seed?: number }): RoomHarness
  ```
  `HandRunner` gains `get wasCancelled(): boolean` (true after `cancel()`).

Error codes used (all `RoomError`): `ROOM_NOT_FOUND` (closed), `ALREADY_IN_ROOM`, `WRONG_PASSWORD`, `ROOM_FULL`, `NOT_IN_ROOM`, `SEAT_TAKEN`, `ILLEGAL_ACTION` (already seated / seat out of range), `INVALID_AMOUNT` (buy-in out of range), `INSUFFICIENT_BALANCE`, `NOT_SEATED`, `GAME_IN_PROGRESS`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `NOT_IN_HAND`, `STALE_STATE`, plus `engineErrorToErrorCode(...)` for engine rejections.

Rules (spec §11, §16.6–16.7, §7.1, §8.2, §8.4):
- Room capacity for humans = `maxPlayers` (bots take the highest seats at creation for Blind rooms: seat `maxPlayers-1`, `maxPlayers-2`, …).
- Hold'em `sitDown` requires `buyIn` in `[minBuyInBB×BB, maxBuyInBB×BB]` and applies `-buyIn` (`buy_in`, refId = roomId); `standUp` applies `+stack` (`cash_out`). Blind `sitDown` requires balance ≥ `blindRequiredStack(rules)` and records the balance as `stack`.
- A player who leaves or stands up during a hand is auto-folded now and removed/stood up when the hand completes.
- Disconnect: `PLAYER_DISCONNECTED{deadline}`; after `reconnectWindowMs` still disconnected → stood up (after the hand if in one), then after `spectatorGraceMs` removed. Reconnect cancels both.
- `consecutiveTimeoutsToStand` consecutive timed-out actions → stood up after the hand.
- Hand start needs ≥ 2 eligible seats (Hold'em: stack > 0; Blind: humans' fresh balance and bots' virtual balance ≥ required, bots refilled to `botStartingBalance` when short). Button rotates via `nextButton`. Next hand auto-starts `handIntervalMs` after completion; if fewer than 2 eligible → room returns to `OPEN` with all `ready` cleared.
- Settlement: Hold'em updates table stacks only; Blind applies net deltas to human balances in one `balances.apply(entries, { refId: handId, fee })`, then pushes `BALANCE` to each affected human. Every completed or cancelled hand is recorded via `history.recordHand` and emitted as `HAND_SETTLED`.
- `shutdown(reason)`: cancel the hand (refunds through the engine), cash out every Hold'em stack, split any carry-over pot equally among seated humans (`refund`, remainder dropped), status `CLOSED`, `ROOM_CLOSED{reason}` broadcast.
- Every outbound room/game message increments `seq`; `turnStartSeq` records the `seq` of the latest `TURN_CHANGED`/`DECISION_PHASE`, and `action()` rejects `baseSeq < turnStartSeq` with `STALE_STATE`.

- [ ] **Step 1: Add `wasCancelled` to `HandRunner`**

In `packages/server-kit/src/room/hand-runner.ts`: add a private field `private cancelled = false`, a getter `get wasCancelled(): boolean { return this.cancelled }`, and set `this.cancelled = true` at the top of `cancel()` before `submit`.

- [ ] **Step 2: Write the harness**

`packages/server-kit/src/testing/room-harness.ts`:
```ts
import { createBotStrategy, seededRng, type PlayerIdentity, type RoomConfig, type ServerMessage } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories, type MemoryRepositories } from '../memory-repositories.js'
import { Room } from '../room/room.js'
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../room/types.js'
import { ManualClock } from './manual-clock.js'

export interface RoomHarness {
  room: Room
  clock: ManualClock
  repos: MemoryRepositories
  sent: Map<string, ServerMessage[]>
  domainEvents: DomainEvent[]
  identity(id: string): PlayerIdentity
  ofType<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }>[]
  last<T extends ServerMessage['t']>(playerId: string, t: T): Extract<ServerMessage, { t: T }> | undefined
}

export const TEST_ROOM_OPTIONS: RoomOptions = {
  ...DEFAULT_ROOM_OPTIONS,
  handIntervalMs: 100,
  revealDelayMs: 10,
  botDelayMs: [10, 10],
  reconnectWindowMs: 1_000,
  spectatorGraceMs: 2_000,
  emptyRoomCloseMs: 500,
  turnTimerMsOverride: 5_000,
}

export function createRoomHarness(
  config: RoomConfig,
  opts: { players?: [id: string, balance: number][]; options?: Partial<RoomOptions>; seed?: number; hostId?: string } = {},
): RoomHarness {
  const clock = new ManualClock()
  const repos = createMemoryRepositories()
  const sent = new Map<string, ServerMessage[]>()
  const domainEvents: DomainEvent[] = []
  const players = opts.players ?? [['h', 100_000], ['a', 100_000], ['b', 100_000]]
  for (const [id, balance] of players) repos.addPlayer(id, id.toUpperCase(), balance)
  const identity = (id: string): PlayerIdentity => ({ playerId: id, displayName: id.toUpperCase(), isBot: false })
  const room = new Room({
    roomId: 'room-1',
    code: 'ABC234',
    config,
    host: identity(opts.hostId ?? players[0]![0]),
    deps: {
      clock,
      rng: seededRng(opts.seed ?? 1),
      repos,
      outbox: { send: (playerId, msg) => { (sent.get(playerId) ?? sent.set(playerId, []).get(playerId)!).push(msg) } },
      bot: createBotStrategy(),
      log: silentLogger,
      options: { ...TEST_ROOM_OPTIONS, ...opts.options },
      onDomainEvent: (e) => domainEvents.push(e),
    },
  })
  const ofType = <T extends ServerMessage['t']>(playerId: string, t: T) => (sent.get(playerId) ?? []).filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t)
  return { room, clock, repos, sent, domainEvents, identity, ofType, last: (playerId, t) => ofType(playerId, t).at(-1) }
}
```

Add to `packages/server-kit/src/testing/index.ts`: `export * from './room-harness.js'`.

- [ ] **Step 3: Write failing tests (membership, seats, host, snapshot)**

`packages/server-kit/src/room/room.test.ts`:
```ts
import type { RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness } from '../testing/room-harness.js'
import { RoomError } from './types.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: true, password: 'pw12', turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } }

const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? e.code : String(e)))

describe('Room membership', () => {
  it('starts with the host in the room and bots seated at the top seats (blind)', () => {
    const h = createRoomHarness(BLIND)
    expect(h.room.hostPlayerId).toBe('h')
    expect(h.room.humanCount).toBe(1)
    const bots = [...h.room.players.values()].filter((p) => p.identity.isBot)
    expect(bots.map((b) => b.seat).sort()).toEqual([2, 3])
    expect(bots.every((b) => b.ready && b.connected)).toBe(true)
    expect(h.room.summary()).toMatchObject({ code: 'ABC234', mode: 'blind', playerCount: 1, maxPlayers: 4, status: 'OPEN', config: { hasPassword: true } })
    expect((h.room.summary().config as { password?: string }).password).toBeUndefined()
  })

  it('join: password, capacity, duplicates; leave: host transfer and empty-room close', async () => {
    const h = createRoomHarness(BLIND, { players: [['h', 1e5], ['a', 1e5], ['b', 1e5], ['c', 1e5], ['d', 1e5]] })
    expect(await code(h.room.join(h.identity('a'), 'nope'))).toBe('WRONG_PASSWORD')
    await h.room.join(h.identity('a'), 'pw12')
    expect(await code(h.room.join(h.identity('a'), 'pw12'))).toBe('ALREADY_IN_ROOM')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_JOINED', player: { playerId: 'a' } })
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'ROOM_JOINED', playerId: 'a' })
    await h.room.join(h.identity('b'), 'pw12')
    await h.room.join(h.identity('c'), 'pw12')
    expect(await code(h.room.join(h.identity('d'), 'pw12'))).toBe('ROOM_FULL') // 4 humans = maxPlayers
    await h.room.leave('h')
    expect(h.room.hostPlayerId).toBe('a') // earliest joiner
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'HOST_CHANGED', hostPlayerId: 'a' })
    expect(await code(h.room.leave('h'))).toBe('NOT_IN_ROOM')
    let closed: string | null = null
    h.room.onClosed = (_r, reason) => { closed = reason }
    await h.room.leave('a'); await h.room.leave('b'); await h.room.leave('c')
    expect(h.room.status).toBe('OPEN')
    h.clock.advance(500)
    await h.room.enqueue(() => undefined)
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toBe('empty')
  })
})

describe('Room seats and buy-ins', () => {
  it('hold’em sit-down validates the seat and buy-in, moves points to the table, and stand-up returns them', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.sitDown('a', 9, 20_000))).toBe('ILLEGAL_ACTION')
    expect(await code(h.room.sitDown('a', 0, 5_000))).toBe('INVALID_AMOUNT') // min 50 BB = 10_000
    expect(await code(h.room.sitDown('a', 0, 50_000))).toBe('INVALID_AMOUNT') // max 200 BB = 40_000
    expect(await code(h.room.sitDown('a', 0))).toBe('INVALID_AMOUNT')
    await h.room.sitDown('a', 0, 20_000)
    expect(await h.repos.balances.get('a')).toBe(80_000)
    expect(h.room.players.get('a')!.stack).toBe(20_000)
    expect(await code(h.room.sitDown('h', 0, 20_000))).toBe('SEAT_TAKEN')
    expect(await code(h.room.sitDown('a', 1, 20_000))).toBe('ILLEGAL_ACTION') // already seated
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_SAT', playerId: 'a', seat: 0, stack: 20_000 })
    await h.room.standUp('a')
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(await code(h.room.standUp('a'))).toBe('NOT_SEATED')
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'cash_out'])
  })

  it('rejects a hold’em buy-in the player cannot afford', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['poor', 15_000]] })
    await h.room.join(h.identity('poor'))
    expect(await code(h.room.sitDown('poor', 1, 20_000))).toBe('INSUFFICIENT_BALANCE')
    expect(await h.repos.balances.get('poor')).toBe(15_000)
  })

  it('blind sit-down needs the required balance and never moves points', async () => {
    const h = createRoomHarness(BLIND, { players: [['h', 100_000], ['poor', 1_500]] })
    await h.room.join(h.identity('poor'), 'pw12')
    expect(await code(h.room.sitDown('poor', 0))).toBe('INSUFFICIENT_BALANCE') // needs 2 × 1000
    await h.room.sitDown('h', 0)
    expect(h.room.players.get('h')!.stack).toBe(100_000)
    expect(h.repos.entries).toHaveLength(0)
    expect(await code(h.room.sitDown('h', 2))).toBe('ILLEGAL_ACTION') // seat 2 is a bot's — and h is already seated
  })

  it('ready needs a seat and an OPEN room; start needs the host and two ready seats', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.setReady('a', true))).toBe('NOT_SEATED')
    await h.room.sitDown('h', 0, 20_000)
    await h.room.sitDown('a', 1, 20_000)
    expect(await code(h.room.startGame('a'))).toBe('NOT_HOST')
    expect(await code(h.room.startGame('h'))).toBe('NOT_ENOUGH_PLAYERS')
    await h.room.setReady('h', true)
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_READY', playerId: 'h', ready: true })
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    expect(h.room.status).toBe('IN_GAME')
    expect(h.room.handActive).toBe(true)
    expect(await code(h.room.setReady('a', false))).toBe('GAME_IN_PROGRESS')
    expect(await code(h.room.startGame('h'))).toBe('GAME_IN_PROGRESS')
  })

  it('autoStart begins the hand when every seated human is ready', async () => {
    const h = createRoomHarness({ ...HOLDEM, autoStart: true })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0, 20_000)
    await h.room.sitDown('a', 1, 20_000)
    await h.room.setReady('h', true)
    expect(h.room.status).toBe('OPEN')
    await h.room.setReady('a', true)
    expect(h.room.status).toBe('IN_GAME')
  })

  it('kick removes a non-playing member and notifies them', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.kick('a', 'h'))).toBe('NOT_HOST')
    await h.room.kick('h', 'a')
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(h.last('a', 'NOTIFICATION')).toMatchObject({ kind: 'KICKED' })
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_LEFT', playerId: 'a' })
  })
})

describe('Room snapshot', () => {
  it('describes players, seats, statuses and the hand for the viewer', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.join(h.identity('a'), 'pw12')
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    await h.room.setReady('h', true)
    const snap = h.room.snapshot('a')
    expect(snap.t).toBe('ROOM_SNAPSHOT')
    expect(snap.hand).toBeNull()
    expect(snap.deadlineAt).toBeNull()
    expect(snap.room.hostPlayerId).toBe('h')
    expect(snap.room.players.map((p) => [p.playerId, p.seat, p.status, p.isHost])).toEqual([
      ['h', 0, 'READY', true], ['bot:room-1:0', 3, 'READY', false], ['bot:room-1:1', 2, 'READY', false], ['a', 1, 'SEATED', false],
    ])
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    const inHand = h.room.snapshot('a')
    expect(inHand.hand?.mySeat).toBe(1)
    expect(inHand.hand?.seats.find((s) => s.seat === 1)?.holeCards).toHaveLength(2)
    expect(inHand.hand?.seats.find((s) => s.seat === 0)?.holeCards).toBeNull()
    expect(inHand.hand?.legal?.kinds).toEqual(['play', 'fold'])
    expect(inHand.deadlineAt).toBe(h.clock.now() + 5_000)
    expect(h.room.snapshot(null).hand?.seats.every((s) => s.holeCards === null)).toBe(true)
  })
})
```

Note the player order in the snapshot test: players are listed in join order (host first, then the bots created at construction, then `a`). Bots are created with indexes 0 and 1 taking seats `maxPlayers-1-i` → bot 0 at seat 3, bot 1 at seat 2.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @bp/server-kit test`
Expected: FAIL — `./room.js` not found.

- [ ] **Step 5: Implement `Room`**

`packages/server-kit/src/room/room.ts`:
```ts
import {
  EngineError, blindRequiredStack, engineErrorToErrorCode, filterEvent, nextButton, playerView, roomConfigToRuleset,
  type GameEvent, type PlayerAction, type PlayerIdentity, type RoomConfig, type RoomEvent, type RoomPlayerView,
  type RoomSummary, type RoomView, type Ruleset, type SeatStatus, type ServerMessage,
} from '@bp/core'
import type { TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import { InsufficientBalanceError, type BalanceEntry, type HandSummary } from '../repositories.js'
import { HandRunner } from './hand-runner.js'
import { RoomError, type RoomDeps, type RoomPlayer } from './types.js'

export interface RoomInit {
  roomId: string
  code: string
  config: RoomConfig
  host: PlayerIdentity
  deps: RoomDeps
}

type Snapshot = Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>

export class Room {
  readonly roomId: string
  readonly code: string
  readonly config: RoomConfig
  readonly rules: Ruleset
  hostPlayerId: string
  status: 'OPEN' | 'IN_GAME' | 'CLOSED' = 'OPEN'
  readonly players = new Map<string, RoomPlayer>()
  seq = 0
  carryOverPot = 0
  button: number | null = null
  nextHandAt: number | null = null
  deadlineAt: number | null = null
  onClosed: ((room: Room, reason: string) => void) | null = null
  onChanged: ((room: Room) => void) | null = null

  private readonly deps: RoomDeps
  private runner: HandRunner | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private nextHandTimer: TimerHandle | null = null
  private closeTimer: TimerHandle | null = null
  private readonly playerTimers = new Map<string, TimerHandle>()
  private turnStartSeq = 0

  constructor(init: RoomInit) {
    this.roomId = init.roomId
    this.code = init.code
    this.config = init.config
    this.deps = init.deps
    this.rules = roomConfigToRuleset(init.config)
    this.hostPlayerId = init.host.playerId
    this.addPlayer(init.host)
    if (init.config.mode === 'blind') {
      const count = init.config.blind?.botCount ?? 0
      for (let i = 0; i < count; i++) {
        const bot = this.addPlayer({ playerId: `bot:${init.roomId}:${i}`, displayName: `Bot ${i + 1}`, isBot: true })
        bot.seat = init.config.maxPlayers - 1 - i
        bot.stack = init.deps.options.botStartingBalance
        bot.ready = true
      }
    }
  }

  // ---------- queue ----------

  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  // ---------- reads ----------

  get humanCount(): number {
    return this.humans().length
  }

  get handActive(): boolean {
    return this.runner !== null && !this.runner.isComplete
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId)
  }

  summary(): RoomSummary {
    const { password, ...rest } = this.config
    return {
      roomId: this.roomId,
      code: this.code,
      name: this.config.name,
      mode: this.config.mode,
      config: { ...rest, hasPassword: password !== undefined },
      playerCount: this.humanCount,
      maxPlayers: this.config.maxPlayers,
      status: this.status === 'IN_GAME' ? 'IN_GAME' : 'OPEN',
    }
  }

  view(): RoomView {
    return {
      ...this.summary(),
      hostPlayerId: this.hostPlayerId,
      players: [...this.players.values()].map((p) => this.playerView(p)),
      carryOverPot: this.carryOverPot,
      nextHandAt: this.nextHandAt,
    }
  }

  snapshot(viewerId: string | null): Snapshot {
    const viewer = viewerId === null ? undefined : this.players.get(viewerId)
    const seat = viewer?.seat ?? null
    const hand = this.runner && !this.runner.isComplete ? playerView(this.runner.state, seat) : null
    return { t: 'ROOM_SNAPSHOT', seq: this.seq, room: this.view(), hand, deadlineAt: hand ? this.deadlineAt : null }
  }

  // ---------- membership ----------

  join(identity: PlayerIdentity, password?: string): Promise<void> {
    return this.enqueue(() => {
      if (this.status === 'CLOSED') throw new RoomError('ROOM_NOT_FOUND', 'room is closed')
      const existing = this.players.get(identity.playerId)
      if (existing) {
        if (!existing.leaveAfterHand) throw new RoomError('ALREADY_IN_ROOM')
        existing.leaveAfterHand = false // rejoined before the hand ended
        return
      }
      if (this.config.password !== undefined && password !== this.config.password) throw new RoomError('WRONG_PASSWORD')
      if (this.humanCount >= this.config.maxPlayers) throw new RoomError('ROOM_FULL')
      const p = this.addPlayer(identity)
      this.cancelClose()
      this.broadcastRoomEvent({ type: 'PLAYER_JOINED', player: this.playerView(p) }, identity.playerId)
      this.deps.onDomainEvent?.({ type: 'ROOM_JOINED', roomId: this.roomId, playerId: identity.playerId })
      this.changed()
    })
  }

  leave(playerId: string): Promise<void> {
    return this.enqueue(() => {
      const p = this.mustPlayer(playerId)
      if (this.inCurrentHand(p)) {
        p.leaveAfterHand = true
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat!)
        return
      }
      return this.removePlayer(p, 'left')
    })
  }

  kick(hostId: string, targetId: string): Promise<void> {
    return this.enqueue(() => {
      if (hostId !== this.hostPlayerId) throw new RoomError('NOT_HOST')
      const target = this.mustPlayer(targetId)
      if (targetId === hostId || target.identity.isBot) throw new RoomError('ILLEGAL_ACTION', 'cannot kick this player')
      if (this.inCurrentHand(target)) throw new RoomError('GAME_IN_PROGRESS', 'player is in the current hand')
      this.deps.outbox.send(targetId, { t: 'NOTIFICATION', kind: 'KICKED', payload: { roomId: this.roomId } })
      return this.removePlayer(target, 'kicked')
    })
  }

  // ---------- seats ----------

  sitDown(playerId: string, seat: number, buyIn?: number): Promise<void> {
    return this.enqueue(async () => {
      const p = this.mustPlayer(playerId)
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.config.maxPlayers) throw new RoomError('ILLEGAL_ACTION', 'seat out of range')
      if (p.seat !== null) throw new RoomError('ILLEGAL_ACTION', 'already seated')
      if (this.seatPlayer(seat)) throw new RoomError('SEAT_TAKEN')
      if (this.rules.mode === 'holdem') {
        const bb = this.rules.bigBlind
        const min = (this.config.holdem?.minBuyInBB ?? 0) * bb
        const max = (this.config.holdem?.maxBuyInBB ?? 0) * bb
        if (buyIn === undefined || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) throw new RoomError('INVALID_AMOUNT', `buy-in must be ${min}–${max}`)
        try {
          await this.deps.repos.balances.apply([{ playerId, delta: -buyIn, reason: 'buy_in', refId: this.roomId }])
        } catch (err) {
          if (err instanceof InsufficientBalanceError) throw new RoomError('INSUFFICIENT_BALANCE')
          throw err
        }
        if (this.seatPlayer(seat)) {
          // lost the race while awaiting: refund
          await this.deps.repos.balances.apply([{ playerId, delta: buyIn, reason: 'refund', refId: this.roomId }])
          throw new RoomError('SEAT_TAKEN')
        }
        p.stack = buyIn
      } else {
        const balance = await this.deps.repos.balances.get(playerId)
        if (balance < blindRequiredStack(this.rules)) throw new RoomError('INSUFFICIENT_BALANCE')
        if (this.seatPlayer(seat)) throw new RoomError('SEAT_TAKEN')
        p.stack = balance
      }
      p.seat = seat
      p.ready = false
      p.sittingOut = false
      p.consecutiveTimeouts = 0
      this.broadcastRoomEvent({ type: 'PLAYER_SAT', playerId, seat, stack: p.stack })
      this.changed()
    })
  }

  standUp(playerId: string): Promise<void> {
    return this.enqueue(async () => {
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (this.inCurrentHand(p)) {
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat)
        return
      }
      await this.standUpNow(p)
    })
  }

  setReady(playerId: string, ready: boolean): Promise<void> {
    return this.enqueue(() => {
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (this.status !== 'OPEN') throw new RoomError('GAME_IN_PROGRESS')
      p.ready = ready
      this.broadcastRoomEvent({ type: 'PLAYER_READY', playerId, ready })
      if (this.config.autoStart && ready && this.readySeats().length >= 2 && this.seatedHumans().every((h) => h.ready)) return this.startHand()
      return undefined
    })
  }

  startGame(playerId: string): Promise<void> {
    return this.enqueue(() => {
      if (playerId !== this.hostPlayerId) throw new RoomError('NOT_HOST')
      if (this.status !== 'OPEN') throw new RoomError('GAME_IN_PROGRESS')
      if (this.readySeats().length < 2) throw new RoomError('NOT_ENOUGH_PLAYERS', 'need at least 2 ready players')
      return this.startHand()
    })
  }

  // ---------- gameplay ----------

  action(playerId: string, action: PlayerAction, baseSeq: number): Promise<void> {
    return this.enqueue(() => {
      const p = this.mustPlayer(playerId)
      if (!this.runner || this.runner.isComplete) throw new RoomError('NOT_IN_HAND', 'no hand in progress')
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (!this.runner.state.players.some((hp) => hp.seat === p.seat)) throw new RoomError('NOT_IN_HAND')
      if (baseSeq < this.turnStartSeq) throw new RoomError('STALE_STATE', `turn changed at seq ${this.turnStartSeq}`)
      try {
        this.runner.submit({ type: 'ACTION', seat: p.seat, action })
      } catch (err) {
        if (err instanceof EngineError) throw new RoomError(engineErrorToErrorCode(err.code), err.message)
        throw err
      }
    })
  }

  // ---------- connection lifecycle ----------

  onDisconnect(playerId: string): Promise<void> {
    return this.enqueue(() => {
      const p = this.players.get(playerId)
      if (!p || !p.connected) return
      p.connected = false
      const deadline = this.deps.clock.now() + this.deps.options.reconnectWindowMs
      p.disconnectDeadline = deadline
      this.broadcastRoomEvent({ type: 'PLAYER_DISCONNECTED', playerId, deadline }, playerId)
      this.setPlayerTimer(playerId, this.deps.options.reconnectWindowMs, () => this.onReconnectExpired(playerId))
    })
  }

  onReconnect(playerId: string): Promise<void> {
    return this.enqueue(() => {
      const p = this.players.get(playerId)
      if (!p || p.connected) return
      p.connected = true
      p.disconnectDeadline = null
      this.clearPlayerTimer(playerId)
      this.broadcastRoomEvent({ type: 'PLAYER_RECONNECTED', playerId }, playerId)
    })
  }

  private async onReconnectExpired(playerId: string): Promise<void> {
    const p = this.players.get(playerId)
    if (!p || p.connected) return
    if (p.seat !== null) {
      if (this.inCurrentHand(p)) {
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat)
      } else await this.standUpNow(p)
    }
    this.setPlayerTimer(playerId, this.deps.options.spectatorGraceMs, () => {
      const still = this.players.get(playerId)
      if (!still || still.connected) return
      if (this.inCurrentHand(still)) {
        still.leaveAfterHand = true
        return
      }
      return this.removePlayer(still, 'timeout')
    })
  }

  // ---------- shutdown / close ----------

  shutdown(reason: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.status === 'CLOSED') return
      if (this.runner && !this.runner.isComplete) {
        this.runner.cancel(reason)
        await this.onHandComplete()
      }
      this.cancelTimers()
      for (const p of this.seatedHumans()) await this.standUpNow(p)
      await this.distributeCarryOver()
      this.status = 'CLOSED'
      this.broadcastRoomEvent({ type: 'ROOM_CLOSED', reason })
      this.onClosed?.(this, reason)
    })
  }

  private close(reason: string): void {
    if (this.status === 'CLOSED') return
    this.cancelTimers()
    if (this.runner && !this.runner.isComplete) {
      this.runner.dispose()
      this.runner = null
    }
    this.status = 'CLOSED'
    this.onClosed?.(this, reason)
  }

  private async distributeCarryOver(): Promise<void> {
    if (this.carryOverPot <= 0) return
    const humans = this.seatedHumans()
    if (humans.length === 0) {
      this.carryOverPot = 0
      return
    }
    const share = Math.floor(this.carryOverPot / humans.length)
    const remainder = this.carryOverPot - share * humans.length
    this.carryOverPot = 0
    const entries = humans.map((p, i) => ({ playerId: p.identity.playerId, delta: share + (i === 0 ? remainder : 0), reason: 'refund' as const, refId: this.roomId })).filter((e) => e.delta > 0)
    if (entries.length === 0) return
    await this.deps.repos.balances.apply(entries)
    for (const p of humans) await this.pushBalance(p.identity.playerId)
  }

  // ---------- hand lifecycle ----------

  private async startHand(): Promise<void> {
    if (this.status === 'CLOSED' || (this.runner && !this.runner.isComplete)) return
    this.nextHandTimer?.cancel()
    this.nextHandTimer = null
    if (this.rules.mode === 'blind') {
      const required = blindRequiredStack(this.rules)
      for (const p of this.seated()) {
        if (p.identity.isBot) {
          if (p.stack < required) p.stack = this.deps.options.botStartingBalance
        } else p.stack = await this.deps.repos.balances.get(p.identity.playerId)
      }
    }
    const eligible = this.eligibleForHand()
    if (eligible.length < 2) {
      this.toOpen()
      return
    }
    const seats = eligible.map((p) => p.seat!)
    this.button = nextButton(this.button, seats, this.deps.rng)
    const handId = newId()
    const runner = new HandRunner(
      {
        clock: this.deps.clock,
        rng: this.deps.rng,
        bot: this.deps.bot,
        log: this.deps.log,
        turnTimerMs: this.deps.options.turnTimerMsOverride ?? this.config.turnTimerSec * 1000,
        revealDelayMs: this.deps.options.revealDelayMs,
        botDelayMs: this.deps.options.botDelayMs,
        isBotSeat: (seat) => this.seatPlayer(seat)?.identity.isBot ?? false,
        enqueue: (fn) => void this.enqueue(fn),
        onEvents: (events, deadlineAt) => this.onHandEvents(events, deadlineAt),
        onComplete: () => void this.enqueue(() => this.onHandComplete()),
      },
      { handId, rules: this.rules, seats: eligible.map((p) => ({ seat: p.seat!, playerId: p.identity.playerId, stack: p.stack, isBot: p.identity.isBot })), button: this.button, carryOverIn: this.carryOverPot },
    )
    this.runner = runner
    this.carryOverPot = 0
    this.nextHandAt = null
    this.status = 'IN_GAME'
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: null })
    this.changed()
    runner.start()
  }

  private onHandEvents(events: GameEvent[], deadlineAt: number | null): void {
    this.deadlineAt = deadlineAt
    for (const event of events) {
      if (event.type === 'PLAYER_ACTED') {
        const p = this.seatPlayer(event.seat)
        if (p && !p.identity.isBot) p.consecutiveTimeouts = event.timedOut ? p.consecutiveTimeouts + 1 : 0
      }
      this.seq += 1
      const isTurn = event.type === 'TURN_CHANGED' || event.type === 'DECISION_PHASE'
      if (isTurn) this.turnStartSeq = this.seq
      const outbound = isTurn && deadlineAt !== null ? { ...event, deadlineAt } : event
      for (const p of this.connectedHumans()) this.deps.outbox.send(p.identity.playerId, { t: 'GAME_EVENT', seq: this.seq, event: filterEvent(outbound, p.seat) })
    }
  }

  private async onHandComplete(): Promise<void> {
    const runner = this.runner
    if (!runner || !runner.isComplete || runner.state.result === null) return
    const state = runner.state
    const result = state.result!
    const entries: BalanceEntry[] = []
    const summary: HandSummary = {
      handId: state.handId,
      roomId: this.roomId,
      mode: this.rules.mode,
      config: this.config,
      startedAt: runner.startedAt,
      endedAt: this.deps.clock.now(),
      fee: result.fee,
      cancelled: runner.wasCancelled,
      players: [],
    }
    for (const hp of state.players) {
      const rp = this.seatPlayer(hp.seat)
      const before = runner.stacksBefore.get(hp.seat) ?? hp.stack
      const net = hp.stack - before
      if (rp) rp.stack = hp.stack
      if (rp && !rp.identity.isBot && this.rules.mode === 'blind' && net !== 0) entries.push({ playerId: rp.identity.playerId, delta: net, reason: 'settlement', refId: state.handId })
      summary.players.push({ playerId: hp.playerId, seat: hp.seat, isBot: hp.isBot, net, won: net > 0, bestCategory: result.showdown?.find((h) => h.seat === hp.seat)?.category ?? null })
    }
    this.carryOverPot = result.carryOverOut
    this.runner = null
    this.deadlineAt = null
    if (entries.length > 0) {
      try {
        await this.deps.repos.balances.apply(entries, { refId: state.handId, fee: result.fee })
      } catch (err) {
        this.deps.log.error('settlement failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
      }
      for (const e of entries) await this.pushBalance(e.playerId)
    }
    try {
      await this.deps.repos.history.recordHand(summary)
    } catch (err) {
      this.deps.log.error('recordHand failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
    }
    this.deps.onDomainEvent?.({ type: 'HAND_SETTLED', summary })

    for (const p of [...this.players.values()]) {
      if (!p.identity.isBot && p.consecutiveTimeouts >= this.deps.options.consecutiveTimeoutsToStand) {
        p.standAfterHand = true
        p.consecutiveTimeouts = 0
      }
      if (p.leaveAfterHand) await this.removePlayer(p, 'left')
      else if (p.standAfterHand || (this.rules.mode === 'holdem' && p.seat !== null && p.stack === 0)) await this.standUpNow(p)
    }
    if (this.status === 'CLOSED') return
    this.nextHandAt = this.deps.clock.now() + this.deps.options.handIntervalMs
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: this.nextHandAt })
    this.nextHandTimer = this.deps.clock.setTimeout(() => void this.enqueue(() => this.startHand()), this.deps.options.handIntervalMs)
  }

  private toOpen(): void {
    this.status = 'OPEN'
    this.nextHandAt = null
    for (const p of this.players.values()) if (!p.identity.isBot) p.ready = false
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'OPEN', nextHandAt: null })
    this.changed()
  }

  // ---------- helpers ----------

  private addPlayer(identity: PlayerIdentity): RoomPlayer {
    const p: RoomPlayer = {
      identity, seat: null, stack: 0, ready: false, connected: true, joinedAt: this.deps.clock.now(), sittingOut: false,
      consecutiveTimeouts: 0, disconnectDeadline: null, standAfterHand: false, leaveAfterHand: false,
    }
    this.players.set(identity.playerId, p)
    return p
  }

  private mustPlayer(playerId: string): RoomPlayer {
    const p = this.players.get(playerId)
    if (!p) throw new RoomError('NOT_IN_ROOM')
    return p
  }

  private humans(): RoomPlayer[] {
    return [...this.players.values()].filter((p) => !p.identity.isBot)
  }

  private connectedHumans(): RoomPlayer[] {
    return this.humans().filter((p) => p.connected)
  }

  private seated(): RoomPlayer[] {
    return [...this.players.values()].filter((p) => p.seat !== null)
  }

  private seatedHumans(): RoomPlayer[] {
    return this.seated().filter((p) => !p.identity.isBot)
  }

  private readySeats(): RoomPlayer[] {
    return this.seated().filter((p) => p.ready)
  }

  private seatPlayer(seat: number): RoomPlayer | undefined {
    return [...this.players.values()].find((p) => p.seat === seat)
  }

  private inCurrentHand(p: RoomPlayer): boolean {
    return p.seat !== null && this.runner !== null && !this.runner.isComplete && this.runner.state.players.some((hp) => hp.seat === p.seat)
  }

  private eligibleForHand(): RoomPlayer[] {
    const required = this.rules.mode === 'blind' ? blindRequiredStack(this.rules) : 1
    return this.seated().filter((p) => !p.sittingOut && !p.standAfterHand && !p.leaveAfterHand && p.stack >= required && (p.identity.isBot || this.status !== 'OPEN' || p.ready))
  }

  private playerView(p: RoomPlayer): RoomPlayerView {
    let status: SeatStatus | null = null
    if (p.seat !== null) {
      if (!p.connected) status = 'DISCONNECTED'
      else if (this.inCurrentHand(p)) status = 'IN_HAND'
      else if (p.sittingOut) status = 'SITTING_OUT'
      else status = p.ready ? 'READY' : 'SEATED'
    }
    const view: RoomPlayerView = {
      playerId: p.identity.playerId, displayName: p.identity.displayName, isBot: p.identity.isBot, isHost: p.identity.playerId === this.hostPlayerId,
      connected: p.connected, seat: p.seat, status, stack: p.stack, ready: p.ready,
    }
    if (p.cosmetics !== undefined) view.cosmetics = p.cosmetics
    return view
  }

  private async standUpNow(p: RoomPlayer): Promise<void> {
    if (p.seat === null) return
    const seat = p.seat
    if (this.rules.mode === 'holdem' && !p.identity.isBot && p.stack > 0) {
      await this.deps.repos.balances.apply([{ playerId: p.identity.playerId, delta: p.stack, reason: 'cash_out', refId: this.roomId }])
      await this.pushBalance(p.identity.playerId)
    }
    p.seat = null
    p.stack = 0
    p.ready = false
    p.standAfterHand = false
    p.consecutiveTimeouts = 0
    this.broadcastRoomEvent({ type: 'PLAYER_STOOD', playerId: p.identity.playerId, seat })
    this.changed()
  }

  private async removePlayer(p: RoomPlayer, reason: string): Promise<void> {
    await this.standUpNow(p)
    this.players.delete(p.identity.playerId)
    this.clearPlayerTimer(p.identity.playerId)
    this.broadcastRoomEvent({ type: 'PLAYER_LEFT', playerId: p.identity.playerId })
    if (p.identity.playerId === this.hostPlayerId) this.transferHost()
    if (this.humanCount === 0) this.scheduleClose()
    this.deps.log.info('player left room', { roomId: this.roomId, playerId: p.identity.playerId, reason })
    this.changed()
  }

  private transferHost(): void {
    const next = this.humans().filter((p) => !p.leaveAfterHand).sort((a, b) => a.joinedAt - b.joinedAt)[0]
    if (!next) return
    this.hostPlayerId = next.identity.playerId
    this.broadcastRoomEvent({ type: 'HOST_CHANGED', hostPlayerId: this.hostPlayerId })
  }

  private async pushBalance(playerId: string): Promise<void> {
    const p = this.players.get(playerId)
    if (!p || !p.connected) return
    try {
      const balance = await this.deps.repos.balances.get(playerId)
      if (this.rules.mode === 'blind' && p.seat !== null) p.stack = balance
      this.deps.outbox.send(playerId, { t: 'BALANCE', balance })
    } catch (err) {
      this.deps.log.warn('balance lookup failed', { playerId, err: String(err) })
    }
  }

  private broadcastRoomEvent(event: RoomEvent, excludePlayerId?: string): void {
    this.seq += 1
    for (const p of this.connectedHumans()) if (p.identity.playerId !== excludePlayerId) this.deps.outbox.send(p.identity.playerId, { t: 'ROOM_EVENT', seq: this.seq, event })
  }

  private changed(): void {
    this.onChanged?.(this)
  }

  private setPlayerTimer(playerId: string, ms: number, fn: () => void | Promise<void>): void {
    this.clearPlayerTimer(playerId)
    this.playerTimers.set(playerId, this.deps.clock.setTimeout(() => void this.enqueue(fn), ms))
  }

  private clearPlayerTimer(playerId: string): void {
    this.playerTimers.get(playerId)?.cancel()
    this.playerTimers.delete(playerId)
  }

  private scheduleClose(): void {
    this.cancelClose()
    this.closeTimer = this.deps.clock.setTimeout(() => void this.enqueue(() => { if (this.humanCount === 0) this.close('empty') }), this.deps.options.emptyRoomCloseMs)
  }

  private cancelClose(): void {
    this.closeTimer?.cancel()
    this.closeTimer = null
  }

  private cancelTimers(): void {
    this.cancelClose()
    this.nextHandTimer?.cancel()
    this.nextHandTimer = null
    for (const t of this.playerTimers.values()) t.cancel()
    this.playerTimers.clear()
    this.runner?.dispose()
  }
}
```

Note on `eligibleForHand`: the `ready` condition means: while `OPEN`, only ready humans join the first hand; once `IN_GAME`, every seated player joins the next hand automatically.

Append to `packages/server-kit/src/index.ts`:
```ts
export * from './room/room.js'
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint`
Expected: pass. Failure triage: `RoomError` codes in the tests are the contract; if the implementation throws a different code for the same situation, fix the implementation. The snapshot player order test depends on `Map` insertion order (host, bots, joiners) — keep `addPlayer` order as written.

- [ ] **Step 7: Commit**

```bash
git add packages/server-kit
git commit -m "feat(server-kit): Room actor with membership, seats, host, snapshot and hand lifecycle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: `Room` hand lifecycle tests (settlement, timers, disconnects, shutdown, money conservation)

**Files:**
- Create: `packages/server-kit/src/room/room-hands.test.ts`
- Modify (only if a test exposes a defect): `packages/server-kit/src/room/room.ts`, `packages/server-kit/src/room/hand-runner.ts`

**Interfaces:**
- Consumes: Task 4 `Room`, `createRoomHarness`, `ManualClock`.
- Produces: no new API. A test-only driver `playOut(h, policy)` inside the test file.

This task exists to prove the room's hand lifecycle against the spec before any network code is written. Every test below must pass; if one fails, fix `room.ts`/`hand-runner.ts` (never the invariant), and record the defect in the report.

- [ ] **Step 1: Write the tests**

`packages/server-kit/src/room/room-hands.test.ts`:
```ts
import type { LegalActions, PlayerAction, RoomConfig, ServerMessage } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, type RoomHarness } from '../testing/room-harness.js'
import { RoomError } from './types.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } }

type Policy = (playerId: string, legal: LegalActions) => PlayerAction
const passive: Policy = (_id, legal) => ({ kind: legal.kinds.includes('check') ? 'check' : legal.kinds.includes('call') ? 'call' : legal.kinds.includes('play') ? 'play' : 'fold' })
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? e.code : String(e)))
const tick = (h: RoomHarness) => h.room.enqueue(() => undefined)
const events = (h: RoomHarness, id: string) => h.ofType(id, 'GAME_EVENT').map((m) => m.event.type)

/** Drives the current hand to completion: humans follow `policy`, bots/reveals/timers run by advancing the clock. */
async function playOut(h: RoomHarness, policy: Policy = passive, opts: { humanTimeouts?: Set<string> } = {}): Promise<void> {
  let guard = 0
  while (h.room.handActive && guard++ < 300) {
    const hand = h.room.snapshot(null).hand!
    if (hand.phase === 'REVEAL') {
      h.clock.advance(10)
      await tick(h)
      continue
    }
    const humanSeat = hand.phase === 'DECISION'
      ? hand.seats.find((s) => !s.hasDecided && !s.isBot)
      : hand.seats.find((s) => s.seat === hand.actingSeat && !s.isBot)
    if (!humanSeat) {
      h.clock.advance(10) // bot delay
      await tick(h)
      continue
    }
    if (opts.humanTimeouts?.has(humanSeat.playerId)) {
      h.clock.advance(5_000)
      await tick(h)
      continue
    }
    const legal = h.room.snapshot(humanSeat.playerId).hand!.legal!
    await h.room.action(humanSeat.playerId, policy(humanSeat.playerId, legal), h.room.seq)
  }
  if (h.room.handActive) throw new Error('hand did not finish')
  await tick(h)
}

async function seatAndStart(h: RoomHarness, ids: string[], buyIn?: number): Promise<void> {
  for (const [i, id] of ids.entries()) {
    if (id !== h.room.hostPlayerId) await h.room.join(h.identity(id))
    await h.room.sitDown(id, i, buyIn)
    await h.room.setReady(id, true)
  }
  await h.room.startGame(h.room.hostPlayerId)
}

describe('Blind hands', () => {
  it('plays a full hand with bots, settles balances, records history and schedules the next hand', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    expect(h.room.status).toBe('IN_GAME')
    const first = h.ofType('h', 'GAME_EVENT')
    expect(first.map((m) => m.event.type).slice(0, 2)).toEqual(['HAND_STARTED', 'BLINDS_POSTED'])
    const dealt = first.filter((m) => m.event.type === 'CARDS_DEALT')
    expect(dealt.filter((m) => m.event.type === 'CARDS_DEALT' && m.event.cards.length === 2)).toHaveLength(1) // only my cards
    expect(dealt.every((m) => m.event.type === 'CARDS_DEALT' && m.event.cardCount === 2)).toBe(true)
    const phase = first.find((m) => m.event.type === 'DECISION_PHASE')!
    expect((phase.event as { deadlineAt?: number }).deadlineAt).toBe(h.clock.now() + 5_000)

    await playOut(h, (id, legal) => ({ kind: id === 'h' && legal.kinds.includes('play') ? 'play' : 'fold' }))

    expect(events(h, 'h').at(-1)).toBe('HAND_COMPLETE')
    expect(h.repos.hands).toHaveLength(1)
    const summary = h.repos.hands[0]!
    expect(summary.players).toHaveLength(4)
    expect(summary.players.reduce((s, p) => s + p.net, 0) + summary.fee).toBe(0) // money conservation
    const settled = h.repos.entries.filter((e) => e.entry.reason === 'settlement')
    expect(settled.map((e) => e.entry.playerId).sort()).toEqual(['a', 'h'])
    expect(settled[0]!.meta).toEqual({ refId: summary.handId, fee: summary.fee })
    expect(await h.repos.balances.get('a')).toBe(100_000 - 1_000) // folded: lost the ante
    expect(h.last('a', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 99_000 })
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'HAND_SETTLED', summary: { handId: summary.handId } })
    expect(h.room.nextHandAt).toBe(h.clock.now() + 100)
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: h.room.nextHandAt })

    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(events(h, 'h').filter((t) => t === 'HAND_STARTED')).toHaveLength(2)
  })

  it('carries the pot over when everyone folds and pays it out in a later hand', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    expect(h.room.view().carryOverPot).toBe(2_000)
    h.clock.advance(100)
    await tick(h)
    expect(h.room.snapshot(null).hand?.carryOverIn).toBe(2_000)
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    expect(h.room.carryOverPot).toBe(0)
    // hand 1: h −1000, a −1000 (both fold, 2000 carried). hand 2: antes 1000 each on top of the 2000 carry; h plays (+1000);
    // a folds → h's uncalled 1000 is returned; pot 4000, fee 80, h receives 3920 → h net +1920 overall, a −2000.
    expect(await h.repos.balances.get('h')).toBe(100_000 + 1_920)
    expect(await h.repos.balances.get('a')).toBe(100_000 - 2_000)
  })

  it('a human who cannot afford the wager sits out the hand', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'play' : 'fold' })) // poor plays and (whatever happens) ends with < 2000 or more
    // Force the situation: set poor's balance below the requirement, then let the next hand start without them.
    h.repos.records.get('poor')!.balance = 1_500
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot(null).hand!.seats.map((s) => s.playerId).sort()).toEqual(['bot:room-1:0', 'h'])
  })
})

describe('Hold’em hands', () => {
  it('two humans check down to showdown; only table stacks move', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await playOut(h)
    const stacks = [h.room.players.get('h')!.stack, h.room.players.get('a')!.stack]
    const fee = h.repos.hands[0]!.fee
    expect(stacks[0]! + stacks[1]! + fee).toBe(40_000)
    expect(fee).toBeGreaterThan(0)
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'buy_in']) // no settlement entries for hold'em
    expect(events(h, 'a')).toContain('SHOWDOWN')
  })

  it('rejects stale, out-of-turn, illegal and non-seated actions with the right codes', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await h.room.join(h.identity('b'))
    const hand = h.room.snapshot(null).hand!
    const acting = hand.seats.find((s) => s.seat === hand.actingSeat)!.playerId
    const other = acting === 'h' ? 'a' : 'h'
    expect(await code(h.room.action(acting, { kind: 'call' }, 0))).toBe('STALE_STATE')
    expect(await code(h.room.action(other, { kind: 'call' }, h.room.seq))).toBe('NOT_YOUR_TURN')
    expect(await code(h.room.action(acting, { kind: 'check' }, h.room.seq))).toBe('ILLEGAL_ACTION') // facing the big blind
    expect(await code(h.room.action(acting, { kind: 'raise', amount: 999_999 }, h.room.seq))).toBe('INVALID_AMOUNT')
    expect(await code(h.room.action('b', { kind: 'call' }, h.room.seq))).toBe('NOT_SEATED')
    await h.room.action(acting, { kind: 'call' }, h.room.seq)
    expect(h.last(other, 'GAME_EVENT')?.event.type).toBe('TURN_CHANGED')
  })

  it('three consecutive timeouts stand a player up after the hand; a lone seat returns the room to OPEN', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    let hands = 0
    while (h.room.players.get('h')!.seat !== null && hands++ < 6) {
      await playOut(h, passive, { humanTimeouts: new Set(['h']) })
      if (h.room.players.get('h')!.seat === null) break
      h.clock.advance(100)
      await tick(h)
    }
    expect(h.room.players.get('h')!.seat).toBeNull()
    expect(h.repos.entries.filter((e) => e.entry.reason === 'cash_out' && e.entry.playerId === 'h')).toHaveLength(1)
    expect(h.last('a', 'ROOM_EVENT')?.event.type).toBe('ROOM_STATUS')
    h.clock.advance(100)
    await tick(h)
    expect(h.room.status).toBe('OPEN') // only one seat left → back to OPEN, ready cleared
    expect(h.room.players.get('a')!.ready).toBe(false)
    expect(h.room.snapshot(null).room.status).toBe('OPEN')
  })

  it('a busted player is stood up and can re-buy', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'], 10_000)
    await playOut(h, (_id, legal) => ({ kind: legal.kinds.includes('allIn') ? 'allIn' : legal.kinds.includes('call') ? 'call' : 'check' }))
    const busted = [...h.room.players.values()].find((p) => p.stack === 0 && p.seat === null)
    expect(busted).toBeDefined() // one of them lost everything (if the seeded deck ties, change the harness seed)
    expect(await h.repos.balances.get(busted!.identity.playerId)).toBe(90_000)
    await h.room.sitDown(busted!.identity.playerId, 3, 10_000)
    expect(h.room.players.get(busted!.identity.playerId)!.seat).toBe(3)
  })
})

describe('Leaving, disconnecting, shutting down', () => {
  it('leaving mid-hand auto-folds, removes the player after the hand and transfers the host', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await h.room.leave('h')
    expect(h.room.hasPlayer('h')).toBe(true) // still in the hand until it ends
    await playOut(h) // h auto-folds when its turn comes → a wins
    expect(h.room.handActive).toBe(false)
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(h.room.hostPlayerId).toBe('a')
    expect(await h.repos.balances.get('h')).toBeLessThan(100_000) // lost a blind, cashed out the rest
    expect(h.repos.hands).toHaveLength(1)
  })

  it('disconnect: others are told, the player receives nothing, reconnect restores delivery; expiry stands up then removes', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    const before = h.ofType('a', 'GAME_EVENT').length
    await h.room.onDisconnect('a')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_DISCONNECTED', playerId: 'a', deadline: h.clock.now() + 1_000 })
    expect(h.room.snapshot(null).room.players.find((p) => p.playerId === 'a')?.status).toBe('DISCONNECTED')
    await h.room.action('h', { kind: 'play' }, h.room.seq)
    expect(h.ofType('a', 'GAME_EVENT').length).toBe(before) // nothing delivered while disconnected
    await h.room.onReconnect('a')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_RECONNECTED', playerId: 'a' })
    expect(h.room.snapshot('a').hand?.mySeat).toBe(1)

    await h.room.onDisconnect('a')
    h.clock.advance(1_000) // reconnect window → auto-fold + stand after hand
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.find((s) => s.seat === 1)?.hasDecided).toBe(true)
    await playOut(h)
    expect(h.room.players.get('a')!.seat).toBeNull()
    h.clock.advance(2_000) // spectator grace
    await tick(h)
    expect(h.room.hasPlayer('a')).toBe(false)
  })

  it('shutdown cancels the hand, refunds, cashes out and closes', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    const hand = h.room.snapshot(null).hand!
    const acting = hand.seats.find((s) => s.seat === hand.actingSeat)!.playerId
    await h.room.action(acting, { kind: 'raise', amount: 1_000 }, h.room.seq)
    let closed: string | null = null
    h.room.onClosed = (_r, reason) => { closed = reason }
    await h.room.shutdown('maintenance')
    expect(closed).toBe('maintenance')
    expect(h.room.status).toBe('CLOSED')
    expect(events(h, 'a')).toContain('HAND_CANCELLED')
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_CLOSED', reason: 'maintenance' })
    expect(await h.repos.balances.get('h')).toBe(100_000)
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.hands[0]!.cancelled).toBe(true)
  })

  it('shutdown splits a carried-over pot among seated humans', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' })) // both fold → 2000 carried
    expect(h.room.carryOverPot).toBe(2_000)
    await h.room.shutdown('restart')
    expect(await h.repos.balances.get('h')).toBe(100_000) // −1000 ante + 1000 refund
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.entries.filter((e) => e.entry.reason === 'refund')).toHaveLength(2)
  })
})

describe('Money conservation over many hands', () => {
  it('blind: Σ human balance changes + bot nets + fees = 0 across 12 hands with a mixed policy', async () => {
    const h = createRoomHarness(BLIND, { seed: 7 })
    await seatAndStart(h, ['h', 'a'])
    let n = 0
    const policy: Policy = (id, legal) => ({ kind: legal.kinds.includes('play') && (id === 'h' ? n % 3 !== 0 : n % 2 === 0) ? 'play' : 'fold' })
    while (n++ < 12) {
      await playOut(h, policy)
      h.clock.advance(100)
      await tick(h)
    }
    const totalFees = h.repos.hands.reduce((s, x) => s + x.fee, 0)
    const botNet = h.repos.hands.flatMap((x) => x.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
    const humanDelta = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a')) - 200_000
    expect(humanDelta + botNet + totalFees + h.room.carryOverPot).toBe(0)
    const seqs = h.ofType('h', 'GAME_EVENT').map((m) => m.seq)
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true)
  })
})
```

Regarding the "sits out" test: keep it simple and deterministic — replace its body with:
```ts
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 3_000]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' })) // poor loses the 1000 ante → 2000 left
    h.repos.records.get('poor')!.balance = 1_500 // e.g. spent elsewhere; below the 2000 requirement
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot(null).hand!.seats.map((s) => s.playerId).sort()).toEqual(['bot:room-1:0', 'h'])
    expect(h.room.players.get('poor')!.seat).toBe(1) // still seated, just not in this hand
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @bp/server-kit test -- room-hands`
Expected: mostly green on the first run. Known-likely defects to check if red: (a) `removePlayer` must be awaited (see Task 4 note); (b) in `onHandComplete`, the `standAfterHand` stand-up for a `leaveAfterHand` player must not run twice; (c) `playOut` needs `await tick(h)` after the last action so the enqueued `onHandComplete` finishes before assertions — it already does.

- [ ] **Step 3: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add packages/server-kit
git commit -m "test(server-kit): room hand lifecycle — settlement, timeouts, disconnects, shutdown, conservation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: `RoomManager`

**Files:**
- Create: `packages/server-kit/src/room/room-manager.ts`, `packages/server-kit/src/room/room-manager.test.ts`
- Modify: `packages/server-kit/src/index.ts`

**Interfaces:**
- Consumes: Task 4 `Room`, Task 2 `newId`, `newRoomCode`.
- Produces (exact):
  ```ts
  export class RoomManager {
    constructor(deps: RoomDeps)
    create(host: PlayerIdentity, config: RoomConfig): Room        // throws RoomError('ALREADY_IN_ROOM') if host is in a room
    get(roomId: string): Room | undefined
    getByCode(code: string): Room | undefined                     // case-insensitive
    roomOf(playerId: string): Room | undefined
    listPublic(): RoomSummary[]                                   // !isPrivate, not CLOSED, newest first
    all(): Room[]
    onListChanged(fn: () => void): () => void                     // returns unsubscribe
    shutdown(reason: string): Promise<void>
    readonly size: number
  }
  ```

- [ ] **Step 1: Write failing tests**

`packages/server-kit/src/room/room-manager.test.ts`:
```ts
import { createBotStrategy, seededRng, type RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../domain-events.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories } from '../memory-repositories.js'
import { ManualClock } from '../testing/manual-clock.js'
import { TEST_ROOM_OPTIONS } from '../testing/room-harness.js'
import { RoomManager } from './room-manager.js'
import { RoomError } from './types.js'

const PUBLIC: RoomConfig = { name: 'Pub', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const PRIVATE: RoomConfig = { ...PUBLIC, name: 'Priv', isPrivate: true }
const id = (playerId: string) => ({ playerId, displayName: playerId, isBot: false })

function setup() {
  const clock = new ManualClock()
  const repos = createMemoryRepositories()
  for (const p of ['h', 'a', 'b']) repos.addPlayer(p, p, 100_000)
  const domainEvents: DomainEvent[] = []
  const manager = new RoomManager({ clock, rng: seededRng(1), repos, outbox: { send: () => {} }, bot: createBotStrategy(), log: silentLogger, options: TEST_ROOM_OPTIONS, onDomainEvent: (e) => domainEvents.push(e) })
  return { clock, repos, manager, domainEvents }
}

describe('RoomManager', () => {
  it('creates rooms with unique codes, lists public ones newest first, finds by id/code/player', () => {
    const { manager, domainEvents } = setup()
    const r1 = manager.create(id('h'), PUBLIC)
    const r2 = manager.create(id('a'), PRIVATE)
    const r3 = manager.create(id('b'), { ...PUBLIC, name: 'Pub2' })
    expect(r1.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(new Set([r1.code, r2.code, r3.code]).size).toBe(3)
    expect(manager.listPublic().map((s) => s.name)).toEqual(['Pub2', 'Pub'])
    expect(manager.get(r2.roomId)).toBe(r2)
    expect(manager.getByCode(r1.code.toLowerCase())).toBe(r1)
    expect(manager.roomOf('a')).toBe(r2)
    expect(manager.roomOf('zzz')).toBeUndefined()
    expect(manager.size).toBe(3)
    expect(domainEvents.filter((e) => e.type === 'ROOM_CREATED')).toHaveLength(3)
  })

  it('refuses a second room for a player already in one', () => {
    const { manager } = setup()
    manager.create(id('h'), PUBLIC)
    expect(() => manager.create(id('h'), PUBLIC)).toThrow(RoomError)
  })

  it('notifies list subscribers on create, change and close, and drops closed rooms', async () => {
    const { manager, clock } = setup()
    let notified = 0
    const off = manager.onListChanged(() => notified++)
    const room = manager.create(id('h'), PUBLIC)
    expect(notified).toBe(1)
    await room.join(id('a'))
    expect(notified).toBeGreaterThanOrEqual(2)
    await room.leave('a')
    await room.leave('h')
    clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await room.enqueue(() => undefined)
    expect(manager.get(room.roomId)).toBeUndefined()
    expect(manager.getByCode(room.code)).toBeUndefined()
    expect(manager.listPublic()).toEqual([])
    const before = notified
    off()
    manager.create(id('b'), PUBLIC)
    expect(notified).toBe(before)
  })

  it('shutdown closes every room', async () => {
    const { manager } = setup()
    const r1 = manager.create(id('h'), PUBLIC)
    const r2 = manager.create(id('a'), PRIVATE)
    await manager.shutdown('bye')
    expect(r1.status).toBe('CLOSED')
    expect(r2.status).toBe('CLOSED')
    expect(manager.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/server-kit test -- room-manager`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/server-kit/src/room/room-manager.ts`:
```ts
import type { PlayerIdentity, RoomConfig, RoomSummary } from '@bp/core'
import { newId, newRoomCode } from '../infra/ids.js'
import { Room } from './room.js'
import { RoomError, type RoomDeps } from './types.js'

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly byCode = new Map<string, Room>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: RoomDeps) {}

  get size(): number {
    return this.rooms.size
  }

  create(host: PlayerIdentity, config: RoomConfig): Room {
    if (this.roomOf(host.playerId)) throw new RoomError('ALREADY_IN_ROOM')
    const roomId = newId()
    const code = newRoomCode((c) => this.byCode.has(c))
    const room = new Room({ roomId, code, config, host, deps: this.deps })
    room.onClosed = (r, reason) => {
      this.rooms.delete(r.roomId)
      this.byCode.delete(r.code)
      this.deps.log.info('room closed', { roomId: r.roomId, reason })
      this.notify()
    }
    room.onChanged = () => this.notify()
    this.rooms.set(roomId, room)
    this.byCode.set(code, room)
    this.deps.log.info('room created', { roomId, code, hostPlayerId: host.playerId, mode: config.mode })
    this.deps.onDomainEvent?.({ type: 'ROOM_CREATED', roomId, hostPlayerId: host.playerId, config })
    this.notify()
    return room
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getByCode(code: string): Room | undefined {
    return this.byCode.get(code.toUpperCase())
  }

  roomOf(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) if (room.hasPlayer(playerId)) return room
    return undefined
  }

  listPublic(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.config.isPrivate && r.status !== 'CLOSED').reverse().map((r) => r.summary())
  }

  all(): Room[] {
    return [...this.rooms.values()]
  }

  onListChanged(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async shutdown(reason: string): Promise<void> {
    await Promise.all([...this.rooms.values()].map((r) => r.shutdown(reason)))
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
```

Append to `packages/server-kit/src/index.ts`: `export * from './room/room-manager.js'`

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint`

```bash
git add packages/server-kit
git commit -m "feat(server-kit): RoomManager with codes, lookup, public listing and change notifications

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: WebSocket gateway — rate limit, connection, auth, routing, heartbeat

**Files:**
- Create: `packages/server-kit/src/gateway/rate-limit.ts`, `packages/server-kit/src/gateway/rate-limit.test.ts`, `packages/server-kit/src/gateway/connection.ts`, `packages/server-kit/src/gateway/gateway.ts`
- Modify: `packages/server-kit/src/index.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6; `ws` (`WebSocketServer`, `WebSocket`).
- Produces (exact):
  ```ts
  // gateway/rate-limit.ts
  export class TokenBucket { constructor(capacity: number, refillPerSecond: number, clock: Clock); tryTake(): boolean }
  // gateway/connection.ts
  export class ClientConnection {
    constructor(id: string, socket: WebSocket, bucket: TokenBucket, now: number)
    readonly id: string
    identity: PlayerIdentity | null
    inLobby: boolean
    replaced: boolean
    lastPongAt: number
    invalidMessages: number
    helloTimer: TimerHandle | null
    send(msg: ServerMessage): void
    tryTake(): boolean
    seenReqId(reqId: string): boolean      // remembers the last 32
    enqueue<T>(fn: () => T | Promise<T>): Promise<T>   // serializes this connection's dispatches
    close(code: number, reason: string): void
    terminate(): void
    readonly isOpen: boolean
  }
  // gateway/gateway.ts
  export interface GatewayOptions { heartbeatIntervalMs: number; heartbeatTimeoutMs: number; rateLimitPerSec: number; rateLimitBurst: number; maxPayloadBytes: number; helloTimeoutMs: number; allowedOrigins: string[] | null; maxInvalidMessages: number }
  export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions   // 15000, 30000, 20, 20, 4096, 5000, null, 3
  export interface GatewayDeps { clock: Clock; rooms: RoomManager; resolver: SessionResolver; repos: Repositories; log: Logger; options: GatewayOptions }
  export class Gateway {
    constructor(deps: GatewayDeps)
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
    outbox: Outbox                                   // send(playerId, msg) to the bound connection, if any
    readonly connectionCount: number
    closeAll(code: number, reason: string, message?: ServerMessage): Promise<void>
    dispose(): void                                  // stops the heartbeat loop
  }
  ```

Behaviour (spec §16.2, §16.4–16.5, §20, §23):
- Upgrade: reject with HTTP 403 when `allowedOrigins` is set and the `Origin` header is absent or not listed; call `resolver.fromUpgrade` if present — identity → bind immediately; otherwise (or if it returns `null`) accept the socket only if `resolver.fromToken` exists and wait for `HELLO` within `helloTimeoutMs` (close 4001 otherwise).
- Bind: replace an existing connection for the same `playerId` (`SESSION_REPLACED` + close 4000 on the old one, marked `replaced` so its close does not count as a disconnect); send `WELCOME{playerId, displayName, balance, serverTime}`; if the player is in a room (`rooms.roomOf`), call `room.onReconnect` and send `room.snapshot(playerId)`.
- Message pipeline: token bucket → JSON parse → `parseClientMessage` → `ERROR{INVALID_MESSAGE}` and close 4002 after `maxInvalidMessages` bad messages → `HELLO` handling → require identity (`UNAUTHENTICATED`) → `PONG` updates `lastPongAt` → `reqId` seen before → `ACK` only → dispatch → `ACK{reqId}` when a `reqId` was given → `RoomError` → `ERROR{reqId, code, message}`; unexpected errors → `ERROR{INTERNAL}` + log.
- Dispatch: `LIST_ROOMS` (subscribe to lobby, send `ROOM_LIST`), `CREATE_ROOM`/`JOIN_ROOM` (refuse `ALREADY_IN_ROOM` via `rooms.roomOf`; on success leave the lobby and send the snapshot), `LEAVE_ROOM`, `SIT_DOWN`, `STAND_UP`, `READY`, `START_GAME`, `KICK`, `ACTION`, `RESYNC` (snapshot). Room-scoped messages resolve the room with `rooms.roomOf(playerId)` (`NOT_IN_ROOM` if none).
- Lobby: `rooms.onListChanged` → send `ROOM_LIST` to every lobby subscriber.
- Heartbeat: a single loop every `heartbeatIntervalMs` — terminate sockets whose `lastPongAt` is older than `heartbeatTimeoutMs`, otherwise send `PING`.
- Close: unbound → forget; bound and not replaced → remove from the map and `room.onDisconnect(playerId)` if in a room.

- [ ] **Step 1: Write the rate-limit test**

`packages/server-kit/src/gateway/rate-limit.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ManualClock } from '../testing/manual-clock.js'
import { TokenBucket } from './rate-limit.js'

describe('TokenBucket', () => {
  it('allows a burst, then refills at the configured rate', () => {
    const clock = new ManualClock()
    const bucket = new TokenBucket(3, 2, clock)
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false])
    clock.advance(500) // +1 token
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)
    clock.advance(10_000) // caps at capacity
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false])
  })
})
```

- [ ] **Step 2: Implement rate limit and connection**

`packages/server-kit/src/gateway/rate-limit.ts`:
```ts
import type { Clock } from '../infra/clock.js'

export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
  ) {
    this.tokens = capacity
    this.last = clock.now()
  }

  tryTake(): boolean {
    const now = this.clock.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond)
    this.last = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}
```

`packages/server-kit/src/gateway/connection.ts`:
```ts
import type { PlayerIdentity, ServerMessage } from '@bp/core'
import { WebSocket } from 'ws'
import type { TimerHandle } from '../infra/clock.js'
import type { TokenBucket } from './rate-limit.js'

const REQ_ID_MEMORY = 32

export class ClientConnection {
  identity: PlayerIdentity | null = null
  inLobby = false
  replaced = false
  lastPongAt: number
  invalidMessages = 0
  helloTimer: TimerHandle | null = null
  private readonly recentReqIds: string[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly id: string,
    private readonly socket: WebSocket,
    private readonly bucket: TokenBucket,
    now: number,
  ) {
    this.lastPongAt = now
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  send(msg: ServerMessage): void {
    if (this.isOpen) this.socket.send(JSON.stringify(msg))
  }

  tryTake(): boolean {
    return this.bucket.tryTake()
  }

  /** Messages from one connection are handled strictly in arrival order. */
  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  seenReqId(reqId: string): boolean {
    if (this.recentReqIds.includes(reqId)) return true
    this.recentReqIds.push(reqId)
    if (this.recentReqIds.length > REQ_ID_MEMORY) this.recentReqIds.shift()
    return false
  }

  close(code: number, reason: string): void {
    this.helloTimer?.cancel()
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(code, reason)
  }

  terminate(): void {
    this.helloTimer?.cancel()
    this.socket.terminate()
  }
}
```

- [ ] **Step 3: Implement the gateway**

`packages/server-kit/src/gateway/gateway.ts`:
```ts
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { parseClientMessage, type ClientMessage, type ErrorCode, type PlayerIdentity, type ServerMessage } from '@bp/core'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Clock, TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import type { Logger } from '../infra/logger.js'
import type { Repositories, SessionResolver } from '../repositories.js'
import type { RoomManager } from '../room/room-manager.js'
import { RoomError, type Outbox } from '../room/types.js'
import { ClientConnection } from './connection.js'
import { TokenBucket } from './rate-limit.js'

export interface GatewayOptions {
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  rateLimitPerSec: number
  rateLimitBurst: number
  maxPayloadBytes: number
  helloTimeoutMs: number
  allowedOrigins: string[] | null
  maxInvalidMessages: number
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 30_000,
  rateLimitPerSec: 20,
  rateLimitBurst: 20,
  maxPayloadBytes: 4_096,
  helloTimeoutMs: 5_000,
  allowedOrigins: null,
  maxInvalidMessages: 3,
}

export interface GatewayDeps {
  clock: Clock
  rooms: RoomManager
  resolver: SessionResolver
  repos: Repositories
  log: Logger
  options: GatewayOptions
}

export class Gateway {
  private readonly wss: WebSocketServer
  private readonly bound = new Map<string, ClientConnection>()
  private readonly all = new Set<ClientConnection>()
  private heartbeat: TimerHandle | null = null
  private readonly unsubscribeList: () => void
  readonly outbox: Outbox

  constructor(private readonly deps: GatewayDeps) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: deps.options.maxPayloadBytes })
    this.outbox = { send: (playerId, msg) => this.bound.get(playerId)?.send(msg) }
    this.unsubscribeList = deps.rooms.onListChanged(() => this.broadcastRoomList())
    this.scheduleHeartbeat()
  }

  get connectionCount(): number {
    return this.all.size
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    void (async () => {
      let identity: PlayerIdentity | null = null
      try {
        identity = this.deps.resolver.fromUpgrade ? await this.deps.resolver.fromUpgrade(req) : null
      } catch (err) {
        this.deps.log.warn('fromUpgrade failed', { err: String(err) })
      }
      if (!identity && !this.deps.resolver.fromToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, identity))
    })()
  }

  async closeAll(code: number, reason: string, message?: ServerMessage): Promise<void> {
    for (const conn of this.all) {
      if (message) conn.send(message)
      conn.close(code, reason)
    }
    this.dispose()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  dispose(): void {
    this.heartbeat?.cancel()
    this.heartbeat = null
    this.unsubscribeList()
  }

  // ---------- connection lifecycle ----------

  private onConnection(ws: WebSocket, identity: PlayerIdentity | null): void {
    const conn = new ClientConnection(newId(), ws, new TokenBucket(this.deps.options.rateLimitBurst, this.deps.options.rateLimitPerSec, this.deps.clock), this.deps.clock.now())
    this.all.add(conn)
    ws.on('message', (data) => this.onMessage(conn, data))
    ws.on('close', () => this.onClose(conn))
    ws.on('error', (err) => this.deps.log.warn('socket error', { conn: conn.id, err: String(err) }))
    if (identity) void this.bind(conn, identity)
    else conn.helloTimer = this.deps.clock.setTimeout(() => { if (!conn.identity) conn.close(4001, 'HELLO timeout') }, this.deps.options.helloTimeoutMs)
  }

  private async bind(conn: ClientConnection, identity: PlayerIdentity): Promise<void> {
    conn.helloTimer?.cancel()
    conn.helloTimer = null
    conn.identity = identity
    const old = this.bound.get(identity.playerId)
    if (old && old !== conn) {
      old.replaced = true
      old.send({ t: 'SESSION_REPLACED' })
      old.close(4000, 'replaced')
      this.all.delete(old)
    }
    this.bound.set(identity.playerId, conn)
    let balance = 0
    try {
      balance = await this.deps.repos.balances.get(identity.playerId)
    } catch (err) {
      this.deps.log.warn('balance lookup failed at bind', { playerId: identity.playerId, err: String(err) })
    }
    conn.send({ t: 'WELCOME', playerId: identity.playerId, displayName: identity.displayName, balance, serverTime: this.deps.clock.now() })
    const room = this.deps.rooms.roomOf(identity.playerId)
    if (room) {
      await room.onReconnect(identity.playerId)
      conn.send(room.snapshot(identity.playerId))
    }
  }

  private onClose(conn: ClientConnection): void {
    conn.helloTimer?.cancel()
    this.all.delete(conn)
    const playerId = conn.identity?.playerId
    if (!playerId || conn.replaced || this.bound.get(playerId) !== conn) return
    this.bound.delete(playerId)
    const room = this.deps.rooms.roomOf(playerId)
    if (room) void room.onDisconnect(playerId)
  }

  // ---------- messages ----------

  private onMessage(conn: ClientConnection, data: unknown): void {
    if (!conn.tryTake()) {
      conn.send({ t: 'ERROR', code: 'RATE_LIMITED', message: 'too many messages' })
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(String(data))
    } catch {
      this.invalid(conn, undefined, 'INVALID_MESSAGE', 'invalid JSON')
      return
    }
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      const reqId = typeof (raw as { reqId?: unknown })?.reqId === 'string' ? (raw as { reqId: string }).reqId : undefined
      this.invalid(conn, reqId, parsed.code, parsed.message)
      return
    }
    void conn.enqueue(() => this.dispatch(conn, parsed.value))
  }

  private invalid(conn: ClientConnection, reqId: string | undefined, code: ErrorCode, message: string): void {
    conn.invalidMessages += 1
    conn.send(reqId === undefined ? { t: 'ERROR', code, message } : { t: 'ERROR', reqId, code, message })
    if (conn.invalidMessages >= this.deps.options.maxInvalidMessages) conn.close(4002, 'too many invalid messages')
  }

  private async dispatch(conn: ClientConnection, msg: ClientMessage): Promise<void> {
    const reqId = msg.reqId
    const ack = () => { if (reqId !== undefined) conn.send({ t: 'ACK', reqId }) }
    try {
      if (msg.t === 'HELLO') {
        if (conn.identity) return ack()
        const identity = this.deps.resolver.fromToken ? await this.deps.resolver.fromToken(msg.sessionToken) : null
        if (!identity) {
          conn.send({ t: 'ERROR', code: 'UNAUTHENTICATED', message: 'invalid session' })
          conn.close(4001, 'unauthenticated')
          return
        }
        await this.bind(conn, identity)
        return ack()
      }
      const identity = conn.identity
      if (!identity) {
        conn.send({ t: 'ERROR', code: 'UNAUTHENTICATED', message: 'send HELLO first' })
        return
      }
      if (msg.t === 'PONG') {
        conn.lastPongAt = this.deps.clock.now()
        return
      }
      if (reqId !== undefined && conn.seenReqId(reqId)) return ack()
      const playerId = identity.playerId
      switch (msg.t) {
        case 'LIST_ROOMS':
          conn.inLobby = true
          conn.send({ t: 'ROOM_LIST', rooms: this.deps.rooms.listPublic() })
          break
        case 'CREATE_ROOM': {
          if (this.deps.rooms.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM')
          const room = this.deps.rooms.create(identity, msg.config)
          conn.inLobby = false
          conn.send(room.snapshot(playerId))
          break
        }
        case 'JOIN_ROOM': {
          if (this.deps.rooms.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM')
          const room = msg.roomId !== undefined ? this.deps.rooms.get(msg.roomId) : msg.code !== undefined ? this.deps.rooms.getByCode(msg.code) : undefined
          if (!room) throw new RoomError('ROOM_NOT_FOUND')
          await room.join(identity, msg.password)
          conn.inLobby = false
          conn.send(room.snapshot(playerId))
          break
        }
        case 'LEAVE_ROOM':
          await this.roomOf(playerId).leave(playerId)
          break
        case 'SIT_DOWN':
          await this.roomOf(playerId).sitDown(playerId, msg.seat, msg.buyIn)
          break
        case 'STAND_UP':
          await this.roomOf(playerId).standUp(playerId)
          break
        case 'READY':
          await this.roomOf(playerId).setReady(playerId, msg.ready)
          break
        case 'START_GAME':
          await this.roomOf(playerId).startGame(playerId)
          break
        case 'KICK':
          await this.roomOf(playerId).kick(playerId, msg.playerId)
          break
        case 'ACTION':
          await this.roomOf(playerId).action(playerId, msg.action, msg.baseSeq)
          break
        case 'RESYNC':
          conn.send(this.roomOf(playerId).snapshot(playerId))
          break
      }
      ack()
    } catch (err) {
      if (err instanceof RoomError) {
        conn.send(reqId === undefined ? { t: 'ERROR', code: err.code, message: err.message } : { t: 'ERROR', reqId, code: err.code, message: err.message })
        return
      }
      this.deps.log.error('dispatch failed', { conn: conn.id, type: msg.t, err: err instanceof Error ? err.stack ?? err.message : String(err) })
      conn.send(reqId === undefined ? { t: 'ERROR', code: 'INTERNAL', message: 'internal error' } : { t: 'ERROR', reqId, code: 'INTERNAL', message: 'internal error' })
    }
  }

  private roomOf(playerId: string) {
    const room = this.deps.rooms.roomOf(playerId)
    if (!room) throw new RoomError('NOT_IN_ROOM')
    return room
  }

  // ---------- lobby / heartbeat / origin ----------

  private broadcastRoomList(): void {
    const rooms = this.deps.rooms.listPublic()
    for (const conn of this.all) if (conn.inLobby && conn.identity) conn.send({ t: 'ROOM_LIST', rooms })
  }

  private scheduleHeartbeat(): void {
    this.heartbeat = this.deps.clock.setTimeout(() => {
      const now = this.deps.clock.now()
      for (const conn of this.all) {
        if (now - conn.lastPongAt > this.deps.options.heartbeatTimeoutMs) {
          this.deps.log.info('heartbeat timeout', { conn: conn.id, playerId: conn.identity?.playerId })
          conn.terminate()
        } else conn.send({ t: 'PING' })
      }
      this.scheduleHeartbeat()
    }, this.deps.options.heartbeatIntervalMs)
  }

  private originAllowed(req: IncomingMessage): boolean {
    const allowed = this.deps.options.allowedOrigins
    if (allowed === null) return true
    const origin = req.headers.origin
    return typeof origin === 'string' && allowed.includes(origin)
  }
}
```

Append to `packages/server-kit/src/index.ts`:
```ts
export * from './gateway/rate-limit.js'
export * from './gateway/connection.js'
export * from './gateway/gateway.js'
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint`
Expected: rate-limit test passes; the gateway compiles (its behaviour is exercised end-to-end in Task 8).

```bash
git add packages/server-kit
git commit -m "feat(server-kit): WebSocket gateway with auth hook, routing, heartbeat, rate limit and reqId dedupe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: `createGameServer`, test harness, `TestClient`, WebSocket integration tests

**Files:**
- Create: `packages/server-kit/src/server.ts`, `packages/server-kit/src/testing/harness.ts`, `packages/server-kit/src/testing/test-client.ts`, `packages/server-kit/src/gateway/gateway.test.ts`
- Modify: `packages/server-kit/src/index.ts`, `packages/server-kit/src/testing/index.ts`

**Interfaces:**
- Produces (exact):
  ```ts
  // server.ts
  export interface GameServerOptions { repos: Repositories; resolver: SessionResolver; clock?: Clock; rng?: Rng; log?: Logger; bot?: BotStrategy; roomOptions?: Partial<RoomOptions>; gatewayOptions?: Partial<GatewayOptions>; onDomainEvent?: (e: DomainEvent) => void }
  export interface GameServer { rooms: RoomManager; gateway: Gateway; handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void; shutdown(reason?: string): Promise<void>; readonly connectionCount: number }
  export function createGameServer(options: GameServerOptions): GameServer
  // testing/harness.ts
  export interface TestServer { url: string; repos: MemoryRepositories; server: GameServer; domainEvents: DomainEvent[]; close(): Promise<void> }
  export async function startTestServer(opts?: { players?: [id: string, balance: number][]; roomOptions?: Partial<RoomOptions>; gatewayOptions?: Partial<GatewayOptions> }): Promise<TestServer>
  // token convention for the test resolver: sessionToken `tok:<playerId>` resolves to that player when it exists in the repos
  // testing/test-client.ts
  export class TestClient {
    static connect(url: string, headers?: Record<string, string>): Promise<TestClient>
    readonly received: ServerMessage[]
    readonly closed: Promise<{ code: number; reason: string }>
    readonly isOpen: boolean
    send(msg: object): void
    hello(token: string): Promise<Extract<ServerMessage, { t: 'WELCOME' }>>
    next<T extends ServerMessage['t']>(t: T, pred?: (m: Extract<ServerMessage, { t: T }>) => boolean, timeoutMs?: number): Promise<Extract<ServerMessage, { t: T }>>
    request(msg: object & { reqId: string }): Promise<Extract<ServerMessage, { t: 'ACK' | 'ERROR' }>>
    drain<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[]   // remove & return all buffered of type
    close(): Promise<void>
  }
  ```
  `next()` first consumes a matching message from the unconsumed buffer; otherwise it waits for the next matching message (default timeout 3000 ms → rejects with the type it waited for and the last five buffered types, to make failures readable).

- [ ] **Step 1: Implement `server.ts`**

`packages/server-kit/src/server.ts`:
```ts
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createBotStrategy, type BotStrategy, type Rng } from '@bp/core'
import type { DomainEvent } from './domain-events.js'
import { DEFAULT_GATEWAY_OPTIONS, Gateway, type GatewayOptions } from './gateway/gateway.js'
import { realClock, type Clock } from './infra/clock.js'
import { consoleLogger, type Logger } from './infra/logger.js'
import { cryptoRng } from './infra/rng.js'
import type { Repositories, SessionResolver } from './repositories.js'
import { RoomManager } from './room/room-manager.js'
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from './room/types.js'

export interface GameServerOptions {
  repos: Repositories
  resolver: SessionResolver
  clock?: Clock
  rng?: Rng
  log?: Logger
  bot?: BotStrategy
  roomOptions?: Partial<RoomOptions>
  gatewayOptions?: Partial<GatewayOptions>
  onDomainEvent?: (e: DomainEvent) => void
}

export interface GameServer {
  rooms: RoomManager
  gateway: Gateway
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  shutdown(reason?: string): Promise<void>
  readonly connectionCount: number
}

export function createGameServer(options: GameServerOptions): GameServer {
  const clock = options.clock ?? realClock
  const log = options.log ?? consoleLogger
  let gateway: Gateway | null = null
  const rooms = new RoomManager({
    clock,
    rng: options.rng ?? cryptoRng,
    repos: options.repos,
    outbox: { send: (playerId, msg) => gateway?.outbox.send(playerId, msg) },
    bot: options.bot ?? createBotStrategy(),
    log,
    options: { ...DEFAULT_ROOM_OPTIONS, ...options.roomOptions },
    ...(options.onDomainEvent ? { onDomainEvent: options.onDomainEvent } : {}),
  })
  gateway = new Gateway({ clock, rooms, resolver: options.resolver, repos: options.repos, log, options: { ...DEFAULT_GATEWAY_OPTIONS, ...options.gatewayOptions } })
  const gw = gateway
  return {
    rooms,
    gateway: gw,
    handleUpgrade: (req, socket, head) => gw.handleUpgrade(req, socket, head),
    get connectionCount() {
      return gw.connectionCount
    },
    async shutdown(reason = 'server shutdown') {
      log.info('shutting down', { reason, rooms: rooms.size, connections: gw.connectionCount })
      await rooms.shutdown(reason)
      await gw.closeAll(1001, reason, { t: 'ERROR', code: 'SERVER_SHUTDOWN', message: reason })
    },
  }
}
```

Append to `packages/server-kit/src/index.ts`: `export * from './server.js'`

- [ ] **Step 2: Implement the harness and client**

`packages/server-kit/src/testing/harness.ts`:
```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { seededRng } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import type { GatewayOptions } from '../gateway/gateway.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories, type MemoryRepositories } from '../memory-repositories.js'
import type { RoomOptions } from '../room/types.js'
import { createGameServer, type GameServer } from '../server.js'

export interface TestServer {
  url: string
  repos: MemoryRepositories
  server: GameServer
  http: Server
  domainEvents: DomainEvent[]
  close(): Promise<void>
}

export const TEST_SERVER_ROOM_OPTIONS: Partial<RoomOptions> = {
  handIntervalMs: 50,
  revealDelayMs: 5,
  botDelayMs: [5, 5],
  reconnectWindowMs: 300,
  spectatorGraceMs: 300,
  emptyRoomCloseMs: 200,
  turnTimerMsOverride: 2_000,
}

export async function startTestServer(opts: { players?: [id: string, balance: number][]; roomOptions?: Partial<RoomOptions>; gatewayOptions?: Partial<GatewayOptions>; seed?: number } = {}): Promise<TestServer> {
  const repos = createMemoryRepositories()
  for (const [id, balance] of opts.players ?? [['a', 100_000], ['b', 100_000], ['c', 100_000]]) repos.addPlayer(id, id.toUpperCase(), balance)
  const domainEvents: DomainEvent[] = []
  const server = createGameServer({
    repos,
    resolver: {
      async fromToken(token) {
        const id = token.startsWith('tok:') ? token.slice(4) : ''
        const rec = await repos.players.findById(id)
        return rec ? { playerId: rec.playerId, displayName: rec.displayName, isBot: false } : null
      },
    },
    rng: seededRng(opts.seed ?? 42),
    log: silentLogger,
    roomOptions: { ...TEST_SERVER_ROOM_OPTIONS, ...opts.roomOptions },
    gatewayOptions: { heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 120_000, ...opts.gatewayOptions },
    onDomainEvent: (e) => domainEvents.push(e),
  })
  const http = createServer((_req, res) => { res.statusCode = 404; res.end() })
  http.on('upgrade', (req, socket, head) => server.handleUpgrade(req, socket, head))
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    repos,
    server,
    http,
    domainEvents,
    async close() {
      await server.shutdown('test end')
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
```

`packages/server-kit/src/testing/test-client.ts`:
```ts
import type { ServerMessage } from '@bp/core'
import { WebSocket } from 'ws'

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>
interface Waiter { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }

export class TestClient {
  readonly received: ServerMessage[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private readonly buffer: ServerMessage[] = []
  private readonly waiters: Waiter[] = []

  private constructor(private readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })))
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage
      this.received.push(msg)
      if (msg.t === 'PING') this.ws.send(JSON.stringify({ t: 'PONG' }))
      const idx = this.waiters.findIndex((w) => w.match(msg))
      if (idx >= 0) this.waiters.splice(idx, 1)[0]!.resolve(msg)
      else this.buffer.push(msg)
    })
  }

  static connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers })
      ws.once('open', () => resolve(new TestClient(ws)))
      ws.once('error', reject)
      ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response ${res.statusCode}`)))
    })
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg))
  }

  async hello(token: string): Promise<Msg<'WELCOME'>> {
    this.send({ t: 'HELLO', sessionToken: token })
    return this.next('WELCOME')
  }

  next<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, timeoutMs = 3000): Promise<Msg<T>> {
    const match = (m: ServerMessage): m is Msg<T> => m.t === t && pred(m as Msg<T>)
    const idx = this.buffer.findIndex(match)
    if (idx >= 0) return Promise.resolve(this.buffer.splice(idx, 1)[0] as Msg<T>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === done)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error(`timed out waiting for ${t}; buffered: ${this.buffer.slice(-5).map((m) => m.t).join(', ') || 'none'}`))
      }, timeoutMs)
      const done = (m: ServerMessage) => { clearTimeout(timer); resolve(m as Msg<T>) }
      this.waiters.push({ match, resolve: done })
    })
  }

  async request(msg: object & { reqId: string }): Promise<Msg<'ACK'> | Msg<'ERROR'>> {
    this.send(msg)
    return Promise.race([
      this.next('ACK', (m) => m.reqId === msg.reqId),
      this.next('ERROR', (m) => m.reqId === msg.reqId),
    ])
  }

  drain<T extends ServerMessage['t']>(t: T): Msg<T>[] {
    const out = this.buffer.filter((m): m is Msg<T> => m.t === t)
    for (const m of out) this.buffer.splice(this.buffer.indexOf(m), 1)
    return out
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(1000, 'bye')
    await this.closed
  }
}
```

`request()` note: the losing `next()` in `Promise.race` keeps a waiter registered; it will be dropped by its own timeout. To avoid a stray 3 s timer keeping the loop alive, implement `request` as a single waiter instead: register one waiter whose `match` is `m => (m.t === 'ACK' || m.t === 'ERROR') && m.reqId === msg.reqId` using a private `nextMatching(match, timeoutMs)` helper that both `next` and `request` call. Do that.

`packages/server-kit/src/testing/index.ts`:
```ts
export * from './manual-clock.js'
export * from './room-harness.js'
export * from './harness.js'
export * from './test-client.js'
```

- [ ] **Step 3: Write the integration tests**

`packages/server-kit/src/gateway/gateway.test.ts`:
```ts
import type { RoomConfig } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from '../testing/harness.js'
import { TestClient } from '../testing/test-client.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND_BOT: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 3, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 1 } }

let ts: TestServer
const clients: TestClient[] = []
const connect = async (id: string) => {
  const c = await TestClient.connect(ts.url)
  clients.push(c)
  await c.hello(`tok:${id}`)
  return c
}
let n = 0
const rid = () => `r${n++}`
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await ts?.close()
})

async function seatTwo(a: TestClient, b: TestClient, config = HOLDEM, buyIn: number | undefined = 20_000) {
  a.send({ t: 'CREATE_ROOM', config })
  const snap = await a.next('ROOM_SNAPSHOT')
  b.send({ t: 'JOIN_ROOM', code: snap.room.code })
  await b.next('ROOM_SNAPSHOT')
  await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_JOINED')
  a.send({ t: 'SIT_DOWN', seat: 0, buyIn })
  b.send({ t: 'SIT_DOWN', seat: 1, buyIn })
  a.send({ t: 'READY', ready: true })
  b.send({ t: 'READY', ready: true })
  await b.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_READY' && m.event.playerId === 'a')
  await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_READY' && m.event.playerId === 'b')
  a.send({ t: 'START_GAME' })
  return snap
}

describe('authentication', () => {
  it('accepts a valid token, rejects an invalid one, and closes silent sockets after the HELLO timeout', async () => {
    ts = await startTestServer({ gatewayOptions: { helloTimeoutMs: 150 } })
    const good = await TestClient.connect(ts.url)
    clients.push(good)
    const welcome = await good.hello('tok:a')
    expect(welcome).toMatchObject({ playerId: 'a', displayName: 'A', balance: 100_000 })

    const bad = await TestClient.connect(ts.url)
    bad.send({ t: 'HELLO', sessionToken: 'tok:nobody' })
    await bad.next('ERROR', (m) => m.code === 'UNAUTHENTICATED')
    expect((await bad.closed).code).toBe(4001)

    const silent = await TestClient.connect(ts.url)
    silent.send({ t: 'LIST_ROOMS' })
    await silent.next('ERROR', (m) => m.code === 'UNAUTHENTICATED')
    expect((await silent.closed).code).toBe(4001)
  })
})

describe('lobby and rooms', () => {
  it('lists public rooms live, joins by code, refuses wrong passwords and double rooms', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    b.send({ t: 'LIST_ROOMS' })
    expect((await b.next('ROOM_LIST')).rooms).toEqual([])
    const res = await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: { ...HOLDEM, isPrivate: true, password: 'pw12' } })
    expect(res.t).toBe('ACK')
    const snap = await a.next('ROOM_SNAPSHOT')
    expect(snap.room.hostPlayerId).toBe('a')
    expect((await b.next('ROOM_LIST')).rooms).toEqual([]) // private: not listed
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: snap.room.code, password: 'nope' })).toMatchObject({ t: 'ERROR', code: 'WRONG_PASSWORD' })
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: 'ZZZZZZ' })).toMatchObject({ t: 'ERROR', code: 'ROOM_NOT_FOUND' })
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: snap.room.code.toLowerCase(), password: 'pw12' })).toMatchObject({ t: 'ACK' })
    expect((await b.next('ROOM_SNAPSHOT')).room.players.map((p) => p.playerId)).toEqual(['a', 'b'])
    expect((await a.next('ROOM_EVENT')).event).toMatchObject({ type: 'PLAYER_JOINED', player: { playerId: 'b' } })
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: HOLDEM })).toMatchObject({ t: 'ERROR', code: 'ALREADY_IN_ROOM' })
    expect(await b.request({ t: 'LEAVE_ROOM', reqId: rid() })).toMatchObject({ t: 'ACK' })
    expect((await a.next('ROOM_EVENT')).event).toMatchObject({ type: 'PLAYER_LEFT', playerId: 'b' })
    b.send({ t: 'LIST_ROOMS' })
    await b.next('ROOM_LIST')
    a.send({ t: 'LEAVE_ROOM' })
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    await a.next('ROOM_SNAPSHOT')
    const list = await b.next('ROOM_LIST', (m) => m.rooms.length === 1)
    expect(list.rooms[0]).toMatchObject({ name: 'T', mode: 'holdem', playerCount: 1, status: 'OPEN' })
  })
})

describe('blind hand against a bot over the wire', () => {
  it('deals private cards only to their owner, drives the decision phase, settles and pushes the balance', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: BLIND_BOT })
    const snap = await a.next('ROOM_SNAPSHOT')
    expect(snap.room.players.filter((p) => p.isBot)).toHaveLength(1)
    a.send({ t: 'SIT_DOWN', seat: 0 })
    a.send({ t: 'READY', ready: true })
    a.send({ t: 'START_GAME' })
    const started = await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_STARTED')
    expect(started.event).toMatchObject({ type: 'HAND_STARTED', mode: 'blind' })
    const mine = await a.next('GAME_EVENT', (m) => m.event.type === 'CARDS_DEALT' && m.event.seat === 0)
    const theirs = await a.next('GAME_EVENT', (m) => m.event.type === 'CARDS_DEALT' && m.event.seat === 2)
    expect(mine.event.type === 'CARDS_DEALT' && mine.event.cards).toHaveLength(2)
    expect(theirs.event.type === 'CARDS_DEALT' && theirs.event.cards).toEqual([])
    expect(theirs.event.type === 'CARDS_DEALT' && theirs.event.cardCount).toBe(2)
    const phase = await a.next('GAME_EVENT', (m) => m.event.type === 'DECISION_PHASE')
    expect(phase.event.deadlineAt).toBeGreaterThan(Date.now() - 1000)
    expect(await a.request({ t: 'ACTION', reqId: rid(), baseSeq: phase.seq, action: { kind: 'play' } })).toMatchObject({ t: 'ACK' })
    await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_COMPLETE', 5000)
    const balance = await a.next('BALANCE')
    expect(balance.balance).not.toBe(100_000)
    expect(await ts.repos.balances.get('a')).toBe(balance.balance)
    expect(ts.repos.hands).toHaveLength(1)
    const status = await a.next('ROOM_EVENT', (m) => m.event.type === 'ROOM_STATUS' && m.event.nextHandAt !== null)
    expect(status.event.type).toBe('ROOM_STATUS')
  })
})

describe('hold’em between two clients', () => {
  it('enforces turn order, staleness, duplicates and legality', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b)
    const first = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const actingSeat = first.event.type === 'TURN_CHANGED' ? first.event.seat : -1
    const [actor, other] = actingSeat === 0 ? [a, b] : [b, a]
    await b.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    expect(await other.request({ t: 'ACTION', reqId: rid(), baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ERROR', code: 'NOT_YOUR_TURN' })
    expect(await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: 0, action: { kind: 'call' } })).toMatchObject({ t: 'ERROR', code: 'STALE_STATE' })
    expect(await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: first.seq, action: { kind: 'check' } })).toMatchObject({ t: 'ERROR', code: 'ILLEGAL_ACTION' })
    const dup = rid()
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK' })
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK' }) // idempotent
    await other.next('GAME_EVENT', (m) => m.event.type === 'PLAYER_ACTED')
    expect(other.drain('GAME_EVENT').filter((m) => m.event.type === 'PLAYER_ACTED')).toHaveLength(0) // not applied twice
    // play the rest passively, driving both seats from a's event stream (seq is room-wide)
    const clientForSeat = (seat: number) => (seat === 0 ? a : b)
    for (let i = 0; i < 40; i++) {
      const ev = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED' || m.event.type === 'HAND_COMPLETE', 5000)
      if (ev.event.type === 'HAND_COMPLETE') break
      if (ev.event.type !== 'TURN_CHANGED') continue
      const kind = ev.event.legal.kinds.includes('check') ? 'check' : 'call'
      expect(await clientForSeat(ev.event.seat).request({ t: 'ACTION', reqId: rid(), baseSeq: ev.seq, action: { kind } })).toMatchObject({ t: 'ACK' })
    }
    const done = await a.next('GAME_EVENT', (m) => m.event.type === 'SETTLEMENT', 5000)
    expect(done.event.type === 'SETTLEMENT' && done.event.fee).toBeGreaterThan(0)
  }, 20_000)
})

describe('reconnect and duplicate sessions', () => {
  it('a dropped client keeps its seat, gets a snapshot on return, and a second login replaces the first', async () => {
    ts = await startTestServer({ roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b, { ...BLIND_BOT, blind: { ...BLIND_BOT.blind!, botCount: 0 } }, undefined)
    await b.next('GAME_EVENT', (m) => m.event.type === 'DECISION_PHASE')
    await b.close()
    const dc = await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_DISCONNECTED')
    expect(dc.event).toMatchObject({ type: 'PLAYER_DISCONNECTED', playerId: 'b' })
    const b2 = await connect('b')
    const snap = await b2.next('ROOM_SNAPSHOT')
    expect(snap.hand?.mySeat).toBe(1)
    expect(snap.hand?.seats.find((s) => s.seat === 1)?.holeCards).toHaveLength(2)
    expect(snap.hand?.legal?.kinds).toEqual(['play', 'fold'])
    expect(snap.deadlineAt).not.toBeNull()
    expect((await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_RECONNECTED')).event).toMatchObject({ playerId: 'b' })

    const b3 = await connect('b')
    await b2.next('SESSION_REPLACED')
    expect((await b2.closed).code).toBe(4000)
    expect((await b3.next('ROOM_SNAPSHOT')).hand?.mySeat).toBe(1)
    expect(a.drain('ROOM_EVENT').some((m) => m.event.type === 'PLAYER_DISCONNECTED')).toBe(false) // replacement is not a disconnect
  })
})

describe('abuse protection', () => {
  it('rate-limits floods, closes after repeated invalid messages, and rejects oversized payloads', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    for (let i = 0; i < 40; i++) a.send({ t: 'PONG' })
    await a.next('ERROR', (m) => m.code === 'RATE_LIMITED')

    const b = await connect('b')
    b.send({ t: 'NOPE' })
    b.send({ t: 'NOPE' })
    b.send({ t: 'NOPE' })
    await b.next('ERROR', (m) => m.code === 'INVALID_MESSAGE')
    expect((await b.closed).code).toBe(4002)

    const c = await connect('c')
    c.send({ t: 'LIST_ROOMS', pad: 'x'.repeat(5000) })
    expect((await c.closed).code).toBe(1009)
  })
})

describe('heartbeat', () => {
  it('pings clients and drops those that never answer', async () => {
    ts = await startTestServer({ gatewayOptions: { heartbeatIntervalMs: 50, heartbeatTimeoutMs: 120 } })
    const alive = await connect('a')
    await alive.next('PING')
    const mute = await TestClient.connect(ts.url)
    mute.send({ t: 'HELLO', sessionToken: 'tok:b' })
    await mute.next('WELCOME')
    ;(mute as unknown as { ws: { removeAllListeners: (e: string) => void } }).ws.removeAllListeners('message') // stop auto-PONG
    const closed = await mute.closed
    expect([1005, 1006]).toContain(closed.code)
    await alive.next('PING')
    expect(alive.isOpen).toBe(true)
  })
})

describe('shutdown', () => {
  it('cancels hands, refunds, notifies and closes every socket', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b)
    await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    await ts.server.shutdown('deploy')
    await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_CANCELLED')
    await a.next('ROOM_EVENT', (m) => m.event.type === 'ROOM_CLOSED')
    await a.next('ERROR', (m) => m.code === 'SERVER_SHUTDOWN')
    expect((await a.closed).code).toBe(1001)
    expect((await b.closed).code).toBe(1001)
    expect(await ts.repos.balances.get('a')).toBe(100_000)
    expect(await ts.repos.balances.get('b')).toBe(100_000)
    expect(ts.server.rooms.size).toBe(0)
  })
})
```

Notes for the implementer: the heartbeat "mute" client reaches into the private `ws` to stop auto-PONG; keep that hack local to the test. Oversized payload: `ws` closes with 1009 when `maxPayload` is exceeded.

- [ ] **Step 4: Run, fix, verify**

Run: `pnpm --filter @bp/server-kit test -- gateway` then the full trio `pnpm test && pnpm typecheck && pnpm lint`.
Expected: all green. Flakiness guard: every wait has a timeout with a readable error; if a test is timing-sensitive on this machine, raise that test's timeout, never sleep.

- [ ] **Step 5: Commit**

```bash
git add packages/server-kit
git commit -m "feat(server-kit): createGameServer, test harness/client and WebSocket integration tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Multiplayer soak test, docs, final verification

**Files:**
- Create: `packages/server-kit/src/soak.test.ts`, `docs/server-kit.md`
- Modify: `README.md` (layout line for server-kit), `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §18.1 (rename `applySettlement` → `apply(entries, meta)` and note `SessionResolver`)

- [ ] **Step 1: Write the soak test**

`packages/server-kit/src/soak.test.ts`:
```ts
import type { RoomConfig, ServerMessage } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './testing/harness.js'
import { TestClient } from './testing/test-client.js'

const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 10, autoStart: true, blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 1 } }
const HOLDEM: RoomConfig = { name: 'H', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: true, holdem: { smallBlind: 50, bigBlind: 100, minBuyInBB: 50, maxBuyInBB: 200 } }

let ts: TestServer
afterEach(async () => { await ts?.close() })

/** Plays until `hands` HAND_COMPLETE events have been seen, following a simple policy; returns seq gaps found. */
async function autoplay(c: TestClient, mySeat: number, hands: number, policy: (kinds: string[], i: number) => string): Promise<{ gaps: number; completed: number }> {
  let completed = 0, gaps = 0, lastSeq = -1, i = 0
  while (completed < hands) {
    const m = await c.next('GAME_EVENT', () => true, 8000)
    if (lastSeq >= 0 && m.seq !== lastSeq + 1 && m.seq <= lastSeq) gaps++
    lastSeq = m.seq
    const e = m.event
    if (e.type === 'HAND_COMPLETE') completed++
    const myTurn = (e.type === 'TURN_CHANGED' && e.seat === mySeat) || (e.type === 'DECISION_PHASE' && e.seats.includes(mySeat))
    if (myTurn) {
      const kinds = e.type === 'TURN_CHANGED' ? e.legal.kinds : ['play', 'fold']
      c.send({ t: 'ACTION', reqId: `q${i++}`, baseSeq: m.seq, action: { kind: policy(kinds, i) } })
    }
  }
  return { gaps, completed }
}

describe('multiplayer soak', () => {
  it('two rooms, six clients, ten hands each: no seq regressions and points are conserved', async () => {
    ts = await startTestServer({ players: [['a', 1e5], ['b', 1e5], ['c', 1e5], ['d', 1e5], ['e', 1e5], ['f', 1e5]], roomOptions: { turnTimerMsOverride: 4000 } })
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const clients = await Promise.all(ids.map(async (id) => { const c = await TestClient.connect(ts.url); await c.hello(`tok:${id}`); return c }))
    const [a, b, c, d, e, f] = clients as [TestClient, TestClient, TestClient, TestClient, TestClient, TestClient]

    a.send({ t: 'CREATE_ROOM', config: BLIND })
    const r1 = await a.next('ROOM_SNAPSHOT')
    d.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const r2 = await d.next('ROOM_SNAPSHOT')
    for (const [cl, code] of [[b, r1.room.code], [c, r1.room.code], [e, r2.room.code], [f, r2.room.code]] as [TestClient, string][]) {
      cl.send({ t: 'JOIN_ROOM', code })
      await cl.next('ROOM_SNAPSHOT')
    }
    const seat = async (cl: TestClient, s: number, buyIn?: number) => { cl.send({ t: 'SIT_DOWN', seat: s, buyIn }); cl.send({ t: 'READY', ready: true }) }
    await seat(a, 0); await seat(b, 1); await seat(c, 2)
    await seat(d, 0, 10_000); await seat(e, 1, 10_000); await seat(f, 2, 10_000)

    const passive = (kinds: string[]) => (kinds.includes('check') ? 'check' : kinds.includes('call') ? 'call' : kinds.includes('play') ? 'play' : 'fold')
    const mixed = (kinds: string[], i: number) => (i % 3 === 0 && kinds.includes('fold') ? 'fold' : passive(kinds))
    const results = await Promise.all([
      autoplay(a, 0, 10, passive), autoplay(b, 1, 10, mixed), autoplay(c, 2, 10, passive),
      autoplay(d, 0, 10, passive), autoplay(e, 1, 10, mixed), autoplay(f, 2, 10, passive),
    ])
    for (const r of results) expect(r.gaps).toBe(0)

    await ts.server.shutdown('soak end') // cashes out hold'em stacks and settles carry-over
    for (const cl of clients) await cl.closed
    const balances = await Promise.all(ids.map((id) => ts.repos.balances.get(id)))
    const fees = ts.repos.hands.reduce((s, h) => s + h.fee, 0)
    const botNet = ts.repos.hands.flatMap((h) => h.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
    expect(balances.reduce((s, x) => s + x, 0) + fees + botNet).toBe(600_000)
    expect(ts.repos.hands.length).toBeGreaterThanOrEqual(20)
  }, 60_000)
})
```

The `ServerMessage` import is only for typing if needed; remove it if unused (lint).

- [ ] **Step 2: Write `docs/server-kit.md`**

Contents (prose, ~80 lines): purpose; how an edition embeds it (`createGameServer`, `handleUpgrade`, `SessionResolver` two styles, repository interfaces and the `BalanceRepository.apply` atomicity contract, `onDomainEvent`); the room lifecycle diagram (`OPEN → IN_GAME → (hand loop) → OPEN/CLOSED`); the timers table with defaults (`RoomOptions`, `GatewayOptions`); the outbound message contract (`seq`, `turnStartSeq`/`STALE_STATE`, `reqId`/`ACK` dedupe, per-viewer filtering); shutdown semantics; testing utilities (`startTestServer`, `TestClient`, `createRoomHarness`, `ManualClock`).

- [ ] **Step 3: README and spec touch-ups**

README layout list: change the server-kit line to `- packages/server-kit — rooms, WebSocket gateway, timers, reconnect, bots (see docs/server-kit.md)`.
Spec §18.1: replace the interface block with the Task 2 interfaces (`PlayerRepository.findById`, `BalanceRepository.get/apply(entries, meta?)`, `GameHistoryRepository.recordHand(summary)`, `SessionResolver.fromUpgrade?/fromToken?`).

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green — core (147), server-kit (Tasks 2–9), tooling boundary test (server-kit's only `@bp/*` dependency is core).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(server-kit): multiplayer soak test; docs for embedding server-kit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage (M4): §11 rooms (Tasks 4–6), §16.2–16.7 realtime (Tasks 3, 4, 7, 8), §17 orchestration (Task 3), §18.1 repositories (Task 2), §20 protocol on the wire (Task 7–8), §22.3 plug-in shape (Task 8 `createGameServer`), §30 edge cases (Tasks 5, 8: disconnect, reconnect, host leave, empty/full room, duplicate action, out-of-turn, invalid bet, timeout, duplicate connection, server restart, race via queue). Not in this plan: persistence implementations (Lite/Normal), REST, UI — later plans.
- Known simplifications to record in the spec's Assumptions when Plan 3 starts: duplicate `reqId` re-ACKs without replaying the original result; hold'em top-up between hands is not implemented (stand up and re-sit); spectators count against `maxPlayers`.
- Type consistency checked: `Room` uses `RoomError` codes that exist in `ErrorCode`; `Gateway` only calls `Room` methods listed in Task 4; `TestClient.next` predicate types match `ServerMessage` variants; `HandRunner.wasCancelled` added in Task 4 and used in `onHandComplete`.
