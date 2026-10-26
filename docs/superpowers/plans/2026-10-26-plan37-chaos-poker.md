# Plan 37 — Poker hỗn loạn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Blind Poker table can be created as "Poker hỗn loạn": players draft Silver/Gold/Diamond effect cards before the first hand and every 5 or 10 table hands, earn bonus cards from chaos points, and the cards apply automatically at deal, decision and reveal — with real points fenced by the spec's economy rules.

**Architecture:** The card logic is pure and lives in `@bp/core` (`packages/core/src/chaos/`): catalogue parsing, draws, a per-hand plan, the hand effects inside the Blind engine, and the after-hand settlement (points, durations, credits). `@bp/server-kit` runs the draft between hands, holds each seat's cards, feeds the plan to the engine, and pays credits through a new optional `ChaosPort` (absent in Lite, so Lite refuses chaos rooms). `apps/normal-server` implements the port (catalogue file + DB rules + daily cap + ledger), gates stats/reputation for chaos hands, and gets a GM tab. `@bp/ui-kit` adds the create-room option (opt-in prop), lobby badge, draft overlay, seat card icons, the reveal banner and the result line.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, React 18 + CSS modules, Fastify + Drizzle/Postgres (PGlite in tests), Playwright (Chromium) for e2e/ops.

**Spec:** `docs/superpowers/specs/2026-10-26-chaos-poker-design.md` (Vietnamese; Q1–Q13 are the user's decisions, "(phiên chọn)" items are the session's). Every task's implementer reads the spec sections named in the task.

## Global Constraints

- Points only, permanently; any new money path keeps `Σ balances + Σ stacks + Σ sink rows − Σ source rows` conserved and is pinned by a conservation test (CLAUDE.md §5).
- `@bp/core` stays pure: no `@bp/*`/`node:` imports, no timers/crypto/Buffer, randomness only through `Rng`, no word "edition" anywhere in `packages/core/src` (tooling/arch/boundaries.test.ts).
- A Blind table without chaos behaves exactly as today: every existing engine/room test passes unchanged except where a test pins an exact object shape that gains an optional field.
- Every player-facing string exists in `vi` and `en`; `react/jsx-no-literals`; numbers via `formatPoints`. Stable terms unchanged ("Chơi", "Bỏ bài", "Tất tay", "Tự động chơi", "Nặn bài", "Hạn mức"…). New stable terms: **"Poker hỗn loạn"** (create-room option), **"Hỗn loạn"** (badge), **"Chu kỳ thẻ"**, **"Thẻ đã dùng"**, tab **"Thẻ hỗn loạn"**.
- New motion has a `prefers-reduced-motion` path and a test.
- No new runtime dependency.
- Spec numbers, verbatim: tier weights Bạc 60 / Vàng 30 / Kim cương 10; draft 15 s; chaos points +1 win, +2 loss, ×2 from the 3rd hand of a streak; bonus card at 10 points; cycle 5 or 10 (default 5); daily cap 100 000 points of new chaos points per account per economy day, Cấp cứu at most 3 times per day; Cấp cứu fires only after a lost hand at this table that leaves the stack under 2 wagers; card odds and Thần tài table per spec §5.1–§5.5.
- Ledger reasons: `chaos_rescue`, `chaos_crit`, `chaos_fortune` (sources) and `chaos_to_table` (the paired transfer from balance to stack).
- Screens checked at 1920×940, 1366×768, 375×812 (portrait and 915×412 landscape); no text overlap.

## Review Focus

1. **A player leaves, stands or disconnects during a draft** — the draft still ends (picks for the rest, random at the deadline), the room never sticks in drafting, the leaver's offer is void. → Task 3 test "a seat that leaves mid-draft does not hold the table".
2. **A reconnect during a draft** — the snapshot carries the viewer's offer, the tier, the deadline and whether they already picked. → Task 3 test "the snapshot restores the viewer's draft".
3. **The daily cap is hit mid-session** — the credit is cut to what is left (possibly 0), the player sees "Đã chạm trần thẻ hôm nay", the books still balance. → Task 4 test "credits stop at the daily cap and the rescue count".
4. **The deck runs short** — 8 seats × 3 hole cards with "Chọn bài"/"Thêm lá"/re-deals must never throw `deck exhausted`; an effect that cannot draw fizzles visibly. → Task 2 test "a full table of extra draws fizzles instead of exhausting the deck".
5. **A hand ends without a showdown** (everyone folds → carry-over, or one player left) — reveal-time effects do not fire, the debuff cards stay held, no chaos points are counted for a carry-over hand. → Task 2 and Task 1 tests "reveal effects wait for a showdown" and "a carry-over hand counts for nobody".

---

## Shared interfaces (produced by Task 1, used everywhere)

`packages/core/src/chaos/types.ts` (exported from `packages/core/src/index.ts`):

```ts
export type ChaosTier = 'silver' | 'gold' | 'diamond'
export type ChaosTiming = 'deal' | 'decision' | 'reveal' | 'wait' | 'now'
export type ChaosMode = 'playOrFold' | 'none'
export type ChaosEffectKind =
  | 'swapLowest' | 'bestOfN' | 'highCard' | 'suited' | 'redealWeak' | 'swapAll' | 'extraHole'
  | 'peekBoard' | 'freeFold' | 'refundStake' | 'shield' | 'mirror' | 'rescue' | 'chaosPoints' | 'farm'
  | 'stealHole' | 'lowerHole' | 'blindfold' | 'freeze' | 'crit' | 'fortune' | 'levelUp'
  | 'borrowHole' | 'redealBoard' | 'swapHands' | 'reverseRank' | 'gambler'
export interface ChaosCardDef {
  id: string; tier: ChaosTier; family: string; effect: ChaosEffectKind
  params: Readonly<Record<string, number>>; timing: ChaosTiming; modes: readonly ChaosMode[]
  debuff: boolean; enabled: boolean
}
export interface HeldCard {
  uid: number; cardId: string; tier: ChaosTier; effect: ChaosEffectKind
  params: Readonly<Record<string, number>>; timing: ChaosTiming; debuff: boolean
  handsLeft: number | null // null = waits for its condition (wait cards) or fires once (one-shot)
}
export interface ChaosSeat {
  cards: HeldCard[]; points: number
  streak: { kind: 'win' | 'loss'; len: number } | null
  frozenNextHand: boolean; blindfoldedNextHand: boolean
  farmHandsLeft: number // "Cày điểm": points ×2 while > 0
}
export interface ChaosConfig {
  tierWeights: Readonly<Record<ChaosTier, number>>; pointsThreshold: number; draftMs: number
  dailyCapPoints: number; dailyRescues: number
}
export const DEFAULT_CHAOS_CONFIG: ChaosConfig // { tierWeights: {silver: 60, gold: 30, diamond: 10}, pointsThreshold: 10, draftMs: 15_000, dailyCapPoints: 100_000, dailyRescues: 3 }
export const EMPTY_CHAOS_SEAT: ChaosSeat
export interface PlannedEffect { uid: number; cardId: string; effect: ChaosEffectKind; params: Readonly<Record<string, number>>; timing: ChaosTiming; debuff: boolean; targets: number[] }
export interface ChaosHandPlan { seats: { seat: number; effects: PlannedEffect[]; shield: { uid: number; cardId: string; kind: 'shield' | 'mirror' } | null; blindfolded: boolean }[]; reverse: boolean }
export type ChaosCreditReason = 'chaos_rescue' | 'chaos_crit' | 'chaos_fortune'
export interface ChaosCredit { seat: number; amount: number; reason: ChaosCreditReason; cardId: string }
export interface HeldCardView { uid: number; cardId: string; tier: ChaosTier; handsLeft: number | null }
```

