# `@bp/server-kit`

## Purpose

`server-kit` turns the pure `@bp/core` game engine into a runnable multiplayer
server: it owns rooms, seats, timers, bots, reconnection, and a WebSocket
wire protocol, but it owns no persistence and no HTTP framework. An edition
(Normal, Lite) supplies storage (`Repositories`) and identity
(`SessionResolver`), hands `server-kit` a raw HTTP upgrade, and gets back a
running game server. `server-kit`'s only `@bp/*` dependency is `@bp/core`.

## Embedding

```ts
import { createGameServer } from '@bp/server-kit'

const server = createGameServer({
  repos,                     // Repositories — see below
  resolver,                  // SessionResolver — see below
  onDomainEvent: (e) => { ... }, // optional: ROOM_CREATED, ROOM_JOINED, HAND_SETTLED
  roomOptions: { ... },       // optional: partial RoomOptions overrides
  gatewayOptions: { ... },    // optional: partial GatewayOptions overrides
})

httpServer.on('upgrade', (req, socket, head) => server.handleUpgrade(req, socket, head))
```

`createGameServer` wires a `RoomManager` and a `Gateway` together and returns
a `GameServer` exposing `rooms`, `gateway`, `handleUpgrade`, `notify`,
`balanceChanged`, `renameIdentity`, `shutdown`, and `connectionCount`. The edition never
touches `Room` or `Gateway` internals directly — `handleUpgrade` and
`shutdown` are the whole surface it needs for a working HTTP server.

### Pushing to a player from outside the game

Editions own everything `server-kit` does not: purchases, daily rewards,
achievements, moderation. Three methods let them reach a live session
without knowing anything about rooms or sockets:

```ts
server.notify(playerId, { t: 'NOTIFICATION', kind: 'DAILY_REWARD', payload: { amount: 500 } })
await server.balanceChanged(playerId) // after crediting points elsewhere
```

- **`notify(playerId, msg)`** — pushes any `ServerMessage` to that
  player's current connection. A push, not a mailbox: if the player is
  offline it does nothing.
- **`balanceChanged(playerId)`** — re-reads the balance and pushes
  `BALANCE`. If the player is seated it goes through the room's queue
  (`Room.refreshBalance`) so the push lands in order with the room's own.
  It never touches a table stack: since the table limit (spec 2026-09-29)
  a Blind seat, like a Hold'em one, plays from points it brought to the
  table (`buy_in` at `SIT_DOWN`, `cash_out` when it stands).
- **`renameIdentity(playerId, displayName)`** — after a successful rename,
  replaces the identity on every live connection of that player, so the
  next room they create or join seats them under the new name. A room they
  are already in keeps the name its seat was given.

### `SessionResolver`

Two independent, optional hooks turn a connection into a `PlayerIdentity`;
an edition implements whichever fits its auth model (or both):

- `fromUpgrade?(req)` — reads a cookie/header off the raw HTTP upgrade
  request before the WebSocket handshake completes. Used by cookie-session
  editions; if it resolves an identity, the gateway skips `HELLO` entirely.
- `fromToken?(token)` — called when the client sends `HELLO { sessionToken }`
  after connecting. Used by token-based auth (and by tests: `TestServer`'s
  resolver treats `tok:<playerId>` as a valid token).

If neither hook resolves an identity, the socket is closed
(401 pre-handshake, or `UNAUTHENTICATED`/close 4001 post-handshake).

### Repositories

```ts
interface PlayerRepository { findById(playerId): Promise<PlayerRecord | null> }
interface BalanceRepository {
  get(playerId): Promise<number>
  apply(entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
}
interface GameHistoryRepository { recordHand(summary: HandSummary): Promise<void> }
```

`BalanceRepository.apply` is the one atomicity contract the edition must
honor: all entries in the batch commit or none do, and it must reject
(throw `InsufficientBalanceError`) if any player's resulting balance would
go negative, before writing anything. `Room` relies on this to write
buy-ins, cash-outs, refunds and carry-over releases each as a single
unit — a partial write would let points leak or be created.

Two further rules the implementation must honor:

- **Netting.** Entries are grouped by player and their deltas summed
  *before* the negativity check, so a batch that debits and re-credits the
  same player is judged on `balance + net >= 0`, not on intermediate
  values. Only the net matters; the intermediate order does not.
