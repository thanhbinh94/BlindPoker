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

### Moderation: reaching a room or a socket from an edition (Plan 25)

The Normal edition's GM console (spec 2026-10-18) needs three things `server-kit` owns and an edition cannot reach. They
are public, small, and held by tests; an edition passes them on and decides nothing about rooms itself.

- **`Room.adminKick(targetId): Promise<'now' | 'after_hand'>`** — like the host's `kick`, with the host check gone, and
  with a different answer to a hand in progress. A host may be removed (the room passes to the next player, as when a
  host leaves). A player seated between hands is removed at once through the usual cash-out, the stack going home. A
  player dealt into the current hand is **not** refused (`kick` answers `GAME_IN_PROGRESS`): they are marked to leave when
  the hand ends and folded now (`markAutoFold`), the money is conserved, and the answer is `'after_hand'`. The target
  always receives `NOTIFICATION { kind: 'KICKED' }`. A bot is refused with `ILLEGAL_ACTION`. The removal is logged in the
  room log as `'kicked_by_gm'` between hands; the after-hand removal goes through the ordinary leave path and is logged
  as `'left'`, so the edition's own action log is the audit trail. A rejoin cannot cancel the after-hand removal: the
  player is still a member until the hand ends, and the gateway refuses `JOIN_ROOM` from a member (`ALREADY_IN_ROOM`)
  before `Room.join`'s rejoin branch is reached (`docs/known-limitations.md`).
- **`Room.adminSummary(): AdminRoomSummary`** — the room as a GM lists it, with everything `summary()` hides from the
  lobby and no cards: `roomId`, `code`, `name`, `mode`, `status`, `isPrivate`, `hasPassword`, `players`, `maxPlayers`,
  `hostPlayerId`, `hostDisplayName`, `carryOverPot` (a release still pending counts), `handInProgress`, `createdAt`, and
  `members` (`playerId`, `displayName`, `isBot`, `seat`, `stack`, `connected`). `Room.createdAt` is new for it.
- **`Gateway.disconnect(playerId, code = 4003, reason = 'LOCKED'): number`** — closes the socket that player holds and
  returns how many it closed (the gateway keeps one bound connection per player, so 0 or 1). **Close code 4003
  `LOCKED`** is the new one beside 4001 `UNAUTHENTICATED`: the account was locked. The kit's client has no special case
  for it: the edition has revoked the sessions too, so the reconnect is refused at the upgrade, and the web client's
  reconnect probe (`GET /api/auth/me`) gets a 401 and ends the session. The edition sends its notice first and
  disconnects after.

