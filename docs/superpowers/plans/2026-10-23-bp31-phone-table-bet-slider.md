# BP-31 — Phone table, bet slider, Blind limit 10× — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone the table shows my cards big and fanned over the felt's foot with a one-row tray, a raise opens a chip-and-slider panel, the slider replaces the number field on every frame, and a Blind table takes ten wagers from the balance instead of five.

**Architecture:** Everything lives in `@bp/ui-kit` (`ActionBar`, `RoomScreen`, `PokerTable`, `Seat`, `table.module.css`) plus one constant in `@bp/core`; Normal and Lite take the kit as is. `RoomScreen` measures the stack layout once and passes `layout` down, so `ActionBar` knows stack / ring, and `frame` already says landscape. The bet amount stays a street total in `[min, max]` from `legal`; no engine or protocol change.

**Tech Stack:** React 18, CSS modules + tokens, Vitest + Testing Library (raw-CSS tests for sizes), Playwright (Normal e2e, ops pack), pnpm 9 via `corepack`.

**Spec:** `docs/superpowers/specs/2026-10-23-phone-table-bet-slider-design.md` (read whole; §3 design, §4 tests, §6 rulings R1–R12, §8 the SRS text).

## Global Constraints

- Branch `feature/BP-31-phone-table-bet-slider` from `main` **after BP-30 merges** (ops pack then 55 cases; this plan ends at 56).
- Stable Vietnamese terms unchanged (CLAUDE.md §6): Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Lật, Xem/Bỏ, Theo mọi mức, Tự động chơi, Sẵn sàng / Hủy sẵn sàng, Bắt đầu, Tạm nghỉ / Chơi tiếp, Người thắng, Ván bị hủy. New strings in both `vi` and `en` (`packages/ui-kit/src/i18n/locales/*/game.json`), parity tests green, no JSX literals.
- Glyphs ▴ ▾ are `aria-hidden`; accessible names stay "Tố", "Cược", "Hủy"; exactly one button matching `/^Tố( |$)/` at any time.
- Every chip in the bet panel carries `aria-pressed` (true/false) so `autopilot`'s `button:not([aria-pressed])` never picks one.
- Buttons ≥ 44 px (`size="md"`) except the bet chips at 36 px (R12). No new runtime dependency. `prefers-reduced-motion` honoured (the fan has no motion; the panel open/close uses no animation).
- Money: the amount sent is `{ kind: 'raise' | 'bet', amount }`, a street total clamped to `[min, max]` from `hand.legal`; nothing else changes on a money path. Blind limit = `fixedWager × 10` everywhere through `blindTableLimit()`.
- Commit trailer exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `git commit --only <paths>`; never push.
- Screenshots with Playwright from `apps/normal-web` (throwaway `zz-preview.spec.ts`, deleted before commit) or the playground; one throwaway account per shot run.

## Review Focus