- **Sink rows.** When `meta` is present and `meta.fee > 0`, the same
  transaction must record a sink row of `meta.kind` — points that left
  player balances and went to no player. Normal writes a
  `point_transactions` row with a null `player_id`; the in-memory
  repositories push the meta onto `repos.sinks`. `meta.kind` is
  `'table_fee'` (the rake of a settled hand, `refId` = handId) or
  `'carry_over'` (the indivisible remainder of a released carry-over pot,
  or the whole pot when nobody was seated, `refId` = roomId). A hand
  settles no player entries in either mode (chips move on the table), so
  its fee arrives as `apply([], { kind: 'table_fee', ... })` — an empty
  batch that exists purely to write the sink row.

Sink rows are what make the money invariant checkable:
`Σ player balances + Σ sinks (+ live table stacks and carry-over pots) `
is constant for the lifetime of the server.

### `onDomainEvent`

An optional sink for events an edition typically forwards to other
subsystems (achievements, stats, analytics) without coupling `server-kit`
to them: `ROOM_CREATED`, `ROOM_JOINED`, `HAND_SETTLED { summary }`.

## Room lifecycle

```
OPEN ──(2+ ready seats, autoStart or START_GAME)──> IN_GAME
IN_GAME ──(hand loop: HandRunner runs a hand to completion)──> onHandComplete
  onHandComplete ──(another eligible hand)──> IN_GAME (next hand, after handIntervalMs)
  onHandComplete ──(fewer than 2 eligible players)──> OPEN
IN_GAME/OPEN ──(shutdown() or last human leaves + emptyRoomCloseMs)──> CLOSED
```

### Table stacks and the Blind table limit (spec 2026-09-29)

A seat plays from a stack taken out of the balance at `SIT_DOWN` (a
`buy_in` row, `refId` = roomId), in both modes: Hold'em brings the buy-in
the player chose, Blind brings the table limit `blindTableLimit(rules)`
(5 × the wager) — or the whole balance when that is less, as long as it
covers one hand (`blindRequiredStack`; below that the answer is
`INSUFFICIENT_BALANCE`). The room pushes `BALANCE` right after the buy-in.
Hands move only table stacks; every way off a seat (stand, leave, kick,
reconnect expiry, sat out too long, shutdown) writes the stack back as a
`cash_out`. When a hand ends, a human seat whose stack can no longer cover
a hand is stood up the same way and stays in the room to watch; in Blind
the player alone is sent `NOTIFICATION { kind: 'TABLE_LIMIT_SPENT',
payload: { roomId, limit, amount } }`, where `amount` is what went back to
the balance (possibly 0). Sitting again is a fresh buy-in. Bots play from a
virtual stack of the limit, topped back up before a hand when it falls
short, and never touch the ledger.

### Carry-over pots (spec §8.4)

When every player folds a Blind hand the pot is not paid out: it carries
into the next hand. A pot must never be stranded, so `Room` releases it
whenever the table stops being able to use it — when the room has been
unable to start a hand for `carryOverReleaseMs` (the timer is armed each
time the room falls back to `OPEN` and cancelled as soon as a hand
starts), when the room closes, and on `shutdown()`. The pot is split
evenly among the seated humans (regardless of stack); the indivisible
remainder — or the whole pot, when nobody is seated — is recorded as a
`carry_over` sink row rather than being handed to an arbitrary player.

### Sitting out (spec §11.3)

`SIT_OUT` keeps the seat and asks to be skipped; `SIT_IN` takes it back.
Both answer `ACK`, or `ERROR{NOT_SEATED}` from a player with no seat.