Closing a room needs nothing new: `Room.shutdown(reason)` already refunds every stack and releases the carried pot.
`TxReason` gained `gm_grant` and `gm_adjust` for the edition's ledger; core and the wire protocol are untouched (a new
`NOTIFICATION` `kind` rides the open channel of spec §20.4).

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
  apply(entries: BalanceEntry[], meta?: SettlementMeta, opts?: { key?: string }): Promise<{ applied: boolean }>
}
interface GameHistoryRepository { recordHand(summary: HandSummary): Promise<void> }
```

`BalanceRepository.apply` is the one atomicity contract the edition must
honor: all entries in the batch commit or none do, and it must reject
(throw `InsufficientBalanceError`) if any player's resulting balance would
go negative, before writing anything. `Room` relies on this to write
buy-ins, cash-outs, refunds and carry-over releases each as a single
unit — a partial write would let points leak or be created.

Three further rules the implementation must honor:

- **Netting.** Entries are grouped by player and their deltas summed
  *before* the negativity check, so a batch that debits and re-credits the
  same player is judged on `balance + net >= 0`, not on intermediate
  values. Only the net matters; the intermediate order does not.
- **Sink rows.** When `meta` is present and `meta.fee > 0`, the same
  transaction must record a sink row of `meta.kind` — points that left
  player balances and went to no player. Normal writes a
  `point_transactions` row with a null `player_id`; the in-memory
  repositories push the meta onto `repos.sinks`. `meta.kind` is
  `'table_fee'` (the rake of a settled Hold'em hand, `refId` = handId;
  Blind takes no fee since Plan 27), `'carry_over'` (the indivisible
  remainder of a released carry-over pot, or the whole pot when nobody was
  seated, `refId` = roomId) or `'shop'` (Normal only, Plan 27: the points a
  purchase took, written by `creditWithin` with `refId` = the item id, so
  `TxReason` also gains `shop_purchase` for the player's own row). A hand
  settles no player entries in either mode (chips move on the table), so
  its fee arrives as `apply([], { kind: 'table_fee', ... })` — an empty
  batch that exists purely to write the sink row.
- **Keys.** A write that may be retried carries `opts.key`, and the
  implementation claims that key first, inside the batch's own
  transaction (Normal and Lite: a `ledger_keys(key primary key,
  created_at)` table; the in-memory repositories: `repos.keys`). A key
  that is already claimed makes the call a no-op that resolves
  `{ applied: false }` — no balance check, no write — so a write that
  committed but reported an error (the acknowledgement lost after
  `COMMIT`) is not applied a second time when it is retried. A rejected
  batch (insufficient balance, any error) rolls its claim back with it,
  so its key is free for the next attempt. Without a key every call
  behaves as it always has and resolves `{ applied: true }`; so does a
  batch with nothing to write, which claims no key.

`Room` keys every write it may retry, and treats `applied: false` as
success (an earlier attempt landed):

| Write | Key |
|---|---|
| cash-out (`standUpNow`) | `cash_out:<roomId>:<sitId>` — one per sitting, no amount in it |
| buy-in (`sitDown`) | `buy_in:<roomId>:<sitId>` |
| refund of a buy-in that never got its seat | `buy_in_refund:<roomId>:<sitId>` |
| carry-over release | `carry_over:<roomId>:<id>` — one per release |

A write that failed may still have landed, so the room never acts on it
as if it had not:

- **Cash-out.** The seat is frozen (`cashOutPending`) from before the
  write until it is acknowledged: it keeps its stack, sits out, is never
  dealt in, and neither a rejoin nor Sit In thaws it. The end of every
  hand retries every pending cash-out (as do another Stand Up, Leave or
  kick, the reconnect expiry and a shutdown), under the same key. A kick
  that fails is finished, not just cashed out: the player has already been
  told `KICKED`, so the end of the next hand retries the whole removal
  (`leaveAfterHand`). Only a `Room.join` before then calls it off, and the gateway never sends one for a player who is
  still a member (`ALREADY_IN_ROOM`), so over the wire the kick stands.
- **Buy-in.** The player is not seated, and the attempt is kept
  (`pendingBuyIn`): the next Sit replays it — same key, same amount,
  before any amount or balance check — and seats the player with it. A
  removal or a shutdown replays it and then refunds it, so nobody is
  left debited and unseated. The failed attempt pushes `BALANCE` (re-read,
  so it shows the debit if the write landed), and the Sit that replays it
  pushes again once seated, as every Sit does.
- **Carry-over release.** The pot is held aside (`Room.pendingRelease`)
  with its batch, out of `carryOverPot`, and is settled first by the next
  release, by the next deal (which deals without it if it still cannot be
  settled) and by a close or shutdown. The room's view and the invariant
  below count it. Nothing newer is released behind it; a close or
  shutdown that still cannot settle it also logs the newer pot it leaves
  unreleased (`carry-over not released at close`, with the room, the
  amount and the pending release's key).

Every error line about one of these writes names its key, so an operator
can reconcile it against `ledger_keys`. The table fee is not keyed: it is
never retried.

A key is only ever replayed by the room that claimed it, and rooms live in
the server's memory, so no key can be retried across a restart. Both
editions empty `ledger_keys` when a server starts (`pruneLedgerKeys`):
Normal in `buildApp`, before the game server exists; Lite in `listen()`,
for the instance that owns the data directory (never a `--smoke` run).
This assumes one server per database (`docs/known-limitations.md`).

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
IN_GAME/OPEN ──(shutdown())──> CLOSED
IN_GAME/OPEN ──(last human removed, bots still seated)──> CLOSED            at once
IN_GAME/OPEN ──(last human removed, no bots + emptyRoomCloseMs)──> CLOSED   summary().closing meanwhile
```