Functions (Task 1, `packages/core/src/chaos/*.ts`):

- `parseChaosCatalogue(raw: unknown): ChaosCardDef[]` — throws `Error('invalid chaos catalogue: <why>')`; refuses unknown effect kinds, duplicate ids, tiers/timings/modes outside the unions, non-integer params, and a catalogue with fewer than 3 enabled cards of any tier for either mode.
- `drawTier(weights: ChaosConfig['tierWeights'], rng: Rng): ChaosTier`
- `drawOffer(pool: readonly ChaosCardDef[], tier: ChaosTier, mode: ChaosMode, rng: Rng, count?: number /* 3 */, weights?: ReadonlyMap<string, number>): ChaosCardDef[]` — distinct cards of that tier valid for the mode, weighted by `weights.get(id) ?? 1` (weight 0 = never).
- `receiveCard(seat: ChaosSeat, def: ChaosCardDef, nextUid: () => number, pool: readonly ChaosCardDef[], mode: ChaosMode, rng: Rng): { seat: ChaosSeat; received: ChaosCardDef[] }` — applies "now" cards (`levelUp` → draws its cards per spec §5.6, never another `levelUp`; `chaosPoints` → adds points), then adds held cards with the non-stacking rule of spec §3.4 (same `effect` with a duration: higher tier replaces, same tier adds duration, lower tier dropped). Returns every card actually received (for display).
- `planHand(input: { seats: readonly { seat: number; isBot: boolean; chaos: ChaosSeat }[]; rules: BlindRules; pool: readonly ChaosCardDef[]; rng: Rng; nextUid: () => number }): { plan: ChaosHandPlan; seats: Map<number, ChaosSeat> }` — picks the effects firing this hand (spec §3.4–§3.5): frozen seats fire nothing; one-shot buffs of different kinds may all fire; at most one debuff card fires per seat (the oldest); duration cards fire every hand while `handsLeft > 0`; `gambler` rolls one random Silver/Gold effect per hand (spec §5.3, excluding rescue/fortune/levelUp/gambler); targets are chosen here, randomly among the other seats in the hand (debuff "each opponent" = all others); wait cards (rescue, fortune, shield, mirror) are not "fired" by the plan except shield/mirror which are exposed as `shield` so the engine can block. Cards with `modes` excluding the table's mode never fire.
- `afterHand(input: { rules: BlindRules; config: ChaosConfig; pool: readonly ChaosCardDef[]; rng: Rng; nextUid: () => number; plan: ChaosHandPlan; consumed: ReadonlySet<number>; carryOverOnly: boolean; seats: readonly { seat: number; isBot: boolean; chaos: ChaosSeat; stackAfter: number; net: number; inHand: boolean }[] }): { seats: Map<number, ChaosSeat>; credits: ChaosCredit[]; awarded: { seat: number; cards: ChaosCardDef[] }[] }` — decrements durations and drops consumed one-shots (`consumed` = uids the engine reports as applied or blocked), updates streaks and points (spec §3.3: win iff `net > 0`, loss iff `net < 0`, `net === 0` changes nothing; `carryOverOnly` counts nobody), awards bonus cards at the threshold, fires `crit` (spec §5.4, amount = (k−1) × net when `net > 0`), `fortune` (spec §5.5 table, after a ≥2 loss streak ended by a win), `rescue` (after a lost hand, `stackAfter < 2 × fixedWager`, amount = multiplier × fixedWager per tier), sets `frozenNextHand`/`blindfoldedNextHand` from the plan's freeze/blindfold effects.
- `toHeldCardView(card: HeldCard): HeldCardView`

---

### Task 1: Chaos core — catalogue, draws, plan and after-hand settlement