| | |
|---|---|
| When it takes effect | The next hand. The hand already on the table is played out — a player who wants out of *this* hand folds. |
| Effective flag | Recomputed at every `startHand`: `sittingOut = asked to sit out ‖ stack < the minimum to play`. So `SIT_IN` on a stack that still cannot cover the wager leaves the seat `SITTING_OUT` under the existing short-stack rule. |
| What clients see | `ROOM_EVENT PLAYER_SIT_OUT { playerId, sittingOut }` on every change of that flag — including the short-stack one, which used to be visible only in a snapshot — plus `RoomPlayerView.sittingOut` (`sitOutRequested ‖ sittingOut`) in every snapshot. The flag has its own field because `status` holds one value and ranks `IN_HAND` above `SITTING_OUT`: a player who sits out mid-hand still finishes that hand, so a snapshot taken then reports `status: 'IN_HAND', sittingOut: true`. A client's toggle reads the field, never the status, so a `RESYNC` or a reconnect cannot flip it back. |
| Starting a hand | A sitting-out seat is not a ready seat: the room needs two seats that are both ready and playing (`autoStart` waits, `START_GAME` answers `NOT_ENOUGH_PLAYERS`). It is not waited on either, so one sitter no longer holds up a table that is otherwise ready. |
| Taking the seat back | After `handsSatOutToStand` hands have started without them, the player is stood up and their stack returned — the same `standUpNow` path as the three-timeout rule, emitting `PLAYER_STOOD`. The counter is reset by a **change** of the request — `SIT_IN` after a `SIT_OUT` — and by a fresh `SIT_DOWN` or a stand-up. A repeated `SIT_OUT` is answered `ACK` and changes nothing, so it cannot re-arm the rule. |
| Where it does not fire | The counter ticks on hands that are actually dealt, not on wall-clock time. On a table with too few other players to start — two seats, one of them sitting out — no hand ever starts, so the sitter is never stood up and the seat is held until they leave or the room closes empty (`emptyRoomCloseMs`). |

A room is created `OPEN` with its host seated. Each hand runs inside a
`HandRunner` driven by `Room`'s own serialized queue (`enqueue`), so joins,
seat changes, actions, disconnects and hand-completion callbacks never
interleave. When a hand ends, `Room` settles the table stacks, writes the fee
sink, records history, stands up any seat that asked to go or can no longer
cover a hand, then either starts the next hand after `handIntervalMs` or
falls back to `OPEN`.

## Timers and options

`RoomOptions` (per `createGameServer({ roomOptions })`, defaults from
`DEFAULT_ROOM_OPTIONS`):

| Option | Default | Purpose |
|---|---|---|
| `handIntervalMs` | 5,000 | Pause between hands in a room |
| `revealDelayMs` | 1,500 | Delay before revealing decisions/community cards |
| `botDelayMs` | `[1000, 3000]` | Random think-time range for bot actions |
| `reconnectWindowMs` | 90,000 | How long a disconnected seated player is held before auto-fold/stand |
| `spectatorGraceMs` | 300,000 | After the reconnect window, how long before the player is removed from the room entirely |
| `emptyRoomCloseMs` | 60,000 | How long an empty room stays open before closing |
| `carryOverReleaseMs` | 60,000 | How long a room may sit unable to start a hand before its carry-over pot is released (spec §8.4) |
| `consecutiveTimeoutsToStand` | 3 | Timed-out actions in a row before a human is stood up automatically |
| `handsSatOutToStand` | 5 | Hands started without a player who asked to sit out before the seat is taken back (spec §11.3) |
| `turnTimerMsOverride` | — | Test hook: overrides `config.turnTimerSec * 1000` when set |

`createGameServer` also takes `shutdownTimeoutMs` (default 10,000) — the
upper bound on `shutdown()`; see below.

`GatewayOptions` (defaults from `DEFAULT_GATEWAY_OPTIONS`):

| Option | Default | Purpose |
|---|---|---|
| `heartbeatIntervalMs` | 15,000 | How often `PING` is sent |
| `heartbeatTimeoutMs` | 30,000 | No `PONG` within this window → connection terminated |
| `rateLimitPerSec` / `rateLimitBurst` | 20 / 20 | Per-connection token-bucket for inbound messages |
| `maxPayloadBytes` | 4,096 | WebSocket frame size cap |
| `helloTimeoutMs` | 5,000 | Time to send `HELLO` before an unauthenticated socket is closed |
| `allowedOrigins` | `null` (any) | Who may open a socket, by the upgrade request's `Origin` — see below |
| `maxInvalidMessages` | 3 | Strikes before a connection is closed. Only `INVALID_MESSAGE` (unparseable frames) counts, plus one strike per 5 consecutive rate-limited messages; a rejected room config never does |
| `lobbyCoalesceMs` | 50 | Room-list changes within this window collapse into one `ROOM_LIST` broadcast |

### `allowedOrigins`

`Origin` is the only cross-site signal a WebSocket upgrade carries — a browser
always sets it and a page cannot forge it — so it is what stands between a
player's open tab on some other site and a socket here. A refusal is an
`HTTP/1.1 403` on the upgrade, before any authentication runs.