"Human" means every member that is not a bot, connected or not: a
disconnected player is removed only when the spectator grace runs out
(`reconnectWindowMs` + `spectatorGraceMs`), and the room stays until then.
Whichever removal takes the last human out — a leave, the spectator-grace
timeout, or a Leave pressed mid-hand that takes effect when the hand is
settled (every removal runs the same check) — closes a room that still
seats bots there and then (`close('empty')`: the carried-over pot is
released, and with no human left it all goes to the `carry_over` sink), so
the lobby never lists a table of bots with nobody to play with. A room with
nobody in it at all keeps the `emptyRoomCloseMs` grace, listed with
`closing: true` ("Đang đóng…"), and a join cancels it. A hand stays current
— a Leave or Stand is deferred, and a kick of a seat dealt into it is
refused with `GAME_IN_PROGRESS` — until `onHandComplete` has settled it, not
just until its last move (clients see `HAND_COMPLETE` a moment before that).
`close()` and `shutdown()` set a `closing` flag first so the removal their
cancelled hand performs cannot start a second close; they settle a hand
whose settlement is still queued behind them (its post-hand stacks are what
go home, its carried pot is what is released), and every step of theirs is
guarded — a step that throws is logged (`room close step failed`) and the
room still ends `CLOSED` with one `onClosed`.

### Table stacks and the Blind table limit (spec 2026-09-29)

A seat plays from a stack taken out of the balance at `SIT_DOWN` (a
`buy_in` row, `refId` = roomId), in both modes: Hold'em brings the buy-in
the player chose, Blind brings the table limit `blindTableLimit(rules)`
(10 × the wager, 5 × before BP-31) — or the whole balance when that is less, as long as it
covers **one** wager, in both decision modes (Plan 27 D2; below that the
answer is `INSUFFICIENT_BALANCE`, and the client's hint quotes one wager).
A chaos table (BP-39, spec 2026-10-27 §3.7) has no limit: the room asks
`blindBuyInCap(rules)` from `@bp/core`, which is `null` there, and the seat
brings the **whole balance** (still at least one wager); a plain Blind table
keeps the 10× limit. Bots at a chaos table keep their virtual 10-wager stack.
The room pushes `BALANCE` right after the buy-in. Hands move only table
stacks; every way off a seat (stand, leave, kick, reconnect expiry, sat out
too long, shutdown) writes the stack back as a `cash_out`.

**Playing to zero (Plan 27 D1/D2, spec 2026-10-21 Part D).** A Blind table
takes no fee (`ECONOMY.blindTableFeeRate` is 0, so a Blind hand writes no
`table_fee` sink) and deals every seat with a stack above 0:
`requiredStack()` is 1 in both modes. A seat short of the wager antes what
it has and is all in; in play-or-fold a seat the ante emptied is played for
it — decided `play` at the deal, never asked, never timed out, and counted
neither way towards the three timeouts that stand a player up — and a seat
short for the second commit plays the rest of its stack ("Tất tay N" on the
button). An all-in seat wins only the pots it matched; when every seat that
covered a short one folds, each folder's excess above the highest live
commitment goes back to the folder (`returnDeadExcess` in core, ahead of
`settle`). When a hand ends, a human seat at exactly 0 — in **either** mode,
so a busted Hold'em seat too — is stood up (`standUpSpent`: nothing to cash
out, no ledger row) and stays in the room to watch; the player alone is sent
`NOTIFICATION { kind: 'STACK_SPENT', payload: { roomId, threshold } }`,
where `threshold` is `ECONOMY.reliefThreshold`, so the toast can point at
Cứu trợ. A player who chose to stand or leave in that hand gets no notice.
`TABLE_LIMIT_SPENT` is gone: no seat is ever stood up with points left.
Sitting again is a fresh buy-in. Bots play from a virtual stack of the
limit, play a short stack all in like a human, are topped back up only once
it is spent, and never touch the ledger.

### Carry-over pots (spec §8.4)