**Files:**
- Create: `packages/core/src/chaos/types.ts`, `catalogue.ts`, `draw.ts`, `hold.ts`, `plan.ts`, `settle.ts`, `index.ts`
- Create: `packages/core/src/chaos/catalogue.test.ts`, `draw.test.ts`, `hold.test.ts`, `plan.test.ts`, `settle.test.ts`
- Create: `packages/core/src/chaos/fixtures.ts` (a test catalogue of the 47 spec cards as data, also used by later tasks' tests)
- Modify: `packages/core/src/index.ts` (export the chaos module)

**Interfaces:** Produces everything in "Shared interfaces". Consumes `Rng`, `BlindRules` from `packages/core/src/cards/rng.ts`, `hand/types.ts`.

- [ ] **Step 1: Write failing tests** — at least:
  - `parseChaosCatalogue` accepts `fixtures.ts`'s 47 cards (18 silver, 15 gold, 14 diamond) and refuses: a duplicate id, an unknown effect, a tier with only 2 cards enabled for `none` mode.
  - `drawTier` with `seededRng` over 10 000 draws lands within ±2 % of 60/30/10.
  - `drawOffer` returns 3 distinct cards of the tier, never a `playOrFold`-only card for mode `none`, never a weight-0 card.
  - `receiveCard`: Silver `levelUp` yields one Gold card and no levelUp; Diamond `levelUp` yields two cards; Gold `bestOfN` (3 hands) on top of Silver `bestOfN` (1 hand) replaces it; Gold + Gold adds hands; Silver after Gold is dropped; `chaosPoints` adds 3 points.
  - `planHand`: a frozen seat fires nothing; a seat holding two debuffs fires only the older; targets never include the firing seat; "each opponent" targets every other seat; a `playOrFold`-only card never fires on a `none` table; gambler rolls a card from the allowed set.
  - `afterHand` — "a carry-over hand counts for nobody"; streak ×2 from the 3rd hand; 10 points award a card and keep the remainder; rescue fires only after a loss leaving `stackAfter < 2 × fixedWager` and pays 5/10/20 × wager by tier; crit pays (k−1) × net only on a win (seeded rng); fortune pays per the spec table after a 4-loss streak ended by a win (Gold: 8 × wager + 1 Gold card); durations decrement; consumed one-shots are removed.
- [ ] **Step 2: Run them** — `corepack pnpm --filter @bp/core exec vitest run src/chaos` → FAIL (modules missing).
- [ ] **Step 3: Implement** the modules with the signatures above. The fixture catalogue carries every card of spec §5.1–§5.3 with its `id`, tier, family, effect, params (e.g. `bestOfN {sets: 2, hands: 3}`, `crit {p2: 25, p3: 10, hands: 3}` as integer percents, `rescue {multiplier: 10}`, `fortune {}` with the table encoded in `settle.ts` by tier), timing, modes (`peekBoard`, `freeFold`, `blindfold` = `['playOrFold']`), `debuff`.
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/core exec vitest run src/chaos` → PASS; `corepack pnpm exec vitest run --root . tooling/arch` → PASS.
- [ ] **Step 5: Commit** `feat(core): the chaos cards' catalogue, draws, per-hand plan and after-hand settlement, pure and seeded`

### Task 2: Blind engine — chaos effects at deal, decision and reveal

**Files:**
- Modify: `packages/core/src/hand/types.ts` (`CreateBlindInput` lives in `blind.ts`; add `HandState.chaos?: ChaosHandState`; new `GameEvent` variants; `ShowdownHand.borrowed?: Card`)
- Modify: `packages/core/src/hand/blind.ts`, `common.ts` (settle hook), `view.ts` (`filterEvent`, `playerView`), `packages/core/src/evaluator/evaluator.ts` (accept 5..10 cards), `packages/core/src/bot/strategy.ts` + `chen.ts` (only the first `rules.holeCards` hole cards; a blindfolded bot plays at 50 %)
- Create: `packages/core/src/chaos/engine.ts` (the effect appliers called by `blind.ts`)
- Test: `packages/core/src/chaos/engine.test.ts`, extend `packages/core/src/hand/blind.test.ts`, `engine.test.ts` (simulation)
- Modify: `packages/ui-kit/src/client/reducer.ts` (add no-op cases for the new events so the exhaustive switch typechecks — real handling is Task 6)

**Interfaces:**
- Consumes Task 1's `ChaosHandPlan`, `PlannedEffect`.
- Produces:
  - `CreateBlindInput.chaos?: ChaosHandPlan` (absent = today's engine, byte-for-byte).
  - `HandState.chaos?: { plan: ChaosHandPlan; applied: number[] /* uids */; blocked: number[]; peek: { seat: number; cards: Card[] }[]; freeFoldSeats: number[]; insured: { seat: number; percent: number }[]; borrowed: { seat: number; card: Card }[] }`
  - New `GameEvent` variants:
    - `{ type: 'CHAOS_APPLIED'; seat: number; cardId: string; effect: ChaosEffectKind; targets: number[]; outcome: 'applied' | 'blocked' | 'reflected' | 'fizzled'; community?: Card[] }`
    - `{ type: 'CHAOS_PEEK'; seat: number; cards: Card[] }` — private: `filterEvent` sends `cards: []` to every other viewer.
  - `applyBlindCommand` result `state.chaos.applied ∪ blocked` is what Task 3 passes to `afterHand` as `consumed`.

Order of application (spec §3.5), all inside `blind.ts`/`chaos/engine.ts`:
1. `createBlindHand`, after the antes and before `CARDS_DEALT`: deal-time effects per seat in clockwise-from-button order — `swapLowest`, `redealWeak` (condition: no pair and no card ≥ J), `swapAll` (no pair and no card ≥ Q), `highCard` (redeal the lowest until a card ≥ 10, at most `holeCards` times), `suited` (redeal the 2nd card until same suit as the 1st, at most 6 tries), `bestOfN` (deal `sets − 1` extra sets, keep the best by hole-card strength: pair/trips first, then highest card, then next; burn the rest), `extraHole` (+1 card). Then `reverseRank` sets `plan.reverse`. Each emits a public `CHAOS_APPLIED` (no card values); `CARDS_DEALT` carries the final cards. A blindfolded seat's own `CARDS_DEALT` and view hide its cards (`cards: []`, `holeCards: null`) until showdown.
2. **Deck reserve:** before any chaos draw, require `deck.length − deckIndex ≥ 10` (the 5-card board plus a full storm re-deal); otherwise the effect emits `outcome: 'fizzled'` and changes nothing.
3. `DECISION_PHASE` (playOrFold): for each `peekBoard {count}` seat emit `CHAOS_PEEK` with `deck.slice(deckIndex, deckIndex + count)` and store it in `state.chaos.peek` (so `playerView` restores it on reconnect).
4. `resolveDecisions`: a `freeFold` seat that folds gets its ante back from the pot (`uncommit` — reduce `totalCommitted`, `pot`, raise `stack`) before `returnDeadExcess`; emits `CHAOS_APPLIED`.
5. After the river `ADVANCE` and before `settle` (only when ≥ 2 seats are in — **reveal effects wait for a showdown**; otherwise the plan's reveal effects are not marked applied, so the cards stay held): (a) shield/mirror — each debuff aimed at a seat with `shield` is `blocked` (the shield card is consumed unless `shield {hands}` > 0 for the 3-hand shield), with `mirror` it is `reflected` onto its user if the user has no debuff yet this hand; (b) `stealHole` (remove a random hole card; a seat keeps ≥ 1), `lowerHole` (redeal the highest), `swapHands`; (c) `redealBoard {count: 1}` (random board card) and `storm` (`redealBoard {count: 5}`), each emitting `community`; (d) `borrowHole` (record a copy of a random hole card of a random opponent in hand); then (e) `settle`. Each seat takes at most one debuff per hand: a second debuff aimed at an already-hit seat is `fizzled`.
6. `settle` (`common.ts`): ranking uses `holeCards + community (+ borrowed)`; with `plan.reverse` the ranks are negated before `distributePots`. **Insurance** (`refundStake {percent}`): after ranks are known, for each insured seat that wins no pot, `refund = floor(totalCommitted × percent / 100)` is taken from the pots that seat was eligible for, layer by layer from the last side pot back to the main pot, and credited to its stack; pots are then distributed. `ShowdownHand.borrowed` carries the borrowed card.

- [ ] **Step 1: Write failing tests** with `identityRng`/`seededRng` decks: each deal-time effect changes exactly the intended cards and emits `CHAOS_APPLIED` before `CARDS_DEALT`; "a full table of extra draws fizzles instead of exhausting the deck" (8 seats, `holeCards: 3`, every seat `bestOfN {sets: 3}` + `extraHole`); peek shows the real next board and reaches only its seat through `filterEvent`/`playerView`; freeFold refunds the ante and the books balance; shield blocks, mirror reflects, a second debuff on the same seat fizzles; steal/lower/swap/redeal/storm/borrow change the evaluated hands; reverse makes the weakest hand win; insurance 50 %/100 % refunds only a non-winning insured seat and `Σ stacks + fee + carryOverOut` is unchanged; "reveal effects wait for a showdown" (one player left / all fold); `evaluate` accepts 9 and 10 cards; a non-chaos hand's events and result are deep-equal to today's (seeded snapshot of a few hands).
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/core exec vitest run src/chaos src/hand src/evaluator src/bot` → FAIL.
- [ ] **Step 3: Implement** per the order above; extend `simulateHand`'s conservation check to random chaos plans (a test drives 500 seeded chaos hands built from `fixtures.ts` through `planHand`).
- [ ] **Step 4: Run** the same command plus `corepack pnpm --filter @bp/ui-kit exec tsc --noEmit -p tsconfig.json` → PASS.
- [ ] **Step 5: Commit** `feat(core): a Blind hand applies the chaos plan — re-deals, extra and borrowed cards, peeks, shields, insurance and the reversed ranking — and keeps every point`

### Task 3: Protocol and server-kit — the chaos room, the draft and the port

**Files:**
- Modify: `packages/core/src/protocol/messages.ts`, `validate.ts`, `validate.test.ts`; `packages/core/src/hand/types.ts` (`BlindRules.chaosCycle?: 5 | 10`); `packages/core/src/constants/economy.ts` (`chaosCycles: [5, 10]`)
- Modify: `packages/server-kit/src/repositories.ts` (`TxReason` += `chaos_rescue | chaos_crit | chaos_fortune | chaos_to_table`), `room/types.ts`, `room/room.ts`, `room/hand-runner.ts`, `room/room-manager.ts`, `gateway/gateway.ts`, `server.ts`, `index.ts`
- Create: `packages/server-kit/src/chaos-port.ts`, `packages/server-kit/src/testing/memory-chaos.ts`
- Test: `packages/server-kit/src/room/room-chaos.test.ts`; extend `room-hands.test.ts` `books()` with chaos sources

**Interfaces:**
- Consumes Task 1 (`planHand`, `afterHand`, `receiveCard`, `drawOffer`, `drawTier`, `parseChaosCatalogue`, types) and Task 2 (`CreateBlindInput.chaos`, `state.chaos.applied/blocked`, new events).
- Produces:
  - `BlindRoomConfig.chaosCycle?: 5 | 10` — `validateRoomConfig` normalises it (absent = off; anything other than 5/10 refused); `roomConfigToRuleset` copies it to `BlindRules.chaosCycle`. `RoomSummary.config` and `HandSummary.config` carry it automatically. **A chaos hand is `summary.mode === 'blind' && summary.config.blind?.chaosCycle !== undefined`.**
  - `ClientMessage` `{ t: 'CHAOS_PICK'; offerId: string; cardId: string }`.
  - `RoomEvent` variants: `{ type: 'CHAOS_DRAFT'; tier: ChaosTier; deadlineAt: number; seats: number[] }`, `{ type: 'CHAOS_PICKED'; seat: number; cardIds: string[] /* every card received, incl. levelUp results */ }`, `{ type: 'CHAOS_STATE'; seats: { seat: number; cards: HeldCardView[]; points: number }[] }`, `{ type: 'CHAOS_CREDIT'; seat: number; amount: number; reason: ChaosCreditReason; capped: boolean }`, `{ type: 'CHAOS_AWARDED'; seat: number; cardIds: string[] }`.
  - Private `NOTIFICATION` `{ kind: 'CHAOS_OFFER'; payload: { offerId: string; tier: ChaosTier; cardIds: string[]; deadlineAt: number } }`.
  - `RoomPlayerView.chaos?: { cards: HeldCardView[]; points: number }`; `ROOM_SNAPSHOT.chaos?: { draft: { tier: ChaosTier; deadlineAt: number; offer: { offerId: string; cardIds: string[] } | null; picked: boolean } | null }`.
  - `ErrorCode` += `'CHAOS_UNAVAILABLE'` (create-room with `chaosCycle` on a server without a port) and `'CHAOS_NO_OFFER'` (pick with a stale offer id).
  - `ChaosPort` (`packages/server-kit/src/chaos-port.ts`):
    ```ts
    export interface ChaosPort {
      catalogue(): Promise<{ cards: readonly ChaosCardDef[]; weights: ReadonlyMap<string, number> }> // active now
      config(): Promise<ChaosConfig>
      credit(c: { playerId: string; roomId: string; amount: number; reason: ChaosCreditReason; key: string }): Promise<{ credited: number; capped: boolean }>
    }
    ```
    `GameServerOptions.chaos?: ChaosPort` → `RoomDeps.chaos?`. `createMemoryChaosPort(opts: { cards?: readonly ChaosCardDef[]; config?: Partial<ChaosConfig>; repos: MemoryRepositories; capPoints?: number; rescues?: number }): ChaosPort` writes `[+credited reason, −credited chaos_to_table]` through `repos.balances.apply` with the key.
- Room behaviour (spec §3.2–§3.4):
  - `Room.tableHands` counts started hands; cycle index `c = floor(tableHands / chaosCycle)`; `cycleTier: Map<number, ChaosTier>` drawn once per cycle; `draftedCycle: Map<playerId, number>` survives stand-up (no re-draft within a cycle).
  - In `startHand`, after eligibility and before the `HandRunner`: if any eligible seat has `draftedCycle !== c`, enter the draft — fetch `catalogue()`/`config()` from the port, send each human its private `CHAOS_OFFER` (3 cards via `drawOffer`), pick for bots immediately (random), broadcast `CHAOS_DRAFT{tier, deadlineAt = now + draftMs, seats}` and set `nextHandAt = deadlineAt`; `Room.pickChaos(playerId, offerId, cardId)` accepts one pick; when every offer is picked or at the deadline (random pick for the rest, also for humans with auto-play — the server does not know auto-play), apply `receiveCard`, broadcast `CHAOS_PICKED` + `CHAOS_STATE`, then start the hand. A seat that leaves/stands during the draft drops its offer; the draft ends as soon as the remaining offers are picked.
  - Each hand: `planHand` from the seats' `ChaosSeat` (stored on `RoomPlayer.chaos`), pass `chaos: plan` to the `HandRunner` → engine; in `onHandComplete` **after** building the `HandSummary` and recording history: `afterHand(...)` with `consumed = applied ∪ blocked`, then for each credit: bots → `stack += amount`; humans → `chaos.credit({ key: 'chaos:<roomId>:<handId>:<seat>:<reason>' })`, `stack += credited`, `pushBalance`; broadcast `CHAOS_CREDIT`, `CHAOS_AWARDED`, `CHAOS_STATE`. Credits never enter the summary's `net`.
  - `standUpNow` clears `p.chaos` (cards and points lost); `draftedCycle` is kept.
  - `RoomManager.create` / gateway `CREATE_ROOM`: `chaosCycle` with no `deps.chaos` → `ERROR{ code: 'CHAOS_UNAVAILABLE' }` (Lite never wires a port).
  - Snapshot/`playerView`: each seat's `chaos` view; the viewer's draft state.

- [ ] **Step 1: Write failing tests** (`room-chaos.test.ts`, `createRoomHarness` + `ManualClock` + memory chaos port): the first hand opens a draft with 3 offered cards of one tier to each human and none to spectators; bots pick at once; a pick starts the hand when everyone has picked; the deadline picks at random; "a seat that leaves mid-draft does not hold the table"; "the snapshot restores the viewer's draft"; a draft opens again at hand 5 (cycle 5) and not at hand 4; a player who stands and sits again in the same cycle gets no new draft; standing clears cards and points; a rescue credit writes `chaos_rescue` + `chaos_to_table` under its key, raises the stack, and `books()` still balances over 200 chaos hands; a pick with a stale offer id → `CHAOS_NO_OFFER`; `CREATE_ROOM` with `chaosCycle` and no port → `CHAOS_UNAVAILABLE`; `validateRoomConfig` refuses `chaosCycle: 7` and the exact-ruleset pin in `validate.test.ts` gains `chaosCycle` only when set.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/server-kit exec vitest run` and `corepack pnpm --filter @bp/core exec vitest run src/protocol` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites + `corepack pnpm -r run typecheck` → PASS (fix the ui-kit reducer/types compile for the new room events with no-op cases; real handling is Task 6).
- [ ] **Step 5: Commit** `feat(server-kit, core): a chaos Blind room drafts cards between hands, carries them per seat, feeds each hand its plan and pays card credits through a ledgered port`

### Task 4: Normal server — catalogue, rules, config, daily cap, ledger and stats gating

**Files:**
- Create: `apps/normal-server/data/chaos-cards.json` (the 47 cards; same content as Task 1's fixture, `enabled: true`)
- Create: `apps/normal-server/src/chaos/chaos-catalogue.ts` (`loadChaosCatalogue(path = defaultChaosCardsPath()): ChaosCardDef[]` via `parseChaosCatalogue`, boot fails on a bad file), `chaos-service.ts`, `chaos-port.ts`, tests beside them
- Create: `apps/normal-server/drizzle/0007_chaos.sql` (+ `meta/0007_snapshot.json`, `_journal.json` entry with `when` > 0006's), `src/db/migrate-chaos.test.ts`
- Modify: `src/db/schema.ts` (`chaosCardRules`, `chaosConfig`; `GM_ACTION_KINDS` += `set_chaos_rules`, `set_chaos_config`), `src/db/schema.test.ts`, `src/test-harness.ts` (`resetDb` truncates `chaos_card_rules`), the four `migrate-*.test.ts` that pin 7 migrations → 8, `scripts/build.mjs` `SIDECARS` + its log line, `test/build.test.ts`
- Modify: `src/app.ts` (load catalogue, create service, pass `chaos: createChaosPort(...)` to `createGameServer`), `src/stats/stats-service.ts` (`patchForHand` gating), `src/reputation/reputation-service.ts` (`paySeat` with `won = false` for chaos hands), `src/gm/gm-service.ts` (`SOURCE_REASONS` += three chaos reasons; `chaos_to_table` is neither a source nor a sink), conservation tests (`app.test.ts`, `shop-service.test.ts` reason list, `economy-service.test.ts`)
- Modify: `apps/normal-web/src/locales/{vi,en}/normal.json` `ledger.reason.*` for the four reasons

**Interfaces:**
- Consumes Task 1 types/parser, Task 3 `ChaosPort`, `TxReason`.
- Produces:
  - Tables: `chaos_card_rules(card_id text PK, enabled boolean NOT NULL, weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 100), starts_at timestamptz NULL, ends_at timestamptz NULL, updated_by uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())`; `chaos_config(key text PK, value jsonb NOT NULL, updated_by uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())` — no FK on `updated_by` (schema.ts:284-288 rationale).
  - `createChaosService(deps: { db: AppDb; catalogue: readonly ChaosCardDef[]; timezone: string; now?: () => number }): ChaosService` with:
    - `active(nowMs?): Promise<{ cards: ChaosCardDef[]; weights: Map<string, number> }>` — a card is active when its rule row exists and `now ∈ [starts_at, ends_at)` (null bounds open) → `rule.enabled` (weight `rule.weight`); otherwise the file's `enabled` (weight 1). Read fresh on every call (one draft = one call).
    - `config(): Promise<ChaosConfig>` — `chaos_config` key `'chaos'` merged over `DEFAULT_CHAOS_CONFIG`.
    - `rules(): Promise<GmChaosCard[]>` where `GmChaosCard = { id, tier, family, effect, modes, fileEnabled, rule: { enabled, weight, startsAt: number | null, endsAt: number | null } | null, activeNow: boolean }`.
    - `setRules(tx, changes: ({ cardId; enabled; weight; startsAt: number | null; endsAt: number | null } | { cardId; clear: true })[], updatedBy): Promise<void>` — throws `ServiceError('INVALID_CHAOS_RULES')` for an unknown card, weight outside 0..100, `endsAt ≤ startsAt`, or a result with < 3 active cards of a tier for either mode (checked at `now`).
    - `setConfig(tx, config: ChaosConfig, updatedBy)` — throws `ServiceError('INVALID_CHAOS_CONFIG')` unless weights are non-negative integers summing to > 0, threshold 1..100, draftMs 5 000..60 000, dailyCapPoints 0..10 000 000, dailyRescues 0..20.
    - `credit(c)` — one transaction: lock the player (`FOR UPDATE`), sum today's (`dayStartMs(dayKey(now, tz), tz)`) `chaos_rescue|chaos_crit|chaos_fortune` rows and count today's `chaos_rescue` rows; `credited = min(amount, capLeft)`, and 0 for a rescue past `dailyRescues`; claim the ledger key; write `[{reason, +credited, refId: key}, {chaos_to_table, −credited, refId: key}]` via `creditWithin`; return `{ credited, capped: credited < amount }`. A replayed key returns `{ credited: 0, capped: false }`.
  - `isChaosHand(summary: HandSummary): boolean` in `src/stats/chaos-hand.ts`; `patchForHand` for a chaos hand keeps `gamesCompleted`, `handsPlayed*`, `botHands` and skips `handsWon*`, `biggestWin`, `bestHandRank`, both streaks; reputation pays `hand_played` only.

- [ ] **Step 1: Write failing tests:** the file loads (47 cards) and a broken copy fails the boot loader; the migration applies on a 0006 database and re-runs as a no-op; `active()` honours file defaults, a row inside its window, a row outside it (file default) and weight 0; `setRules` refuses leaving 2 active Silver cards; "credits stop at the daily cap and the rescue count" (cap 100 000: 60 000 + 60 000 → second credits 40 000 `capped`; 4th rescue → 0) and the day rolls over at the economy-day boundary; a replayed key credits nothing; a chaos hand's summary leaves `handsWonBlind`/`bestWinStreak`/`bestHandRank`/`biggestWin` untouched but counts `handsPlayedBlind`; reputation pays no `hand_won` for it; conservation in `app.test.ts` counts `chaos_*` sources and `chaos_to_table`; the build test lists `data/chaos-cards.json`.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/chaos src/db src/stats src/reputation src/gm src/app.test.ts test/build.test.ts` → FAIL.
- [ ] **Step 3: Implement** (generate the migration with `corepack pnpm --filter @bp/normal-server db:generate --name chaos`, then hand-guard it with `IF NOT EXISTS` like `0006_plan27.sql`).
- [ ] **Step 4: Run** the same → PASS; `corepack pnpm --filter @bp/normal-server exec tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(normal-server): chaos cards from a data file and GM rules, a daily cap of new points, the chaos ledger reasons, and chaos hands kept out of win stats and streaks`

### Task 5: GM console — "Thẻ hỗn loạn"

**Files:**
- Modify: `apps/normal-server/src/gm/gm-service.ts` (`chaos()`, `setChaosRules(actor, changes, reason)`, `setChaosConfig(actor, config, reason)` via `checkReason` → `editorOf` → transaction + `logAction`), `src/http/routes-gm.ts` (+ `SERVICE_STATUS` for the two new codes → 400), `src/http/routes.ts`/`app.ts` deps; tests `gm-service.test.ts`, `routes-gm.test.ts` (or the existing GM route test file)
- Modify: `apps/normal-web/src/api.ts` (DTOs `GmChaosDto = { cards: GmChaosCard[]; config: ChaosConfig }`, methods `gmChaos()`, `gmSetChaosRules(changes, reason)`, `gmSetChaosConfig(config, reason)`), `src/screens/gm/GmScreen.tsx` (tab `'chaos'` after `'shop'`), `GmScreen.test.tsx` (seven tabs)
- Create: `apps/normal-web/src/screens/gm/ChaosTab.tsx`, `ChaosTab.test.tsx`
- Modify: `apps/normal-web/src/locales/{vi,en}/normal.json` (`gm.tabs.chaos` = "Thẻ hỗn loạn", `gm.chaos.*`, `gm.log.kind.set_chaos_rules|set_chaos_config`)

**Interfaces:**
- Consumes Task 4's `ChaosService`, Task 6's card names (`useTranslation('game')` → `chaos.cards.<id>.name`; ui-kit i18n is already initialised in normal-web).
- Produces routes: `GET /api/gm/chaos` → `GmChaosDto`; `PUT /api/gm/chaos/rules` `{ changes, reason }`; `PUT /api/gm/chaos/config` `{ config, reason }` — all GM-only, reason 3–200 chars, audit rows in `gm_actions`.

ChaosTab: three tier sections, each card a row with name, effect family, "Đang bật" state, a toggle, weight (0–100), from/to dates (economy-day pickers using `formatDay`), "Theo file" reset; a config block (the five numbers). Unsaved edits enable "Lưu"; saving opens `ReasonDialog`; the server's refusal (e.g. fewer than 3 active cards) prints in the dialog.

- [ ] **Step 1: Write failing tests:** the GET returns 47 cards with `activeNow`; a PUT without reason → 400 `INVALID_REASON`; a valid PUT writes rules and a `set_chaos_rules` audit row; refusing to leave a tier short → 400 `INVALID_CHAOS_RULES`; non-GM → 403; ChaosTab lists three tiers, sends only changed rows under one reason, prints the server's refusal, and GmScreen shows seven tabs in order.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/gm src/http` and `corepack pnpm --filter @bp/normal-web exec vitest run src/screens/gm` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(normal-server, normal-web): a "Thẻ hỗn loạn" GM tab turns each card on or off, weights it, dates it for a season and edits the chaos numbers, every save under a reason`

### Task 6: ui-kit client state, create-room option, lobby badge and card names

**Files:**
- Modify: `packages/ui-kit/src/client/types.ts` (`ClientState.chaos: { draft: { tier; deadlineAt; offer: { offerId; cardIds } | null; picked: boolean } | null; seats: Record<number, { cards: HeldCardView[]; points: number }>; applied: AppliedChaosView[]; credits: { seat; amount; reason; capped }[] }`, `ClientHandResult.chaosUsed: { seat: number; cardId: string; outcome: string }[]`), `reducer.ts` (handle every new GAME/ROOM event, the `CHAOS_OFFER` notification, snapshot restore; clear `applied` at `HAND_STARTED`, copy into `result.chaosUsed` at settlement), `useGameClient.tsx` (`pickChaos(offerId, cardId)`), `playground/mock-client.ts`, `playground/scenarios.tsx` `frozenClient`, test fakes
- Modify: `packages/ui-kit/src/lobby/CreateRoomForm.tsx`, `CreateRoomFields.tsx` (`BlindFields`: "Poker hỗn loạn" checkbox + "Chu kỳ thẻ" select 5/10, rendered only when the new prop `chaosOffered` is true), `lobby.module.css` (keep `.modeFields` equal height across modes — re-measure Hold'em vs Blind with chaos), `screens/LobbyScreen.tsx` (pass `chaosOffered` through), `apps/normal-web/src/App.tsx` (`chaosOffered`)
- Modify: `packages/ui-kit/src/lobby/RoomList.tsx`, `table/RoomHeader.tsx` (badge "Hỗn loạn"), `primitives/Badge.tsx` + `primitives.module.css` (tone `'chaos'`), `theme/tokens.css` (`--tier-silver`, `--tier-gold`, `--tier-diamond` + `-ink` variants in dark, light and night palettes), `theme/tokens.test.ts` (contrast of the inks)
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` (`create.chaos`, `create.chaosHint`, `create.chaosCycle`, `labels.chaosMode` = "Hỗn loạn", `chaos.capped` = "Đã chạm trần thẻ hôm nay" (shown by Task 7 beside a capped credit), `chaos.tier.*`, `chaos.cards.<id>.name|desc` for all 47 ids — Vietnamese names and one-line descriptions from the spec tables; English written from the spec's meaning), `chaos.*` UI strings
- Test: `client/reducer.test.ts`, `useGameClient.test.tsx`, `lobby/CreateRoomForm.test.tsx`, `lobby/RoomList.test.tsx`, `table/RoomHeader` tests, `i18n/i18n.test.ts` (parity), a test that every id in `@bp/core`'s fixture catalogue has a name and desc in both languages

**Interfaces:**
- Consumes Task 3's protocol (`CHAOS_PICK`, room events, notification, snapshot), Task 2's game events, Task 1's `HeldCardView`, fixtures.
- Produces `ClientState.chaos`, `ClientHandResult.chaosUsed`, `GameClientApi.pickChaos`, `CreateRoomForm`/`LobbyScreen` prop `chaosOffered?: boolean` (default false), Badge tone `'chaos'`, tier tokens, i18n keys `chaos.cards.<id>.name|desc`.

- [ ] **Step 1: Write failing tests:** the reducer stores a `CHAOS_OFFER`, marks `picked` after `CHAOS_PICKED` for my seat, keeps each seat's cards from `CHAOS_STATE`, collects `CHAOS_APPLIED` in order and moves them to `result.chaosUsed`, restores a draft from a snapshot; `pickChaos` sends `{t:'CHAOS_PICK'}`; the form hides the chaos fields without `chaosOffered`, shows them with it, submits `blind.chaosCycle: 5` by default and `10` when chosen, and omits it when unchecked; the lobby ticket and room header show "Hỗn loạn"; i18n parity and every card id named.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/ui-kit exec vitest run src/client src/lobby src/i18n src/theme src/table/RoomHeader` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `corepack pnpm --filter @bp/normal-web exec vitest run src/App` → PASS.
- [ ] **Step 5: Commit** `feat(ui-kit, normal-web): a Blind room can be made "Poker hỗn loạn" with a 5- or 10-hand card cycle, the lobby marks it "Hỗn loạn", and the client keeps every draft, card and credit`

### Task 7: ui-kit table — draft overlay, seat cards, reveal banner, result line

**Files:**
- Create: `packages/ui-kit/src/table/ChaosDraft.tsx` (3 cards, tier frames, name + one-line desc, a `TurnTimer` ring on `draft.deadlineAt`, click/Enter picks, "Đã chọn — chờ người chơi khác" after picking, keyboard-reachable buttons), `ChaosCardIcon.tsx` (small tier-framed icon with a tooltip name; `handsLeft` badge), `ChaosBanner.tsx` (queue of `applied` items shown one at a time, ~900 ms each, `role="status"`; under reduced motion each shows statically with no slide), tests for each
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx` (mount `ChaosDraft` and `ChaosBanner` inside `.roomMain` beside the result overlay; the draft blocks the action tray), `table/Seat.tsx` (icons in `.tags` for the ring layout and in `.stripLine` for the phone strip; at most 4 icons, then "+N"), `table/PokerTable.tsx` (pass seat chaos), `table/HandResult.tsx` (a "Thẻ đã dùng" `.resultMeta` line listing card names by seat; credits shown as "Cấp cứu +N" / "Bạo kích ×2" etc.), `table/table.module.css` (+ the "Motion off" block lists every new moving class)
- Modify: `packages/ui-kit/playground/mock-client.ts` (mode `blindC`: a chaos room that drafts and applies a few cards), `playground/main.tsx` (`MODE_LABEL`), `playground/scenarios.tsx` (`WorstState` += `chaosDraft`, `chaosReveal`), `playground/scenarios.test.ts`
- Test: `table/ChaosDraft.test.tsx`, `ChaosBanner.test.tsx` (reduced-motion path), `Seat.test.tsx`, `HandResult.test.tsx`, `screens/RoomScreen.test.tsx`, `table/Card.test.tsx`-style CSS regex for the motion-off list

**Interfaces:**
- Consumes Task 6 (`ClientState.chaos`, `chaosUsed`, `pickChaos`, tokens, i18n).
- Produces the components above; no new protocol.

Layout rules: the draft is a centred panel over the felt at ≥ 768 px wide, a bottom sheet on phones (375×812) and a compact row in landscape (915×412); cards never overlap the player's own hand fan; the banner sits above the community cards and never covers the action tray; `expectNoTextOverlap` passes on each.

- [ ] **Step 1: Write failing tests:** the draft shows three named cards with their tier and a timer, a click calls `pickChaos` once and shows the waiting line; the banner shows applied cards in order and, under reduced motion, without animation classes; the seat shows up to 4 icons then "+N"; the result card lists "Thẻ đã dùng"; scenario hashes `#worst/chaosDraft/6/vi` and `#worst/chaosReveal/6/vi` render.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/ui-kit exec vitest run src/table src/screens playground` → FAIL.
- [ ] **Step 3: Implement**, then take Playwright screenshots of the playground states at 1920×940, 1366×768, 375×812 and 915×412 (save under `.superpowers/sdd/plan37/shots/`, gitignored) and look at them.
- [ ] **Step 4: Run** the same → PASS; `corepack pnpm lint`.
- [ ] **Step 5: Commit** `feat(ui-kit): the chaos draft over the felt, each seat's cards as small tier icons, a banner for every card that fires, and "Thẻ đã dùng" on the result card`

### Task 8: End to end, guides and docs

**Files:**
- Create: `apps/normal-web/e2e/ops/10-chaos.spec.ts` (ops pack; accounts only via `newPlayer`/`registerPatiently`): create a "Poker hỗn loạn" room with 3 bots, see the "Hỗn loạn" badge in the lobby, the draft appears with 3 cards, pick one, a hand plays with the card icon on the seat, a hand result shows "Thẻ đã dùng" when a card fired (drive with a seeded server option or retry hands until one fires, bounded), the draft returns after 5 hands; a `@mobile` case for the draft sheet and a `@landscape` case.
- Modify: `apps/normal-web/e2e/ops/ops-helpers.ts` (`createBlind` gains `chaos?: 5 | 10`), `apps/normal-web/e2e/support.ts` (`expectCreateRoomKeepsItsHeight` still passes with the chaos fields visible)
- Modify: `docs/player-guide.md` (new Vietnamese section "Poker hỗn loạn": how drafts work, tiers, points, the 47 cards in three tables, the fences, the daily cap), `docs/normal-server.md`, `docs/server-kit.md`, `docs/ui-kit.md`, `docs/known-limitations.md` (Lite has no chaos; English card names unreviewed; card art is CSS frames; bots pick at random), `docs/test-matrix.md` only if a matrix row applies, `CHANGELOG.md` (`## Plan 37 — Poker hỗn loạn — merged \`MERGE\` (date)`), `docs/lessons-learned.md` (Plan 37 section at merge)

- [ ] **Step 1:** Write the ops spec; run `corepack pnpm build:normal` then `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "chaos"` → FAIL first if run before the build, then PASS.
- [ ] **Step 2:** Run `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts` (whole pack) and `corepack pnpm e2e:normal` → PASS (the create-room height check included).
- [ ] **Step 3:** Write the docs; `corepack pnpm exec vitest run --root . tooling/arch` → PASS.
- [ ] **Step 4: Commit** `test(e2e), docs: a chaos table played end to end on desktop, phone and landscape, and the player guide explains drafts, tiers, points and all 47 cards`

---

## Amendments (pre-flight 2026-10-26)

An independent review checked the plan against the code. These amendments **override** the task text above where they
differ. Execution order is **T1, T2, T3, T4, T6, T5, T7, T8** (T5's GM tab reads T6's card names).

**Cross-cutting**
- `fixtures.ts` is exported from `@bp/core` as `CHAOS_CARDS_SPEC`; Task 4 tests that `data/chaos-cards.json` deep-equals it.
- GM weights apply to **every** random card draw (draft offers, bonus cards, Cấp độ, Thần tài prizes, Tay bạc rolls): pass
  a `weights: ReadonlyMap<string, number>` into `receiveCard`, `planHand` and `afterHand` (weight 0 = never). Task 4's
  "≥ 3 active per tier per mode" counts only cards with weight > 0. A tier left with fewer than 3 active cards (e.g. a date
  window expired) drafts what exists and never throws; with 0 it falls back to the next lower tier.
- The Thần tài table (spec §5.5) is encoded in each `fortune` card's `params` (e.g. `{ m2: 4, m4: 8, c4: 1, t4: 2, m6: 12, c6: 2, t6: 2 }` — multipliers, card counts, card tiers as 1/2/3), not hard-coded.

**Task 1**
- `afterHand` seats carry an explicit `outcome: 'win' | 'loss' | 'none'` (won a pot → win; folded, or in the hand without
  winning a pot → loss; carry-over or cancelled → none) instead of deriving it from `net`. Streaks, points, Thần tài and
  Cấp cứu use `outcome`; Bạo kích still pays (k−1) × `net` when `net > 0`. `ChaosCredit` gains `uid: number` (the card) and
  `multiplier?: 2 | 3` (Bạo kích).
- `afterHand` sets `frozenNextHand`/`blindfoldedNextHand` from the engine's final **marks** (Task 2: `state.chaos.marks`,
  after shields/mirrors), passed in as `marks: { seat: number; kind: 'freeze' | 'blindfold' }[]`, not from the plan.
- A seat frozen this hand receives its bonus cards at the end of its next unfrozen hand (they are queued, not lost).
- `planHand` does **not** pick targets for reveal debuffs (`stealHole`, `lowerHole`, `swapHands`, `borrowHole`, `redealBoard`
  needs none): it passes `targets: []` and the engine picks at reveal. Deal-time debuffs (`freeze`, `blindfold`) still get
  targets from `planHand`, then go through the same shield/mirror/one-per-seat resolver in the engine.
- `s_high_card` and `s_suited` are guaranteed (spec §5.1): the engine draws until it qualifies within the deck reserve.

**Task 2**
- Add `chaos?: ChaosHandPlan` to `CreateHandInput` and forward it in `createHand` (`packages/core/src/hand/engine.ts`), and
  through `simulateHand`.
- Deck reserve: a deal-time draw of `n` cards needs `remaining − n ≥ 10`; a reveal-time draw needs `remaining ≥ n`;
  otherwise `fizzled`.
- Deal-time debuffs (`freeze`, `blindfold`) resolve at deal through the same resolver as reveal debuffs (shield blocks,
  mirror reflects, one debuff per seat per hand); final targets are stored in `state.chaos.marks`.
- Reveal debuffs pick their target at reveal, at random (with the `rng` passed to `applyBlindCommand`) among unfolded
  opponents not yet hit this hand; a holder who folded fires no reveal effect and keeps the card.
- Deal-time buff `CHAOS_APPLIED` events are **private to their owner** (`filterEvent` turns them into nothing for others —
  e.g. drop them for other viewers) and are re-emitted publicly at settlement as part of a `CHAOS_SUMMARY { used: { seat, cardId, effect, outcome }[] }` event (also a new `GameEvent` variant), which is what the result line and history use. Only `reverseRank` is public at deal.
- On a squeeze table a blindfolded seat starts with `revealed: true`.

**Task 3**
- `onHandComplete`: skip all chaos work when the runner was cancelled; otherwise run `afterHand` and every credit **after**
  `recordHand` and **before** the stand-up/leave loop (so a seat at stack 0 can be rescued before `standUpSpent`).
- The draft is its own `Room` state (`draft: { … } | null`) that guards `startHand`/`startGame`: the draft check sits after
  eligibility and before the sit-out loop; `startHand` returns `true` when a draft opens; status is `IN_GAME` with
  `ROOM_STATUS{ nextHandAt: deadlineAt }`; at draft end `startHand` runs again with the draft check skipped once (seats that
  became eligible during the draft play that hand undrafted and draft before their next one); `cancelTimers`/`close`/
  `shutdown` cancel the draft timer; if the port's `catalogue()`/`config()` throws, log and deal without a draft.
- Disconnected humans are picked for at once (random). Held `gambler` cards are dropped when the next cycle's draft opens.
- Credit keys: `chaos:<roomId>:<handId>:<seat>:<uid>:<reason>`. A replayed key returns the amount already written under
  that `refId` (the port looks it up); the room retries a failed credit once and logs a second failure (no stack change).
- `createRoomHarness` gains `chaos?: true | { cards?; config?; capPoints?; rescues? }` building the memory port from the
  harness repos; export `memory-chaos.ts` from `testing/index.ts` and `chaos-port.ts` from `src/index.ts`.
- `HandSummary` gains `chaosUsed?: { seat: number; cardId: string; outcome: string }[]` (from `CHAOS_SUMMARY`).
- `CHAOS_CREDIT` carries `multiplier?: 2 | 3`.
- Test wording: "a draft at hand 5" = before the hand when `tableHands === 5`.

**Task 4**
- Migration 0007 also adds `games.chaos_used jsonb NULL`; `history-repo.recordHand` writes `summary.chaosUsed`; the history
  read path returns it (UI in Task 8).
- `apps/normal-web/src/screens/LedgerPanel.tsx` `REASONS` gains the four chaos reasons.
- `resetDb` truncates `chaos_card_rules` and `chaos_config`.
- `credit` replay returns the amount already written under the key.

**Task 6**
- `packages/ui-kit/src/i18n/locales/{vi,en}/common.json` gain `errors.CHAOS_UNAVAILABLE` and `errors.CHAOS_NO_OFFER`.
- The `CHAOS_OFFER` notification is handled by the reducer without `notify()` (no toast).
- With auto-play on, the client picks the first offered card at once (same pattern as the squeeze auto-REVEAL).
- Screenshots at 1920×940, 1366×768, 375×812 of the create-room form with the chaos fields and of the room header with both
  "Nặn bài" and "Hỗn loạn".

**Task 5**
- Screenshots of the seven-tab GM row at 375 px, 1366×768 and 1920×940.

**Task 7**
- Show "Bạo kích ×2!" / "×3!" on the winner's seat from `CHAOS_CREDIT.multiplier`.
- Screenshots also cover a 4-card hand (`extraHole` on a 3-card table) in the normal and peel layouts, and a blindfolded own
  seat.

**Task 8**
- The game history shows the "Thẻ đã dùng" line from `games.chaos_used`.