1. A raise whose `max` is not a multiple of the step: the slider must still reach `max` exactly and the confirm must send `max` (Task 2 test "the slider reaches max when the range is not a multiple of the step").
2. `legal` changes while the panel is open (a reconnect, a bot acts): the slider re-clamps to the new `[min, max]` and the confirm label follows (Task 2 test "new legal bounds re-clamp the open panel").
3. A Hold'em hand where only a call-all-in is legal (no sizing): the tray row shows Tất tay in the third slot and no panel opens (Task 2 test "with no sizing the row offers Tất tay and no panel").
4. The stack layout at 8 opponents (three rows of chips): no page scroll, my cards ≥ 52 px, nothing over the pot (Task 3 playground shot `#worst/turn/9/vi` at 375×812 and Task 5's M-01 measure).
5. A spectator or a player between hands in the stack layout: no tray, a dock with Sẵn sàng / Bắt đầu, the ⋯ in the header (Task 4 tests "stack between hands shows the dock, not the tray" and "a spectator has no footer").

---

### Task 1: Blind table limit 10×

**Files:**
- Modify: `packages/core/src/constants/economy.ts:11`, `packages/core/src/hand/blind.ts:20` (comment), `packages/core/src/constants/economy.test.ts:22`, `packages/core/src/hand/blind.test.ts:43-47`
- Modify: `packages/server-kit/src/room/room.test.ts:108-122`, `room-hands.test.ts:84,688-700,792`, `gateway/gateway.test.ts:340`
- Modify: `packages/ui-kit/src/i18n/locales/vi/game.json:231`, `en/game.json:231` (`create.tableLimitHint`), `packages/ui-kit/src/lobby/CreateRoomForm.test.tsx:62-68`, `packages/ui-kit/src/screens/RoomScreen.test.tsx:415,433,476-478,947,1180,1242`, `packages/ui-kit/src/table/Seat.tsx:392` (comment)
- Modify: `apps/normal-web/e2e/normal.spec.ts:62-65,393,438`, `apps/lite/e2e/lite.spec.ts:26-29,297-298`, `apps/normal-web/e2e/ops/02-lobby-rooms.spec.ts:51-52,67`, `apps/normal-web/e2e/ops/04-blind.spec.ts:94,225,247`
- Modify docs: `docs/player-guide.md:33,182,194,241-245,254`, SRS `docs/superpowers/specs/2026-09-04-bind-poker-design.md:216,264-269,381`, `docs/superpowers/specs/2026-09-29-blind-table-limit-design.md` (amendment note at the top), `docs/operation-test-plan.md` rows S-05, F-10, H-02, `docs/known-limitations.md:59,78,123,272` (only where a multiplier is stated), `docs/ui-kit.md:242`, `docs/server-kit.md:251`

**Interfaces:**
- Produces: `ECONOMY.blindTableLimitMultiplier === 10`; `blindTableLimit({ fixedWager })` returns `fixedWager * 10`; nothing else changes shape.

- [ ] **Step 1: Red** — change `economy.test.ts:22` to `toBe(10)` and `blind.test.ts` "sets the table limit at ten wagers for every tier" expecting `10 ×` for the six tiers; run `corepack pnpm --filter @bp/core exec vitest run src/constants src/hand/blind.test.ts` → FAIL.
- [ ] **Step 2: Green** — set the constant to 10; fix the `blind.ts:20` comment.
- [ ] **Step 3: Downstream numbers** — update every file listed above (server-kit sit-down stacks 5_000 → 10_000 and balances, ui-kit "Limit 50,000" / "(10× the wager)", e2e `LIMIT = 10 * WAGER`, ops `'Mức cược 1.000 · Hạn mức 10.000'` and buy-in −10_000, docs text "bằng 10 lần mức cược (mức cược 1.000 thì hạn mức 10.000)"). Run `corepack pnpm --filter @bp/core test`, `--filter @bp/server-kit test`, `--filter @bp/ui-kit test`, and `corepack pnpm exec vitest run --root . tooling/arch` → PASS. Read a Vietnamese heading of `docs/player-guide.md` back.
- [ ] **Step 4: Commit** `feat(core, server-kit, ui-kit): a Blind table takes ten wagers from the balance, and the create-room hint, the guides and every test say so`.

### Task 2: `ActionBar` — the bet panel (chips + slider), one-row tray, `layout` prop

**Files:**
- Create: `packages/ui-kit/src/table/BetPanel.tsx` (+ `BetPanel.test.tsx`)
- Modify: `packages/ui-kit/src/table/ActionBar.tsx` (whole sizing section, lines ~120-160 and 270-450), `ActionBar.test.tsx` (rewrite the sizing, landscape and Blind blocks), `packages/ui-kit/src/table/table.module.css` (`.tray`, `.trayRow`, `.sizer`, `.preset`, slider rules at 1455-1800), `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` (`presets.half` "½ pot", `presets.allIn` → reuse `actions.allIn`, new `labels.betPanel` "Chọn mức cược" / "Choose the bet", `actions.cancelBet` "Hủy" / "Cancel"; remove `labels.amount`, `labels.amountDialog`), `packages/ui-kit/src/index.ts` (drop the `AmountDialog` export if any)
- Delete: `packages/ui-kit/src/table/AmountDialog.tsx` (+ its test)
- Modify: `packages/ui-kit/playground/*` wherever `ActionBar` is rendered (pass `layout`)

**Interfaces:**
- Consumes: `hand.legal` bounds (`minBet/maxBet/minRaiseTo/maxRaiseTo`), `room.rules.smallBlind` (Hold'em).
- Produces:
  - `ActionBarProps.layout?: 'stack' | 'ring'` (default `'ring'`); two-step when `layout === 'stack' || frame === 'landscape'`, one-step otherwise.
  - `BetPanel(props: { min: number; max: number; step: number; value: number; pot: number; onChange(v: number): void; onConfirm(): void; onCancel?(): void; lang: Lang; confirmLabel: string; compact?: boolean })` rendering `group[name=labels.betSize]` chips Min · ½ pot · Pot · Tất tay (each `aria-pressed`), an `<input type="range" aria-label={labels.amountSlider} aria-valuetext={formatPoints(value)}>`, a floating value label, and (two-step only) the row `Hủy ▾` + confirm.
  - `betStep(min, max, smallBlind): number` exported from `BetPanel.tsx`: `smallBlind`, or `ceil((max-min)/200)` rounded up to a multiple of `smallBlind` when `(max-min)/smallBlind > 200`.
  - Tray row contents per spec §3.1 (Hold'em turn: Bỏ bài · Xem|Theo N · Cược ▴|Tố ▴ or Tất tay; between turns: the pre-action toggles, or the wait line when none; Blind: Tự động chơi · Bỏ bài · Chơi N|Tất tay N). The old `.controls`-related rendering is not here (Task 4).
  - `data-panel="open|closed"` on the tray root; `data-layout` on the tray root.

- [ ] **Step 1: Red** — `BetPanel.test.tsx`: "the slider reaches max when the range is not a multiple of the step" (min 600, max 2_950, step 200 → End gives 2_950 and `aria-valuetext` "2.950"); "chips set min, half pot, pot, all-in and light the matching one" (`aria-pressed`); "keys move one step, ten steps, home and end"; `betStep(1_000, 500_000, 500)` is 2_500 (`(499_000/200 = 2_495 → up to 2_500)`), `betStep(1_000, 20_000, 500)` is 500. `ActionBar.test.tsx`: "stack: Tố opens the panel, Hủy closes it, and there is one Tố button throughout"; "landscape: the panel replaces the left corner and the right corner's Tố becomes Tố N"; "ring desktop: chips and slider are always shown and Enter sends the clamped total"; "new legal bounds re-clamp the open panel"; "with no sizing the row offers Tất tay and no panel"; "Blind: Tự động chơi, Bỏ bài, Chơi N in one row"; "between turns the toggles replace the row, and the wait line shows only when there are none"; "no spinbutton anywhere". Run → FAIL.
- [ ] **Step 2: Implement** `BetPanel.tsx`, the `layout` prop, the two-step state (`panelOpen`), remove `AmountDialog`, the number input and `SLIDER_STEPS`; CSS: `.panel` (chips 36 px row, slider 44 px row with a 28 px thumb and 44 px hit area, confirm row), `.trayRow > button` at `size="md"`, `[data-layout='stack'] .tray` padding 8/12, landscape left corner hosts `.panel` when open. Reduced motion: no transitions on the panel.
- [ ] **Step 3: Green** — `corepack pnpm --filter @bp/ui-kit test`; eslint on touched files; `corepack pnpm --filter @bp/ui-kit typecheck`.
- [ ] **Step 4: Playground** — `corepack pnpm --filter @bp/ui-kit playground`, shots `#worst/turn/6/vi` at 375×812 (force stack) idle and panel open, at 915×412 panel open, at 1920×940; save to `.superpowers/sdd/bp31/shots/T2-*.png`.
- [ ] **Step 5: Commit** `feat(ui-kit): a raise is chosen with chips and a slider on every frame, the phone tray is one row, and the number field and the amount dialog are gone`.

### Task 3: Stack layout — fanned hand, my strip, card sizes, 11/12 px

**Files:**
- Modify: `packages/ui-kit/src/table/Seat.tsx` (viewer branch: `data-fan`, strip markup), `Seat.test.tsx`, `packages/ui-kit/src/table/PokerTable.tsx` (`.mine` → strip + fan; `--card-lg` on `.stackFelt`), `PokerTable.test.tsx`, `packages/ui-kit/src/table/table.module.css` (`.cardMd` in stack, `.fan`, `.mine`, `.stackFelt` padding-bottom, `.othersChip .tags > *` 0.6875rem, `.othersChip .bet` 0.75rem, `:1065` 0.6875rem, `--plate-h`), `packages/ui-kit/src/table/PeelCard.tsx` (size only)

**Interfaces:**
- Consumes: nothing new. Produces: on the viewer's seat in stack layout a root `data-me="true"` keeping `role="group"` and its name; a hand wrapper `[data-fan="2"|"3"|"none"]`; a strip `.meStrip` 44 px (56 px at showdown) with the avatar disc (timer ring, D), name, stack, `.bet`, Chủ phòng badge, `RankLabel`, state badge; CSS variables `--fan-card: clamp(52px, 15vw, 60px)`, `--fan-overlap: 14px`, `--fan-lift: 30px`.

- [ ] **Step 1: Red** — `Seat.test.tsx`: "the viewer's stack seat fans two or three cards and never a peel hand" (`data-fan`), "the strip keeps the timer ring, the dealer button, the street bet and the host badge, and drops Bạn and the caption"; raw-CSS tests "the fan rotates ±7° for two cards and ±9° for three, overlaps 14 px and lifts 30 px over the felt", "the stack felt gives the fan 30 px of padding", "chip tags are 11 px and the chip bet is 12 px on the phone", "stack cards are clamp(52px, 15vw, 60px) and community cards clamp(40px, 11vw, 48px)". Run → FAIL.
- [ ] **Step 2: Implement** per spec §3.1 and R1/R10. The fan is pure CSS (`transform: rotate()` on each card, `transform-origin: 50% 100%`), no animation.
- [ ] **Step 3: Green** — ui-kit tests, typecheck, eslint.
- [ ] **Step 4: Playground shots** at 375×812 and 390×844: `#worst/turn/6/vi`, `#worst/turn/9/vi` (8 opponents: no scroll, cards ≥ 52 px), `#worst/blindS/6/vi` (peel row, Lật pill), `#worst/result/6/vi`; measure and write the numbers into the ledger; save `T3-*.png`.
- [ ] **Step 5: Commit** `feat(ui-kit): on a phone my cards fan out over the felt's foot and my seat is a one-line strip, and the smallest table text is 11 px`.

### Task 4: `RoomScreen` — stack header ⋯, the dock between hands, tray width 980, wider desktop seats

**Files:**
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx` (measure stack with `useMediaQuery(STACK_QUERY)`; pass `layout`; stack: compact header with the ⋯ menu, no `.controls` row, a `.dock` group "Điều khiển bàn" between hands), `packages/ui-kit/src/table/frame.ts` (export `STACK_LAYOUT_QUERY` and reuse it in `PokerTable.tsx:76`), `packages/ui-kit/src/screens/screens.module.css` (`.dock` for stack, `.roomFoot` max-width 980 + centred), `packages/ui-kit/src/table/table.module.css` (`.tray`/`.controls` `max-width: min(980px, 100%)`; ring seat width `max(15%, 132px)` / `max(13%, 118px)` under `@media (min-width: 1024px)`; others' caption hidden from 7 seats), `RoomScreen.test.tsx`, `PokerTable.test.tsx`, `packages/ui-kit/src/table/geometry.test.ts` (unchanged unless a width assertion exists)

**Interfaces:**
- Consumes: Task 2's `layout` prop and tray contents; Task 3's strip. Produces: `STACK_LAYOUT_QUERY = '(max-width: 767px), (max-height: 620px)'`; in stack the room root carries `data-layout="stack"`; the dock is `role="group"` named `room.controls` ("Điều khiển bàn") and holds Sẵn sàng / Hủy sẵn sàng, Bắt đầu (host), the status line "N/M sẵn sàng · 0:12"; the ⋯ menu (`room.more`) in the header with Đứng dậy, Tạm nghỉ / Chơi tiếp (checkbox), Quản lý bàn, Toàn màn hình.

- [ ] **Step 1: Red** — `RoomScreen.test.tsx`: "stack between hands shows the dock, not the tray"; "stack in a hand shows the tray and no Điều khiển bàn row, and the header menu holds Đứng dậy, Tạm nghỉ, Quản lý bàn"; "a spectator has no footer in the stack layout"; "the desktop ring keeps the controls row and has no header menu"; raw CSS: "the tray and the controls row are capped at 980 px and centred", "desktop ring seats are at least 132 px wide (118 px from 7 seats) and others' captions hide from 7 seats". Run → FAIL.
- [ ] **Step 2: Implement.** Keep the landscape branch as is (it already has the menu and dock); the stack branch reuses those two pieces.
- [ ] **Step 3: Green** — ui-kit tests, typecheck, eslint; `corepack pnpm -r run typecheck` (Lite compiles).
- [ ] **Step 4: Real-build screenshots** — `pnpm build:normal`, throwaway `zz-preview.spec.ts` with one account: 375×812 waiting (dock), turn, panel open, result, Blind peel; 390×844 turn; 915×412 and 855×319 panel open; 768×1024 result with 6 showdown rows (P13 check: `data-more` shows, card ≤ 70 % of the viewport, Đóng visible — record the numbers; fix only if wrong); 1366×768 and 1920×940 with 9 seats and long names (P7, P10: tray ≈ 980 px). `expectNoTextOverlap` on each. Save `T4-*.png`; delete `zz-preview`.
- [ ] **Step 5: Commit** `feat(ui-kit): the phone room keeps its controls in a header menu and a dock between hands, the desktop tray stops at the felt's width, and desktop seats are wide enough for a name`.

### Task 5: e2e, ops, docs

**Files:**
- Modify: `apps/normal-web/e2e/normal.spec.ts` (375×812 block 660-705: tray ≤ 64 px idle, my cards ≥ 52 px, five `expectNoTextOverlap` states incl. panel open; Sẵn sàng/Bắt đầu via the dock; `sitOutAndPlay` via `openRoomMenu` on the phone), `apps/normal-web/e2e/support.ts` (`openRoomMenu` works when the menu is in the stack header), `apps/lite/e2e/lite.spec.ts:371` (@mobile via the dock), `apps/normal-web/e2e/ops/ops-helpers.ts` (`autopilot` unchanged; add `openBetPanel(page)` + `setBet(page, amount)` using `fill` on the slider), `07-landscape.spec.ts` L-04 (slider instead of the dialog: set 600 → "Tố 600"), L-06 (+ panel open at 855×319, clear of my cards), new `09-phone.spec.ts` with **`M-01 the phone table: one-row tray, fanned cards, the bet panel and the header menu @mobile`** (title verbatim), `02-lobby-rooms.spec.ts` / `04-blind.spec.ts` (Task 1 numbers, if not already)
- Modify docs: `docs/operation-test-plan.md` (section M "Điện thoại dọc" with M-01; L-04/L-06 rows updated; "Cả bảy ca" for L), `docs/test-matrix.md` (`## BP-31` section, 4 rows: stack layout, the slider, the 10× limit, M-01), `tooling/arch/acceptance-links.test.ts` (matrix `+ 4`), `CLAUDE.md:63` (56 cases) and `:68-69` (matrix sum `… + 3 + 3 + 2 + 4`), `docs/ui-kit.md` (ActionBar/BetPanel, the stack layout, `layout` prop), `docs/player-guide.md:27,223,333,451` (tray, slider, no ✎), SRS §27.1 (replace with spec §8), `docs/known-limitations.md` (touch slider drag untested on real phones; chips 36 px; 9-seat desktop width ruling), `docs/ui-review-2026-10-22.md` (P1, P7, P10, P13 marked "BP-31"), `CHANGELOG.md` (`## BP-31 — … — merged \`MERGE\` (2026-10-23)` with rulings R1–R12 and the implementers', deviations, "Still open": P3/P5/P8/P9…)

**Interfaces:**
- Consumes: Tasks 1–4. Produces: ops count 56; matrix `43 + 10 + 4 + 7 + 5 + 8 + 3 + 5 + 5 + 3 + 3 + 2 + 4`.

- [ ] **Step 1:** `pnpm build:normal`; run `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "L-04|L-06|M-01|02-|04-"` → green; `pnpm e2e:normal` → 24 green; `corepack pnpm --filter @bp/lite e2e` after `pnpm build:lite` (exit 1 on Node 24 is tolerated; run the Lite e2e only if the build produced `release/lite`).
- [ ] **Step 2:** docs as listed; `corepack pnpm exec vitest run --root . tooling/arch` → green; read a Vietnamese heading of `operation-test-plan.md` and `player-guide.md` back.
- [ ] **Step 3: Commit** `test(e2e), docs: the ops pack drives the phone tray and the slider, the guides describe them, and the Blind limit reads ten wagers everywhere`.

### Task 6: Final review, gate, merge, deploy, report

- [ ] Whole-branch review (opus) with every screenshot opened → one fix wave → re-review.
- [ ] Merge `main` if it moved; full gate per CLAUDE.md §3 in order, logs in the scratchpad; report the numbers.
- [ ] Merge `--no-ff` into `main` (`Merge feature/BP-31-phone-table-bet-slider: …`), docs commit with the hash (CHANGELOG `MERGE`, bug log, ui-review), `docs/lessons-learned.md` rulings + lessons.
- [ ] Deploy VPS without waiting for the push: `git bundle create <scratch>/bp31.bundle origin/main..main`, `scp` to the VPS `/tmp`, on the VPS `./backup.sh`, health rooms 0, `git pull --ff-only /tmp/bp31.bundle main`, `docker compose up -d --build`, health ok; CHANGELOG deploy line. Lite: rebuilt locally, not shipped.
- [ ] One report: what shipped, gate numbers, every ruling, deviations, residuals, what the user checks by hand (real-phone slider drag, both orientations).
