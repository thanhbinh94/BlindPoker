# BP-39 Poker hỗn loạn vòng 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaos tables get card toasts that never cover the winner, a fixed result time with a table-wide "Bỏ qua" vote, held bonus cards the player plays by hand (even mid-choice), a tap-to-read card tooltip, a horizontal draft row in landscape, and no table limit.

**Architecture:** `@bp/core` gains the bonus hand (`ChaosSeat.bonus`), the rules to arm a bonus card for this hand or the next, a mid-hand insertion of reveal effects into `HandState.chaos`, `resultMs` in `ChaosConfig`, the new protocol messages, and `blindBuyInCap`. `@bp/server-kit` routes `CHAOS_USE` and `RESULT_SKIP`, splits chaos state into what the owner sees and what the table sees, times the result from `resultMs`, and seats chaos players with their whole balance. `@bp/ui-kit` replaces `ChaosBanner` with `ChaosToasts`, adds `ChaosCardInfo` (custom tooltip), `BonusHand`, a phone result strip with "Bỏ qua", and the landscape draft row. `apps/normal-server` bounds `resultMs`; `apps/normal-web` shows it in the GM tab and adds S25 checks to the ops pack.

**Tech Stack:** TypeScript, React 18, CSS modules, Vitest, Playwright (Chromium), Fastify, Drizzle/PGlite.

**Spec:** `docs/superpowers/specs/2026-10-27-chaos-feedback-design.md` (amends `docs/superpowers/specs/2026-10-26-chaos-poker-design.md`).

**Branch / worktree:** `feature/BP-39-chaos-round-two` in `.worktrees/BP-39` (own `pnpm install`).

## Global Constraints

- Points only; any money path keeps `Σ balances + Σ sink rows` conserved, pinned by a conservation test (CLAUDE.md §5).
- Every player-facing string in `vi` and `en`; parity tests (`packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts`); `react/jsx-no-literals`; numbers through `formatPoints`.
- New copy (vi / en): "Bỏ qua" / "Skip", "Đã bỏ qua" / "Skipped", "Bỏ qua {{done}}/{{total}}" / "Skip {{done}}/{{total}}", "Dùng" / "Use", "Đã đặt dùng" / "Set to play", "Thẻ thưởng" / "Bonus cards", "Không giới hạn" / "No limit", "+{{count}} thẻ khác" / "+{{count}} more cards", "+{{count}} người" / "+{{count}} more". English is the session's draft (CLAUDE.md: English copy changes only when the user asks — these are new strings).
- Stable terms unchanged (Bỏ bài, Chơi, Người thắng, Tự động chơi, Tạm nghỉ, Hoàn toàn may rủi, Chơi hoặc bỏ, Hạn mức…). "Bỏ qua" is new and must not collide with "Bỏ bài" in any locator.
- `@bp/core` stays pure (`tooling/arch/boundaries.test.ts`). No new runtime dependency.
- New motion has a `prefers-reduced-motion` path and a test.
- Plain Blind tables and Hold'em behave exactly as today: 5 s between hands, 10× table limit, `HandResult` card, no "Bỏ qua".
- Screens: 1920×940, 1366×768, 375×812 as always, plus **360×780** and **780×360** for chaos tables; no scroll, `expectNoTextOverlap`, toasts never intersect the result strip, the board or the tray.
- Bonus cards a player has not used are never sent to another client (events or snapshots).
- Lite gets no chaos (unchanged).

## Review Focus

1. A player who taps "Dùng" on a reveal debuff during the choice, then folds → the card returns to the bonus hand, and no other client ever learned it was armed (no toast, seat count unchanged). Test in Task 3.
2. A reconnect mid-hand with an armed bonus card → the owner's snapshot shows the bonus hand and the armed card; another viewer's snapshot shows only the count. Test in Task 3.
3. "Bỏ qua" with a human who disconnects after the others skipped → counts as skipped, the hand deals at once; a human who joins the seat during the wait raises `total`. Test in Task 4.
4. A chaos seat with a balance of 5 000 000 sits, plays, stands → balance + sinks conserved; Cấp cứu still fires only below 2 wagers. Test in Task 4.
5. Eight seats firing at one reveal at 780×360 → toasts collapse to "+N thẻ khác", nothing overlaps the strip. Test in Task 11.

## Amendments (pre-flight 2026-10-27)

An independent review against the code. These override the task text below where they differ.