| Value | Behaviour |
|---|---|
| `null` | Everything is allowed. Only correct when something in front already decides. |
| `'same-host'` | An `Origin` whose `host[:port]` equals the request's `Host` header is allowed; so is a request with **no** `Origin` at all (a bot, a health probe, `wscat` — there is no site to forge from). Everything else is refused. |
| `string[]` | Exactly these origins, matched whole. An absent `Origin` is refused: a list is a deliberate allowlist. |

`'same-host'` is the right default for a server that also serves its own UI: it
needs no configuration and still refuses a foreign page. Matching is
scheme-insensitive (a TLS terminator in front rewrites `https` to `http`
without changing the authority) and tolerates a `:80`/`:443` written out on one
side and omitted on the other. Use the list form when a reverse proxy has
changed the public origin out from under `Host`.

## Wire contract

- **`seq`**: every `ROOM_SNAPSHOT`, `GAME_EVENT`, and `ROOM_EVENT` carries
  the room's monotonically increasing `seq`. Clients use it to detect
  dropped or reordered messages and to `RESYNC` when a gap appears.
- **`turnStartSeq` / `STALE_STATE`**: `Room` remembers the `seq` at which the
  current turn began. An `ACTION` must supply `baseSeq >= turnStartSeq`; an
  action submitted against a turn that has already moved on is rejected
  with `STALE_STATE` rather than silently applied to the wrong turn.
- **`reqId` / `ACK`**: any client message may carry a `reqId`; the gateway
  replies with `ACK { reqId }` on success or `ERROR { reqId, code, message }`
  on failure. Per connection, a small ring buffer of recent `reqId`s
  (last 32) remembers the *frame each `reqId` produced*, so a retransmitted
  duplicate is answered with that exact frame — an `ACK` stays an `ACK` and
  a failure stays the same `ERROR` — instead of being re-executed or
  mistaken for success.
- **Per-viewer filtering**: nothing broadcasts a single shared payload.
  `GAME_EVENT`s go through `filterEvent(event, viewerSeat)` so hole cards
  belonging to other seats are stripped (only `cardCount` survives); `Room`
  sends to each connected human individually via the `Outbox`, and only to
  seats currently in the hand for turn-scoped events.

## Reconnecting and frame order

The client contract, in order:

1. The first frame on any authenticated socket is **`WELCOME`**. It carries
   the player's id, display name, balance and the server time.
2. If the player is still in a room, the next frame is **`ROOM_SNAPSHOT`**.
   Its `seq` is the room's `seq` at the moment the snapshot was taken.
   `JOIN_ROOM` and `CREATE_ROOM` answer with a snapshot the same way —
   `Room.join()` returns the snapshot computed *inside* the queue slot that
   admitted the player, so nothing can slip between admission and the frame
   the client builds its state from.
3. Everything after that is an event — `GAME_EVENT` or `ROOM_EVENT` — with
   `seq > snapshot.seq`. Apply them in order.

Rules for the client:

- **Gaps.** `seq` is room-wide. Per-viewer filtering means a client
  legitimately never sees *some* values (another seat's hole cards, turn
  events for a hand it is not in), so a skip is normal; a value that goes
  backwards, or a gap the client cannot explain, means state is stale —
  send `RESYNC` and rebuild from the snapshot it returns.
- **In-flight actions.** After reconnecting, do not replay an `ACTION`
  with its old `baseSeq`: the turn has almost certainly moved and the
  server answers `STALE_STATE`. Re-send it with a fresh `baseSeq` taken
  from the new snapshot, only if the snapshot still shows it as your turn.
  The `reqId` ring buffer is **per connection** (spec §16.4), so it does
  not survive the reconnect: the new socket has no memory of the old
  `reqId` and the retransmission is re-evaluated rather than replayed.
  What keeps it from being applied twice is the `turnStartSeq` guard, not
  the cache — an action for a turn that has moved on is refused with
  `STALE_STATE`, and one for a seat that is no longer acting with
  `NOT_YOUR_TURN`. So after a reconnect, expect an `ERROR` where the same
  `reqId` on the *same* socket would have replayed its original `ACK`, and
  treat the snapshot — not the answer to the retransmission — as the truth
  about whether the action landed.
