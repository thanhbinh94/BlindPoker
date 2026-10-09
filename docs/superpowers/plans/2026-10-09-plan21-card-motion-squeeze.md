# Card motion and the Blind squeeze mode — Implementation Plan (Plan 21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card comes out of a deck drawn on the table and turns over where it lands; opponents' cards lift and flip at the showdown; and a Blind Poker table can run in *squeeze mode*, where each player turns their own face-down cards by hand (peel from the touch point) inside a 20 s round that ends early once everyone has turned.

**Architecture:** The engine (`@bp/core`) gains a `SQUEEZE` phase, a `REVEALED` command and a per-seat `revealed` flag; the server (`@bp/server-kit`) times the phase and accepts a `REVEAL` message; the kit (`@bp/ui-kit`) draws a `Deck`, slides every `Card` from it, lifts opponents' cards at the showdown, and renders the viewer's own cards as `PeelCard`s (a 2D peel: clip and translate, no 3D) in squeeze rooms. Both editions share all three packages, so nothing is edition-specific.

**Tech Stack:** TypeScript, React 18, CSS 3D transforms and keyframes, Pointer Events, vitest + @testing-library/react, Playwright (the ops pack). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md` (read it first; this plan argues from it). Rules it amends: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8.

## Global Constraints

- No new runtime dependencies (spec §1): CSS, Web Animations/`requestAnimationFrame`, Pointer Events only.
- Durations (spec §3): slide from the deck 360 ms; flip in place 600 ms; lift-and-flip 720 ms; deal stagger 120 ms per card around the table; board stagger 300 ms; showdown stagger 200 ms; peel snap 220 ms, finish 260 ms, slide back 220 ms. Thresholds: open at p ≥ 0.5, flick at ≥ 0.9 px/ms along the peel when p > 0.12, full peel at 0.75 × the card's length along the peel.
- Squeeze rooms force `turnTimerSec = 20` (spec §4.2.1) — forced by the server, never refused.
- `prefers-reduced-motion: reduce`: no animation anywhere; a peel still works but snaps (spec §4.1.5, §6).
- Every player-facing string exists in both `vi` and `en` locales (`packages/ui-kit/src/i18n/locales/*/game.json`).
- Money and ledgers are untouched (spec §7); no DB migration.
- Commit after every task. Run `pnpm typecheck` and `pnpm lint` before each commit; use `export PATH="$PATH:$(npm prefix -g)"` first in the Bash tool.
- Bots: in squeeze rooms a bot is `revealed` from the start of the hand (spec §4.2.3).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/hand/types.ts` | `BlindRules.squeeze`, `HandPhase 'SQUEEZE'`, `HandPlayer.revealed`, `HandCommand REVEALED`, three new events |
| `packages/core/src/hand/blind.ts` | the squeeze phase, `REVEALED`, decisions marking `revealed` |
| `packages/core/src/hand/holdem.ts` | `revealed: true` on every Hold'em player |
| `packages/core/src/hand/view.ts` | `SeatView.revealed` |
| `packages/core/src/constants/economy.ts` | `squeezeTurnTimerSec: 20` |
| `packages/core/src/protocol/messages.ts`, `validate.ts` | `BlindRoomConfig.squeeze`, `REVEAL` message, forced timer, ruleset |
| `packages/server-kit/src/room/hand-runner.ts` | the 20 s squeeze deadline and the forced reveals |
| `packages/server-kit/src/room/room.ts`, `gateway/gateway.ts` | `Room.reveal`, `REVEAL` routing, `SQUEEZE_PHASE` carries `deadlineAt` |
| `packages/ui-kit/src/client/{types,reducer,useGameClient}.ts(x)` | `ClientPhase 'SQUEEZE'`, `ClientSeat.revealed`, `ClientHand.restored`, `client.reveal()`, auto-play reveals |
| `packages/ui-kit/src/table/Deck.tsx` (new) | the deck and the anchor cards measure against |
| `packages/ui-kit/src/table/Card.tsx`, `table.module.css`, `theme/tokens.css` | `dealt`, `reveal: 'flip' \| 'lift'`, the slide and lift keyframes, the duration constants |
| `packages/ui-kit/src/table/peel.ts` (new), `PeelCard.tsx` (new) | peel geometry (pure) and the peelable card |
| `packages/ui-kit/src/table/{Seat,PokerTable,CommunityCards,ActionBar}.tsx`, `screens/{RoomScreen.tsx,reveal-hold.ts}` | deal order and `dealt`, the deck in the centre, squeeze wiring, the "Lật" pill, the "Đã lật" badge, wait text, the hold |
| `packages/ui-kit/src/lobby/{CreateRoomFields,CreateRoomForm,RoomList}.tsx`, `table/RoomHeader.tsx` | the "Nặn bài" option, hidden timer, badges |
| `apps/normal-web/e2e/ops/04-blind.spec.ts`, `ops-helpers.ts`; `apps/lite/e2e/lite.spec.ts` | the two-browser squeeze scenario, shots, the Lite smoke |
| `docs/…`, `CHANGELOG.md` | documentation |

---

### Task 1: Core engine — the squeeze phase

**Files:**
- Modify: `packages/core/src/hand/types.ts`
- Modify: `packages/core/src/hand/blind.ts`
- Modify: `packages/core/src/hand/holdem.ts:38-41` (player literal)
- Modify: `packages/core/src/hand/view.ts`
- Test: `packages/core/src/hand/blind.test.ts`

**Interfaces:**
- Consumes: `getPlayer`, `clone`, `revealNext`, `settle` from `hand/common.ts` (unchanged).
- Produces: `BlindRules.squeeze?: boolean`; `HandPhase` includes `'SQUEEZE'`; `HandPlayer.revealed: boolean`; `HandCommand` includes `{ type: 'REVEALED'; seat: number }`; `GameEvent` includes `{ type: 'SQUEEZE_PHASE'; seats: number[]; turnSeq: number }`, `{ type: 'PLAYER_REVEALED'; seat: number }`, `{ type: 'SQUEEZE_ENDED' }`; `SeatView.revealed: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/hand/blind.test.ts` (it already imports `applyBlindCommand`, `createBlindHand`, `playerView`, `seededRng`, `identityRng`, `rules`, `Table`):

```ts
describe('squeeze mode (spec 2026-10-08)', () => {
  const squeezeRules = (decisionMode: BlindRules['decisionMode']) => rules({ decisionMode, squeeze: true })
  /** Three seats; `bots` names the bot seats. */
  const deal = (decisionMode: BlindRules['decisionMode'], bots: number[] = []) => {
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: bots.includes(seat) }))
    return createBlindHand({ handId: 'sq', rules: squeezeRules(decisionMode), seats, button: 0, carryOverIn: 0 }, seededRng(3))
  }
  const step = (state: HandState, cmd: Parameters<typeof applyBlindCommand>[1]) => applyBlindCommand(state, cmd, identityRng)

  it('pure luck: deals into a SQUEEZE phase, bots already revealed, ending when every human has turned', () => {
    const { state, events } = deal('none', [2])
    expect(state.phase).toBe('SQUEEZE')
    expect(state.players.map((p) => p.revealed)).toEqual([false, false, true])
    expect(events.at(-1)).toEqual({ type: 'SQUEEZE_PHASE', seats: [0, 1], turnSeq: 1 })
    expect(state.turnSeq).toBe(1)

    const r1 = step(state, { type: 'REVEALED', seat: 0 })
    expect(r1.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }])
    expect(r1.state.phase).toBe('SQUEEZE')
    const again = step(r1.state, { type: 'REVEALED', seat: 0 })
    expect(again.events).toEqual([]) // a second REVEALED from the same seat is nothing
    const r2 = step(again.state, { type: 'REVEALED', seat: 1 })
    expect(r2.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 1 }, { type: 'SQUEEZE_ENDED' }])
    expect(r2.state.phase).toBe('REVEAL')
    // From here the hand runs out as any pure-luck hand does.
    let s = r2.state
    while (s.phase === 'REVEAL') s = step(s, { type: 'ADVANCE' }).state
    expect(s.phase).toBe('COMPLETE')
    expect(s.result?.showdown).not.toBeNull()
  })

  it('a table of bots only skips the phase: SQUEEZE_PHASE names nobody and the hand is in REVEAL at once', () => {
    const { state, events } = deal('none', [0, 1, 2])
    expect(events.filter((e) => e.type === 'SQUEEZE_PHASE' || e.type === 'SQUEEZE_ENDED')).toEqual([
      { type: 'SQUEEZE_PHASE', seats: [], turnSeq: 1 },
      { type: 'SQUEEZE_ENDED' },
    ])
    expect(state.phase).toBe('REVEAL')
  })

  it('play or fold: no SQUEEZE phase; REVEALED marks the seat without ending the round; a decision turns the cards too', () => {
    const { state } = deal('playOrFold')
    expect(state.phase).toBe('DECISION')
    expect(state.players.map((p) => p.revealed)).toEqual([false, false, false])
    const r1 = step(state, { type: 'REVEALED', seat: 1 })
    expect(r1.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 1 }])
    expect(r1.state.phase).toBe('DECISION')
    // Deciding without having turned: the engine turns the cards for the seat, before the decision is recorded.
    const r2 = step(r1.state, { type: 'ACTION', seat: 0, action: { kind: 'play' } })
    expect(r2.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }, { type: 'DECISION_MADE', seat: 0 }])
    // A seat that had turned already decides with no second PLAYER_REVEALED.
    const r3 = step(r2.state, { type: 'ACTION', seat: 1, action: { kind: 'fold' } })
    expect(r3.events).toEqual([{ type: 'DECISION_MADE', seat: 1 }])
  })

  it('REVEALED is a no-op outside squeezing, and ADVANCE is refused during SQUEEZE', () => {
    const plain = new Table(rules({ decisionMode: 'none' }), [5000, 5000])
    expect(plain.state.players.every((p) => p.revealed)).toBe(true)
    expect(plain.apply({ type: 'REVEALED', seat: 0 })).toEqual([])
    const { state } = deal('none', [2])
    expect(() => step(state, { type: 'ADVANCE' })).toThrow(EngineError)
    expect(() => step(state, { type: 'REVEALED', seat: 7 })).toThrow(EngineError) // NOT_IN_HAND
  })

  it('the view carries revealed per seat, and a Hold’em or plain Blind seat is always revealed', () => {
    const { state } = deal('none', [2])
    const r = step(state, { type: 'REVEALED', seat: 0 })
    expect(playerView(r.state, 1).seats.map((s) => s.revealed)).toEqual([true, false, true])
    expect(playerView(r.state, 1).phase).toBe('SQUEEZE')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/core exec vitest run src/hand/blind.test.ts -t "squeeze mode"`
Expected: FAIL — `squeeze` is not a known property / `revealed` undefined / phase `'REVEAL'` instead of `'SQUEEZE'`.

- [ ] **Step 3: Types**

In `packages/core/src/hand/types.ts`:

```ts
export interface BlindRules {
  mode: 'blind'
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  tableFeeRate: number
  /**
   * Squeeze mode (spec 2026-10-08): each seat's hole cards stay face down on its own screen until it turns them, and
   * the table waits — a `SQUEEZE` phase in pure luck, the 20 s decision round in play-or-fold. Absent means off.
   */
  squeeze?: boolean
}

export type HandPhase = 'BETTING' | 'DECISION' | 'SQUEEZE' | 'REVEAL' | 'COMPLETE'
```

Add to `HandPlayer` (after `decision`):

```ts
  /** Squeeze mode: this seat has turned every one of its cards over. Always true outside squeeze mode, and for a bot. */
  revealed: boolean
```

Add to `HandCommand`:

```ts
  | { type: 'REVEALED'; seat: number }
```

Add to `GameEvent` (after `DECISIONS_REVEALED`):

```ts
  | { type: 'SQUEEZE_PHASE'; seats: number[]; turnSeq: number }
  | { type: 'PLAYER_REVEALED'; seat: number }
  | { type: 'SQUEEZE_ENDED' }
```

In `packages/core/src/hand/holdem.ts`, the player literal in `createHoldemHand` gains `revealed: true` after `decision: null`.

In `packages/core/src/hand/view.ts`, `SeatView` gains `revealed: boolean` after `decision`, and `playerView` maps it: `revealed: p.revealed,`.

- [ ] **Step 4: The engine**

In `packages/core/src/hand/blind.ts`, `createBlindHand`:

```ts
  const squeeze = input.rules.squeeze === true
  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: input.rules.decisionMode === 'playOrFold' ? 'DECISION' : squeeze ? 'SQUEEZE' : 'REVEAL',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null,
      // Squeeze mode waits only on humans: a bot has nothing to turn by hand (spec 2026-10-08 §4.2.3).
      revealed: !squeeze || s.isBot,
    })),
    // … the rest exactly as it is
  }
