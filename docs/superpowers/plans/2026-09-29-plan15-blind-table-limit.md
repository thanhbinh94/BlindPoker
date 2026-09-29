# Plan 15 — Blind Poker table limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Blind Poker seat plays from an escrowed table stack of `min(balance, 5 × wager)` instead of the whole balance; a seat whose stack can no longer cover a hand is stood up after the hand, told why, and must pick a seat again.

**Architecture:** The money model of Blind becomes the one Hold'em already has: `sitDown` moves points from the balance to the table (`buy_in`), hands move table stacks only (the ledger records just the fee sink), and every way off a seat cashes the stack home (`cash_out`). `@bp/core` owns the limit (`blindTableLimit`), `@bp/server-kit`'s `Room` owns the escrow and the "limit spent" stand-up, `@bp/ui-kit` shows the limit and the notice. Both editions pick it up unchanged; no database migration.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, React + react-i18next, Playwright (e2e + ops pack), Fastify (editions).

**Spec:** `docs/superpowers/specs/2026-09-29-blind-table-limit-design.md` (amends `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8/§12).

## Global Constraints

- Limit: `L = fixedWager × ECONOMY.blindTableLimitMultiplier`, multiplier **5** (1.000→5.000 … 50.000→250.000). Not configurable.
- Requirement to play a hand is unchanged: `R = blindRequiredStack(rules)` = W (`none`) or 2W (`playOrFold`).
- Sit-down: refuse `INSUFFICIENT_BALANCE` when balance < R; otherwise buy in `min(balance, L)` with ledger reason `buy_in`, refId = roomId; lost seat race → `refund` + `SEAT_TAKEN`; push `BALANCE` after a successful sit-down (both modes).
- Hands write **no** `settlement` rows for Blind; the fee sink (`meta.kind = 'table_fee'`) is unchanged.
- End of hand: a human seat with `stack < R` is stood up (remainder → `cash_out`, nothing when 0); Blind sends `NOTIFICATION { kind: 'TABLE_LIMIT_SPENT', payload: { roomId, limit: L, amount: <returned> } }`. The player stays in the room.
- Every stand-up (stand, leave, kick, reconnect expiry, sat out 5 hands, room close, shutdown) cashes out a human's stack > 0 in **both** modes.
- Bots: virtual stack = L, topped back up to L before a hand when < R. `RoomOptions.botStartingBalance` is removed.
- Carry-over release still pays **balances** (reason `refund`, sink `carry_over`) — unchanged.
- Money invariant (spec §12.6): `Σ balances + Σ table stacks + carry-over pot + Σ sinks` is constant.
- Strings (exact):
  - `labels.tableLimit`: vi `Hạn mức` / en `Limit`
  - `create.tableLimitHint`: vi `Hạn mức mỗi người: {{points}} (5× mức cược)` / en `Table limit per player: {{points}} (5× the wager)`
  - `room.shortToSit` (replaces `room.shortOfPoints`): vi `Số dư không đủ để vào bàn (cần {{amount}} điểm)` / en `Not enough points to take a seat (need {{amount}})`
  - `notify.TABLE_LIMIT_SPENT`: vi `Bạn đã dùng hết hạn mức ở bàn này — {{amount}} điểm còn lại đã về số dư. Chọn một ghế trống để vào lại.` / en `You have used up your table limit here — the {{amount}} left went back to your balance. Pick an empty seat to play again.`
  - `notify.TABLE_LIMIT_SPENT_none`: vi `Bạn đã dùng hết hạn mức ở bàn này. Chọn một ghế trống để vào lại.` / en `You have used up your table limit here. Pick an empty seat to play again.`
- Environment: in Bash run `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm. Never write file contents through Bash heredocs or `node -e "…"` (backticks and `${}` get mangled) — use the Edit/Write tools. Keep each file's line endings (many are CRLF).
- Lint: `react/jsx-no-literals` — no bare text in JSX; `--max-warnings=0`.
- Tests cited in `docs/test-matrix.md` / `docs/acceptance-checklist.md` are checked by `tooling/arch/acceptance-links.test.ts`: when a cited test is renamed, update every citation in the same commit.
- The default e2e suite may not register more accounts (server allows 10 sign-ups/min; it already uses ~9).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Change |
|---|---|
| `packages/core/src/constants/economy.ts` (+ `.test.ts`) | `blindTableLimitMultiplier: 5` |
| `packages/core/src/hand/blind.ts` (+ `blind.test.ts`), `packages/core/src/index.ts` | `blindTableLimit()` |
| `packages/server-kit/src/room/room.ts` | escrow sit-down, no per-hand Blind rows, stand-up cash-out both modes, limit-spent stand-up + notice, bots at L, no stack mirroring, guarded end-of-hand stand-ups |
| `packages/server-kit/src/room/types.ts` | drop `botStartingBalance` |
| `packages/server-kit/src/room/room.test.ts`, `room-hands.test.ts`, `gateway/gateway.test.ts` (+ any other failing server-kit test) | rewritten to the escrow model; new table-limit tests |
| `apps/normal-server/src/app.test.ts` | Blind hand test stands up before reading the ledger |
| `docs/server-kit.md`, `docs/test-matrix.md`, `docs/acceptance-checklist.md` | balanceChanged text; renamed citations |
| `packages/ui-kit/src/table/RoomHeader.tsx`, `lobby/CreateRoomFields.tsx`, `screens/Toasts.tsx`, `screens/RoomScreen.tsx`, `i18n/locales/{vi,en}/game.json` (+ tests) | limit in header and create form, notice, hint for spectators |
| `apps/normal-web/e2e/normal.spec.ts`, `apps/lite/e2e/lite.spec.ts`, `apps/normal-web/e2e/ops/{ops-helpers.ts,02-lobby-rooms.spec.ts,04-blind.spec.ts}`, `docs/operation-test-plan.md` | e2e money checks read after leaving; ops pack F-10 + re-sit helper |
| `docs/superpowers/specs/2026-09-04-bind-poker-design.md`, `docs/known-limitations.md`, `CHANGELOG.md` | docs |

---

### Task 1: `@bp/core` — the table limit

**Files:**
- Modify: `packages/core/src/constants/economy.ts`
- Modify: `packages/core/src/constants/economy.test.ts`
- Modify: `packages/core/src/hand/blind.ts`
- Modify: `packages/core/src/hand/blind.test.ts`
- Modify: `packages/core/src/index.ts:12`

**Interfaces:**
- Produces: `ECONOMY.blindTableLimitMultiplier: 5`; `blindTableLimit(rules: Pick<BlindRules, 'fixedWager'>): number` exported from `@bp/core`.

- [ ] **Step 1: Write the failing tests**

In `economy.test.ts`, inside `it('exposes tiers', …)` add:

```ts
    expect(ECONOMY.blindTableLimitMultiplier).toBe(5)
```

In `blind.test.ts`, change the import on line 4 to also import `blindTableLimit`, and add next to the existing `blindRequiredStack` test:

```ts
  it('sets the table limit at five wagers for every tier (spec 2026-09-29)', () => {
    expect([1_000, 2_000, 5_000, 10_000, 20_000, 50_000].map((fixedWager) => blindTableLimit({ fixedWager }))).toEqual([
      5_000, 10_000, 25_000, 50_000, 100_000, 250_000,
    ])
    expect(blindTableLimit(rules({ decisionMode: 'playOrFold' }))).toBe(5_000) // the mode does not change it
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @bp/core exec vitest run src/constants/economy.test.ts src/hand/blind.test.ts`
Expected: FAIL (`blindTableLimitMultiplier` undefined; `blindTableLimit` is not exported).

- [ ] **Step 3: Implement**

`economy.ts` — add after `blindWagerTiers`:

```ts
  /** A Blind seat brings at most this many wagers to the table (spec 2026-09-29, table limit). */
  blindTableLimitMultiplier: 5,
```

`blind.ts` — add `import { ECONOMY } from '../constants/economy.js'` to the imports and, after `blindRequiredStack`:

```ts
/**
 * The most a Blind seat brings to the table: five wagers (spec 2026-09-29). A player with less sits down with all of
 * it, as long as that covers `blindRequiredStack`; a seat that can no longer cover a hand is stood up and must sit
 * down again. Takes only the field it reads, so a client can ask it of the room config it was sent.
 */
export function blindTableLimit(rules: Pick<BlindRules, 'fixedWager'>): number {
  return rules.fixedWager * ECONOMY.blindTableLimitMultiplier
}
```

`index.ts:12` becomes:

```ts
export { blindRequiredStack, blindTableLimit } from './hand/blind.js'
```

- [ ] **Step 4: Run the tests and the package gate**

Run: `pnpm --filter @bp/core exec vitest run` then `pnpm --filter @bp/core exec tsc --noEmit -p .`
Expected: PASS, no type errors. Also run `pnpm test --filter ./tooling` if the repo has an architecture test for core imports (`tooling/arch/boundaries.test.ts`) — it must still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constants/economy.ts packages/core/src/constants/economy.test.ts packages/core/src/hand/blind.ts packages/core/src/hand/blind.test.ts packages/core/src/index.ts
git commit -m "feat(core): Blind table limit, five wagers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `@bp/server-kit` — escrowed Blind seats and the limit-spent stand-up

**Files:**
- Modify: `packages/server-kit/src/room/room.ts` (constructor ~68-76, `refreshBalance` doc ~172, `sitDown` ~197-236, `startHand` ~437-450, `onHandComplete` ~518-578, new `standUpSpent`, `standUpNow` ~694-711, `pushBalance` ~732-742)
- Modify: `packages/server-kit/src/room/types.ts:42,57` (remove `botStartingBalance`)
- Modify: `packages/server-kit/src/room/room-hands.test.ts`, `packages/server-kit/src/room/room.test.ts`, `packages/server-kit/src/gateway/gateway.test.ts`
- Modify (only if they fail): other server-kit tests (`edge-cases.test.ts`, `room-manager.test.ts`, `soak.test.ts`), `apps/lite/server/src/**/*.test.ts`
- Modify: `apps/normal-server/src/app.test.ts` (the Blind hand test, ~line 777-840)
- Modify: `docs/server-kit.md:44-52`, `docs/test-matrix.md:38,82`, `docs/acceptance-checklist.md` rows 40.14, 40.15, 66.28

**Interfaces:**
- Consumes: `blindTableLimit`, `blindRequiredStack` from `@bp/core` (Task 1).
- Produces: `NOTIFICATION { t: 'NOTIFICATION', kind: 'TABLE_LIMIT_SPENT', payload: { roomId: string, limit: number, amount: number } }` sent to the stood-up player (Task 3 renders it). A `BALANCE` push after every successful `SIT_DOWN`.

- [ ] **Step 1: Write the new failing tests** — append to `packages/server-kit/src/room/room-hands.test.ts` (before the `'Money conservation over many hands'` describe; `code`, `tick`, `playOut`, `seatAndStart`, `BLIND`, `TEST_ROOM_OPTIONS` already exist in the file):

```ts
describe('Blind table limit (spec 2026-09-29)', () => {
  it('a seat takes the table limit from the balance, and a hand moves only table stacks', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    expect(h.repos.entries.map((e) => [e.entry.playerId, e.entry.delta, e.entry.reason, e.entry.refId])).toEqual([
      ['h', -5_000, 'buy_in', 'room-1'],
      ['a', -5_000, 'buy_in', 'room-1'],
    ])
    expect(await h.repos.balances.get('h')).toBe(95_000)
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 95_000 }) // pushed at the buy-in
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    // a folded the 1.000 ante; h's play went uncalled and came back, and h took the 2.000 pot less the 2% fee.
    expect(h.room.players.get('a')!.stack).toBe(4_000)
    expect(h.room.players.get('h')!.stack).toBe(5_000 + 1_000 - 40)
    expect(h.repos.entries).toHaveLength(2) // no per-hand rows: the balances did not move
    expect(await h.repos.balances.get('a')).toBe(95_000)
    expect(h.repos.sinks).toEqual([{ refId: h.repos.hands[0]!.handId, fee: 40, kind: 'table_fee' }])
  })

  it('a seat that spends its table limit is stood up after the hand, told why, and stays to watch', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    expect(h.room.players.get('poor')!.stack).toBe(2_500) // all of it: under the 5.000 limit, over the 2.000 a hand needs
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' })) // the ante goes → 1.500, short of 2.000
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(h.room.hasPlayer('poor')).toBe(true) // still in the room, watching
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'poor').map((e) => [e.entry.delta, e.entry.reason])).toEqual([
      [-2_500, 'buy_in'],
      [1_500, 'cash_out'],
    ])
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    expect(h.last('poor', 'NOTIFICATION')).toEqual({ t: 'NOTIFICATION', kind: 'TABLE_LIMIT_SPENT', payload: { roomId: 'room-1', limit: 5_000, amount: 1_500 } })
    expect(h.ofType('h', 'ROOM_EVENT').some((m) => m.event.type === 'PLAYER_STOOD' && m.event.playerId === 'poor')).toBe(true)
    expect(h.ofType('h', 'NOTIFICATION').some((m) => m.kind === 'TABLE_LIMIT_SPENT')).toBe(false) // only the one it concerns

    // Sitting again is a fresh buy-in: refused while 1.500 cannot cover a hand, the limit again once it can.
    expect(await code(h.room.sitDown('poor', 1))).toBe('INSUFFICIENT_BALANCE')
    h.repos.records.get('poor')!.balance = 50_000
    await h.room.sitDown('poor', 1)
    expect(h.room.players.get('poor')!.stack).toBe(5_000)
    expect(await h.repos.balances.get('poor')).toBe(45_000)
  })

  it('every way off a seat takes the table stack home', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    for (const [i, id] of ['h', 'a', 'b'].entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i)
    }
    await h.room.standUp('h')
    await h.room.leave('a')
    await h.room.kick('h', 'b')
    expect(h.repos.entries.filter((e) => e.entry.reason === 'cash_out').map((e) => [e.entry.playerId, e.entry.delta])).toEqual([
      ['h', 5_000],
      ['a', 5_000],
      ['b', 5_000],
    ])
    for (const id of ['h', 'a', 'b']) expect(await h.repos.balances.get(id)).toBe(100_000)
  })

  it('bots play from a virtual table limit, topped back up when it cannot cover a hand', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    const bot = [...h.room.players.values()].find((p) => p.identity.isBot)!
    expect(bot.stack).toBe(5_000)
    await seatAndStart(h, ['h'])
    await playOut(h, () => ({ kind: 'fold' }))
    bot.stack = 500 // as if it had lost its limit
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === bot.identity.playerId)).toBe(true)
    expect(bot.stack).toBe(5_000)
    expect(h.repos.entries.every((e) => e.entry.playerId !== bot.identity.playerId)).toBe(true) // never the ledger
  })

  it('a balance change elsewhere is pushed, and the table stack is left alone', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.sitDown('h', 0)
    h.repos.records.get('h')!.balance = 142_000
    await h.room.refreshBalance('h')
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 142_000 })
    expect(h.room.players.get('h')!.stack).toBe(5_000)
  })

  it('a cash-out that fails at the end of a hand does not wedge the room; it is retried after the next', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    const real = h.repos.balances.apply.bind(h.repos.balances)
    let failOnce = true
    h.repos.balances.apply = async (batch, meta) => {
      if (failOnce && batch.some((e) => e.reason === 'cash_out')) {
        failOnce = false
        throw new Error('ledger unavailable')
      }
      return real(batch, meta)
    }
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' }))
    expect(h.room.players.get('poor')!.seat).toBe(1) // the stand-up could not write, so the seat stays…
    expect(h.room.nextHandAt).not.toBeNull() // …and the room still deals on
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === 'poor')).toBe(false) // short: not dealt in
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(await h.repos.balances.get('poor')).toBe(1_500)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @bp/server-kit exec vitest run src/room/room-hands.test.ts`
Expected: the new describe FAILS (stack is the whole balance, no `buy_in` rows, no notice).

- [ ] **Step 3: Implement in `room.ts`**

Imports (line 1-5): add `blindTableLimit` next to `blindRequiredStack`.

Constructor — replace the bot block (lines 68-76) with:

```ts
    const blind = init.config.blind
    if (init.config.mode === 'blind' && blind !== undefined) {
      for (let i = 0; i < blind.botCount; i++) {
        const bot = this.addPlayer({ playerId: `bot:${init.roomId}:${i}`, displayName: `Bot ${i + 1}`, isBot: true })
        bot.seat = init.config.maxPlayers - 1 - i
        // A virtual table limit, like everyone else's, topped back up in `startHand` (spec 2026-09-29 §4.7).
        bot.stack = blindTableLimit(blind)
        bot.ready = true
      }
    }
```

`refreshBalance` doc comment (line ~172) becomes `/** Re-reads a player's balance and pushes \`BALANCE\`. Queued, so it lands after anything already in the room's queue. */` (write it with the Edit tool).

`sitDown` — replace the body from `if (this.rules.mode === 'holdem') {` through the end of the Blind `else` block (lines ~204-226) with:

```ts
      // Both modes bring a table stack out of the balance (spec 2026-09-29): Hold'em the buy-in the player chose, Blind
      // the table limit — or the whole balance when that is less, as long as it covers one hand.
      let amount: number
      if (this.rules.mode === 'holdem') {
        const bb = this.rules.bigBlind
        const min = (this.config.holdem?.minBuyInBB ?? 0) * bb
        const max = (this.config.holdem?.maxBuyInBB ?? 0) * bb
        if (buyIn === undefined || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) throw new RoomError('INVALID_AMOUNT', `buy-in must be ${min}–${max}`)
        amount = buyIn
      } else {
        const balance = await this.deps.repos.balances.get(playerId)
        if (balance < blindRequiredStack(this.rules)) throw new RoomError('INSUFFICIENT_BALANCE')
        amount = Math.min(balance, blindTableLimit(this.rules))
      }
      try {
        await this.deps.repos.balances.apply([{ playerId, delta: -amount, reason: 'buy_in', refId: this.roomId }])
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw new RoomError('INSUFFICIENT_BALANCE')
        throw err
      }
      if (this.seatPlayer(seat)) {
        // lost the race while awaiting: refund
        await this.deps.repos.balances.apply([{ playerId, delta: amount, reason: 'refund', refId: this.roomId }])
        throw new RoomError('SEAT_TAKEN')
      }
      p.stack = amount
```

and after the existing `this.changed()` at the end of `sitDown` add:

```ts
      // The balance just moved to the table: the player's own bar must say so now, not at the next stand-up.
      await this.pushBalance(playerId)
```

`startHand` — replace the Blind loop (lines ~444-450) with:

```ts
    if (this.rules.mode === 'blind') {
      // Humans play from the stack they brought; only bots are topped up — back to the limit, never the ledger.
      const limit = blindTableLimit(this.rules)
      for (const p of this.seated()) if (p.identity.isBot && p.stack < required) p.stack = limit
    }
```

`onHandComplete`:
1. Delete the Blind `settlement` push (`if (rp && !rp.identity.isBot && this.rules.mode === 'blind' && net !== 0) entries.push(…)`) and the now-unused `entries` array.
2. Replace the ledger block with a fee-only write:

```ts
    // Both modes move chips on the table (spec 2026-09-29), so the hand's only ledger row is the fee sink.
    if (result.fee > 0) {
      try {
        await this.deps.repos.balances.apply([], { refId: state.handId, fee: result.fee, kind: 'table_fee' })
      } catch (err) {
        // The hand is still recorded and still emitted, flagged, so an operator can reconcile it.
        summary.settlementError = String(err)
        this.deps.log.error('settlement failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
      }
    }
```

3. Replace the stand-up loop (`for (const p of [...this.players.values()]) { … }`) with:

```ts
    const required = this.requiredStack()
    for (const p of [...this.players.values()]) {
      // One player's ledger failure must not take the next deal down with it: logged, and retried after the next hand
      // (a short seat sits that hand out in `startHand`).
      try {
        if (!p.identity.isBot && p.consecutiveTimeouts >= this.deps.options.consecutiveTimeoutsToStand) {
          p.standAfterHand = true
          p.consecutiveTimeouts = 0
        }
        if (p.leaveAfterHand) await this.removePlayer(p, 'left')
        else if (p.standAfterHand) await this.standUpNow(p)
        else if (p.seat !== null && !p.identity.isBot && p.stack < required) await this.standUpSpent(p)
      } catch (err) {
        this.deps.log.error('stand-up after hand failed', { roomId: this.roomId, playerId: p.identity.playerId, err: String(err) })
      }
    }
```

   (Hold'em's old `p.stack === 0` rule is the `p.stack < required` branch: `requiredStack()` is 1 in Hold'em.)

New private method, next to `standUpNow`:

```ts
  /**
   * Spec 2026-09-29 (table limit): a seat whose stack can no longer cover a hand goes back to the rail when the hand
   * ends — whatever is left goes home — and a Blind player is told why, so the empty seat reads as "your limit is
   * spent, sit again" rather than a glitch. Hold'em's busted seat (stack 0) takes the same path without the notice.
   */
  private async standUpSpent(p: RoomPlayer): Promise<void> {
    const returned = p.stack
    await this.standUpNow(p)
    if (this.rules.mode === 'blind' && p.connected) {
      this.deps.outbox.send(p.identity.playerId, {
        t: 'NOTIFICATION',
        kind: 'TABLE_LIMIT_SPENT',
        payload: { roomId: this.roomId, limit: blindTableLimit(this.rules), amount: returned },
      })
    }
  }
```

`standUpNow` — the cash-out condition becomes mode-independent:

```ts
    if (!p.identity.isBot && p.stack > 0) {
```

`pushBalance` — delete the line `if (this.rules.mode === 'blind' && p.seat !== null) p.stack = balance`.

`types.ts` — delete `botStartingBalance: number` from `RoomOptions` and `botStartingBalance: 1_000_000,` from `DEFAULT_ROOM_OPTIONS`. `pnpm --filter @bp/server-kit exec tsc --noEmit -p .` must find no other user (grep the repo: `apps/` must not pass it either).

- [ ] **Step 4: Run the new tests**

Run: `pnpm --filter @bp/server-kit exec vitest run src/room/room-hands.test.ts -t "table limit"`
Expected: PASS.

- [ ] **Step 5: Rewrite the tests the old model breaks**

`room-hands.test.ts`:
1. Rename `'plays a full hand with bots, settles balances, records history and schedules the next hand'` → `'plays a full hand with bots, settles the table stacks, records history and schedules the next hand'`, and replace its lines 74-79 (from `const settled = …` to the `BALANCE` expectation) with:

```ts
    // Spec 2026-09-29 (table limit): both seats bought in with 5.000; the hand moves table stacks only, and its one
    // ledger row is the fee sink.
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'buy_in'])
    expect(h.repos.sinks).toEqual([{ refId: summary.handId, fee: summary.fee, kind: 'table_fee' }])
    expect(h.room.players.get('a')!.stack).toBe(5_000 - 1_000) // folded: lost the ante
    expect(await h.repos.balances.get('a')).toBe(100_000 - 5_000)
    expect(h.last('a', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 95_000 }) // pushed at the buy-in, not by the hand
```

2. `'carries the pot over when everyone folds and pays it out in a later hand'` — replace the last comment and the two balance expectations with:

```ts
    // hand 1: h −1000, a −1000 (both fold, 2000 carried). hand 2: antes 1000 each on top of the 2000 carry; h plays (+1000);
    // a folds → h's uncalled 1000 is returned; pot 4000, fee 80, h receives 3920 → h's stack 5000 + 1920, a's 5000 − 2000.
    expect(h.room.players.get('h')!.stack).toBe(5_000 + 1_920)
    expect(h.room.players.get('a')!.stack).toBe(5_000 - 2_000)
    expect(await h.repos.balances.get('h')).toBe(95_000) // the balances only moved at the buy-in
```

3. Delete `'a human who cannot afford the wager sits out the hand'` (replaced by the limit-spent test) and `'a seat that is only short-stacked is never stood up, however many hands it misses'` (a human seat can no longer stay short: it is stood up).
4. `'records and emits a hand whose settlement failed, …'` — the two balance expectations become `toBe(95_000)` (the buy-ins happened; the failed batch is the fee sink only). Keep the title.
5. `'releases a carry-over pot to the seated humans once the room cannot start a hand for carryOverReleaseMs'` — keep the title (cited in `docs/test-matrix.md`); replace the body with:

```ts
    // 'poor' brings its whole 2.500 (under the 5.000 limit); after the all-fold hand 1.500 is left, short of the
    // 2 × 1000 a hand needs, so it is stood up and only h stays seated — no hand can start, and the pot waits.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs) // next-hand timer fires, one seat left → OPEN + release armed
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.carryOverPot).toBe(2_000)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs)
    await tick(h)
    expect(h.room.carryOverPot).toBe(0)
    expect(await h.repos.balances.get('h')).toBe(95_000 + 2_000) // the whole pot: h is the only seated human
    expect(h.room.players.get('h')!.stack).toBe(4_000)
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    expect(h.repos.sinks).toEqual([])
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 97_000 })
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_STATUS', status: 'OPEN' })
    expect(h.room.view().carryOverPot).toBe(0)
```

6. `'blind: Σ human balance changes + bot nets + fees = 0 across 12 hands with a mixed policy'` — the humans' side now includes what is still on the table:

```ts
    const onTable = (id: string) => h.room.players.get(id)?.stack ?? 0
    const humanDelta = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a')) + onTable('h') + onTable('a') - 200_000
```

`room.test.ts`:
1. Rename `'blind sit-down needs the required balance and never moves points'` → `'blind sit-down needs the required balance and brings the table limit, or all of a smaller balance'` with body:

```ts
    const h = createRoomHarness(BLIND, { players: [['h', 100_000], ['poor', 1_500]] })
    await h.room.join(h.identity('poor'), 'pw12')
    expect(await code(h.room.sitDown('poor', 0))).toBe('INSUFFICIENT_BALANCE') // needs 2 × 1000
    await h.room.sitDown('h', 0)
    expect(h.room.players.get('h')!.stack).toBe(5_000)
    expect(h.repos.entries.map((e) => [e.entry.playerId, e.entry.delta, e.entry.reason])).toEqual([['h', -5_000, 'buy_in']])
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 95_000 })
    expect(await code(h.room.sitDown('h', 2))).toBe('ILLEGAL_ACTION') // seat 2 is a bot's — and h is already seated

    const g = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['mid', 3_000]] })
    await g.room.join(g.identity('mid'), 'pw12')
    await g.room.sitDown('mid', 1)
    expect(g.room.players.get('mid')!.stack).toBe(3_000) // less than the limit, more than a hand: all of it
    expect(await g.repos.balances.get('mid')).toBe(0)
```

2. `'refuses when the one ready human cannot cover the wager, rather than acknowledging and doing nothing'` — keep the title; replace the two setup lines (`const balance = …` and the `apply(…'settlement')`) and their comment with:

```ts
    // Unreachable through the API since the table limit — a spent seat is stood up when its hand ends — so the stack is
    // forced here to keep the refusal honest.
    h.room.players.get('h')!.stack = 500
```

3. Any other assertion in this file that expected a Blind seat's `stack` to equal the balance (e.g. the "Rejoin mid-hand" test) expects the buy-in (`5_000`, or less the ante after a hand) instead.

`gateway/gateway.test.ts`:
1. Rename `'notify reaches a live session, and balanceChanged refreshes a blind seat’s mirrored stack'` → `'notify reaches a live session, and balanceChanged pushes the balance without touching a blind seat’s table stack'`. After `PLAYER_SAT`, consume the buy-in push: `expect((await a.next('BALANCE')).balance).toBe(95_000)`; the stack expectation becomes `5_000`; after `balanceChanged('a')` expect `BALANCE` 142_000 and the stack still `5_000`.
2. `'deals private cards only to their owner, drives the decision phase, settles and pushes the balance'` → rename to `'deals private cards only to their owner, drives the decision phase, settles the table stack and cashes it out on stand-up'`; start that test's server with `startTestServer({ roomOptions: { handIntervalMs: 60_000 } })` so no second hand deals; replace the tail from `const balance = await a.next('BALANCE')` with:

```ts
    // Spec 2026-09-29 (table limit): the hand moved the table stack only; standing up takes it home.
    expect(await a.request({ t: 'STAND_UP', reqId: rid() })).toMatchObject({ t: 'ACK' })
    const balance = await a.next('BALANCE', (m) => m.balance !== 95_000)
    expect(balance.balance).not.toBe(100_000)
    expect(await ts.repos.balances.get('a')).toBe(balance.balance)
    expect(ts.repos.hands).toHaveLength(1)
```

   (If `a.next` for `BALANCE` does not take a predicate, consume the buy-in `BALANCE` right after `SIT_DOWN` instead and read the next one here. Drop the old trailing `ROOM_STATUS` wait if the stand-up makes it unreachable.)

`apps/normal-server/src/app.test.ts` — in `'settles through the ledger, records a table_fee sink and moves both players’ counters'` (keep the title): right after `const complete = …HAND_COMPLETE…` / its expectation, add

```ts
    // Spec 2026-09-29 (table limit): the stacks go home when the players stand; only then do the balances show the hand.
    expect(await a.request({ t: 'STAND_UP', reqId: 'stand-a' })).toMatchObject({ t: 'ACK' })
    expect(await b.request({ t: 'STAND_UP', reqId: 'stand-b' })).toMatchObject({ t: 'ACK' })
```

and change the conservation query's reasons from `('settlement', 'table_fee')` to `('buy_in', 'cash_out', 'table_fee')`, with its comment saying "what the seats brought, what they took home and the fee cancel to zero". The balances assertion (`2 * startingBalance - fees + rewards`) stays.

Run the whole server-kit suite, then the editions: `pnpm --filter @bp/server-kit exec vitest run`, `pnpm --filter @bp/normal-server exec vitest run`, `pnpm --filter @bp/lite-server exec vitest run` (check the Lite server package name in `apps/lite/server/package.json`, or run `pnpm test` from the root). Every failure must be a test that assumed "the seat is the balance": fix it to the escrow model using the same numbers as above (buy-in `min(balance, 5 × W)`, balances move at sit-down and stand-up only). Never delete a test other than the two listed; if a failure is not explained by the escrow model, stop and report it.

- [ ] **Step 6: Docs that name the old behaviour**

- `docs/server-kit.md` — the `balanceChanged` bullet (lines ~48-52) becomes: "**`balanceChanged(playerId)`** — re-reads the balance and pushes `BALANCE`. If the player is seated it goes through the room's queue (`Room.refreshBalance`) so the push lands in order with the room's own. It never touches a table stack: since the table limit (spec 2026-09-29) a Blind seat, like a Hold'em one, plays from points it brought to the table (`buy_in` at `SIT_DOWN`, `cash_out` when it stands)." Add one short paragraph under the room section (or wherever `sitDown`/stand-up is described; grep `buy_in`) describing the limit-spent stand-up and the `TABLE_LIMIT_SPENT` notification payload.
- `docs/test-matrix.md` line 38: the gateway title → the new one. Line 82: the gateway title → the new one, and the parenthesis "(the Blind half, where the seat *is* the balance — §8.1)" → "(the Blind half: the balance is pushed, the table stack is left alone — spec 2026-09-29)".
- `docs/acceptance-checklist.md` rows 40.14, 40.15, 66.28: `settles balances` → `settles the table stacks` in the cited title.

Run: `pnpm exec vitest run tooling/arch` (or `pnpm test` from the root) — the citation test must pass.

- [ ] **Step 7: Package gate and commit**

Run: `pnpm typecheck` and `pnpm lint` from the root. Expected: clean.

```bash
git add packages/server-kit apps/normal-server/src/app.test.ts docs/server-kit.md docs/test-matrix.md docs/acceptance-checklist.md
git add apps/lite/server/src   # only if a Lite test changed
git commit -m "feat(server-kit): Blind seats play from an escrowed table limit and stand up when it is spent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `@bp/ui-kit` — the limit on screen, the notice, the spectator hint

**Files:**
- Modify: `packages/ui-kit/src/table/RoomHeader.tsx:33-38`
- Modify: `packages/ui-kit/src/lobby/CreateRoomFields.tsx` (`BlindFields`, the wager `Field`)
- Modify: `packages/ui-kit/src/screens/Toasts.tsx` (`describe`)
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx:172-183`
- Modify: `packages/ui-kit/src/i18n/locales/vi/game.json`, `packages/ui-kit/src/i18n/locales/en/game.json`
- Test: `packages/ui-kit/src/screens/RoomScreen.test.tsx`, `packages/ui-kit/src/screens/Toasts.test.tsx`, `packages/ui-kit/src/lobby/CreateRoomForm.test.tsx`
- Modify if it mentions the old hint: `docs/ui-kit.md` (grep `shortOfPoints`, `T4`)

**Interfaces:**
- Consumes: `blindTableLimit`, `blindRequiredStack`, `ECONOMY` from `@bp/core`; the `TABLE_LIMIT_SPENT` notification from Task 2 (`payload.amount` = points returned).

- [ ] **Step 1: Locale keys** (both files, same key order; strings exactly as in Global Constraints)

- `labels` object (the one holding `"wager": "Mức cược"`, ~line 95): add `"tableLimit"` after `"wager"`.
- `create` object: add `"tableLimitHint"` after `"buyInHint"`.
- `room` object: replace `"shortOfPoints"` with `"shortToSit"`.
- `notify` object: add `"TABLE_LIMIT_SPENT"` and `"TABLE_LIMIT_SPENT_none"` before `"other"`.

- [ ] **Step 2: Write the failing tests**

`RoomScreen.test.tsx` — replace the whole `describe('a seat the balance cannot cover (T4)', …)` block with:

```tsx
  describe('a player the balance cannot seat (T4, table limit)', () => {
    /** Play-or-fold at 5,000: a hand needs the ante and the play, 10,000; the table limit is 25,000. */
    const blindRoom = (me: Partial<RoomPlayerView>, decisionMode: 'none' | 'playOrFold' = 'playOrFold') =>
      makeRoom({
        mode: 'blind',
        status: 'OPEN',
        hostPlayerId: 'me',
        config: {
          name: 'B',
          mode: 'blind',
          maxPlayers: 4,
          isPrivate: false,
          turnTimerSec: 15,
          autoStart: false,
          hasPassword: false,
          blind: { holeCards: 3, decisionMode, fixedWager: 5_000, botCount: 1 },
        },
        players: [
          makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: null, status: null, stack: 0, ...me }),
          makePlayer({ playerId: 'bot:r:0', displayName: 'Bot 1', isBot: true, seat: 3, status: 'READY', stack: 25_000, ready: true }),
        ],
      })

    it('tells a spectator whose balance cannot cover a hand what sitting down needs', () => {
      wrap(fakeClient(makeState({ balance: 7_000, room: blindRoom({}) })))
      expect(screen.getByText('Not enough points to take a seat (need 10,000)')).toBeInTheDocument()
      expect(screen.queryByText('Take a seat to play.')).toBeNull()
    })

    it('measures pure luck against the stake alone', () => {
      wrap(fakeClient(makeState({ balance: 4_000, room: blindRoom({}, 'none') })))
      expect(screen.getByText('Not enough points to take a seat (need 5,000)')).toBeInTheDocument()
    })

    it('says it between hands too, while the table plays on without them', () => {
      const room = { ...blindRoom({}), status: 'IN_GAME' as const, nextHandAt: 1_005_000 }
      wrap(fakeClient(makeState({ balance: 7_000, room })))
      expect(screen.getByText('Not enough points to take a seat (need 10,000)')).toBeInTheDocument()
    })

    it('never says it to a seated player: their points are on the table, and a short seat is stood up', () => {
      wrap(fakeClient(makeState({ balance: 0, room: blindRoom({ seat: 0, status: 'SEATED', stack: 25_000 }) })))
      expect(screen.queryByText(/Not enough points/)).toBeNull()
      expect(screen.getByText('Press Ready to start — a hand needs at least one real player.')).toBeInTheDocument()
    })

    it('keeps the usual hint once the balance covers a hand', () => {
      wrap(fakeClient(makeState({ balance: 10_000, room: blindRoom({}) })))
      expect(screen.queryByText(/Not enough points/)).toBeNull()
      expect(screen.getByText('Take a seat to play.')).toBeInTheDocument()
    })

    it('writes the amount the way the app writes points, in Vietnamese too', () => {
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <RoomScreen client={fakeClient(makeState({ balance: 7_000, room: blindRoom({}) }))} lang="vi" onLeft={vi.fn()} />
        </I18nextProvider>,
      )
      expect(screen.getByText('Số dư không đủ để vào bàn (cần 10.000 điểm)')).toBeInTheDocument()
    })

    it('shows the wager and the table limit in the header', () => {
      wrap(fakeClient(makeState({ balance: 50_000, room: blindRoom({}) })))
      expect(screen.getByText(/Wager 5,000 · Limit 25,000/)).toBeInTheDocument()
    })
  })
```

(`makePlayer` may not accept `status: null`; use whatever the file's spectator players use — e.g. the C5 test's host has `seat: null, status: 'SEATED'`. Match the existing helpers; the assertions are the requirement.)

`Toasts.test.tsx` — add (follow the file's render helper and props):

```tsx
  it('tells a player whose table limit is spent what came home, and what to do', () => {
    renderToasts({ notifications: [{ id: 1, kind: 'TABLE_LIMIT_SPENT', payload: { roomId: 'r', limit: 5_000, amount: 1_500 }, at: 0 }] })
    expect(screen.getByText('You have used up your table limit here — the 1,500 left went back to your balance. Pick an empty seat to play again.')).toBeInTheDocument()
  })

  it('leaves out the "went back" part when nothing was left', () => {
    renderToasts({ notifications: [{ id: 1, kind: 'TABLE_LIMIT_SPENT', payload: { roomId: 'r', limit: 5_000, amount: 0 }, at: 0 }] })
    expect(screen.getByText('You have used up your table limit here. Pick an empty seat to play again.')).toBeInTheDocument()
  })
```

`CreateRoomForm.test.tsx` — add (follow the file's render/open helpers; Blind is chosen with the mode segment, the wager with the "Fixed wager" select):

```tsx
  it('says what the chosen wager means as a table limit', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Blind Poker' }))
    expect(screen.getByText('Table limit per player: 5,000 pts (5× the wager)')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Fixed wager'), '5000')
    expect(screen.getByText('Table limit per player: 25,000 pts (5× the wager)')).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run to see them fail**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/screens/RoomScreen.test.tsx src/screens/Toasts.test.tsx src/lobby/CreateRoomForm.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 4: Implement**

`RoomHeader.tsx` — the Blind branch of `stakes` becomes:

```tsx
        : `${t('labels.wager')} ${formatPoints(blind.fixedWager, lang)} · ${t('labels.tableLimit')} ${formatPoints(blindTableLimit(blind), lang)}`
```

(import `blindTableLimit` from `@bp/core`).

`CreateRoomFields.tsx` — in `BlindFields`, the wager field gets a hint (import `blindTableLimit` from `@bp/core`):

```tsx
      <Field
        label={t('create.wager')}
        hint={t('create.tableLimitHint', { points: `${formatPoints(blindTableLimit({ fixedWager }), lang)} ${t('common:units.pointsShort')}` })}
      >
        <Select value={fixedWager} options={wagers} disabled={disabled} onChange={onFixedWager} />
      </Field>
```

`Toasts.tsx` — in `describe`, pick the key before calling `t`:

```tsx
    // A spent table limit with nothing left over has no "went back to your balance" to report (spec 2026-09-29).
    const key = n.kind === 'TABLE_LIMIT_SPENT' && amount === 0 ? 'notify.TABLE_LIMIT_SPENT_none' : `notify.${n.kind}`
    return t(key, {
```

`RoomScreen.tsx` — replace the T4 comment and the lines computing `needed`, `inHandNow`, `shortOf`, `hint` with:

```tsx
  /**
   * What sitting down needs, when the balance cannot cover it (finding T4 of the 2026-09-28 run, reworked for the table
   * limit of 2026-09-29). Blind only, and only for a player who is not seated: a seat plays from the stack it brought,
   * and a seat whose stack cannot cover the next hand is stood up — so the one who can be short is the one watching.
   * Hold'em's buy-in dialog states its own range.
   */
  const needed = room.config.blind === undefined ? null : blindRequiredStack(room.config.blind)
  const shortToSit = canSit && needed !== null && state.balance < needed ? needed : null
  const hint = shortToSit !== null ? t('room.shortToSit', { amount: formatPoints(shortToSit, lang) }) : hintKey === null ? null : t(hintKey)
```

`docs/ui-kit.md` — if it describes the T4 hint or `shortOfPoints`, update the sentence to the spectator rule above; add one line under notifications/toasts naming `TABLE_LIMIT_SPENT` (and its `_none` variant).

- [ ] **Step 5: Run the ui-kit suite, both web apps and the gate**

Run: `pnpm --filter @bp/ui-kit exec vitest run`, then `pnpm --filter @bp/normal-web exec vitest run` and the Lite web tests (root `pnpm test` covers all), then `pnpm typecheck` and `pnpm lint`.
Expected: PASS. The i18n parity test (vi/en same keys) must pass. If `packages/ui-kit/playground/mock-client.ts` or a test fixture builds Blind seats whose stack is a balance (e.g. `1_000_000` for bots), leave fixtures alone unless a test fails.

- [ ] **Step 6: Commit**

```bash
git add packages/ui-kit docs/ui-kit.md
git commit -m "feat(ui-kit): show the Blind table limit, say when it is spent, hint a spectator who cannot sit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: end-to-end — e2e money checks, ops pack F-10, operation test plan

**Files:**
- Modify: `apps/normal-web/e2e/normal.spec.ts` (`'một tài khoản chơi trọn một ván Blind với bot'`)
- Modify: `apps/lite/e2e/lite.spec.ts` (the two-browser Blind test)
- Modify: `apps/normal-web/e2e/ops/ops-helpers.ts` (new `keepPlaying`)
- Modify: `apps/normal-web/e2e/ops/02-lobby-rooms.spec.ts` (S-04 S-05 D-05)
- Modify: `apps/normal-web/e2e/ops/04-blind.spec.ts` (F-01, F-03/F-05, F-06, F-09, K-02, H-02 comment, new F-10)
- Modify: `docs/operation-test-plan.md` (rows F-01, F-07, new F-10; the §6 session script if it says balances move per hand)

**Interfaces:**
- Consumes: Task 2 server behaviour; Task 3 strings (`Hạn mức 5.000` in the header; toast text starting `Bạn đã dùng hết hạn mức ở bàn này`).

The rule for every Blind money check: **the balance moves at sit-down (−limit) and at stand-up/leave (+stack)**, never at the end of a hand. So read balances *after leaving*, and reconcile `buy_in` + `cash_out` rows instead of `settlement` rows. W = 1.000 in these tests, so the limit is 5.000.

- [ ] **Step 1: Normal e2e** — in `normal.spec.ts`, declare `const LIMIT = 5 * WAGER` next to the existing `WAGER`/`PLAY_COST` constants (add `WAGER = 1_000` if only `PLAY_COST` exists). Move the "Rời phòng" click (and its URL expectation) *before* the balance read, and read

```ts
    const end = await balanceWhen(page, (n) => n !== start - LIMIT)
```

Replace the ledger block's settlement lines with:

```ts
    const buyIns = entries.filter((e) => e.reason === 'buy_in')
    const cashOuts = entries.filter((e) => e.reason === 'cash_out')
    expect(buyIns.map((e) => e.amount), 'sitting down took the table limit').toEqual([-LIMIT])
    expect(cashOuts, 'leaving took the stack home, once').toHaveLength(1)
    expect(buyIns[0]!.amount + cashOuts[0]!.amount, 'and together they are the move the result card described').toBe(payout + returned - PLAY_COST)
```

Keep every other assertion (the `end - start` formula is unchanged, it just reads later). Keep the achievements/progress part.

- [ ] **Step 2: Lite e2e** — same move in `lite.spec.ts`: both pages leave first, then

```ts
    const endB = await balanceWhen(pageB, tokenB, (n) => n !== startB - LIMIT)
    const endA = await balanceWhen(pageA, tokenA, (n) => n !== startA - LIMIT)
```

with `const LIMIT = 5 * WAGER`. The delta expectations are unchanged.

- [ ] **Step 3: Ops helper** — add to `ops-helpers.ts`:

```ts
/**
 * Spec 2026-09-29 (Blind table limit): a seat that spends its limit is stood up after the hand. A test that needs many
 * hands calls this inside its poll: sit back down (a fresh buy-in), re-arm Ready/Start when the table fell back to
 * waiting, and turn auto-play on again (it ends with the seat). Every step is a no-op when it does not apply.
 */
export async function keepPlaying(page: Page, seat: number): Promise<void> {
  const sit = page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: /Ngồi vào bàn/ })
  if (await sit.isVisible().catch(() => false)) await takeSeat(page, seat)
  const readyButton = page.getByRole('button', { name: 'Sẵn sàng', exact: true })
  if (await readyButton.isVisible().catch(() => false)) await readyButton.click().catch(() => undefined)
  const startButton = page.getByRole('button', { name: 'Bắt đầu', exact: true })
  if ((await startButton.count()) > 0 && (await startButton.isEnabled().catch(() => false))) await startButton.click().catch(() => undefined)
  const auto = page.getByRole('button', { name: 'Tự động chơi' })
  if ((await auto.count()) > 0 && (await auto.getAttribute('aria-pressed').catch(() => null)) === 'false') await auto.click().catch(() => undefined)
}
```

(Check the auto-play toggle really carries `aria-pressed`; if it does not, detect "off" the way the UI exposes it.)

- [ ] **Step 4: Ops specs**

`02-lobby-rooms.spec.ts` S-05: after `Ngồi ngoài`, call `leave(host.page)` *before* reading the ledger, then:

```ts
  const fresh = await ledgerSince(host.page, rowsBefore)
  expect(fresh.filter((row) => row.reason === 'buy_in').map((row) => row.amount), 'S-05: the seat took the 5.000 limit').toEqual([-5_000])
  expect(fresh.filter((row) => row.reason === 'cash_out'), 'and leaving took the stack home').toHaveLength(1)
  expect((await balanceOf(host.page)) - before, 'the balance moved by exactly the rows the hand wrote').toBe(sumOf(fresh))
```

(and drop the later `leave(host.page)`; wait for the cash-out with `balanceWhen(host.page, (n) => n !== before - 5_000)` before reading the ledger).

`04-blind.spec.ts`:
- **F-01 H-01**: after `leave`, wait with `balanceWhen(a.page, (n) => n !== before - 5_000)`; the fresh rows are `buy_in`, `cash_out` and possibly `achievement`:

```ts
  const buyIn = fresh.filter((row) => row.reason === 'buy_in')
  const cashOut = fresh.filter((row) => row.reason === 'cash_out')
  expect(buyIn.map((row) => row.amount)).toEqual([-5_000])
  expect(cashOut).toHaveLength(1)
  expect(fresh.every((row) => ['buy_in', 'cash_out', 'achievement'].includes(row.reason)), 'nothing else moved').toBe(true)
  expect((await balanceOf(a.page)) - before, 'the new rows are the whole move').toBe(fresh.reduce((sum, row) => sum + row.amount, 0))
  const hand = (await historyOf(a.page))[0]!
  expect(hand.mode).toBe('blind')
  expect(hand.net, 'the history names the same net').toBe(buyIn[0]!.amount + cashOut[0]!.amount)
```

  (drop the `after - before` not-zero check if it is now implied; keep it if it still holds.)
- **F-03 F-04 F-05**: `aBefore`/`bBefore` are read after the buy-ins, and the carried 2.000 is shared into balances while the 4.000 stacks stay on the table, so:

```ts
  const aReleased = await balanceWhen(a.page, (n) => n === aBefore + 1_000, 90_000)
  const bReleased = await balanceWhen(b.page, (n) => n === bBefore + 1_000, 30_000)
  expect(aReleased, 'Đào gets her half of the 2.000').toBe(aBefore + 1_000)
  expect(bReleased, 'Em gets his half').toBe(bBefore + 1_000)
```

- **F-06**: the final settlement check becomes the cash-out of Đào's stack — 5.000 brought, 1.000 ante, uncalled play returned, the 2.000 pot less 2 %:

```ts
  expect(sumOf(fresh, 'cash_out'), `result card: ${cardText}`).toBe(5_000 - 1_000 + (2_000 - Math.floor(2_000 * 0.02)))
  expect((await balanceOf(a.page)) - aBefore, 'the cash-out and any rewards are the whole move').toBe(sumOf(fresh))
```

  and wait with `balanceWhen(a.page, (n) => n !== aBefore)` as now (the cash-out moves it).
- **F-09**: inside the poll call `keepPlaying(a.page, 0)`:

```ts
  await expect.poll(async () => {
    await keepPlaying(a.page, 0)
    return (await historyOf(a.page)).length
  }, { timeout: 120_000 }).toBeGreaterThanOrEqual(before + 3)
```

- **K-02**: same, around `statsOf(a.page)).handsPlayedBlind` (timeout unchanged).
- **H-02 F-07**: loop unchanged. Replace the F-07 comment's sentence "(A player already seated whose balance falls below the stake sits out instead — …; since T4 the tray says why.)" with "(A seated player whose table stack can no longer cover a hand is stood up instead — F-10.)".
- **New F-10**, after F-09:

```ts
test('F-10: the table limit — five wagers on the table, folded away, then stood up and asked to sit again', async () => {
  test.setTimeout(300_000)
  // Spec 2026-09-29: play-or-fold at 1.000 needs 2.000 a hand and brings 5.000 to the table. Folding costs exactly the
  // ante, so four folds leave 1.000 — short of a hand — and the seat is stood up with that 1.000 going home.
  const before = await balanceOf(a.page)
  const rowsBefore = (await ledgerOf(a.page)).length
  await createBlind(a.page, { name: unique('Bàn F10 '), bots: 1, mode: 'Chơi hoặc bỏ', wager: '1.000' })
  await expect(a.page.locator('header').first().getByText(/Hạn mức 5\.000/)).toBeVisible()
  await takeSeat(a.page, 0)
  expect(await balanceWhen(a.page, (n) => n === before - 5_000), 'the seat took the limit').toBe(before - 5_000)
  await ready(a.page)
  await start(a.page)
  const notice = a.page.getByText(/Bạn đã dùng hết hạn mức ở bàn này/)
  await autopilot(a.page, ['fold'], async () => (await notice.count()) > 0, 240_000)
  await expect(notice).toContainText('1.000 điểm còn lại đã về số dư')
  await expect(a.page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'no longer seated').toHaveCount(0)
  await expect(a.page.getByRole('button', { name: 'Rời phòng' }), 'still in the room').toBeVisible()
  const fresh = await ledgerSince(a.page, rowsBefore)
  expect(fresh.filter((row) => row.reason === 'buy_in').map((row) => row.amount)).toEqual([-5_000])
  expect(fresh.filter((row) => row.reason === 'cash_out').map((row) => row.amount)).toEqual([1_000])
  expect(sumOf(fresh, 'buy_in') + sumOf(fresh, 'cash_out'), 'four antes').toBe(-4_000)
  expect((await balanceOf(a.page)) - before, 'the rows are the whole move').toBe(sumOf(fresh))
  // Sitting again is a fresh buy-in of the limit.
  await takeSeat(a.page, 0)
  const again = await ledgerSince(a.page, rowsBefore)
  expect(again.filter((row) => row.reason === 'buy_in').map((row) => row.amount)).toEqual([-5_000, -5_000])
  await a.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await leave(a.page)
})
```

  (`autopilot`'s `until` signature and `mySeat`/`leave` helpers exist in this file or `ops-helpers.ts`; adapt names, not behaviour.)

- [ ] **Step 5: Operation test plan** — `docs/operation-test-plan.md` §F:
  - F-01 expectation: "Mỗi ván trừ đúng mức cược cố định **từ chồng trên bàn**; …" (rest unchanged).
  - F-07: step (b) → "chồng trên bàn không đủ cho ván sau"; expectation (b) → "bị mời đứng dậy sau ván, phần còn lại về số dư (xem F-10)".
  - New row after F-09: `| F-10 | Phòng mức cược 1.000, Chơi hoặc bỏ, 1 bot; ngồi vào bàn rồi Bỏ mọi ván | Ngồi: số dư −5.000 (hạn mức 5×), đầu phòng ghi "Hạn mức 5.000"; sau 4 ván chồng còn 1.000 < 2.000 → bị mời đứng dậy, thông báo "Bạn đã dùng hết hạn mức…", 1.000 về số dư, vẫn ở trong phòng; bấm ghế lại → hạn mức mới 5.000 | P1 |`
  - The ops-pack pointer paragraph: add F-10 to the list of automated cases if the doc lists them.

- [ ] **Step 6: Run everything that drives a browser**

From the root: `pnpm build:normal`, `pnpm e2e:normal` (9 tests), `pnpm --filter @bp/normal-web e2e:ops` (≈20 min, port 8093, throwaway PGlite — never a real database; expect 31 tests), `pnpm build:lite`, `pnpm --filter @bp/lite e2e` (3 tests). All must pass. A failure in the ops pack must be traced to its cause (test mistake vs product bug) before changing anything; a product bug stops the task (report it).

- [ ] **Step 7: Commit**

```bash
git add apps/normal-web/e2e apps/lite/e2e docs/operation-test-plan.md
git commit -m "test(e2e): Blind money checks read after leaving; ops F-10 table limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Documentation — spec §8/§12, known limitations, changelog

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` (§8.1 table, §8.2, §8.4, §8.5, new §8.8, §12.2 table, §12.3, §21 if it says Blind settles per hand)
- Modify: `docs/known-limitations.md` (Gameplay: first entry; Editions: hard-kill entry; new relief entry)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Main spec** (Vietnamese, same style as the file):
  - §8.1 table: add a row `| Hạn mức (L) | 5 × fixedWager — cố định, không chọn khi tạo phòng (sửa đổi 2026-09-29) |`.
  - §8.2 first bullet → "Ghế đủ điều kiện vào ván khi **chồng trên bàn** ≥ W (kiểu A) hoặc ≥ 2W (kiểu B). Vào bàn cần số dư ≥ mức đó (§8.8)." Second bullet → "Ghế người thật có chồng không đủ bị mời đứng dậy khi ván kết thúc (§8.8); bot được nạp lại."
  - §8.3 step 1: "Mỗi người đủ điều kiện bị trừ W **từ chồng** vào pot."
  - §8.4: add "Chia vào **số dư** (không vào chồng trên bàn)." to the third bullet.
  - §8.5 third bullet → "Bot có chồng ảo = L, tự nạp lại về L khi < mức cần cho một ván; không ghi vào kinh tế người chơi."
  - New §8.8 "Hạn mức bàn (sửa đổi 2026-09-29)" — five bullets summarising `docs/superpowers/specs/2026-09-29-blind-table-limit-design.md` §4 (vào bàn `min(số dư, L)` qua `buy_in`; ván chỉ đổi chồng, sổ chỉ ghi phí; hết hạn mức → đứng dậy + `cash_out` phần lẻ + thông báo `TABLE_LIMIT_SPENT`, ở lại phòng, tự chọn ghế để vào lại; mọi cách rời ghế trả chồng; hard kill Lite mất chồng như Hold'em) and a pointer to that design doc.
  - §12.2 table: add `| \`blindTableLimitMultiplier\` | 5 |` after `blindWagerTiers`.
  - §12.3 second paragraph: "Hold'em **và Blind** không có entry người chơi nào mỗi ván (chip đã nằm trên bàn) nên gọi `apply([], …)` …" (the rest unchanged).
  - §21: grep the section for "Blind" + "balance"/"số dư"; if a row says the Blind seat is the balance, correct it.
- [ ] **Step 2: `docs/known-limitations.md`**
  - Delete the "**Blind Poker shows opponents' balances.**" entry (lines 18-25): since the table limit a Blind seat shows its table stack, like Hold'em.
  - Editions, hard-kill entry: "chips sitting on a Hold'em table and a carried-over Blind pot are gone" → "table stacks (Hold'em and, since the table limit, Blind) and a carried-over Blind pot are gone"; title → "**A hard kill of the Lite server loses live table stacks and the Blind carry-over pot.**" (unchanged wording is fine).
  - New Gameplay entry: "**Relief looks at the balance only.** Points on a table (a Hold'em buy-in, a Blind table limit) are not counted, so a player with most of their points on a table can claim relief (`POST /api/economy/relief`, once per 24 hours). *Why it stays:* counting live table stacks would make the economy service ask the rooms, across editions, for a once-a-day top-up of at most 5.000. *Tracked:* here; spec §12.4."
- [ ] **Step 3: `CHANGELOG.md`** — a new section at the top (after the `---` under the intro), in the file's style:

```markdown
## Plan 15 — Blind Poker table limit — *merge commit to be filled in by the controller*

A Blind seat no longer plays from the whole balance. Sitting down brings `min(balance, 5 × wager)` to the table
(`buy_in`); hands move table stacks only, and the ledger records just the fee; every way off a seat takes the stack home
(`cash_out`). A seat whose stack can no longer cover a hand is stood up when the hand ends, told so
(`TABLE_LIMIT_SPENT`), and stays in the room until the player picks a seat again. The room header shows "Mức cược W ·
Hạn mức L", the create form says what the wager means as a limit, and a spectator who cannot afford a seat is told what
it needs. Bots play from a virtual limit topped back up to 5 × wager. Design:
`docs/superpowers/specs/2026-09-29-blind-table-limit-design.md`.

---
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tooling` (citation/link checks) or root `pnpm test`.

```bash
git add docs/superpowers/specs/2026-09-04-bind-poker-design.md docs/known-limitations.md CHANGELOG.md
git commit -m "docs: Blind table limit in the spec, known limitations and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller)

Full gate on the branch: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm --filter @bp/normal-web e2e:ops`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`. Merge `--no-ff` to master, fill the CHANGELOG merge commit, `pnpm build:normal`, check `/health` shows `rooms:0`, `deploy/normal-windows/stop.ps1`, `run.ps1 -NoMigrate`; `pnpm build:lite`.