- **Lobby.** `ROOM_LIST` broadcasts only go to connections that have asked
  for them; leaving a room does not re-subscribe you. Send `LIST_ROOMS`
  again after `LEAVE_ROOM` to start receiving the live list.
- **Bind failure.** If a resync fails server-side, the client gets
  `ERROR { code: 'INTERNAL', message: 'resync required' }` after its
  `WELCOME` — it should send `RESYNC` (or reconnect) rather than assume it
  is in sync.

## Shutdown

`GameServer.shutdown(reason?)` is two-phase, so nothing new enters while
the live state is being settled:

1. **Stop accepting.** `Gateway.stopAccepting()` answers new upgrades with
   `HTTP/1.1 503 Service Unavailable` and refuses `CREATE_ROOM`/`JOIN_ROOM`
   with `ERROR { code: 'SERVER_SHUTDOWN' }`; `RoomManager.create` throws the
   same. Sessions already in a hand keep playing.
2. **Drain rooms.** `RoomManager.shutdown(reason)` runs `Room.shutdown(reason)`
   on every room in parallel. Each room cancels any in-flight hand (refunding
   what's live), releases its carry-over pot, cashes out every seated human's
   stack back to their balance (both modes), marks the room `CLOSED`, and
   broadcasts `ROOM_EVENT { type: 'ROOM_CLOSED', reason }`. A `CLOSED` room
   refuses every further mutation with `ROOM_NOT_FOUND`, so a request racing
   the shutdown cannot deduct a buy-in into a room that is going away.
3. **Close sockets.** `Gateway.closeAll(1001, reason, { t: 'ERROR', code: 'SERVER_SHUTDOWN', message: reason })`
   sends every connected client a final `ERROR` and closes the socket.

Steps 2 and 3 run inside a `Promise.race` with `shutdownTimeoutMs`
(default 10,000). If the budget is exceeded the call returns anyway and
logs a warning — a wedged repository must not hang a deploy.

```ts
const server = createGameServer({ repos, resolver, shutdownTimeoutMs: 10_000 })

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void (async () => {
      httpServer.close()             // stop new HTTP connections
      await server.shutdown(signal)  // stop accepting -> drain rooms -> close sockets
      process.exit(0)
    })()
  })
}
```

After `shutdown` resolves, every point that was ever in a stack or a
carry-over pot has been returned to a `BalanceRepository` balance or
recorded as a sink row — nothing is left in RAM. The one exception is a
cash-out the repository refuses: it is logged (`shutdown cash-out failed`,
with the player and the stack) for an operator to reconcile, and the room
still closes and the other seats are still cashed out, so one bad row
cannot hold up the rest of the shutdown.

## Testing utilities

`@bp/server-kit/testing` (or the package's `testing/index.ts`) exports the
harnesses used by `server-kit`'s own test suite and available to editions
for integration tests:

- **`startTestServer(opts)`** — spins up a real `createGameServer` behind a
  real `http`/`ws` listener on a random port, backed by in-memory
  repositories. Returns `{ url, repos, server, http, domainEvents, close() }`.
  Accepts `players` (seed balances), `roomOptions`, `gatewayOptions`, and
  `seed` (for the RNG). Use this for tests that exercise the real socket
  and message-framing path end to end (see `soak.test.ts`).
- **`TestClient`** — a thin WebSocket client for talking to a `TestServer`:
  `connect(url)`, `hello(token)`, `next(t, pred?, timeoutMs?)` to await a
  typed message, `request(msg)` to send-and-await its `ACK`/`ERROR`,
  `drain(t)` to pull buffered messages of a type, `send(msg)`, `close()`,
  and a `closed` promise that resolves with the socket's close code/reason.
- **`createRoomHarness(config, opts)`** — builds a single `Room` directly
  (no gateway, no sockets) against a `ManualClock` and in-memory
  repositories, capturing every outbound message per player. Fastest way to
  drive room/hand logic deterministically in unit tests.
- **`ManualClock`** — a `Clock` whose time only advances on `advance(ms)`,
  firing any due timers (in schedule order) as it passes them. Lets tests
  fast-forward through `handIntervalMs`, reconnect windows, and turn timers
  without waiting on a wall clock.
- **`runSoak(server, opts)`** — the multiplayer soak driver (spec §29.3). See
  below.

### The soak driver

```ts
import { runSoak, startTestServer } from '@bp/server-kit/testing'

const ts = await startTestServer({
  players: Array.from({ length: 6 }, (_, i) => [`p${i}`, 200_000] as [string, number]),
  gatewayOptions: { rateLimitPerSec: 500, rateLimitBurst: 500 },
})
const r = await runSoak(ts, { clients: 6, rooms: 3, handsPerRoom: 20, mode: 'holdem', seed: 1337 })
```

`runSoak` connects `clients` `TestClient`s, spreads them evenly over `rooms`
rooms (`clients / rooms` seats each, so at least two humans per room; Blind
rooms add one bot), seats and readies everyone, and plays until the *last*
room has settled `handsPerRoom` hands — so `hands` is a floor, not a target.
The policy is deliberately dull: it plays a legal action the server itself
offered (`legal.kinds` on `TURN_CHANGED`, `play`/`fold` on `DECISION_PHASE`),
never bets or raises, and folds a fixed share of the time, which keeps each
hand's exposure to about one big blind so nobody busts mid-run. Pass
`actionDelayMs: [min, max]` for a random think time.

**What `seed` buys you.** Each seat gets its own stream, `seededRng(seed + i)`,
so a seat facing its *n*-th decision always decides the same way for a given
seed — the policy no longer depends on the order the sockets happened to be
served in. It is *not* a promise of bit-for-bit reproducibility of the run:
`startTestServer` hands the whole server one `seededRng`, so the deck each
room shuffles depends on which room reached `startGame` first, and bots and
`actionDelayMs` consume that same stream in timing order. Hand counts, fees
and closing balances therefore still move a little between runs of the same
seed, in Hold'em as well as Blind — the invariants the soak asserts (money
exact, no `seq` gaps, ≥ 20 hands per room, zero fee on cancelled hands) hold
on every run, which is what the test is for. Seed a failing run, and you
replay the *clients*' decisions; you do not replay the cards.

The run ends with `server.shutdown()`, so `endBalances` is read when every
table stack and carry-over pot is back in a balance. `SoakResult` then reports:

| Field | Meaning |
|---|---|
| `hands` / `cancelledHands` | Settled hands, from the `HAND_SETTLED` domain events |
| `handsPerRoomSeen` | The same count broken out per room, so "20 hands *each*" is assertable |
| `fees` | Σ `summary.fee` — the domain events are the fee source of truth |
| `cancelledFees` | Σ `summary.fee` over the cancelled hands. A cancelled hand takes no rake, so assert `0` |
| `sinks` | Σ every sink row the repositories recorded (`table_fee` + `carry_over`) |
| `botNet` | Σ `net` of every bot seat: a bot's stack is virtual, so it is a term of its own |
| `startBalances` / `endBalances` | Σ human balances, before the run and after the shutdown |
| `latencySamples` | How many action → broadcast round trips were timed (a seat whose turn timer beat it contributes none) |
| `seqGaps` / `resyncs` | Frames whose `seq` was not exactly one past the previous one, and the `RESYNC`s they cost |
| `p95ActionToBroadcastMs` | p95 of `ACTION` sent → the `GAME_EVENT` carrying that seat's applied action (spec §24) |
| `errors` / `tolerated` | `ERROR` frames, split into failures and the races the driver knowingly runs into |

The money identity to assert is
`endBalances + botNet + sinks === startBalances`; with no bots and no
carry-over (a Hold'em run) it reduces to `endBalances + fees ===
startBalances`. Assert `cancelledFees === 0` alongside it: a fee wrongly
charged on a cancelled hand lands in `fees`, in `sinks` and in the balance
deduction alike, so the identity above holds straight through it.

To run something bigger than the committed 6 × 3 × 20 — say 40 clients over
10 rooms playing 200 hands each — edit the constants at the top of
`packages/server-kit/src/soak.test.ts` and run
`pnpm --filter @bp/server-kit exec vitest run src/soak.test.ts`, raising the
`it(...)` timeout to match. Two things scale with the numbers: the test
server must seed at least `clients` players, and the per-connection rate limit
must be lifted. `TEST_SERVER_ROOM_OPTIONS` compresses every room timer roughly
a hundredfold, so a soak client legitimately acts far more often per
wall-clock second than a human at a real table ever could; leave the default
20 msg/s in place and the soak measures the flood protection instead of the
game.