```

Replace the trailing `if (state.phase === 'DECISION') {…}` block with:

```ts
  if (state.phase === 'DECISION') {
    state.turnSeq += 1
    events.push({ type: 'DECISION_PHASE', seats: state.players.map((p) => p.seat), turnSeq: state.turnSeq })
  } else if (state.phase === 'SQUEEZE') {
    state.turnSeq += 1
    events.push({ type: 'SQUEEZE_PHASE', seats: state.players.filter((p) => !p.revealed).map((p) => p.seat), turnSeq: state.turnSeq })
    endSqueezeIfDone(state, events) // a table of bots has nobody to wait for
  }
  return { state, events }
```

Add the `REVEALED` case to `applyBlindCommand` (before `case 'ACTION'`):

```ts
    case 'REVEALED': {
      reveal(state, events, cmd.seat)
      return { state, events }
    }
```

Add the two helpers after `decide`:

```ts
/**
 * Squeeze mode: `seat` has turned its cards over (by hand, by its "Lật" button, or by the server when the round ran
 * out). Outside squeezing — a plain table, another phase, a seat that had turned already — it is nothing, not an
 * error: a client that sends it late or twice is doing no harm (spec 2026-10-08 §6).
 */
function reveal(state: HandState, events: GameEvent[], seat: number): void {
  const p = getPlayer(state, seat)
  const squeezing = state.phase === 'SQUEEZE' || (state.phase === 'DECISION' && rulesOf(state).squeeze === true)
  if (!squeezing || p.revealed) return
  p.revealed = true
  events.push({ type: 'PLAYER_REVEALED', seat })
  if (state.phase === 'SQUEEZE') endSqueezeIfDone(state, events)
}