- **A1 (Task 2) — an armed card stays in `armed` through its hand.** `planHand` turns an armed `next` card into `hand: 'this'` and keeps it in `armed` (it does not clear it); `afterHand` removes it if its uid is in `consumed`, else returns it to `bonus`. A frozen seat's armed card waits untouched for the next unfrozen hand. Exception: a duration card or a deal-time card armed for `next` joins `cards` at plan time under the stacking rule (it acts at the deal; it is "used" from then on and may show on the seat). `toHeld` is exported from `hold.ts`. Arming a duration card that the stacking rule would drop (a lower tier than the held one of the same effect) is refused: `armBonus` returns `{ error: 'WEAKER_HELD' }`, the room answers `CHAOS_CANNOT_USE`.
- **A2 (Task 2/3) — `addRevealEffect` conflicts.** `armBonus` takes the live plan seat (`planSeat?: ChaosHandPlan['seats'][number]`) to choose: if that seat already fired a deal-time debuff (freeze/blindfold) this hand, or already plans the same effect kind, a mid-hand arm becomes `hand: 'next'` instead of `'this'`. `MID_HAND_EFFECTS` stays the five one-shot reveal effects (Bảo hiểm and Bạo kích pressed mid-hand apply from the next hand, matching spec §3.4's list); a Bạo kích already held must still count an inserted card in `fired`. The frozen check reads `p.chaos.frozenNextHand` as planned for the live hand. The room mutates `this.runner.state` in place (`hand-runner.ts:53` returns the live object).
- **A3 (Task 1 ↔ 5) — `resultMs` plumbing moves into Task 1.** Task 1 also updates `apps/normal-server/src/chaos/chaos-service.ts` (`LIMITS.resultMs = [5_000, 15_000]`, `mergeConfig`, the value `setConfig` builds), `apps/normal-server/src/gm/gm-service.ts` `pickConfig` (~line 983), and the `ChaosConfig` literals in `apps/normal-web/src/screens/gm/ChaosTab.tsx` (~344, ~381), so the build stays green after Task 1. Task 5 keeps the GM field, its copy and the tests.
- **A4 (Task 4) — timers and the vote.** The memory chaos port and `room-harness.ts` use a small `resultMs` (100 ms, matching the harness interval) so existing tests do not stall. The result wait is `nextHandTimer !== null && runner === null && !chaos.draft`. Recompute `total` on sit-down, sit-out/sit-in (a seat with `sitOutRequested` counts as out), disconnect, reconnect, stand-up, leave and kick. The conservation test goes in `room-hands.test.ts`.
- **A5 (Task 1/3/6) — every bonus-data path.** `RoomPlayerView.chaos` (messages.ts:68) gains `bonusCount`; the reducer's `chaosFromSnapshot` copies it. `snapshotFor` adds `bonus` in both branches (it returns early when no draft). The reducer handles `NOTIFICATION CHAOS_BONUS` like `CHAOS_OFFER` (never as a generic notify toast).
- **A6 (Task 1/2/9) — targets and locators.** `ChaosUse` and `CHAOS_SUMMARY` gain `targets: number[]` (`record()` has them) so the tooltip can say "nhắm vào ai"; the client's `chaosUsed` carries them. `HandResult`'s h2 text stays exactly "Người thắng" / "Ván bị hủy" (group name used by ops 04/07/10, ops-helpers:365, normal.spec:149, lite.spec:187); "· Ván tiếp theo sau N giây" is a separate element. The desktop card keeps the "Thẻ đã dùng: X — Y" line format (10-chaos.spec.ts:162).
- **A7 (Task 9) — landscape strip.** The landscape frame has no bottom tray (corner dock, RoomScreen.tsx:466). The strip sits at the stage's bottom edge left of the dock; it must not change the measured stage height (`useStageTier`) and `useSeatClearance` does not apply to it. No text may overlap (`expectNoTextOverlap`); the implementer chooses how (compressed plates, hiding seat captions under the strip while it is open), proven by screenshots at 780×360 and 915×412.
- **A8 (Task 8) — banner removal and timing.** Update the tests that name the banner: `ChaosTable.test.tsx:73, 233–246`, `Seat.test.tsx:699` (`chaosBannerIn` in the reduced-motion list), `RoomScreen.test.tsx:1788`, `i18n.test.ts:100–101`. Reveal events and settlement arrive in one batch (blind.ts:136–139): a toast's 4 s counts from its arrival, all of one batch together (up to the visible cap; the rest under "+N"). On `stack` the toast band is its own layout row under the header; on landscape and desktop it must not overlay seat names (overlap check).
- **A9 (Task 7) — locators and data.** Keep an inner `role="img"` with `data-tier` inside the new trigger (ops matches `[role="img"][data-tier]`, 10-chaos.spec.ts:43). The timing word and tier come from `CHAOS_CARDS_SPEC` (exported by `@bp/core`) and `tierOfCardId`.
- **A10 (Task 10) — the landscape draft is already a row of three** (`.draftCards` grid, table.module.css:3054). The task becomes: show the tier there (hidden at :3182), keep 2–3 description lines, and prove no inner scroll at 780×360 (short tier).
- **A11 (Task 11) — ops.** Tags `@s25p` (360×780) and `@s25l` (780×360), both added to the desktop project's `grepInvert`. F-13f via GM API (`promoteToGm`, add a PUT helper next to `postApi`): tier weights `{silver:0, gold:100, diamond:0}`, every gold card off except `g_borrow`, `g_steal_all`, `g_redeal_board_1`; restore in `finally`; run it last. Bonus-hand case: same pool with `pointsThreshold: 1`. F-13 presses "Bỏ qua" each hand. Run F-13b/c also at the S25 sizes. Update the ops case count in CLAUDE.md §3.
- **A12 (Task 6) — names and doubles.** `GameClient.playBonus(uid)` (not `useBonus`). Update the fake clients in `LobbyScreen.test.tsx` and `RoomScreen.test.tsx`. Clear `resultSkips` on `CHAOS_DRAFT` too. Add `errors.CHAOS_CANNOT_USE` (vi/en) to ui-kit `common.json` with the i18n check.
- **A13 (Task 4/11) — Cứu trợ with the whole balance on the table.** Ruling 1 below: kept, recorded in `docs/known-limitations.md`.
- **A14 (Task 10) — refusals inline.** A `CHAOS_CANNOT_USE` refusal shows inside `BonusHand`, not as the bottom-right error slip that would cover the strip.

**Rulings (pre-flight):**
- Ruling 1: Cứu trợ ignores table stacks today (known-limitations), so a chaos player who seats the whole balance can claim it while holding a large stack. Kept, noted as a residual — the relief amount is small and the loophole already exists for any balance under the 10× limit. Costs if wrong: rich players take one small relief a day; fix later by counting seated stacks in relief.
- Ruling 2: a weaker duplicate duration card is refused rather than silently dropped (A1). Costs if wrong: one more refusal path to explain.
- Ruling 3: Bảo hiểm and Bạo kích pressed mid-hand apply next hand (A2), as the spec's mid-hand list names only debuff, board re-deal and borrow. Costs if wrong: a player expected insurance on the hand in play.

---

### Task 1: Core types, config and protocol

**Files:**
- Modify: `packages/core/src/chaos/types.ts`, `packages/core/src/protocol/messages.ts`, `packages/core/src/protocol/validate.ts`, `packages/core/src/hand/blind.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/protocol/validate.test.ts`, `packages/core/src/hand/blind.test.ts` (or the existing file that tests `blindTableLimit`)

**Interfaces:**
- Produces:
  - `ChaosConfig.resultMs: number`; `DEFAULT_CHAOS_CONFIG.resultMs = 10_000`.
  - `ChaosSeat.bonus: HeldCard[]` (the bonus hand, max `BONUS_HAND_MAX = 3`, exported) and `ChaosSeat.armed: ArmedBonus | null`; `EMPTY_CHAOS_SEAT` gets `bonus: []`, `armed: null`.
  - `interface ArmedBonus { card: HeldCard; hand: 'this' | 'next' }` — `this`: inserted into the running hand's reveal; `next`: fires first in the next hand's plan.
  - `ClientMessage` adds `{ t: 'CHAOS_USE'; reqId?: string; uid: number }` and `{ t: 'RESULT_SKIP'; reqId?: string }`; `validateClientMessage` parses both (`uid` a positive integer).
  - `RoomEvent` adds `{ type: 'RESULT_SKIPS'; skipped: number; total: number }`.
  - `CHAOS_STATE` seats become `{ seat; cards: HeldCardView[]; points: number; bonusCount: number }` (`cards` never holds bonus cards).
  - `interface ChaosBonusPayload { cards: HeldCardView[]; armed: { uid: number; cardId: string; hand: 'this' | 'next' } | null }` — the owner's `NOTIFICATION { kind: 'CHAOS_BONUS' }` payload; `ChaosSnapshot.bonus?: ChaosBonusPayload` (owner only).
  - `ErrorCode` adds `'CHAOS_CANNOT_USE'`.
  - `blindBuyInCap(rules: Pick<BlindRules, 'fixedWager' | 'chaosCycle'>): number | null` — `null` at a chaos table, else `blindTableLimit(rules)`.

- [ ] **Step 1: Failing tests** — `validate.test.ts`: `CHAOS_USE` with `uid: 3` parses; `uid: 0`, `uid: 1.5`, missing `uid` fail with `INVALID_MESSAGE`; `RESULT_SKIP` parses with and without `reqId`. Blind test: `blindBuyInCap({ fixedWager: 1000 })` is `10_000`; `blindBuyInCap({ fixedWager: 1000, chaosCycle: 5 })` is `null`.
- [ ] **Step 2: Run** `pnpm --filter @bp/core exec vitest run src/protocol src/hand` — expect the new cases to fail.
- [ ] **Step 3: Implement** the types and parsing above. Fix every compile error the new required fields cause (fixtures, `EMPTY_CHAOS_SEAT`, tests that build `ChaosSeat` literals) without changing behaviour.
- [ ] **Step 4: Run** `pnpm --filter @bp/core test` and `pnpm typecheck` — expect PASS (other packages may need the same literal fixes; make them).
- [ ] **Step 5: Commit** `feat(core): chaos round two types — the bonus hand, resultMs, CHAOS_USE and RESULT_SKIP, no buy-in cap at chaos tables`.

### Task 2: Core bonus-hand rules and mid-hand reveal insertion

**Files:**
- Create: `packages/core/src/chaos/bonus.ts`, `packages/core/src/chaos/bonus.test.ts`
- Modify: `packages/core/src/chaos/settle.ts` (`afterHand`), `packages/core/src/chaos/plan.ts` (`planHand`), `packages/core/src/chaos/engine.ts`, `packages/core/src/chaos/index.ts`
- Test: `settle.test.ts`, `plan.test.ts`, `engine.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `MID_HAND_EFFECTS: ReadonlySet<ChaosEffectKind>` = `stealHole, lowerHole, swapHands, redealBoard, borrowHole` (one-shot reveal cards; spec §3.4).
  - `needsNoPress(def: ChaosCardDef): boolean` — `timing === 'wait' || timing === 'now'` (Cấp cứu, Thần tài, Khiên, Gương, Tích lũy, Cấp độ).
  - `armBonus(seat: ChaosSeat, uid: number, when: { phase: 'between' } | { phase: 'decision'; frozen: boolean }): { seat: ChaosSeat; armed: ArmedBonus } | { error: 'NO_CARD' | 'ALREADY_ARMED' | 'FROZEN' }` — moves the card out of `bonus` into `armed`; `hand: 'this'` only when `phase === 'decision'` and the card's effect is in `MID_HAND_EFFECTS`, otherwise `'next'`. One armed card at a time (that is the "1 per hand" limit, counted on the hand it applies to). A `decision`-phase arm with `frozen: true` → `FROZEN`.
  - `addRevealEffect(state: HandState, seat: number, effect: PlannedEffect): void` (engine.ts) — appends to `state.chaos.plan.seats[seat].effects` before the reveal; if that seat already plans a debuff and this one is a debuff, the planned one is removed from this hand's plan (it stays held: its uid is never applied) and the armed one takes its place (spec: the pressed debuff fires first).
  - `planHand` input seats' `armed` with `hand: 'next'` fire first, under the same rules as held cards (duration cards then join `cards` via the existing stacking rule of `receiveCard`); the returned seat has `armed: null` for them.
  - `afterHand`: (a) bonus conversion: while `points >= threshold` **and** `bonus.length < BONUS_HAND_MAX` (bots: no hand limit — they keep today's path), subtract and draw; a drawn card with `needsNoPress` goes through `receiveCard` (today's path), any other goes to `bonus` for humans; bots always use `receiveCard`; Thần tài prizes and `pendingBonus` keep today's path. (b) an armed `this` card whose uid is not in `consumed` goes back to `bonus` (at its old place if possible, else the end); one that fired is gone. `AfterHandResult.awarded` keeps listing only cards that went through `receiveCard`; add `AfterHandResult.bonusAwarded: { seat: number; cards: ChaosCardDef[] }[]`. `AfterHandSeat` gains nothing; the seat's `isBot` decides the path.

- [ ] **Step 1: Failing tests** (`bonus.test.ts`): `armBonus` between hands → `hand: 'next'`, card left `bonus`; in decision with `s_steal_one` → `hand: 'this'`; in decision with `s_luck_1` (deal) → `'next'`; second arm → `ALREADY_ARMED`; unknown uid → `NO_CARD`; frozen in decision → `FROZEN`. `settle.test.ts`: a human crossing 10 points with 3 bonus cards keeps the points; with 2 gets a 3rd; a drawn `s_rescue` goes to `cards`, not `bonus`; a bot's bonus goes to `cards`; an armed `this` steal not consumed returns to `bonus`, a consumed one is gone. `plan.test.ts`: an armed `next` debuff fires and a held draft debuff waits. `engine.test.ts`: `addRevealEffect` during DECISION then the reveal applies the steal (`CHAOS_APPLIED` with the armed uid); with a planned draft debuff on the same seat, only the armed one fires and the draft uid is not in `applied`.
- [ ] **Step 2: Run** `pnpm --filter @bp/core exec vitest run src/chaos` — expect failures.
- [ ] **Step 3: Implement** in the files above.
- [ ] **Step 4: Run** `pnpm --filter @bp/core test` — PASS, and the existing chaos/Blind regression tests unchanged.
- [ ] **Step 5: Commit** `feat(core): bonus cards wait in the player's hand and fire when played, this hand's reveal or the next hand`.

### Task 3: Server-kit — playing a bonus card, and keeping it private

**Files:**
- Modify: `packages/server-kit/src/room/room-chaos.ts`, `packages/server-kit/src/room/room.ts`, `packages/server-kit/src/gateway/gateway.ts`, `packages/server-kit/src/testing/memory-chaos.ts` (if fixtures need it)
- Test: `packages/server-kit/src/room/room-chaos.test.ts` (or the existing chaos room test file)

**Interfaces:**
- Consumes: `armBonus`, `addRevealEffect`, `MID_HAND_EFFECTS`, `AfterHandResult.bonusAwarded` (Task 2); Task 1 messages.
- Produces:
  - `Room.useChaosBonus(playerId: string, uid: number): Promise<void>` on the queue; gateway routes `CHAOS_USE` to it. Allowed when the player is seated at a chaos table and either no hand is live (between hands, during the result wait or a draft) or the live hand is in `DECISION` and the player is in it. Otherwise `RoomError('CHAOS_CANNOT_USE')`. On a `'this'` arm the room calls `addRevealEffect` on the live `HandState` with a `PlannedEffect` built from the card.
  - `ChaosTable.bonusFor(p): ChaosBonusPayload`, sent to the owner as `NOTIFICATION CHAOS_BONUS` after any change to their bonus hand (award, arm, return, fire) and included in `snapshotFor(viewerId)` as `bonus` for a seated viewer.
  - `broadcastState` sends `bonusCount = bonus.length + (armed ? 1 : 0)` — the armed card still counts until it fires, so the table cannot read an arm. After the hand, the count drops for a card that fired.
  - `CHAOS_AWARDED` is broadcast only for `awarded` (cards that went through `receiveCard`); `bonusAwarded` produces only the owner's `CHAOS_BONUS`.
  - Bots: unchanged (their bonus is auto).
- [ ] **Step 1: Failing tests:** a human awarded a bonus card gets `CHAOS_BONUS` with it and the table's `CHAOS_STATE` shows `bonusCount: 1` and no card id anywhere in other viewers' events; `CHAOS_USE` between hands arms `next` and the next hand's `CHAOS_APPLIED` carries it; `CHAOS_USE` in DECISION with a steal fires at this hand's reveal; same then fold → card back in `CHAOS_BONUS.cards`, other viewers saw no `CHAOS_APPLIED` and `bonusCount` stayed 1; `CHAOS_USE` during SQUEEZE/REVEAL → `CHAOS_CANNOT_USE`; at a "Hoàn toàn may rủi" table mid-hand → `CHAOS_CANNOT_USE`; snapshot for the owner has `bonus`, for a spectator has none (Review Focus 1, 2).
- [ ] **Step 2: Run** `pnpm --filter @bp/server-kit exec vitest run src/room` — expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @bp/server-kit test` — PASS.
- [ ] **Step 5: Commit** `feat(server-kit): a player plays a held bonus card between hands or mid-choice, and nobody else sees it until it fires`.

### Task 4: Server-kit — result time, "Bỏ qua" vote, no table limit

**Files:**
- Modify: `packages/server-kit/src/room/room.ts`, `packages/server-kit/src/room/room-chaos.ts`, `packages/server-kit/src/gateway/gateway.ts`
- Test: room chaos test file; the room's conservation test file

**Interfaces:**
- Consumes: `ChaosConfig.resultMs`, `blindBuyInCap`, `RESULT_SKIPS` (Task 1).
- Produces:
  - `ChaosTable.resultMs(): Promise<number>` reads `port.config()` (fallback `DEFAULT_CHAOS_CONFIG.resultMs` when the port fails), used by `onHandComplete` for the next deal at a chaos table in place of `handIntervalMs`. A GM change takes effect from the next hand.
  - `Room.skipResult(playerId: string): Promise<void>`; gateway routes `RESULT_SKIP`. Only during the post-settlement wait of a chaos table (not a draft); otherwise silently ignored (ACK, no error). Voters (`total`): seated humans who are connected and not sitting out. Auto-play lives in the client, so an auto-playing client sends `RESULT_SKIP` itself (Task 6); bots never count. Skipped set resets each wait. Broadcast `RESULT_SKIPS { skipped, total }` on each change (and once with `0/total` when the wait starts). When `skipped >= total` the timer is cancelled and the hand starts now (`nextHandAt` updated through `ROOM_STATUS`). A disconnect or stand-up during the wait recomputes and may trigger the start.
  - Sit-down at a chaos table: `amount = blindBuyInCap(rules) ?? balance` (whole balance). Bots keep `blindTableLimit` top-up.
- [ ] **Step 1: Failing tests:** next deal at a chaos table is `resultMs` (10 s default, 7 s when the port says 7 000) after settlement; plain Blind stays 5 s; two humans + bot: both skip → hand starts at once, one skip → `RESULT_SKIPS {1,2}` and timer kept; a human disconnects after the other skipped → starts; `RESULT_SKIP` during a draft or a hand → ignored; chaos sit-down with balance 5 000 000 brings 5 000 000; conservation test sits, plays two hands, stands, and checks `Σ balances + Σ sinks` (Review Focus 3, 4).
- [ ] **Step 2: Run** the room tests — failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @bp/server-kit test` — PASS.
- [ ] **Step 5: Commit** `feat(server-kit): chaos tables wait resultMs after a hand, deal at once when every player skips, and seat the whole balance`.

### Task 5: Normal server and GM tab — `resultMs`

**Files:**
- Modify: `apps/normal-server/src/chaos/chaos-service.ts`, `apps/normal-web/src/screens/gm/ChaosTab.tsx`, `apps/normal-web/src/locales/{vi,en}/*.json` (the GM namespace the tab uses)
- Test: `apps/normal-server/src/chaos/chaos-service.test.ts`, the ChaosTab test file

**Interfaces:**
- Consumes: `ChaosConfig.resultMs`.
- Produces: `LIMITS.resultMs = [5_000, 15_000]`; stored config without it reads the default; `setConfig` rejects 4 999 and 15 001. GM tab shows "Thời gian xem kết quả (giây)" / "Result time (seconds)" as seconds, saves ms, with the existing reason + log flow.
- [ ] **Step 1: Failing tests** for the bounds, the default and the tab field round-trip.
- [ ] **Step 2–4: Implement and run** `pnpm --filter @bp/normal-server exec vitest run src/chaos` and the tab test — PASS.
- [ ] **Step 5: Commit** `feat(normal-server, normal-web): the GM sets a chaos table's result time, 5–15 s`.

### Task 6: UI-kit client state

**Files:**
- Modify: `packages/ui-kit/src/client/types.ts`, `packages/ui-kit/src/client/reducer.ts`, `packages/ui-kit/src/client/useGameClient.tsx`, `packages/ui-kit/playground/mock-client.ts`, `packages/ui-kit/playground/scenarios.tsx`
- Test: `packages/ui-kit/src/client/reducer.test.ts` (or the chaos reducer test file)

**Interfaces:**
- Consumes: Task 1 protocol.
- Produces:
  - `ClientChaos.bonus: { cards: HeldCardView[]; armed: { uid: number; cardId: string; hand: 'this' | 'next' } | null }` (from `CHAOS_BONUS` and snapshot `bonus`; reset on leave).
  - `ClientChaos.seats[n].bonusCount: number`.
  - `ClientState.resultSkips: { skipped: number; total: number; mine: boolean } | null` — set by `RESULT_SKIPS`, `mine` set by the ack of my skip; cleared when a hand starts or the room leaves.
  - `GameClient.useBonus(uid: number): Promise<AckOrError>` and `GameClient.skipResult(): Promise<AckOrError>`.
  - Auto-play: while `autoPlay` is on and a result wait is running, the client sends `RESULT_SKIP` once (same pattern as the auto draft pick in `useGameClient.tsx`).
  - Mock client and scenarios: support both calls and a scenario with a held bonus hand and a chaos result with 8 seats each firing a card (used by Tasks 8–11).
- [ ] **Step 1: Failing reducer tests** for each event, the snapshot, the reset on `HAND_STARTED`, and the auto-play skip.
- [ ] **Step 2–4: Implement and run** `pnpm --filter @bp/ui-kit exec vitest run src/client` — PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): the client keeps the bonus hand, the skip count, and can play a bonus card or skip the result`.

### Task 7: `ChaosCardInfo` — the custom card tooltip

**Files:**
- Create: `packages/ui-kit/src/table/ChaosCardInfo.tsx`, `packages/ui-kit/src/table/ChaosCardInfo.test.tsx`
- Modify: `packages/ui-kit/src/table/ChaosCardIcon.tsx`, `packages/ui-kit/src/table/table.module.css`, `packages/ui-kit/src/i18n/locales/{vi,en}/*.json` (the chaos namespace)

**Interfaces:**
- Produces: `ChaosCardInfo({ cardId, handsLeft?, use?: { by: string; targets: string[]; outcome: ChaosOutcome }, children })` — wraps its child trigger in a `button` (or adds button semantics to the given element), opens on tap/click, hover and focus, closes on second tap, outside tap, `Esc`, unmount; content: name, tier (by colour and word), full `chaos.cards.<id>.desc`, timing word, hands left, and for a use: by whom, on whom, outcome. Positioned above or below its trigger, clamped inside the viewport (no horizontal overflow at 360 px, fits 780×360). `aria-describedby` links the popup. Reduced motion: no fade.
- `ChaosCardIcon` (single, stack, "+N") uses it and drops every `title=`.
- If `chaos.cards.s_steal_one.desc` does not say the card is random, make it say so ("một lá ngẫu nhiên" / "a random card") — spec §3.8.
- [ ] **Step 1: Failing tests:** tap opens with name/tier/desc; second tap closes; outside pointerdown closes; `Esc` closes; hover opens; no element under `ChaosCardIcon` has a `title` attribute; reduced motion path.
- [ ] **Step 2–4: Implement and run** `pnpm --filter @bp/ui-kit exec vitest run src/table/ChaosCard` — PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): tapping a chaos card on a phone shows what it does, in our own tooltip`.

### Task 8: `ChaosToasts` replace the banner

**Files:**
- Create: `packages/ui-kit/src/table/ChaosToasts.tsx`, `packages/ui-kit/src/table/ChaosToasts.test.tsx`
- Delete: `packages/ui-kit/src/table/ChaosBanner.tsx` and its test (move what still applies)
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx`, `packages/ui-kit/src/table/PokerTable.tsx` (drop the `banner` prop or repurpose it), `table.module.css`, chaos locale files

**Interfaces:**
- Consumes: `state.chaos.applied` (`AppliedChaosView`), `ChaosCardInfo` (Task 7).
- Produces: `ChaosToasts({ applied, handId, restored, nameOf, layout: 'stack' | 'landscape' | 'desktop', reverseNote: string | null, resultOpen: boolean })`:
  - one toast per applied card in order: "{{name}} dùng {{card}}" or "… → {{targets}}" plus the outcome word when not applied; up to 2 lines, no ellipsis; tapping the card name opens `ChaosCardInfo`; tapping the toast body pins it (until tapped again or the next hand).
  - each toast lives `TOAST_MS = 4000` from its appearance; at most `3` visible (stack, desktop) or `2` side by side in one row (landscape); the overflow collapses into one "+N thẻ khác" toast that opens the full list of the hand's cards; while `resultOpen`, new toasts go straight into "+N".
  - "Thế giới đảo ngược" note is a pinned toast for the hand.
  - a restored hand replays nothing (same rule as `useChaosBanner`'s `skipExisting`).
  - `RoomScreen`: the result no longer waits for the toasts (drop `banner.item` from `held`); the toast zone is a layout region — under the header on `stack`, the top band on `landscape`, the felt's top-right on desktop — not an overlay over the result.
- [ ] **Step 1: Failing tests:** 5 applied → 3 toasts + "+2 thẻ khác" (stack), 2 + "+3" (landscape); fake timers: a toast leaves after 4 000 ms unless pinned; result open → new ones go to "+N"; restored hand renders none; reduced motion: no enter class; the result card renders while toasts are still up.
- [ ] **Step 2–4: Implement and run** `pnpm --filter @bp/ui-kit exec vitest run src/table src/screens` — PASS (update tests that relied on the banner hold).
- [ ] **Step 5: Commit** `feat(ui-kit): card effects arrive as toasts in their own band, at most three, the rest under "+N thẻ khác", and the result never waits for them`.

### Task 9: The chaos result — phone strip, "Bỏ qua", and "Không giới hạn"

**Files:**
- Modify: `packages/ui-kit/src/table/HandResult.tsx` (+ test), `packages/ui-kit/src/screens/RoomScreen.tsx`, `table.module.css`, `packages/ui-kit/src/table/RoomHeader.tsx` (+ test), `packages/ui-kit/src/lobby/CreateRoomFields.tsx` (+ test), locale files

**Interfaces:**
- Consumes: `ClientState.resultSkips`, `GameClient.skipResult` (Task 6), `ChaosCardInfo` (Task 7), `blindBuyInCap` (Task 1).
- Produces:
  - `HandResult` gets `variant?: 'card' | 'strip'` and `skip?: { skipped: number; total: number; mine: boolean; onSkip: () => void } | null`. At a chaos table on `stack` and `landscape` frames it renders as `strip`: a band directly above the tray (a layout region, not an overlay), first line "Người thắng · Ván tiếp theo sau N giây" + the "Bỏ qua" button ("Đã bỏ qua" disabled once mine) + "Bỏ qua {{done}}/{{total}}"; rows winner first then the viewer, the rest as "+N người" (expandable) when they do not fit; "Thẻ đã dùng" names each wrapped in `ChaosCardInfo` with `use`. Landscape lays the parts in columns (L-B). Desktop keeps the card, adds the same button and count. Plain tables: unchanged, no skip.
  - The result group keeps its accessible name "Người thắng" (e2e locators).
  - `RoomHeader` and `CreateRoomFields`: when `blindBuyInCap` is `null`, the limit reads "Không giới hạn".
- [ ] **Step 1: Failing tests:** strip renders at a chaos table on stack/landscape with the button and count; pressing calls `onSkip` once, then shows "Đã bỏ qua"; 8 rows collapse to winner + viewer + "+6 người"; plain table renders the card without skip; header and create-room show "Không giới hạn" for a chaos config and the 10× figure otherwise.
- [ ] **Step 2–4: Implement and run** ui-kit table/screen/lobby tests — PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): on a phone the chaos result is a strip above the buttons with Bỏ qua, and chaos tables say Không giới hạn`.

### Task 10: `BonusHand` and the landscape draft row

**Files:**
- Create: `packages/ui-kit/src/table/BonusHand.tsx`, `packages/ui-kit/src/table/BonusHand.test.tsx`
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx`, `packages/ui-kit/src/table/Seat.tsx` (bonus count badge), `packages/ui-kit/src/table/ChaosDraft.tsx` (+ test), `table.module.css`, locale files

**Interfaces:**
- Consumes: `ClientChaos.bonus`, `seats[n].bonusCount`, `GameClient.useBonus` (Task 6), `ChaosCardInfo` (Task 7).
- Produces:
  - `BonusHand({ bonus, canUse, onUse, layout })`: up to 3 small cards near the tray; tap a card → its `ChaosCardInfo` with a "Dùng" button (the separate confirm step); the armed card shows "Đã đặt dùng"; disabled (still readable) when `canUse` is false. `canUse` = seated at a chaos table and (no live hand, or hand in DECISION with me in it) and nothing armed. Hidden when the hand is empty and nothing is armed. Never covers my hole cards or the action buttons; fits 360×780 and 780×360 without scroll.
  - Seat badge: other seats show "Thẻ thưởng ×N" as an icon with a count (no card identity), via `ChaosCardInfo`-free plain label.
  - `ChaosDraft` in the landscape frame: one row of three cards with name, tier and a 2–3-line description, timer in a corner, no scroll at 780×360 (spec §3.6). Portrait and desktop unchanged; tapping a draft card still picks it.
- [ ] **Step 1: Failing tests:** cards render; tap → info → "Dùng" calls `onUse(uid)`; armed shows "Đã đặt dùng" and others disabled; `canUse` false disables "Dùng"; seat badge shows count only; landscape draft renders a single row (class/data attribute) with full descriptions.
- [ ] **Step 2–4: Implement and run** ui-kit tests — PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): the bonus hand by the tray — tap to read, Dùng to play — and the landscape draft as one row of three`.

### Task 11: Ops checks at S25 sizes, docs

**Files:**
- Modify: `apps/normal-web/e2e/ops/10-chaos.spec.ts`, `apps/normal-web/e2e/ops/ops.config.ts`, `apps/normal-web/e2e/ops/ops-helpers.ts` (if needed), `docs/player-guide.md` (§6a), `docs/known-limitations.md`, `docs/test-matrix.md` and `tooling/arch/acceptance-links.test.ts` if a matrix row is added, `docs/normal-web.md` / `docs/ui-kit.md` / `docs/server-kit.md` where they describe the chaos banner, protocol or table limit
- Test: the ops cases themselves

**Interfaces:**
- Consumes: everything above.
- Produces:
  - Two ops projects (or tags) for the S25: `s25` 360×780 portrait touch (`@s25`) and `s25land` 780×360 landscape touch (`@s25land`), applied to the chaos cases only.
  - F-13d `@s25` and F-13e `@s25land`: a chaos table plays to a result; assert no page scroll, `expectNoTextOverlap`, the strip's box does not intersect any toast, the board or the tray, "Bỏ qua" works (single human + bots → the hand deals at once).
  - F-13f: eight seats (one human, seven bots, "Hoàn toàn may rủi" so nobody folds) all firing a card at one reveal, at 360×780 and 780×360: toasts collapse into "+N thẻ khác", no toast box intersects the strip. Force the firing through the GM chaos config (tier weights silver-only, only reveal one-shot silver cards enabled — see `06-gm.spec.ts` for GM access); if the GM route cannot force it, use the playground burst scenario from Task 6 served by Vite and record that choice as a ruling.
  - Bonus-hand case: earn a bonus card (or seed one via the GM path if available), tap it, "Dùng", see it fire.
  - Docs: player guide §6a explains toasts, "Bỏ qua", the bonus hand and "Không giới hạn"; known-limitations notes real-phone checks still manual for S25; developer docs updated where they describe the banner/protocol.
- [ ] **Step 1: Write the cases.**
- [ ] **Step 2: Run** `pnpm build:normal` then `pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "F-13"` — PASS.
- [ ] **Step 3: Run** `pnpm exec vitest run --root . tooling/arch` — PASS.
- [ ] **Step 4: Commit** `test(e2e), docs: chaos round two checked at the Galaxy S25's 360×780 and 780×360, and the player guide explains toasts, Bỏ qua and the bonus hand`.