When every player folds a Blind hand the pot is not paid out: it carries
into the next hand. A pot must never be stranded, so `Room` releases it
whenever the table stops being able to use it — when the room has been
unable to start a hand for `carryOverReleaseMs` (the timer is armed each
time the room falls back to `OPEN` and cancelled as soon as a hand
starts), when the room closes, and on `shutdown()`. The pot is split
evenly among the seated humans (regardless of stack); the indivisible
remainder — or the whole pot, when there is nobody to pay — is recorded
as a `carry_over` sink row rather than being handed to an arbitrary
player. Until Plan 27 a human stood up for a spent table limit while the
pot was carried stayed a *claimant* on it; that path is deleted (Ruling 14):
every seat is now dealt with at least 1 point and an emptied seat is played
for it, so an all-fold hand always leaves each folder with points and
nobody reaches 0 while a pot is carried (`room-hands.test.ts` → "an
all-fold table plays its last wagers all in, so the carried-over pot goes
to a seat and never to the house"). The pot goes into the next hand as
`carryOverIn` and, in that hand, into the main pot, so a short all-in seat
is eligible for it (spec R19).

### The squeeze round (spec 2026-10-08)

A Blind room created with `blind.squeeze: true` is a squeeze table: each seat's hole cards go out at the deal as they
always did, but the player turns them by hand on their own screen, and the table waits for that inside one 20 s round.
`validateRoomConfig` forces `turnTimerSec` to `ECONOMY.squeezeTurnTimerSec` (20) whatever the client sent — ignored,
not refused — so `config.turnTimerSec * 1000` is already the round's length and the runner needs no option of its own
(`turnTimerMsOverride` still wins, as everywhere). What the server knows is one flag per seat, `HandPlayer.revealed`:
`false` for a human at the deal, `true` for a bot, a Hold'em seat and every seat of a plain Blind table.

| Piece | What it does |
|---|---|
| `REVEAL` (client → server) | `{ t: 'REVEAL', reqId? }`: "I have turned every one of my cards". It carries nothing else — the server cannot tell which card was peeled, and does not need to. The gateway hands it to `Room.reveal(playerId)` and answers `ACK`. |
| `Room.reveal(playerId)` | Queued like every other call. Refused with `NOT_SEATED` for a player with no seat, hand or no hand, and with `NOT_IN_HAND` for a seat that was not dealt into the hand that is running (the spec said `NOT_IN_HAND` for both; the wire has an exact code for the first). With no hand running — before the first, or after the one the `REVEAL` was sent for is over (the last card opened within a decision's last moment, a slow link) — a seated player's `REVEAL` returns without a word, so the client never shows "not in this hand" for it. Outside a squeeze round — a plain table, a Hold'em one, the reveal, a turn — it returns without touching the runner: submitting would re-arm the hand's timers for nothing, and a late or repeated `REVEAL` must cost nothing. In a round — `SQUEEZE`, or the `DECISION` of a squeeze table — it submits `REVEALED { seat }`. |
| `SQUEEZE_PHASE` | Opens a pure-luck round (Blind A on a squeeze table) between the deal and the reveal. `seats` is the humans who have not turned; with none (a hand of bots alone) it names nobody and `SQUEEZE_ENDED` follows at once. It is turn-scoped like `DECISION_PHASE`: it takes `turnStartSeq` and goes out stamped with the round's `deadlineAt`, and a `ROOM_SNAPSHOT` taken mid-round carries the same `deadlineAt`. |
| Play-or-fold on a squeeze table | No new phase: the `DECISION` round stays, and its `turnTimer` is the 20 s. `REVEAL` marks the seat without ending it, and a `play`/`fold` turns the seat too (`PLAYER_REVEALED`). |

`HandRunner` arms one deadline per squeeze round, on entering `SQUEEZE`, and no bot timer (a bot is turned from the
deal). `PLAYER_REVEALED` does not bump `turnSeq`, so seats turning one after another leave the shared deadline alone,
exactly as `DECISION_MADE` does; the round ends the moment the last human has turned (`SQUEEZE_ENDED`, then the board
comes at `revealDelayMs` as any reveal does). When the deadline passes, `onSqueezeTimeout(turnSeq)` — guarded by the
phase and the `turnSeq` it was armed for, so a timer that outlives its round or its hand does nothing — submits
`REVEALED` for every seat still down. That is **not** a `TIMEOUT`: no `PLAYER_ACTED` with `timedOut`, so
`consecutiveTimeoutsToStand` does not move (spec §8.7). A seat marked auto-fold (it left or stood up mid-round) is turned
for in the same breath (`applyAutoFolds`), so the round never waits on a seat with nobody behind it. `REVEALED` outside
a squeeze round is a no-op in the engine, never an error — except on a hand that is already `COMPLETE`, where the engine's
common guard throws `HAND_COMPLETE`; `Room.reveal` never reaches it, since it returns first when the hand is over.

### The chaos room (Plan 37, spec 2026-10-26)

A Blind room created with `blind.chaosCycle` (5 or 10; `validateRoomConfig` refuses any other value, and an absent one leaves no
key on the config or on the ruleset) is a chaos table. The cards' rules are pure code in `@bp/core` (`planHand`, `afterHand`,
`receiveCard`, the engine's appliers); what the room adds is the draft, each seat's cards, the plan it feeds the engine and the payouts.
The code is `room/room-chaos.ts` (`ChaosTable`, the helper `Room` holds) and a few hooks in `room.ts`.

**The port.** `RoomDeps.chaos?: ChaosPort` (from `createGameServer({ chaos })`), three calls: `catalogue()` (the cards active now and
the GM's draw weights, 0 = never), `config()` (`ChaosConfig`: tier weights, points threshold, draft ms, result ms, daily cap and
rescues) and `credit({ playerId, roomId, amount, reason, key })` → `{ credited, capped }`. `config()` is read at each draft and, since
BP-39, again after each hand for `resultMs` (`ChaosTable.resultMs()`; a port that throws or answers a non-positive number gives
`DEFAULT_CHAOS_CONFIG.resultMs`, 10 s, logged), so a GM change takes effect from the next result. Without a port, `RoomManager.create` answers
`ERROR{CHAOS_UNAVAILABLE}` to a chaos config (and `Room`'s constructor throws the same code), so Lite and any edition that passes none
simply never has a chaos table. The catalogue is read at each draft and kept for the hands until the next one; if the port throws
there, the room logs it and deals without a draft (the next hand tries again).

**The draft.** Its own state on the room (`draft`), guarding `startHand`: after eligibility and before the sit-out loop, `startHand`
opens one when a seat has not drafted this cycle (the first hand a seat plays, then when the table's hand count reaches 5k or 10k;
"a draft at hand 5" means before the hand when `tableHands === 5`). The room is `IN_GAME` with `ROOM_STATUS { nextHandAt: deadlineAt }`
while it is open, and `startHand` returns `true`. One tier is drawn for the whole table (`drawTier`) and each drafted seat gets three
distinct cards of it (`drawOffer`, mode-safe: ✱ cards never on a pure-luck table). Bots and disconnected humans are picked for at once
(random); a human has `draftMs` (15 s), then a random pick; a human with auto-play on is answered by the client at once. The draft ends
on the last pick or the deadline: the cards are handed out (`CHAOS_PICKED` per seat, then `CHAOS_STATE` with every seat's cards and
points) and `startHand(true)` deals, skipping a second draft. A seat that sat down during the draft plays that hand undrafted and
drafts before its next; one that stands and sits again in the same cycle is not offered a second draft; a seat that leaves or stands
mid-draft drops its offer and, if it was the last one waited on, ends the draft through the room queue (never from inside the stand-up).
`cancelTimers` (so `close` and `shutdown`) cancels the draft's timer. A held Tay bạc is dropped when its holder drafts again.

**The hand.** Just before the `HandRunner`, `planHand` (from the seats' `ChaosSeat`s) builds the `ChaosHandPlan` that goes into
`CreateHandInput.chaos`. After the hand — **after `recordHand` and `HAND_SETTLED`, before the stand-up and leave loop**, so a seat
at stack 0 can be rescued before `standUpSpent` — `settleHand` runs `afterHand` and pays every credit; a cancelled hand skips all of
it. A win is a seat in any pot's winners; every other seat in the hand lost; a hand with no pot is a carry-over and counts for nobody.
`net` is the stack change against `runner.stacksBefore` (refunds included). `HandSummary.chaosUsed` comes from the engine's
`CHAOS_SUMMARY`.

**Credits.** A human credit calls `port.credit` with the key `chaos:<roomId>:<handId>:<seat>:<uid>:<reason>`, retried once under the same key;
a second failure is logged (`chaos credit failed; pending`, with the key) and the credit is **kept pending** under its key
(`ChaosTable.pending`, per player, oldest first): it may have landed. `settlePending` retries it after the next hand (before that
hand's own credits), before the seat is judged spent (a rescue whose reply was lost keeps the seat), and at the top of `standUpNow` —
a stand-up, Leave or kick it cannot settle is refused and the seat sits out with `cashOutPending`, retried after each hand. A replayed
key answers with what it wrote, so the stack is raised once. The room then adds `credited` to the stack, pushes the balance, and
broadcasts `CHAOS_CREDIT { seat, reason, amount, stack, capped, multiplier? }` before `CHAOS_STATE`; `stack` is the seat's stack
after the credit, absolute, which the client writes to its roster. A credit cut to 0 is
still broadcast, so the table can say "capped". A bot's credit goes on its virtual stack with no ledger row and `capped: false`. A seat that
**stands up or leaves** loses its cards and points (`standUpNow` clears `p.chaos`).

**The bonus hand (BP-39).** A human's bonus cards (from points, `afterHand`'s `bonusAwarded`) wait in `ChaosSeat.bonus`, private.
`CHAOS_USE { uid }` → `Room.useChaosBonus` → `ChaosTable.useBonus` → `armBonus`. Allowed for a seated human at a chaos table either
with no hand live (the interval, a draft, before the first deal: `{ phase: 'between' }`, the card fires in the next hand) or during the
`DECISION` phase of a hand the seat is dealt into (`{ phase: 'decision', frozen: p.chaos.frozenNextHand, planSeat }`; a `'this'` arm
calls `addRevealEffect` on `runner.state`, the live object, so the reveal fires it). Anything else — squeeze, reveal, a pure-luck hand, a
seat not in the hand, every `armBonus` error — is `CHAOS_CANNOT_USE` (the message says why). Nothing is broadcast on a press: the owner
gets `NOTIFICATION { kind: 'CHAOS_BONUS', payload: ChaosBonusPayload }` (`bonusFor`) after every change to its bonus hand or pressed
card — a press, `planHand` turning a `next` card into `this`, `afterHand` drawing, spending or returning one, a stand-up or Leave
clearing it — and the table only sees `bonusCount = bonus.length + (armed ? 1 : 0)` in `CHAOS_STATE` and `RoomPlayerView.chaos`, so an
armed card is invisible until it fires (a holder who folds gets it back in silence). `CHAOS_AWARDED` lists only cards that went through
`receiveCard`. `ROOM_SNAPSHOT.chaos.bonus` carries the viewer's own bonus hand, for a seated viewer only; the hand view never carries the
plan.

**The result wait and "Bỏ qua" (BP-39).** After a chaos hand the room waits `chaos.resultMs()` (10 s by default, the GM's 5–15 s)
instead of `handIntervalMs`, and says so in `ROOM_STATUS { nextHandAt }`; a plain table still waits `handIntervalMs`. The wait is
`inResultWait()`: a chaos room, not closed, `nextHandTimer` armed, no runner and no draft open. Its voters are the seated humans
who are connected and neither sitting out nor asked to (`resultVoters()`; bots never count, a human on auto-play does — its client
presses for it). `RESULT_SKIP` → `Room.skipResult(playerId)` adds the voter to `resultSkips`; outside a wait, from a non-voter or
twice it is ignored without an error (the gateway still ACKs). `recountResultSkips()` runs after a press and after anything that can
move the count — a seat taken or left, a sit-out or sit-in, a disconnect or reconnect, a stand-up, Leave or kick — broadcasts
`RESULT_SKIPS { skipped, total }` when the tally changed (always once at the start of a wait), and when every voter has pressed it
calls `startHand()` at once, which cancels the timer (a timer that fires after that deals nothing: it checks it is still
`nextHandTimer`). `ROOM_SNAPSHOT.resultSkips` (`{ skipped, total, mine }`, `mine` per viewer, false for a spectator) restores the
tally during a wait and is absent otherwise. A new wait clears the presses.

**Wire.** `ClientMessage` `CHAOS_PICK { offerId, cardId }` (`Room.pickChaos`: a stale, foreign or second pick is `CHAOS_NO_OFFER`, a card
that was not offered is `ILLEGAL_ACTION`), `CHAOS_USE { uid }` (above) and `RESULT_SKIP` (no body but the optional `reqId`). Room events `CHAOS_DRAFT` (tier, deadline, `draftMs` — the GM's window, for the client's ring — and the drafted seats), `CHAOS_PICKED`, `CHAOS_STATE`,
`CHAOS_CREDIT`, `CHAOS_AWARDED`, `RESULT_SKIPS`; the private `CHAOS_OFFER` and `CHAOS_BONUS` notifications; `ROOM_SNAPSHOT.chaos` restores the
viewer's draft and bonus hand after a reconnect, and `ROOM_SNAPSHOT.resultSkips` the "Bỏ qua" tally; `RoomPlayerView.chaos` carries a seat's cards, points and `bonusCount`. Game events (from the engine): `CHAOS_APPLIED`,
`CHAOS_PEEK`, `CHAOS_SUMMARY` (each use with its `targets`). Error code `CHAOS_CANNOT_USE` answers every refused `CHAOS_USE`.

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
| `handIntervalMs` | 5,000 | Pause between hands in a room (a chaos table waits its port's `resultMs` instead, BP-39) |
| `revealDelayMs` | 1,500 | Delay before revealing decisions/community cards |
| `botDelayMs` | `[1000, 3000]` | Random think-time range for bot actions |
| `reconnectWindowMs` | 90,000 | How long a disconnected seated player is held before auto-fold/stand |
| `spectatorGraceMs` | 300,000 | After the reconnect window, how long before the player is removed from the room entirely |
| `emptyRoomCloseMs` | 60,000 | How long a room with nobody in it — no humans and no bots — stays open (listed as `closing`) before closing; a room whose last human leaves while bots are seated closes at once |
| `carryOverReleaseMs` | 60,000 | How long a room may sit unable to start a hand before its carry-over pot is released (spec §8.4) |
| `consecutiveTimeoutsToStand` | 3 | Timed-out actions in a row before a human is stood up automatically: a Hold'em turn, or a Blind play-or-fold decision the timer folded (`PLAYER_ACTED{timedOut}`, told with the other decisions when the round resolves — never earlier, which would give the fold away). Any other action resets the count; the squeeze round running out is neither |
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
  seats currently in the hand for turn-scoped events. Since Plan 37
  `filterEvent` returns `GameEvent | null`: `null` means "this viewer gets
  nothing" (a deal-time `CHAOS_APPLIED` that is not theirs and does not
  target them), and `Room` skips the send. The viewer's `seq` then jumps
  forward by one, which the client's gap check (backward only) ignores. A
  `CHAOS_PEEK` that is not the viewer's goes out with `cards: []`.

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
recorded as a sink row — nothing is left in RAM. The exceptions are a
write the repository refuses. A cash-out, or the refund of a buy-in that
never got its seat, is logged (`shutdown settlement failed`, with the
player, the stack, the buy-in when it is a refund, and the write's key)
for an operator to reconcile, and the room still closes and the other
seats are still cashed out, so one bad row cannot hold up the rest of the
shutdown. A carry-over release that fails is logged with its pot and key
(and the newer pot held behind it, `carry-over not released at close`).

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
  With `chaos: true | { cards?, config?, capPoints?, rescues? }` the
  harness also builds an in-memory `ChaosPort` (`createMemoryChaosPort`,
  exported from `testing/`) over the same repositories: a credit writes
  the `[+reason, −chaos_to_table]` pair under its key, a replayed key
  returns the amount already written, `capPoints` and `rescues` stand in
  for the economy-day cap, and `weights`, `failReads` and `failCredit`
  are test hooks. Its `resultMs` is 100 ms (the harness's own interval),
  so the result wait never stalls a test that is not about it. Bots-only drafts finish at once; to play a human's
  draft call `room.pickChaos(playerId, offerId, cardId)` with the ids
  from its `CHAOS_OFFER`.
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