/** The squeeze round is over once every seat has turned: on to the community cards, as a pure-luck hand goes. */
function endSqueezeIfDone(state: HandState, events: GameEvent[]): void {
  if (state.phase !== 'SQUEEZE' || state.players.some((p) => !p.revealed)) return
  events.push({ type: 'SQUEEZE_ENDED' })
  state.phase = 'REVEAL'
}
```

In `decide`, after the two `legal` checks and before `p.decision = …`, add:

```ts
  // In a squeeze room a decision shows the cards it was made on: the seat counts as turned from here (§4.2.4).
  if (rulesOf(state).squeeze === true && !p.revealed) {
    p.revealed = true
    events.push({ type: 'PLAYER_REVEALED', seat })
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @bp/core exec vitest run src/hand` then `pnpm typecheck`
Expected: PASS. If `typecheck` reports a test building a `HandPlayer` literal without `revealed`, add `revealed: true` to that literal (there are none in `src/hand` today; `simulate.test.ts` and the bot tests build hands through `createHand`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hand
git commit -m "feat(core): squeeze mode — a SQUEEZE phase, REVEALED per seat, bots revealed from the deal (spec 2026-10-08)"
```

---

### Task 2: Protocol — `blind.squeeze`, the forced 20 s timer, the `REVEAL` message

**Files:**
- Modify: `packages/core/src/constants/economy.ts`
- Modify: `packages/core/src/protocol/messages.ts`
- Modify: `packages/core/src/protocol/validate.ts`
- Test: `packages/core/src/protocol/validate.test.ts`

**Interfaces:**
- Consumes: Task 1's `BlindRules.squeeze`.
- Produces: `ECONOMY.squeezeTurnTimerSec = 20`; `BlindRoomConfig.squeeze?: boolean` (validated configs always carry it, `false` by default); `ClientMessage` includes `{ t: 'REVEAL'; reqId?: string }`; `roomConfigToRuleset` sets `squeeze`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/protocol/validate.test.ts` (it defines `blind`, a valid Blind raw config, and imports `validateRoomConfig`, `parseClientMessage`, `roomConfigToRuleset` — add any of those three the file does not import yet):

```ts
describe('squeeze mode (spec 2026-10-08)', () => {
  const squeeze = { ...blind, blind: { ...blind.blind, squeeze: true } }

  it('is off unless asked for, and comes back on a validated config either way', () => {
    const off = validateRoomConfig(blind)
    expect(off.ok && off.value.blind).toMatchObject({ squeeze: false })
    const on = validateRoomConfig(squeeze)
    expect(on.ok && on.value.blind).toMatchObject({ squeeze: true })
  })

  it('forces the round to 20 s on a squeeze table, whatever timer was sent — and refuses 20 s elsewhere', () => {
    for (const turnTimerSec of [undefined, 10, 15, 20, 30, 999]) {
      const r = validateRoomConfig({ ...squeeze, turnTimerSec })
      expect(r.ok && r.value.turnTimerSec, String(turnTimerSec)).toBe(20)
    }
    expect(validateRoomConfig({ ...blind, turnTimerSec: 20 }).ok).toBe(false)
    expect(ECONOMY.squeezeTurnTimerSec).toBe(20)
  })

  it('refuses a squeeze flag that is not a boolean, and never on a Hold’em table', () => {
    expect(validateRoomConfig({ ...blind, blind: { ...blind.blind, squeeze: 'yes' } }).ok).toBe(false)
    const h = validateRoomConfig(holdem)
    expect(h.ok && h.value.blind).toBeUndefined()
  })

  it('carries squeeze into the ruleset', () => {
    const r = validateRoomConfig(squeeze)
    expect(r.ok && roomConfigToRuleset(r.value)).toMatchObject({ mode: 'blind', squeeze: true })
    const plain = validateRoomConfig(blind)
    expect(plain.ok && roomConfigToRuleset(plain.value)).toMatchObject({ mode: 'blind', squeeze: false })
  })

  it('parses REVEAL as a bare message with an optional reqId', () => {
    expect(parseClientMessage({ t: 'REVEAL' })).toEqual({ ok: true, value: { t: 'REVEAL' } })
    expect(parseClientMessage({ t: 'REVEAL', reqId: 'r1' })).toEqual({ ok: true, value: { t: 'REVEAL', reqId: 'r1' } })
  })
})
```

(`ECONOMY` and `holdem` are already in scope in that file; check the exact name of the client-message parser at the top of `validate.ts` — it is the function whose `switch (raw.t)` lists `'LIST_ROOMS'` — and import it under that name.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/core exec vitest run src/protocol/validate.test.ts -t "squeeze mode"`
Expected: FAIL (`squeeze` dropped, timer refused, `REVEAL` unknown).

- [ ] **Step 3: Implement**

`packages/core/src/constants/economy.ts` — add beside `blindTurnTimers`:

```ts
  /** A squeeze table's round (spec 2026-10-08 §4.2.1): fixed, not one of `blindTurnTimers`. */
  squeezeTurnTimerSec: 20,
```

`packages/core/src/protocol/messages.ts`:

```ts
export interface BlindRoomConfig {
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  botCount: number
  /** Squeeze mode (spec 2026-10-08): hole cards are turned by hand inside a 20 s round. A validated config always sets it. */
  squeeze?: boolean
}
```

and in `ClientMessage`, after `SIT_IN`:

```ts
  /** Squeeze mode: the sender has turned every one of its cards (spec 2026-10-08 §5.2). Harmless anywhere else. */
  | { t: 'REVEAL'; reqId?: string }
```

`packages/core/src/protocol/validate.ts`:

1. In the client-message parser, add `'REVEAL'` to the bare-message case: `case 'LIST_ROOMS': case 'LEAVE_ROOM': case 'STAND_UP': case 'SIT_OUT': case 'SIT_IN': case 'START_GAME': case 'RESYNC': case 'PONG': case 'REVEAL':`.
2. In `validateRoomConfig`, replace the two `turnTimerSec` lines with:

```ts
  const timers: readonly number[] = mode === 'holdem' ? ECONOMY.holdemTurnTimers : ECONOMY.blindTurnTimers
  // A squeeze table's round is fixed (spec 2026-10-08 §4.2.1): the timer a client sends with it is ignored, not refused.
  const squeezeWanted = mode === 'blind' && isObj(raw.blind) && raw.blind.squeeze === true
  const turnTimerSec = squeezeWanted ? ECONOMY.squeezeTurnTimerSec : raw.turnTimerSec === undefined ? (mode === 'holdem' ? 30 : 15) : raw.turnTimerSec
  if (!squeezeWanted && (!isInt(turnTimerSec) || !timers.includes(turnTimerSec))) return bad(`turnTimerSec must be one of ${timers.join(', ')}`)
```

3. In the blind branch, after `botCount`:

```ts
    const squeeze = b.squeeze === undefined ? false : b.squeeze
    if (!isBool(squeeze)) return bad('squeeze must be boolean')
    const blind: BlindRoomConfig = { holeCards: b.holeCards, decisionMode, fixedWager: b.fixedWager, botCount, squeeze }
```

4. `roomConfigToRuleset`'s blind branch returns `{ mode: 'blind', holeCards: b.holeCards, decisionMode: b.decisionMode, fixedWager: b.fixedWager, tableFeeRate: ECONOMY.tableFeeRate, squeeze: b.squeeze === true }`.

- [ ] **Step 4: Run the tests, typecheck**

Run: `pnpm --filter @bp/core test` and `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constants/economy.ts packages/core/src/protocol
git commit -m "feat(protocol): blind.squeeze on a room, the 20 s round it forces, and the REVEAL message"
```

---

### Task 3: Server — the squeeze deadline, `Room.reveal`, the gateway

**Files:**
- Modify: `packages/server-kit/src/room/hand-runner.ts`
- Modify: `packages/server-kit/src/room/room.ts` (near `action`, and `onHandEvents`)
- Modify: `packages/server-kit/src/gateway/gateway.ts:371-376`
- Test: `packages/server-kit/src/room/room-hands.test.ts`

**Interfaces:**
- Consumes: Task 1's `SQUEEZE` phase and `REVEALED`; Task 2's `REVEAL` message and forced timer.
- Produces: `Room.reveal(playerId: string): Promise<void>` (errors `NOT_IN_HAND`, `NOT_SEATED`); `SQUEEZE_PHASE` goes out with `deadlineAt`; the runner turns every unrevealed seat when the deadline passes.

- [ ] **Step 1: Write the failing tests**

In `packages/server-kit/src/room/room-hands.test.ts`, teach `playOut` the new phase — inside its loop, before the `humanSeat` lookup:

```ts
    if (hand.phase === 'SQUEEZE') {
      for (const s of hand.seats) if (!s.isBot && !s.revealed) await h.room.reveal(s.playerId)
      await tick(h)
      continue
    }
```

and add a `describe`:

```ts
describe('squeeze mode (spec 2026-10-08)', () => {
  const SQUEEZE: RoomConfig = { ...BLIND, turnTimerSec: 20, blind: { ...BLIND.blind!, decisionMode: 'none', botCount: 1, squeeze: true } }
  const types = (h: RoomHarness, id: string) => h.ofType(id, 'GAME_EVENT').map((m) => m.event.type)

  it('opens a SQUEEZE round with a deadline and ends it the moment the one human has turned', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    const phase = h.ofType('h', 'GAME_EVENT').find((m) => m.event.type === 'SQUEEZE_PHASE')!
    expect(phase.event).toMatchObject({ type: 'SQUEEZE_PHASE', seats: [0], deadlineAt: h.clock.now() + TEST_ROOM_OPTIONS.turnTimerMsOverride! })
    expect(h.room.snapshot('h').hand).toMatchObject({ phase: 'SQUEEZE', seats: [{ revealed: false }, { revealed: true }] })
    expect(h.room.snapshot('h').deadlineAt).toBe(phase.event.deadlineAt)

    await h.room.reveal('h')
    expect(types(h, 'h').slice(-2)).toEqual(['PLAYER_REVEALED', 'SQUEEZE_ENDED'])
    expect(h.room.snapshot('h').deadlineAt).toBeNull()
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })

  it('turns the seats that have not turned when the round runs out, and goes on', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, botCount: 0 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    await h.room.reveal('h')
    expect(types(h, 'a').slice(-1)).toEqual(['PLAYER_REVEALED'])
    h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!)
    await tick(h)
    const tail = types(h, 'a')
    expect(tail.slice(tail.indexOf('SQUEEZE_PHASE') + 1, tail.indexOf('SQUEEZE_ENDED') + 1)).toEqual(['PLAYER_REVEALED', 'PLAYER_REVEALED', 'SQUEEZE_ENDED'])
    expect(h.room.snapshot('a').hand?.phase).toBe('REVEAL')
    // No action timed out: the squeeze round is not a turn (spec §4.2.9).
    expect(h.room.players.get('a')!.consecutiveTimeouts ?? 0).toBe(0)
  })

  it('REVEAL is refused with no hand or no seat, and is nothing when sent again', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000], ['w', 100_000]] })
    expect(await code(h.room.reveal('h'))).toBe('NOT_IN_HAND')
    await seatAndStart(h, ['h'])
    await h.room.join(h.identity('w'))
    expect(await code(h.room.reveal('w'))).toBe('NOT_SEATED')
    await h.room.reveal('h')
    const before = h.ofType('h', 'GAME_EVENT').length
    await h.room.reveal('h')
    expect(h.ofType('h', 'GAME_EVENT').length).toBe(before)
  })

  it('play or fold on a squeeze table keeps its decision round: the deadline comes from the config, and deciding turns the cards', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, decisionMode: 'playOrFold' } }, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    expect(h.room.snapshot('h').hand?.phase).toBe('DECISION')
    await h.room.action('h', { kind: 'play' }, h.room.seq)
    expect(types(h, 'h')).toContain('PLAYER_REVEALED')
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })
})
```

(`consecutiveTimeouts` is a field of the room's player record; if it is private, assert through `h.logs`/the absence of a `PLAYER_ACTED` with `timedOut: true` instead: `expect(h.ofType('a', 'GAME_EVENT').some((m) => m.event.type === 'PLAYER_ACTED' && m.event.timedOut)).toBe(false)`.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/server-kit exec vitest run src/room/room-hands.test.ts -t "squeeze mode"`
Expected: FAIL — `h.room.reveal is not a function`.

- [ ] **Step 3: The runner**

In `packages/server-kit/src/room/hand-runner.ts`, `afterCommand`:

```ts
    // A DECISION_MADE or PLAYER_REVEALED from one seat doesn't bump turnSeq and doesn't need to disturb the shared
    // deadline or the other seats' still-pending bot timers — only reschedule on an actual round change.
    if ((s.phase === 'DECISION' || s.phase === 'SQUEEZE') && this.decisionScheduledTurnSeq === s.turnSeq) {
      this.deps.onEvents(events, this.currentDeadlineAt)
      this.applyAutoFolds()
      return
    }
```

and a new branch after the `DECISION` one:

```ts
    } else if (s.phase === 'SQUEEZE') {
      // Squeeze mode (spec 2026-10-08 §4.2.3): one table-wide deadline; bots are revealed from the deal, so no bot timer.
      const turnSeq = s.turnSeq
      this.decisionScheduledTurnSeq = turnSeq
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onSqueezeTimeout(turnSeq))
    } else if (s.phase === 'REVEAL') {
```

and the handler, after `onDecisionTimeout`:

```ts
  /** The squeeze round ran out: the server turns whoever has not (§4.2.3). Not a timeout — no seat is charged one. */
  private onSqueezeTimeout(turnSeq: number): void {
    if (this.completed || this.current.phase !== 'SQUEEZE' || this.current.turnSeq !== turnSeq) return
    for (const seat of this.current.players.filter((p) => !p.revealed).map((p) => p.seat)) {
      if (this.completed || this.current.phase !== 'SQUEEZE') return
      this.submit({ type: 'REVEALED', seat })
    }
  }
```

- [ ] **Step 4: The room and the gateway**

In `packages/server-kit/src/room/room.ts`, after `action(...)`:

```ts
  /** Squeeze mode: the player has turned every one of its cards (spec 2026-10-08 §5.2). Nothing when it was not squeezing. */
  reveal(playerId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!this.runner || this.runner.isComplete) throw new RoomError('NOT_IN_HAND', 'no hand in progress')
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (!this.runner.state.players.some((hp) => hp.seat === p.seat)) throw new RoomError('NOT_IN_HAND')
      try {
        this.runner.submit({ type: 'REVEALED', seat: p.seat })
      } catch (err) {
        if (err instanceof EngineError) throw new RoomError(engineErrorToErrorCode(err.code), err.message)
        throw err
      }
    })
  }
```

In `onHandEvents`, the deadline rides on the squeeze round's opening event too:

```ts
      const isTurn = event.type === 'TURN_CHANGED' || event.type === 'DECISION_PHASE' || event.type === 'SQUEEZE_PHASE'
```

In `packages/server-kit/src/gateway/gateway.ts`, after `case 'ACTION':`:

```ts
        case 'REVEAL':
          await this.roomOf(playerId).reveal(playerId)
          break
```

- [ ] **Step 5: Run the tests, typecheck, lint**

Run: `pnpm --filter @bp/server-kit test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS. If the gateway has an exhaustive `switch` on `msg.t` elsewhere (`satisfies never`), the new case belongs there too.

- [ ] **Step 6: Commit**

```bash
git add packages/server-kit/src
git commit -m "feat(server-kit): the squeeze round — a 20 s deadline, the forced turn at its end, Room.reveal and the REVEAL message"
```

---

### Task 4: Client state — the phase, `revealed`, `restored`, `client.reveal()`

**Files:**
- Modify: `packages/ui-kit/src/client/types.ts`
- Modify: `packages/ui-kit/src/client/reducer.ts`
- Modify: `packages/ui-kit/src/client/useGameClient.tsx`
- Test: `packages/ui-kit/src/client/reducer.test.ts`, `packages/ui-kit/src/client/useGameClient.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `ClientPhase` includes `'SQUEEZE'`; `ClientSeat.revealed?: boolean` (set in squeeze rooms, absent elsewhere); `ClientHand.restored: boolean` (true for a hand built from a snapshot); `GameClientApi.reveal(): Promise<AckOrError>`; auto-play sends `REVEAL` once per hand.

- [ ] **Step 1: Write the failing tests**

In `packages/ui-kit/src/client/reducer.test.ts` (it has `start(mode, rules, stacks, me)`, `roomView`, `BLIND_A`, `feed`-style helpers — read the file's helpers and use them the way the DECISION tests do):

```ts
describe('squeeze mode (spec 2026-10-08)', () => {
  const SQUEEZE: BlindRules = { ...BLIND_A, holeCards: 2, squeeze: true }
  const squeezeRoom = (stacks: number[]): RoomView => {
    const room = roomView('blind', SQUEEZE, stacks)
    return { ...room, config: { ...room.config, turnTimerSec: 20, blind: { ...room.config.blind!, squeeze: true } } }
  }

  it('starts a pure-luck squeeze hand in SQUEEZE with my seat unrevealed and the bot revealed, then follows the round', () => {
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p0', displayName: 'P0', balance: 0, serverTime: 0 }, now: 0 })
    const room = squeezeRoom([5000, 5000])
    room.players[1]!.isBot = true
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 1, room, hand: null, deadlineAt: null }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h1', mode: 'blind', button: 0, seats: [0, 1], carryOverIn: 0 } }, now: 0 })
    expect(s.hand).toMatchObject({ phase: 'SQUEEZE', restored: false, seats: [{ seat: 0, revealed: false }, { seat: 1, revealed: true }] })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 3, event: { type: 'SQUEEZE_PHASE', seats: [0], turnSeq: 1, deadlineAt: 20_000 } }, now: 0 })
    expect(s.deadlineAt).toBe(20_000)
    expect(s.hand?.phase).toBe('SQUEEZE')
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 4, event: { type: 'PLAYER_REVEALED', seat: 0 } }, now: 0 })
    expect(s.hand?.seats[0]?.revealed).toBe(true)
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 5, event: { type: 'SQUEEZE_ENDED' } }, now: 0 })
    expect(s.hand?.phase).toBe('REVEAL')
    expect(s.deadlineAt).toBeNull()
  })

  it('a hand from a snapshot is restored, and keeps the view’s revealed flags', () => {
    const s = start('blind', SQUEEZE, [5000, 5000], 0)
    const room = squeezeRoom([5000, 5000])
    const res = createHand({ handId: 'h2', rules: SQUEEZE, seats: [{ seat: 0, playerId: 'p0', stack: 5000, isBot: false }, { seat: 1, playerId: 'p1', stack: 5000, isBot: false }], button: 0, carryOverIn: 0 }, seededRng(1))
    const turned = applyCommand(res.state, { type: 'REVEALED', seat: 1 }, seededRng(1)).state
    const next = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 9, room, hand: playerView(turned, 0), deadlineAt: 20_000 }, now: 0 })
    expect(next.hand).toMatchObject({ phase: 'SQUEEZE', restored: true, seats: [{ revealed: false }, { revealed: true }] })
  })

  it('a plain hand carries no revealed flag at all', () => {
    const s = start('blind', BLIND_A, [5000, 5000], 0)
    const next = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h3', mode: 'blind', button: 0, seats: [0, 1], carryOverIn: 0 } }, now: 0 })
    expect(next.hand?.seats.every((seat) => seat.revealed === undefined)).toBe(true)
    expect(next.hand?.phase).toBe('REVEAL')
  })
})
```

In `packages/ui-kit/src/client/useGameClient.test.tsx`, beside the auto-play test (reuse its socket fixture and the way it feeds `GAME_EVENT`s and reads what the socket sent):

```ts
  it('auto-play turns the cards at once in a squeeze room: one REVEAL per hand, none when off', async () => {
    // Feed: WELCOME → ROOM_SNAPSHOT (a squeeze room, blind.squeeze true, turnTimerSec 20) → HAND_STARTED → CARDS_DEALT for my seat.
    // With setAutoPlay(true) before the deal: exactly one { t: 'REVEAL' } goes out; a second CARDS_DEALT in the same hand sends none;
    // with auto-play off, none at all. Also: client.reveal() sends { t: 'REVEAL', reqId } and resolves on ACK.
  })
```

Write the body the way the existing auto-play test is written (the fixture names differ per file; keep the assertions above).

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/client`
Expected: FAIL.

- [ ] **Step 3: Types and reducer**

`packages/ui-kit/src/client/types.ts`:

```ts
export type ClientPhase = 'DEALING' | 'BETTING' | 'DECISION' | 'SQUEEZE' | 'REVEAL' | 'COMPLETE'
```

`ClientSeat` gains, after `decision`:

```ts
  /**
   * Squeeze mode (spec 2026-10-08): whether this seat has turned every card. Present only in a squeeze room — `true`
   * for a bot from the deal — and absent on a plain table, where cards are never anyone's to turn.
   */
  revealed?: boolean
```

`ClientHand` gains, after `potPulse`:

```ts
  /** Built from a `ROOM_SNAPSHOT` rather than followed from `HAND_STARTED`: the cards are already on the table, so nothing is dealt in. */
  restored: boolean
```

`packages/ui-kit/src/client/reducer.ts`:

- `handFromView`: `restored: true,` and, in the seat map, `revealed: sv.revealed,` **only** when the room is a squeeze room — `...(room.config.blind?.squeeze === true ? { revealed: sv.revealed } : {})`.
- `startHand`:

```ts
  const squeeze = event.mode === 'blind' && room.config.blind?.squeeze === true
  const phase: ClientHand['phase'] = event.mode === 'holdem' ? 'BETTING' : room.config.blind?.decisionMode === 'playOrFold' ? 'DECISION' : squeeze ? 'SQUEEZE' : 'REVEAL'
  const seats: ClientSeat[] = event.seats.map((seat) => {
    const p = room.players.find((x) => x.seat === seat)
    return {
      seat, playerId: p?.playerId ?? '', displayName: p?.displayName ?? '', isBot: p?.isBot ?? false, stack: p?.stack ?? 0,
      betThisStreet: 0, folded: false, allIn: false, cardCount: 0, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false,
      ...(squeeze ? { revealed: p?.isBot ?? false } : {}),
    }
  })
  const hand: ClientHand = { …as now…, potPulse: 0, restored: false }
```

- `applyHandEvent` gains three cases (before `SETTLEMENT`):

```ts
    case 'SQUEEZE_PHASE':
      return { ...state, deadlineAt: event.deadlineAt ?? null, hand: { ...hand, phase: 'SQUEEZE', actingSeat: null, legal: null } }
    case 'PLAYER_REVEALED':
      return withHand(state, hand, { seats: mapSeat(hand, event.seat, (s) => ({ ...s, revealed: true })) })
    case 'SQUEEZE_ENDED':
      return { ...state, deadlineAt: null, hand: { ...hand, phase: 'REVEAL' } }
```

`PokerTable.seatFromPlayer` (Task 5 touches the file; add nothing there now — `revealed` is optional).

- [ ] **Step 4: The client API**

`packages/ui-kit/src/client/useGameClient.tsx`: add to `GameClientApi` after `act`:

```ts
  /** Squeeze mode: tell the table every one of my cards is turned (spec 2026-10-08). Harmless on a plain table. */
  reveal(): Promise<AckOrError>
```

In the returned object: `reveal: () => request({ t: 'REVEAL' }),`.

Auto-play (spec §4.2.5): add an effect beside the existing auto-play effect:

```ts
  // Squeeze mode with auto-play on: the cards are turned the moment they land, once per hand.
  const revealedFor = useRef<string | null>(null)
  const hand = state.hand
  const squeeze = state.room?.config.blind?.squeeze === true
  const myCards = hand !== null && hand.mySeat !== null ? hand.seats.find((s) => s.seat === hand.mySeat) : undefined
  useEffect(() => {
    if (!autoPlay || !squeeze || hand === null || myCards === undefined || myCards.revealed !== false || myCards.cardCount === 0) return
    if (revealedFor.current === hand.handId) return
    revealedFor.current = hand.handId
    request({ t: 'REVEAL' }).catch(() => undefined)
  }, [autoPlay, squeeze, hand, myCards, request])
```

- [ ] **Step 5: Run the tests, typecheck**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/client` and `pnpm typecheck`
Expected: PASS. Fix any `ClientSeat`/`ClientHand` literal that `typecheck` flags for the new required `restored` (test fixtures in `src/table/*.test.tsx`, `src/screens/*.test.tsx`: add `restored: false`).

- [ ] **Step 6: Commit**

```bash
git add packages/ui-kit/src
git commit -m "feat(ui-kit): the client follows the squeeze round — SQUEEZE phase, revealed per seat, restored hands, client.reveal and auto-play turning"
```

---

### Task 5: Motion — the deck, cards dealt from it, the lift at the showdown

**Files:**
- Create: `packages/ui-kit/src/table/Deck.tsx`
- Modify: `packages/ui-kit/src/table/Card.tsx`
- Modify: `packages/ui-kit/src/table/table.module.css` (Card section, centre)
- Modify: `packages/ui-kit/src/theme/tokens.css:167`
- Modify: `packages/ui-kit/src/table/CommunityCards.tsx`, `Seat.tsx`, `PokerTable.tsx`
- Modify: `packages/ui-kit/src/screens/reveal-hold.ts`
- Modify: `packages/ui-kit/src/index.ts` (export `Deck`, `DeckAnchorProvider`)
- Test: `packages/ui-kit/src/table/Card.test.tsx`, `CommunityCards.test.tsx` (new), `PokerTable.test.tsx`, `screens/reveal-hold.test.ts` (new, small)

**Interfaces:**
- Consumes: Task 4's `ClientHand.restored`.
- Produces: `Card` props `dealt?: boolean` and `reveal?: 'flip' | 'lift'`; exports `DEAL_MS = 360`, `FLIP_MS = 600`, `LIFT_MS = 720`, `DEAL_STAGGER_MS = 120`, `BOARD_STAGGER_MS = 300`, `SHOWDOWN_STAGGER_MS = 200` (and `CARD_STAGGER_MS = 60` stays, for `HandResult`); `CardBack` and `CardFace` exported; `DeckAnchorProvider` + `useDeckAnchor()` in `Deck.tsx`; `Seat` props `dealt`, `dealIndex`, `dealCount`, `reveal`; `CommunityCards` prop `dealt`; `REVEAL_HOLD_MS = 1270`.

- [ ] **Step 1: Write the failing tests**

`packages/ui-kit/src/table/Card.test.tsx` — add (keep the existing imports; add `DEAL_MS`, `LIFT_MS` to the import from `./Card.js`, and `DeckAnchorProvider` from `./Deck.js`):

```ts
  // Spec 2026-10-08 §3: a card comes out of the deck face down and, if it is to be seen, turns over where it lands.
  it('a dealt face-up card slides in from the deck anchor and then turns — the back drawn as artwork for the slide', () => {
    const anchor = { current: document.createElement('div') }
    const { container } = wrap(
      <DeckAnchorProvider value={anchor}>
        <Card card={parseCard('Qh')} dealt delayMs={300} />
      </DeckAnchorProvider>,
    )
    const wrapper = container.querySelector(`.${s.card}`)!
    expect(wrapper).toHaveClass(s.cardDealt)
    expect(wrapper.getAttribute('style')).toContain('--deal-delay: 300ms')
    expect(wrapper.getAttribute('style')).toMatch(/--deal-dx: -?\d+(\.\d+)?px/)
    expect(container.querySelector(`.${s.cardTurn}`)).not.toBeNull()
    expect(container.querySelector('[aria-hidden="true"] pattern')).not.toBeNull()
    expect(named(container)).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAttribute('data-card', 'Qh')
  })

  it('a dealt face-down card slides in and stays a back; with no deck anchor a dealt card fades in as before', () => {
    const anchor = { current: document.createElement('div') }
    const down = wrap(
      <DeckAnchorProvider value={anchor}>
        <Card faceDown dealt />
      </DeckAnchorProvider>,
    )
    expect(down.container.querySelector(`.${s.cardDealt}`)).not.toBeNull()
    expect(down.container.querySelector(`.${s.cardTurn}`)).toBeNull()
    const alone = wrap(<Card card={parseCard('Qh')} dealt />)
    expect(alone.container.querySelector(`.${s.cardDealt}`)).toBeNull()
    expect(alone.container.querySelector(`.${s.cardTurn}`)).toBeNull()
  })

  it('reveal="lift" turns a revealed card with the lift keyframes instead of the flat turn', () => {
    const { container, rerender } = wrap(<Card faceDown reveal="lift" />)
    rerender(<Card card={parseCard('Qh')} reveal="lift" />)
    expect(container.querySelector(`.${s.cardLift}`)).not.toBeNull()
    expect(container.querySelector(`.${s.cardTurn}`)).toBeNull()
    expect(screen.getByRole('img')).toHaveAttribute('data-card', 'Qh')
  })

  it('keeps the resting face out of the lift and slide keyframes, and the constants match the tokens', () => {
    const lift = /@keyframes\s+lift\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(lift).toMatch(/0%\s*\{[^}]*rotateY\(180deg\)/)
    expect(lift).not.toMatch(/100%/)
    const slide = /@keyframes\s+dealSlide\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(slide).toMatch(/^\s*from\s*\{/)
    expect(slide).not.toMatch(/\bto\b/)
    expect(/--dur-deal:\s*(\d+)ms;/.exec(TOKENS_CSS)?.[1]).toBe(String(DEAL_MS))
    expect(/--dur-lift:\s*(\d+)ms;/.exec(TOKENS_CSS)?.[1]).toBe(String(LIFT_MS))
  })
```

`packages/ui-kit/src/table/CommunityCards.test.tsx` (new):

```tsx
import { parseCards } from '@bp/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { BOARD_STAGGER_MS } from './Card.js'
import { CommunityCards } from './CommunityCards.js'
import s from './table.module.css'

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('CommunityCards', () => {
  it('staggers the flop by BOARD_STAGGER_MS and starts the turn and river at once', () => {
    const { container } = wrap(<CommunityCards cards={parseCards('Qs 8d 6c 2h 9s')} dealt />)
    const delays = [...container.querySelectorAll(`.${s.card}`)].map((el) => /--deal-delay:\s*(\d+)ms/.exec(el.getAttribute('style') ?? '')?.[1] ?? '0')
    expect(delays).toEqual(['0', String(BOARD_STAGGER_MS), String(2 * BOARD_STAGGER_MS), '0', '0'])
  })
})
```

`packages/ui-kit/src/screens/reveal-hold.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest'
import { LIFT_MS, SHOWDOWN_STAGGER_MS } from '../table/Card.js'
import { REVEAL_HOLD_MS } from './reveal-hold.js'

describe('REVEAL_HOLD_MS', () => {
  it('covers a lift, two more lifts’ stagger and the settle margin', () => {
    expect(REVEAL_HOLD_MS).toBe(LIFT_MS + 2 * SHOWDOWN_STAGGER_MS + 150)
    expect(REVEAL_HOLD_MS).toBe(1270)
  })
})
```

`packages/ui-kit/src/table/PokerTable.test.tsx` — add to the first test's assertions (it renders a live hand): the deck is on the felt (`container.querySelector('[data-deck]')` not null) and the viewer's seat cards carry deal delays in clockwise order after the button. With seats `[0, 1, 2]`, button `0`, two cards each: seat 1 is dealt first — card 0 at `0ms`, card 1 at `3 × 120 = 360ms`; seat 2: `120ms`, `480ms`; seat 0: `240ms`, `600ms`. Assert the `--deal-delay` values on the `.card` wrappers under `[data-seat="1"]` and `[data-seat="0"]`. Also: a hand with `restored: true` renders no `.cardDealt` wrapper at all.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/table src/screens/reveal-hold.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tokens and CSS**

`packages/ui-kit/src/theme/tokens.css`, beside `--dur-flip: 600ms;`:

```css
  --dur-deal: 360ms;
  --dur-lift: 720ms;
```

`packages/ui-kit/src/table/table.module.css`, in the Card section. Keep `.card` and its `deal` animation (the fade is what a card with no deck to come from, or a restored hand, still gets). Add:

```css
/* Dealt from the deck (spec 2026-10-08 §3): the wrapper slides in face down from the deck's place, measured by `Card`
   against the `Deck` anchor into `--deal-dx`/`--deal-dy`; a card that is to be seen then turns (`.cardTurn`, below),
   `--turn-after` the slide. Reduced motion lands on the resting style like everything else. */
.cardDealt {
  animation: dealSlide var(--dur-deal, 360ms) var(--ease) backwards;
  animation-delay: var(--deal-delay, 0ms);
}

@keyframes dealSlide {
  from {
    transform: translate(var(--deal-dx, 0px), var(--deal-dy, -40px)) rotate(-7deg);
  }
}
```

Change `.cardTurn`'s delay to `animation-delay: calc(var(--deal-delay, 0ms) + var(--turn-after, 0ms));` and add, after it:

```css
/* The showdown's turn (spec 2026-10-08 §3, mẫu B): the card lifts off the felt, turns in the air and lands with a small
   overshoot. The resting style is the face, as for `.cardTurn`; only the start and the middle are keyframes. */
.cardLift {
  transform-style: preserve-3d;
  animation: lift var(--dur-lift, 720ms) cubic-bezier(0.3, 0.1, 0.25, 1) backwards;
  animation-delay: calc(var(--deal-delay, 0ms) + var(--turn-after, 0ms));
}

.cardLift > .cardSide {
  backface-visibility: hidden;
}

@keyframes lift {
  0% {
    transform: translateY(0) rotateY(180deg) scale(1);
  }
  45% {
    transform: translateY(-18%) rotateY(90deg) scale(1.1);
  }
  82% {
    transform: translateY(-3%) rotateY(-9deg) scale(1.02);
  }
}
```

Add `.cardLift` to the reduced-motion list at the end of the file (`.card, .cardTurn, .cardLift, …`).

The deck, in the Pot/centre section:

```css
/* The deck (spec 2026-10-08 §3, Q5): a fixed stack above the board, beside the pot, that every card comes out of. */
.deck {
  position: relative;
  width: calc(var(--card-lg, clamp(40px, 10.4vw, 62px)) * 0.78);
  aspect-ratio: 60 / 84;
  margin-bottom: calc(-1 * var(--space-1));
}

.deckCard {
  position: absolute;
  inset: 0;
  width: 100%;
  height: auto;
  filter: drop-shadow(0 1px 2px rgba(3, 6, 16, 0.5));
}

.deckCard:nth-child(2) {
  transform: translate(2px, -2px);
}

.deckCard:nth-child(3) {
  transform: translate(4px, -4px);
}
```

- [ ] **Step 4: `Deck.tsx`**

```tsx
import { createContext, forwardRef, useContext, useId, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { CardBack } from './Card.js'
import s from './table.module.css'

/**
 * Where the deck is: `Card` measures itself against it to slide in from there (spec 2026-10-08 §3). Absent, a card has
 * nothing to come from and keeps its plain fade-in — the result card, the playground, a test.
 */
const DeckAnchorContext = createContext<RefObject<HTMLElement | null> | null>(null)
export const DeckAnchorProvider = DeckAnchorContext.Provider
export const useDeckAnchor = (): RefObject<HTMLElement | null> | null => useContext(DeckAnchorContext)

/** Three backs, stacked: the pile every card is dealt from. Artwork only — it names nothing and counts for no card. */
export const Deck = forwardRef<HTMLDivElement>(function Deck(_props, ref) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <div ref={ref} className={s.deck} data-deck="" role="img" aria-label={t('labels.deck')}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={s.deckCard} aria-hidden="true">
          <CardBack uid={`${uid}-${i}`} label={null} />
        </span>
      ))}
    </div>
  )
})
```

Add `"deck": "Bộ bài"` (vi) / `"deck": "Deck"` (en) under `labels` in both `game.json` files.

- [ ] **Step 5: `Card.tsx`**

Export `CardBack` and `CardFace` (`export function CardBack…`, `export function CardFace…`). Constants:

```ts
/** How long a revealed card takes to turn over in place: the `--dur-flip` token (`Card.test` holds them equal). */
export const FLIP_MS = 600
/** The slide from the deck (spec 2026-10-08 §3): the `--dur-deal` token. */
export const DEAL_MS = 360
/** The showdown's lift-and-turn: the `--dur-lift` token. */
export const LIFT_MS = 720
/** The step between the result card's cards (and any other plain fade-in). */
export const CARD_STAGGER_MS = 60
/** The step between cards dealt around the table: card `i` of the seat `k`-th from the button waits `(i × n + k) × this`. */
export const DEAL_STAGGER_MS = 120
/** The step between the flop's three cards. */
export const BOARD_STAGGER_MS = 300
/** The step between one seat's cards at the showdown. */
export const SHOWDOWN_STAGGER_MS = 200
```

Props:

```ts
export interface CardProps {
  card?: CardId | null
  faceDown?: boolean
  size?: CardSize
  delayMs?: number
  highlighted?: boolean
  className?: string
  /** Dealt from the deck in this render: slides in face down from the `Deck` anchor (none → the plain fade), then, face up, turns. */
  dealt?: boolean
  /** How a card that was face down turns when revealed: in place (the default) or lifted off the felt (the showdown). */
  reveal?: 'flip' | 'lift'
}
```

Body:

```tsx
export function Card({ card, faceDown = false, size = 'md', delayMs = 0, highlighted = false, className, dealt = false, reveal = 'flip' }: CardProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const shown = faceDown || card === undefined || card === null ? null : card
  const down = shown === null
  const [was, setWas] = useState({ down, turned: false })
  if (was.down !== down) setWas({ down, turned: was.down })
  const turned = !down && was.turned
  const anchor = useDeckAnchor()
  const ref = useRef<HTMLSpanElement>(null)
  // Measured once, before the first paint: where the deck is from here. `null` until then and when there is no deck.
  const [from, setFrom] = useState<{ dx: number; dy: number } | null>(null)
  useLayoutEffect(() => {
    const deck = anchor?.current
    const self = ref.current
    if (!dealt || !deck || !self) return
    const a = deck.getBoundingClientRect()
    const b = self.getBoundingClientRect()
    setFrom({ dx: a.left + a.width / 2 - (b.left + b.width / 2), dy: a.top + a.height / 2 - (b.top + b.height / 2) })
    // Only on mount: the slide is the card's arrival, never replayed on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sliding = from !== null
  // A card dealt face up turns after its slide (back first, as it travels); a revealed card turns from where it lies.
  const turning = turned || (sliding && !down)
  const style: CSSProperties = {
    ...(delayMs > 0 ? { '--deal-delay': `${delayMs}ms` } : {}),
    ...(sliding ? { '--deal-dx': `${from.dx.toFixed(1)}px`, '--deal-dy': `${from.dy.toFixed(1)}px`, '--turn-after': `${DEAL_MS}ms` } : {}),
  } as CSSProperties
  const turnClass = reveal === 'lift' && turned ? s.cardLift : s.cardTurn

  return (
    <span ref={ref} className={cx(s.card, s[SIZE_CLASS[size]], down && s.cardDown, highlighted && s.cardHi, sliding && s.cardDealt, className)} style={style}>
      <span className={cx(s.cardFlip, turning && turnClass)}>
        {shown === null ? null : <CardFace card={shown} uid={uid} label={cardLabel(shown, t)} />}
        {down || turning ? <CardBack uid={uid} label={down ? t('labels.faceDown') : null} /> : null}
      </span>
    </span>
  )
}
```

(`useRef`, `useLayoutEffect` join the React import; `useDeckAnchor` from `./Deck.js`. A dealt face-up card uses the flat turn after its slide even when `reveal="lift"` — the lift is for a card that was lying face down.) Update the component's doc comment to say so.

- [ ] **Step 6: `CommunityCards`, `Seat`, `PokerTable`, the hold**

`CommunityCards.tsx`: prop `dealt?: boolean`; `delayMs={(i < 3 ? i : 0) * BOARD_STAGGER_MS}`; pass `dealt`.

`Seat.tsx`: props `dealt: boolean`, `dealIndex: number` (this seat's place in the deal, 0 = first after the button), `dealCount: number` (seats dealt), `reveal: 'flip' | 'lift'`; the card line becomes:

```tsx
<Card key={i} card={card} faceDown={card === null} size={cardSize} dealt={dealt} reveal={reveal} delayMs={(i * dealCount + dealIndex) * DEAL_STAGGER_MS} />
```

`PokerTable.tsx`:
- `const deckRef = useRef<HTMLDivElement>(null)`; wrap each returned `<section>` in `<DeckAnchorProvider value={deckRef}>`; the centre becomes `<Deck ref={deckRef} />` then `<CommunityCards cards={community} highlight={highlight} dealt={dealt} />` then the pot.
- `const dealt = hand !== null && !hand.restored`.
- Deal order: `const dealOrder = hand === null ? [] : [...hand.seats.map((s) => s.seat)].sort((a, b) => a - b)` rotated so that the first element is the first seat strictly after `hand.button` (wrap around); `dealIndex = dealOrder.indexOf(index)` (−1 → 0), `dealCount = dealOrder.length`.
- `reveal={index === hand?.mySeat ? 'flip' : 'lift'}`.
- `seatFromPlayer` unchanged.

`screens/reveal-hold.ts`:

```ts
import { LIFT_MS, SHOWDOWN_STAGGER_MS } from '../table/Card.js'
…
export const REVEAL_HOLD_MS = LIFT_MS + (MOST_HOLE_CARDS - 1) * SHOWDOWN_STAGGER_MS + SETTLE_MS
```

and reword its comment: the lift, the stagger to the last of three cards, the margin — 720 + 2 × 200 + 150 = 1270 ms.

Export from `packages/ui-kit/src/index.ts`: `export * from './table/Deck.js'`.

- [ ] **Step 7: Run everything in the package, typecheck, lint**

Run: `pnpm --filter @bp/ui-kit test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS. `RoomScreen.test.tsx` asserts the hold's length somewhere — update any literal `870` to `REVEAL_HOLD_MS`.

- [ ] **Step 8: Look at it**

Start `pnpm --filter @bp/ui-kit playground` (launch config `ui-kit-playground`, port 5175) only if the playground has a table scenario; otherwise skip — Task 9 takes the real screenshots. Commit:

```bash
git add packages/ui-kit/src
git commit -m "feat(ui-kit): a deck on the felt; cards slide from it and turn where they land; opponents' cards lift and turn at the showdown"
```

---

### Task 6: The peel — geometry and `PeelCard`

**Files:**
- Create: `packages/ui-kit/src/table/peel.ts`
- Create: `packages/ui-kit/src/table/PeelCard.tsx`
- Modify: `packages/ui-kit/src/table/table.module.css` (new Peel section)
- Modify: `packages/ui-kit/src/index.ts` (export `PeelCard`)
- Test: `packages/ui-kit/src/table/peel.test.ts`, `packages/ui-kit/src/table/PeelCard.test.tsx`

**Interfaces:**
- Consumes: Task 5's exported `CardBack`, `CardFace`, `DEAL_MS`, the `.card`/`.cardDealt` wrapper styles.
- Produces:

```ts
// peel.ts
export const PEEL = { threshold: 0.5, flick: 0.9, travel: 0.75, snapMs: 220, finishMs: 260, slideMs: 220, centreDead: 16 } as const
export type Vec = readonly [number, number]
export function peelDirection(dx: number, dy: number): Vec          // from the press point relative to the centre; near the centre → [0, -1]
export function peelExtent(u: Vec, w: number, h: number): { sMin: number; sMax: number; L: number }
export interface PeelFrame { backClip: string; faceClip: string; faceShift: Vec; fold: { x: number; y: number; angle: number }; done: boolean }
export function peelFrame(u: Vec, p: number, w: number, h: number): PeelFrame
export function inward(u: Vec, dx: number, dy: number): number        // travel along the peel
export function shouldOpen(p: number, velocity: number): boolean      // threshold or flick
// PeelCard.tsx
export interface PeelCardProps { card: CardId; size?: CardSize; open: boolean; onOpened: () => void; dealt?: boolean; delayMs?: number; className?: string }
```

- [ ] **Step 1: Write the failing geometry tests**

`packages/ui-kit/src/table/peel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PEEL, inward, peelDirection, peelExtent, peelFrame, shouldOpen } from './peel.js'

const W = 60, H = 84
const nums = (clip: string) => clip.match(/-?\d+(\.\d+)?/g)!.map(Number)

describe('peel geometry (spec 2026-10-08 §3)', () => {
  it('points from the press into the centre, exactly, and from the bottom near the middle', () => {
    expect(peelDirection(0, 40)).toEqual([0, -1])
    const [ux, uy] = peelDirection(30, 40)
    expect(ux).toBeCloseTo(-0.6)
    expect(uy).toBeCloseTo(-0.8)
    expect(peelDirection(5, 5)).toEqual([0, -1])
    expect(peelDirection(-30, 0)).toEqual([1, 0])
  })

  it('measures the card along the peel: the bottom edge runs the height, a corner the diagonal', () => {
    expect(peelExtent([0, -1], W, H)).toEqual({ sMin: -H, sMax: 0, L: H })
    const d = peelExtent([-Math.SQRT1_2, -Math.SQRT1_2], W, H)
    expect(d.L).toBeCloseTo((W + H) * Math.SQRT1_2)
  })

  it('at p = 0 nothing is peeled; at p = ½ the face sits in place over the far half; at p = 1 the face has moved a card length', () => {
    const u = [0, -1] as const
    const closed = peelFrame(u, 0, W, H)
    expect(closed.backClip).toBe('none')
    expect(closed.faceClip).toBe('polygon(0px 0px, 0px 0px, 0px 0px)')
    expect(closed.done).toBe(false)

    const half = peelFrame(u, 0.5, W, H)
    expect(half.faceShift).toEqual([0, 0])
    expect(Math.max(...nums(half.backClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(H / 2) // the back keeps the top half
    expect(Math.min(...nums(half.faceClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(0) // the face shows its top half…
    expect(Math.max(...nums(half.faceClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(H / 2)
    expect(half.fold).toMatchObject({ x: W / 2, y: H / 2 })
    expect(half.fold.angle).toBeCloseTo(0)

    const open = peelFrame(u, 1, W, H)
    expect(open.faceShift[1]).toBeCloseTo(-H) // along u, a full length
    expect(open.faceClip).toBe('none')
    expect(open.backClip).toBe('polygon(0px 0px, 0px 0px, 0px 0px)')
    expect(open.done).toBe(true)
  })

  it('a corner peel folds along the diagonal', () => {
    const u = [-Math.SQRT1_2, -Math.SQRT1_2] as const
    const f = peelFrame(u, 0.3, W, H)
    expect(f.fold.angle).toBeCloseTo(Math.PI / 4)
    expect(f.backClip).toMatch(/^polygon\(/)
    expect(f.faceClip).toMatch(/^polygon\(/)
  })

  it('travel is the drag projected on the peel, and opening needs half a card or a flick', () => {
    expect(inward([0, -1], 0, -30)).toBe(30)
    expect(inward([0, -1], 30, 0)).toBe(0)
    expect(shouldOpen(0.5, 0)).toBe(true)
    expect(shouldOpen(0.49, 0)).toBe(false)
    expect(shouldOpen(0.2, PEEL.flick)).toBe(true)
    expect(shouldOpen(0.1, 5)).toBe(false) // too early for a flick to count
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/table/peel.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: `peel.ts`**

```ts
/**
 * The squeeze's geometry (spec 2026-10-08 §3), pure: a card `w × h` peeled along the unit vector `u` (into the card
 * from the pressed side), `p` of the way (0 face down, 1 peeled right over). s(P) = P·u runs from `sMin` at the pressed
 * edge or corner to `sMax` at the far side, `L` apart; the fold is at s = sMin + p·L.
 *
 * The lifted part lies back over the rest showing the face — the face that was *under* the card, which a card laid
 * face down by a turn about the same axis shows upright: the face slid along u by 2f − L, clipped to its far `f`. At
 * p = ½ the face is exactly in place with its far half showing; at p = 1 it has moved a card length and the back is gone.
 */
export const PEEL = { threshold: 0.5, flick: 0.9, travel: 0.75, snapMs: 220, finishMs: 260, slideMs: 220, centreDead: 16 } as const

export type Vec = readonly [number, number]

export function peelDirection(dx: number, dy: number): Vec {
  const n = Math.hypot(dx, dy)
  if (n < PEEL.centreDead) return [0, -1]
  return [-dx / n, -dy / n]
}

export function peelExtent(u: Vec, w: number, h: number): { sMin: number; sMax: number; L: number } {
  const ss = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => x! * u[0] + y! * u[1])
  const sMin = Math.min(...ss), sMax = Math.max(...ss)
  return { sMin, sMax, L: sMax - sMin }
}

/** The card rectangle kept where s(P) ≥ s0 as a clip-path; `none` when that is all of it, an empty polygon when none. */
function keepBeyond(u: Vec, s0: number, w: number, h: number): string {
  const rect: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
  const f = ([x, y]: [number, number]) => x * u[0] + y * u[1] - s0
  if (rect.every((pt) => f(pt) >= -1e-6)) return 'none'
  const out: [number, number][] = []
  for (let i = 0; i < 4; i++) {
    const a = rect[i]!, b = rect[(i + 1) % 4]!, da = f(a), db = f(b)
    if (da >= 0) out.push(a)
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out.length ? `polygon(${out.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})` : 'polygon(0px 0px, 0px 0px, 0px 0px)'
}

export interface PeelFrame {
  backClip: string
  faceClip: string
  faceShift: Vec
  /** The fold's point nearest the card's centre, and the fold line's angle (0 = horizontal). */
  fold: { x: number; y: number; angle: number }
  done: boolean
}

export function peelFrame(u: Vec, p: number, w: number, h: number): PeelFrame {
  const { sMin, sMax, L } = peelExtent(u, w, h)
  const f = Math.max(0, Math.min(1, p)) * L
  const c = sMin + f
  const d = 2 * f - L
  const sc = (sMin + sMax) / 2
  const k = c - sc
  return {
    backClip: keepBeyond(u, c, w, h),
    faceClip: keepBeyond(u, sMax - f, w, h),
    faceShift: [d * u[0], d * u[1]],
    fold: { x: w / 2 + k * u[0], y: h / 2 + k * u[1], angle: Math.atan2(-u[0], u[1]) },
    done: p >= 1,
  }
}

export const inward = (u: Vec, dx: number, dy: number): number => dx * u[0] + dy * u[1]

export const shouldOpen = (p: number, velocity: number): boolean => p >= PEEL.threshold || (p > 0.12 && velocity >= PEEL.flick)
```

(`fold.angle` for the bottom peel: `atan2(0, −1) = π` — if the test wants 0, normalise: `((angle % π) + π) % π` so the band's rotation is the same line either way; use `Math.atan2(u[0], -u[1])` instead, which is 0 for `[0,−1]` and π/4 for the bottom-right diagonal. Make the test and the code agree.)

- [ ] **Step 4: Run the geometry tests**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/table/peel.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `PeelCard` tests**

`packages/ui-kit/src/table/PeelCard.test.tsx`:

```tsx
import { parseCard } from '@bp/core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { PeelCard } from './PeelCard.js'
import s from './table.module.css'

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)
const box = (el: Element, w = 60, h = 84) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) })

describe('PeelCard (spec 2026-10-08 §3, §4.2.2)', () => {
  it('starts face down and named as a card to peel; a drag past half opens it and reports once', () => {
    vi.useFakeTimers()
    const onOpened = vi.fn()
    const { container } = wrap(<PeelCard card={parseCard('Ah')} open={false} onOpened={onOpened} />)
    const root = container.querySelector('[data-peel]')!
    box(root)
    expect(screen.getByRole('img')).toHaveAccessibleName('Lá úp — kéo để lật')
    expect(root).toHaveAttribute('data-face', 'down')
    fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 40, pointerId: 1, buttons: 1 }) // 40 px of 63 (0.75 × 84) → p ≈ 0.63
    expect(root).toHaveAttribute('data-face', 'peeling')
    fireEvent.pointerUp(root, { clientX: 30, clientY: 40, pointerId: 1 })
    act(() => vi.advanceTimersByTime(1000))
    expect(root).toHaveAttribute('data-face', 'up')
    expect(screen.getByRole('img')).toHaveAccessibleName('Át cơ')
    expect(onOpened).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('a short drag snaps back and reports nothing', () => {
    vi.useFakeTimers()
    const onOpened = vi.fn()
    const { container } = wrap(<PeelCard card={parseCard('Ah')} open={false} onOpened={onOpened} />)
    const root = container.querySelector('[data-peel]')!
    box(root)
    fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 70, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(root, { clientX: 30, clientY: 70, pointerId: 1 })
    act(() => vi.advanceTimersByTime(1000))
    expect(root).toHaveAttribute('data-face', 'down')
    expect(onOpened).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('opens when told to (the "Lật" button, the server turning it), and still reports once', () => {
    vi.useFakeTimers()
    const onOpened = vi.fn()
    const { container, rerender } = wrap(<PeelCard card={parseCard('Ah')} open={false} onOpened={onOpened} />)
    box(container.querySelector('[data-peel]')!)
    rerender(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}><PeelCard card={parseCard('Ah')} open onOpened={onOpened} /></I18nextProvider>)
    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelector('[data-peel]')).toHaveAttribute('data-face', 'up')
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(container.querySelector(`.${s.card}`)).not.toBeNull() // the same wrapper as a Card: size, shadow, the deal-in
    vi.useRealTimers()
  })
})
```

(`'Át cơ'` is whatever `cardLabel(parseCard('Ah'), t)` gives in `vi` — read `i18n/index.ts` and use the exact string. Fake timers: the component's tweens must run on `setTimeout`/`requestAnimationFrame` that vitest's fake timers drive — use `requestAnimationFrame` and `vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame', 'performance'] })` if the default does not fake `requestAnimationFrame`.)

- [ ] **Step 6: `PeelCard.tsx` and its CSS**

```tsx
import type { Card as CardId } from '@bp/core'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cardLabel } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { CardBack, CardFace, DEAL_MS, type CardSize } from './Card.js'
import { useDeckAnchor } from './Deck.js'
import { PEEL, inward, peelDirection, peelFrame, shouldOpen, type Vec } from './peel.js'
import s from './table.module.css'

export interface PeelCardProps {
  card: CardId
  size?: CardSize
  /** Turned from outside — the seat's "Lật" button, or the server at the end of the round. Once true it stays true. */
  open: boolean
  /** The card is face up and at rest; called once, however it got there. */
  onOpened: () => void
  dealt?: boolean
  delayMs?: number
  className?: string
}

const SIZE_CLASS: Record<CardSize, string> = { sm: 'cardSm', md: 'cardMd', lg: 'cardLg' }

/**
 * The viewer's own face-down card in a squeeze room (spec 2026-10-08 §3): pressed anywhere and dragged inward, it peels
 * from the pressed point towards the centre — a 2D peel, clip and translate, so it draws the same in every browser —
 * past half it finishes and slides back into place face up; let go early it snaps back. The wrapper is `Card`'s, so it
 * sizes, shadows and deals in like one.
 */
export function PeelCard({ card, size = 'md', open, onOpened, dealt = false, delayMs = 0, className }: PeelCardProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ref = useRef<HTMLSpanElement>(null)
  const [p, setP] = useState(0)
  const [u, setU] = useState<Vec>([0, -1])
  const [slide, setSlide] = useState(0)
  const [face, setFace] = useState<'down' | 'peeling' | 'up'>('down')
  const drag = useRef<{ x: number; y: number; p: number; samples: { x: number; y: number; t: number }[] } | null>(null)
  const raf = useRef(0)
  const reported = useRef(false)
  const report = useCallback(() => {
    if (reported.current) return
    reported.current = true
    onOpened()
  }, [onOpened])

  const box = () => {
    const r = ref.current?.getBoundingClientRect()
    return { w: r?.width || 60, h: r?.height || 84, left: r?.left ?? 0, top: r?.top ?? 0 }
  }
  const tween = useCallback((from: number, to: number, ms: number, set: (v: number) => void, done?: () => void) => {
    cancelAnimationFrame(raf.current)
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      set(from + (to - from) * (1 - (1 - k) * (1 - k)))
      if (k < 1) raf.current = requestAnimationFrame(step)
      else done?.()
    }
    raf.current = requestAnimationFrame(step)
  }, [])
  const finish = useCallback(
    (fromP: number) => {
      setFace('peeling')
      tween(fromP, 1, PEEL.finishMs * (1 - fromP) + 60, setP, () =>
        tween(0, 1, PEEL.slideMs, setSlide, () => {
          setFace('up')
          report()
        }),
      )
    },
    [tween, report],
  )

  useEffect(() => {
    if (open && face !== 'up' && drag.current === null) finish(p)
    // `p` is read once, when `open` lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, face, finish])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (face === 'up' || open) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
    cancelAnimationFrame(raf.current)
    const { w, h, left, top } = box()
    if (p === 0) setU(peelDirection(e.clientX - left - w / 2, e.clientY - top - h / 2))
    drag.current = { x: e.clientX, y: e.clientY, p, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }
    setFace('peeling')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (d === null) return
    const { w, h } = box()
    const { L } = peelExtentFor(u, w, h)
    setP(Math.max(0, Math.min(1, d.p + inward(u, e.clientX - d.x, e.clientY - d.y) / (PEEL.travel * L))))
    d.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (d.samples.length > 6) d.samples.shift()
  }
  const onPointerUp = () => {
    const d = drag.current
    if (d === null) return
    drag.current = null
    const a = d.samples[0]!, b = d.samples[d.samples.length - 1]!
    const v = b.t > a.t ? inward(u, b.x - a.x, b.y - a.y) / (b.t - a.t) : 0
    if (shouldOpen(p, v)) finish(p)
    else tween(p, 0, PEEL.snapMs, setP, () => setFace('down'))
  }

  const { w, h } = box()
  const frame = peelFrame(u, p, w, h)
  const up = face === 'up'
  const label = up ? cardLabel(card, t) : t('labels.peelHint')
  const style = {
    ...(delayMs > 0 ? { '--deal-delay': `${delayMs}ms` } : {}),
    ...dealStyle(dealt),
  } as CSSProperties
  return (
    <span
      ref={ref}
      className={cx(s.card, s[SIZE_CLASS[size]], s.peel, className)}
      style={style}
      data-peel=""
      data-face={face}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className={s.peelSheet} style={{ transform: slide > 0 && !up ? `translate(${(-slide * frame.faceShift[0]).toFixed(2)}px, ${(-slide * frame.faceShift[1]).toFixed(2)}px)` : undefined }}>
        <span className={s.peelBack} style={{ clipPath: up ? 'polygon(0 0, 0 0, 0 0)' : frame.backClip }} aria-hidden="true">
          <CardBack uid={`${uid}-b`} label={null} />
        </span>
        <span className={s.peelFlap} style={{ transform: up ? undefined : `translate(${frame.faceShift[0].toFixed(2)}px, ${frame.faceShift[1].toFixed(2)}px)`, filter: face === 'peeling' ? `drop-shadow(${(4 * u[0]).toFixed(1)}px ${(4 * u[1]).toFixed(1)}px 5px rgba(0,0,0,.5))` : undefined }}>
          <span className={s.peelArt} style={{ clipPath: up ? undefined : frame.faceClip }}>
            <CardFace card={card} uid={uid} label={label} />
          </span>
        </span>
        <span className={s.peelClip} aria-hidden="true">
          <span className={s.peelCurl} style={{ width: `${2 * Math.max(w, h)}px`, left: `${(frame.fold.x - Math.max(w, h)).toFixed(2)}px`, top: `${(frame.fold.y - 5).toFixed(2)}px`, transform: `rotate(${frame.fold.angle.toFixed(4)}rad)`, opacity: face === 'peeling' && p > 0.01 && p < 0.99 ? 1 : 0 }} />
        </span>
      </span>
    </span>
  )
}
```

Where `peelExtentFor` is `peelExtent` imported from `./peel.js` (name it so), and `dealStyle(dealt)` is the same deck measurement `Card` does — lift that `useLayoutEffect`+state pair out of `Card.tsx` into a small hook `useDealFrom(ref, dealt)` in `Card.tsx` that returns `{ sliding, vars }`, used by both components (the hook sets `--deal-dx/--deal-dy/--turn-after` and returns whether `.cardDealt` applies). `CardFace` keeps its `role="img"` — to keep one named element, pass `label` to `CardFace` only when `up` and render it with `aria-hidden` otherwise (add an optional `hidden?: boolean` prop to `CardFace` that drops `role`/`aria-label`/`data-*` the way `CardBack` does with `label: null`); the root carries `role="img"` only while not up.

CSS (new "Peel" section after the Card section):

```css
/* ---------------- Peel (squeeze mode, spec 2026-10-08) ---------------- */
.peel {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
  perspective: none;
}

.peel[data-face='up'] {
  cursor: default;
}

.peelSheet,
.peelBack,
.peelFlap,
.peelArt,
.peelClip {
  position: absolute;
  inset: 0;
}

.peelSheet {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 60 / 84;
}

.peelBack > svg,
.peelArt > svg {
  display: block;
  width: 100%;
  height: auto;
}

.peelFlap {
  transform-origin: 0 0;
  will-change: transform;
}

.peelClip {
  overflow: hidden;
  border-radius: 6px;
  pointer-events: none;
}

/* The bend: a thin light-then-dark band along the fold, inside the card only. */
.peelCurl {
  position: absolute;
  height: 10px;
  transform-origin: 50% 50%;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.22) 40%, rgba(255, 255, 255, 0.5) 50%, rgba(0, 0, 0, 0.38) 60%, rgba(0, 0, 0, 0) 100%);
  transition: opacity 120ms;
}

@media (prefers-reduced-motion: reduce) {
  .peelCurl {
    transition: none;
  }
}
```

Locale keys (both files, `labels`): `"peelHint": "Lá úp — kéo để lật"` / `"Face-down card — drag to turn"`.

- [ ] **Step 7: Run the tests, typecheck, lint; look at it in the playground**

Run: `pnpm --filter @bp/ui-kit test`, `pnpm typecheck`, `pnpm lint`. Add a `PeelCard` row to `packages/ui-kit/playground/scenarios.tsx` (three peelable cards, a "Lật" button that sets `open`), start the playground (launch config `ui-kit-playground`), drag with the mouse from the bottom edge, a corner and a side; flick; press the button. Screenshot the mid-peel at 1920×940.

- [ ] **Step 8: Commit**

```bash
git add packages/ui-kit/src packages/ui-kit/playground
git commit -m "feat(ui-kit): PeelCard — the squeeze, a 2D peel from the pressed point with a flick, a snap-back and an outside open"
```

---

### Task 7: Squeeze on the table — seats, the "Lật" pill, "Đã lật", the timer, the tray

**Files:**
- Modify: `packages/ui-kit/src/table/Seat.tsx`, `PokerTable.tsx`, `ActionBar.tsx` (`trayWaitKey`), `table.module.css`
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx`
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json`
- Test: `packages/ui-kit/src/table/Seat.test.tsx`, `PokerTable.test.tsx`, `ActionBar.test.tsx`, `screens/RoomScreen.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`revealed`, `'SQUEEZE'`, `client.reveal`), Task 6 (`PeelCard`).
- Produces: `Seat` props `squeezing: boolean` (this seat is the viewer's and its cards are its own to turn), `squeezeRound: boolean` (the table is in a squeeze round, any seat), `onReveal?: () => void`; `PokerTable` prop `onReveal?: () => void`; locale keys `actions.reveal`, `labels.revealed`, `labels.waitSqueeze`, `labels.waitOthersReveal`, `phase.squeeze`.

- [ ] **Step 1: Write the failing tests**

`Seat.test.tsx` — build a `ClientSeat` for the viewer with two `holeCards` and `revealed: false`, render with `squeezing` and `squeezeRound` true and an `onReveal` spy:
- two `[data-peel]` cards and a button named `Lật` are rendered, no `.cardTurn`;
- pressing `Lật` opens both (`data-face` → `up` after `act(() => vi.advanceTimersByTime(1000))`) and `onReveal` is called exactly once;
- with `revealed: true` the cards render as plain face-up `Card`s and there is no button;
- an opponent's seat with `revealed: true` and `squeezeRound` shows a badge `Đã lật`; with `squeezeRound` false it shows none;
- the viewer's seat shows the `TurnTimer` while squeezing with a `deadlineAt` (query the timer's role/element the existing `TurnTimer.test` uses), and not once revealed.

`PokerTable.test.tsx` — a squeeze room (`room.config.blind.squeeze: true`) with a hand in `SQUEEZE`: my seat gets `[data-peel]` cards, the opponents' seats do not; the table passes `deadlineAt` to my seat (the timer is in the DOM) and to no other.

`ActionBar.test.tsx` — `trayWaitKey` for a Blind hand in `SQUEEZE`: `'labels.waitSqueeze'` while my seat is unrevealed, `'labels.waitOthersReveal'` once `revealed: true`.

`RoomScreen.test.tsx` — in a squeeze room during `SQUEEZE`, pressing `Lật` ends with the socket sending `{ t: 'REVEAL' }` (the file has a socket fixture; follow its pattern for `ACTION`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/table/Seat.test.tsx src/table/PokerTable.test.tsx src/table/ActionBar.test.tsx src/screens/RoomScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `Seat.tsx`**

New props on `SeatProps`:

```ts
  /** Squeeze mode: this is the viewer's seat and its cards are its own to turn (spec 2026-10-08 §4.2). */
  squeezing: boolean
  /** The table is in a squeeze round: a seat that has turned says so to the others. */
  squeezeRound: boolean
  /** Every one of my cards is up: tell the table. Called once per hand. */
  onReveal?: () => void
```

Inside the component:

```tsx
  // Squeeze mode: the viewer's cards are PeelCards until every one is up; the "Lật" pill opens the rest at once.
  const [openAll, setOpenAll] = useState(false)
  const opened = useRef(new Set<number>())
  const reportedRef = useRef(false)
  const peeling = squeezing && isMe && seat.holeCards !== null && seat.revealed === false
  useEffect(() => {
    if (!squeezing) { setOpenAll(false); opened.current.clear(); reportedRef.current = false }
  }, [squeezing])
  const onOpened = (i: number) => {
    opened.current.add(i)
    if (opened.current.size >= (seat.holeCards?.length ?? 0) && !reportedRef.current) {
      reportedRef.current = true
      onReveal?.()
    }
  }
```

Cards:

```tsx
      {faces.length > 0 ? (
        <div className={s.seatCards}>
          {faces.map((card, i) =>
            peeling && card !== null ? (
              <PeelCard key={i} card={card} size={cardSize} open={openAll} onOpened={() => onOpened(i)} dealt={dealt} delayMs={(i * dealCount + dealIndex) * DEAL_STAGGER_MS} />
            ) : (
              <Card key={i} card={card} faceDown={card === null} size={cardSize} dealt={dealt} reveal={reveal} delayMs={(i * dealCount + dealIndex) * DEAL_STAGGER_MS} />
            ),
          )}
        </div>
      ) : null}
      {peeling && !openAll ? (
        <button type="button" className={s.revealBtn} onClick={() => setOpenAll(true)}>
          {t('actions.reveal')}
        </button>
      ) : null}
```

A seat that is already `revealed` (the server turned it, a snapshot) renders plain face-up `Card`s — `peeling` is false, and a `Card` that mounts face up with `dealt` false shows at rest. When `seat.revealed` flips to true *while* PeelCards are up, keep the PeelCards mounted (they are open by then) — so `peeling` must not drop them mid-animation: compute `peeling` as `squeezing && isMe && seat.holeCards !== null && (seat.revealed === false || openAll || opened.current.size > 0)`; the next hand resets it.

Timer and badge:

```tsx
        {isActing || (peeling && !reportedRef.current) ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={38} /> : null}
…
        {!isMe && squeezeRound && seat.revealed === true ? <Badge tone="teal">{t('labels.revealed')}</Badge> : null}
```

CSS for the pill, in the Seat section:

```css
/* Squeeze mode's "Lật": a small gold pill under the viewer's own cards (spec 2026-10-08 §4.2.2). */
.revealBtn {
  align-self: center;
  margin-top: 2px;
  padding: 4px 12px;
  border: 1px solid var(--gold);
  border-radius: var(--radius-pill);
  background: var(--gold);
  color: #16181d;
  font: 600 0.8rem/1 var(--font-body);
  cursor: pointer;
}
```

- [ ] **Step 4: `PokerTable.tsx`, `ActionBar.tsx`, `RoomScreen.tsx`, locales**

`PokerTable`: prop `onReveal?: () => void`; `const squeezeRound = hand !== null && room.config.blind?.squeeze === true && (hand.phase === 'SQUEEZE' || hand.phase === 'DECISION')`; per seat `squeezing={squeezeRound && index === hand!.mySeat}`, `squeezeRound={squeezeRound}`, `onReveal={onReveal}`, and `deadlineAt={acting || (squeezeRound && index === hand!.mySeat) ? deadlineAt : null}`.

`ActionBar.trayWaitKey`, inside the `hand.mode === 'blind'` branch, first:

```ts
    if (hand.phase === 'SQUEEZE') return mine?.revealed === true ? 'labels.waitOthersReveal' : 'labels.waitSqueeze'
```

and add both keys to `TrayWaitKey`.

`RoomScreen`: `onReveal={() => void request.run(() => client.reveal())}` on `<PokerTable>`.

Locales (`vi` / `en`): `actions.reveal`: "Lật" / "Turn"; `labels.revealed`: "Đã lật" / "Turned"; `labels.waitSqueeze`: "Nặn bài của bạn — hết giờ sẽ tự lật" / "Squeeze your cards — they turn when time is up"; `labels.waitOthersReveal`: "Đã lật — chờ người chơi khác" / "Turned — waiting for the others"; `phase.squeeze`: "Đang nặn bài" / "Squeezing".

- [ ] **Step 5: Run the package tests, typecheck, lint**

Run: `pnpm --filter @bp/ui-kit test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui-kit/src
git commit -m "feat(ui-kit): squeeze on the table — PeelCards for the viewer, the Lật pill, the Đã lật badge, the round's timer on my plate, the tray's wait line"
```

---

### Task 8: The lobby — the "Nặn bài" option, the hidden timer, the badges

**Files:**
- Modify: `packages/ui-kit/src/lobby/CreateRoomFields.tsx`, `CreateRoomForm.tsx`, `RoomList.tsx`
- Modify: `packages/ui-kit/src/table/RoomHeader.tsx`
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json`
- Test: `packages/ui-kit/src/lobby/CreateRoomForm.test.tsx`, `RoomList.test.tsx`, `packages/ui-kit/src/table/RoomHeader.test.tsx` (create any that is missing, following the neighbouring test files)

**Interfaces:**
- Consumes: Task 2's `blind.squeeze` and the forced timer.
- Produces: `BlindFields` props `squeeze: boolean`, `onSqueeze: (on: boolean) => void`; locale keys `create.squeeze`, `create.squeezeHint`, `labels.squeezeMode`.

- [ ] **Step 1: Write the failing tests**

`CreateRoomForm.test.tsx`: in Blind mode a checkbox labelled `Nặn bài` (vi) exists, unchecked; checking it hides the `Thời gian mỗi lượt` select; submitting then calls `onSubmit` with `blind.squeeze === true` and `turnTimerSec === 20`; unchecked, `blind.squeeze === false` and the chosen timer. In Hold'em mode there is no such checkbox.

`RoomList.test.tsx`: a Blind summary with `config.blind.squeeze: true` shows a badge `Nặn bài`; without it, none.

`RoomHeader.test.tsx`: the same badge in the header.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/lobby src/table/RoomHeader.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CreateRoomFields.tsx` — `BlindFieldsProps` gains `squeeze: boolean; onSqueeze: (on: boolean) => void`; after the `decisionMode` field:

```tsx
      <Field label={t('create.squeeze')} hint={t('create.squeezeHint')}>
        <label className={s.check}>
          <input type="checkbox" checked={squeeze} disabled={disabled} onChange={(event) => onSqueeze(event.target.checked)} />
          <span>{t('create.squeezeOn')}</span>
        </label>
      </Field>
```

(`s.check` is the class the form already uses for its "Phòng riêng tư"/"Tự động bắt đầu" checkboxes — reuse that exact markup.)

`CreateRoomForm.tsx` — `const [squeeze, setSqueeze] = useState(false)`; the timer `Field` renders only when `!(mode === 'blind' && squeeze)`; the submitted config uses `turnTimerSec: mode === 'blind' && squeeze ? ECONOMY.squeezeTurnTimerSec : turnTimerSec` and `blind: { holeCards, decisionMode, fixedWager, botCount: bots, squeeze }`; pass `squeeze`/`onSqueeze={setSqueeze}` to `BlindFields`.

`RoomList.tsx` (beside the two Blind badges) and `RoomHeader.tsx`: `{blind.squeeze === true ? <Badge tone="gold">{t('labels.squeezeMode')}</Badge> : null}`.

Locales: `create.squeeze`: "Nặn bài" / "Squeeze"; `create.squeezeOn`: "Bật — bài chia úp, tự tay bóc xem" / "On — cards are dealt face down and turned by hand"; `create.squeezeHint`: "Mỗi vòng tối đa 20 giây, hết sớm khi mọi người đã lật." / "Each round lasts up to 20 s, less once everyone has turned."; `labels.squeezeMode`: "Nặn bài" / "Squeeze".

- [ ] **Step 4: Run the package tests, typecheck, lint; commit**

Run: `pnpm --filter @bp/ui-kit test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

```bash
git add packages/ui-kit/src
git commit -m "feat(ui-kit): the Nặn bài option when creating a Blind table, its fixed round, and the badge in the list and the header"
```

---

### Task 9: End to end — the two-browser squeeze, the shots, the Lite smoke

**Files:**
- Modify: `apps/normal-web/e2e/ops/ops-helpers.ts` (`BlindRoomOptions.squeeze?: boolean`)
- Modify: `apps/normal-web/e2e/ops/04-blind.spec.ts`
- Modify: `apps/lite/e2e/lite.spec.ts`

**Interfaces:**
- Consumes: everything above, built (`pnpm build:normal`, `pnpm build:lite`).

- [ ] **Step 1: Build**

Run: `pnpm build:normal && pnpm build:lite` (the host serves `apps/normal-web/dist` from the main checkout — build in the worktree only; the deploy happens after the merge).

- [ ] **Step 2: The ops helper**

In `ops-helpers.ts`, `BlindRoomOptions` gains `squeeze?: boolean`; in `createBlind`, after the `Cách chơi` select: `if (o.squeeze === true) await dialog.getByLabel('Nặn bài').check()` and skip the timer select when `o.squeeze` (the field is hidden then).

- [ ] **Step 3: The scenario**

Append to `04-blind.spec.ts` (the file has `a` as the first player, `newPlayer`, `takeSeat`, `ready`, `start`, `resultCard`, `closeAll`):

```ts
test('F-11: a squeeze table — one peels by hand, the other presses Lật, and the round ends before its 20 s', async ({ browser }) => {
  test.setTimeout(180_000)
  const b = await newPlayer(browser, 'sq', { width: 1366, height: 768 })
  try {
    const code = await createBlind(a.page, { name: unique('Bàn F11 '), bots: 0, mode: 'Hoàn toàn may rủi', squeeze: true })
    await expect(a.page.locator('header').getByText('Nặn bài')).toBeVisible()
    await joinByCode(b.page, code)
    await takeSeat(a.page, 0)
    await takeSeat(b.page, 1)
    await ready(a.page)
    await ready(b.page)
    const t0 = Date.now()
    await start(a.page)

    // Both see their own cards face down, the hint says squeeze, and the round's timer is on their own plate.
    const mine = a.page.locator('[data-me="true"] [data-peel]')
    await expect(mine).toHaveCount(2)
    await expect(mine.first()).toHaveAttribute('data-face', 'down')
    await expect(a.page.getByText('Nặn bài của bạn')).toBeVisible()
    await a.page.screenshot({ path: 'test-results/shots/squeeze-dealt-1920.png' })

    // a peels both cards from the bottom edge, with the mouse.
    for (const i of [0, 1]) {
      const box = (await mine.nth(i).boundingBox())!
      const x = box.x + box.width / 2
      await a.page.mouse.move(x, box.y + box.height - 4)
      await a.page.mouse.down()
      await a.page.mouse.move(x, box.y + box.height * 0.55, { steps: 8 })
      if (i === 0) await a.page.screenshot({ path: 'test-results/shots/squeeze-peeling-1920.png' })
      await a.page.mouse.move(x, box.y + box.height * 0.25, { steps: 8 })
      await a.page.mouse.up()
      await expect(mine.nth(i)).toHaveAttribute('data-face', 'up')
    }
    // b sees a's seat turned; b presses Lật instead.
    await expect(b.page.locator('[data-seat="0"]').getByText('Đã lật')).toBeVisible()
    await b.page.getByRole('button', { name: 'Lật', exact: true }).click()
    await expect(b.page.locator('[data-me="true"] [data-peel]').first()).toHaveAttribute('data-face', 'up')

    // The round ended early: the result is out well before the 20 s would have run.
    await expect(resultCard(a.page)).toBeVisible({ timeout: 15_000 })
    expect(Date.now() - t0).toBeLessThan(20_000)
    await b.page.screenshot({ path: 'test-results/shots/squeeze-result-1366.png' })
    await leave(a.page)
  } finally {
    await closeAll([b])
  }
})

test('F-12: @mobile the squeeze fits a phone — the viewer’s cards, the Lật pill and the timer are on screen', async ({ browser }) => {
  // The same room shape on PHONE_SCREEN (375 × 812): create, sit with a bot, start, assert the pill and both peel cards are
  // within the viewport (boundingBox inside 375 × 812), take `squeeze-dealt-375.png`, press Lật, see the result card.
})
```

Give F-12 a real body following F-11 with `bots: 1` and `PHONE_SCREEN` (imported from `ops-helpers`); it is tagged `@mobile` so the mobile project runs it. If the 20 s round ends only on the human's turn with a bot at the table, F-12 proves it too.

- [ ] **Step 4: The Lite smoke**

In `apps/lite/e2e/lite.spec.ts`, `createBlindRoom` gains a `squeeze = false` parameter that checks `Nặn bài` and skips the timer select; the existing room test that creates a Blind room gets one more assertion after creating a squeeze room in a separate short test: the header badge `Nặn bài` is visible and the timer select was hidden while the box was checked.

- [ ] **Step 5: Run**

Run: `pnpm --filter @bp/normal-web e2e:ops -g "F-11|F-12"` (the ops pack starts its own PGlite server on 8093), then `pnpm --filter @bp/lite e2e`.
Expected: PASS. Copy the three shots (`squeeze-dealt-1920`, `squeeze-peeling-1920`, `squeeze-dealt-375`) plus `squeeze-result-1366` into the SDD workspace `shots/` for the report.

- [ ] **Step 6: Commit**

```bash
git add apps/normal-web/e2e apps/lite/e2e
git commit -m "test(e2e): the squeeze round across two browsers and on a phone; the Lite create dialog's Nặn bài"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8.1, §8.3, §8.5, §8.7, §17
- Modify: `docs/server-kit.md`, `docs/ui-kit.md`, `docs/test-matrix.md`, `docs/acceptance-checklist.md`, `CHANGELOG.md`

- [ ] **Step 1: The main spec**

§8.1: a row `squeeze | true/false (sửa đổi 2026-10-08) — bật thì turnTimer cố định 20 s`. §8.3: after step 2, "2b. **Nặn bài + kiểu A — `SQUEEZE`**: tối đa 20 s; kết thúc sớm khi mọi ghế người thật đã lật (`REVEALED`); hết giờ server lật hộ. Kiểu B: không có pha riêng; chọn Chơi/Bỏ cũng tính là đã lật." §8.5: "Bàn nặn: bot tính là đã lật từ đầu pha." §8.7: "Pha `SQUEEZE` hết giờ không tính là timeout hành động." §17: the phase, the command `REVEALED`, the events `SQUEEZE_PHASE`/`PLAYER_REVEALED`/`SQUEEZE_ENDED`, the client message `REVEAL`. Each with "(2026-10-08, spec card-motion-squeeze)".

- [ ] **Step 2: `docs/server-kit.md`, `docs/ui-kit.md`**

server-kit: the `REVEAL` message in the client contract table; `Room.reveal`; the runner's squeeze deadline and forced turn; `SQUEEZE_PHASE` carries `deadlineAt`. ui-kit: in the Table catalogue — `Deck`/`DeckAnchorProvider`, `Card`'s `dealt`/`reveal` and the constants, `PeelCard` and `peel.ts`, `Seat`'s squeeze props; the motion rules (slide, flip, lift, durations, reduced motion); the client's `reveal()` and the `restored` flag.

- [ ] **Step 3: `docs/test-matrix.md`, `docs/acceptance-checklist.md`, `CHANGELOG.md`**

test-matrix: rows for §8.3 2b (core `blind.test.ts` "squeeze mode", server `room-hands.test.ts` "squeeze mode", ops F-11/F-12), the motion (Card/CommunityCards/PokerTable tests, reveal-hold). acceptance-checklist: three rows (deal from the deck, lift at showdown, squeeze round). CHANGELOG: a new top section "Plan 21 — cards dealt from a deck and turned, the showdown's lift, and the Blind squeeze mode — merged `MERGE` (2026-10-09)" listing what changed per area, including that the per-device squeeze toggle of the first design was replaced by the room mode.

- [ ] **Step 4: Commit**

```bash
git add docs CHANGELOG.md
git commit -m "docs: the squeeze mode and the card motion — spec §8 amendments, server-kit, ui-kit, test matrix, checklist, changelog"
```

---

## Self-review

**Spec coverage.** §3 definitions → Tasks 5 (deck, slide, lift), 6 (peel). §4.1.1 deal order → Task 5 (`dealIndex`/`dealCount`). §4.1.2 board → Task 5. §4.1.3 showdown after the river and the hold → Task 5 (`reveal='lift'`, `REVEAL_HOLD_MS`); the river's 1.5 s pacing already covers "after it lands" (spec §4.1.2). §4.1.4 restored hands → Tasks 4–5. §4.1.5 reduced motion → Task 5 CSS list, Task 6 (snap only). §4.2.1 option, forced timer, badges → Tasks 2, 8. §4.2.2 PeelCard, "Lật", local only → Tasks 6–7. §4.2.3 SQUEEZE phase, early end, bots, forced turn → Tasks 1, 3. §4.2.4 decision turns → Task 1. §4.2.5 auto-play → Task 4. §4.2.6 "Đã lật" → Task 7. §4.2.7 snapshot → Tasks 1 (view), 4 (reducer). §4.2.8 → Task 3's deadline. §4.2.9 no action timeout → Task 3 (`REVEALED`, not `TIMEOUT`). §5 → the tasks above by package. §6 REVEAL no-op → Tasks 1, 3. §8 tests → each task; e2e → Task 9. §9 docs → Task 10.

**Deviation to record in the ledger:** the spec says the squeeze timer shows "như pha quyết định" — the decision phase shows no countdown today, so the squeeze round's timer is drawn on the viewer's own plate while their cards are not all turned (Task 7), which is where a Blind player looks. `BlindRules.squeeze` and `ClientSeat.revealed` are optional rather than required, so existing fixtures stay valid; a validated `BlindRoomConfig` always carries `squeeze`.

**Type consistency.** `revealed` is required on `HandPlayer`/`SeatView` (Task 1) and optional on `ClientSeat` (Task 4); the reducer copies it only in squeeze rooms. `DEAL_STAGGER_MS`, `BOARD_STAGGER_MS`, `SHOWDOWN_STAGGER_MS`, `DEAL_MS`, `LIFT_MS` are defined in Task 5 and used in Tasks 5–7. `PeelCard` props (Task 6) match their use in Task 7. `Room.reveal` (Task 3) matches the gateway case and `client.reveal()` (Task 4).
