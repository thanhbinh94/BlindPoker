# Plan 17 — Review round 2 notes (R2-1 … R2-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four notes the Plan 16 final review left open (bug-log §7, R2-1 … R2-4). The user said "fix luôn R2-1 đến R2-4" on 2026-10-01.

**Architecture:** Bounded fixes in existing flows. The tray line in `ActionBar` and the history line in `ProfileScreen` change only their wording. `HandResult` moves its live region inward, and `RoomScreen` measures the viewer's own seat so the result card stops above it. The viewer's own name plate is allowed to widen. One e2e case fills the lobby by patching the `ROOM_LIST` frames of the WebSocket. There is no protocol change, no schema change and no server change.

**Tech Stack:** TypeScript, React 18.3, CSS modules, Vitest + Testing Library, Playwright 1.62.1 (`page.routeWebSocket`, available since 1.48).

**Pre-flight review (2026-10-01):** an independent review checked every reference against the code. It found no blockers and returned 16 amendments (7 important), all folded into this version. The main ones:
- a bot chip keeps a mark that is not colour alone;
- the clearance goes through overlay padding, with its hook above `RoomScreen`'s early return;
- the measured seat positions put the phone in tier 3;
- the ops pack is added to Task 4;
- the busy lobby replaces the room list outright;
- a Hold'em run-out line is added to the tray.

**Spec / source of truth:**
- `docs/bug-log.md` §7, table "Ghi nhận từ final review Plan 16" (R2-1 … R2-4 and their directions).
- The Plan 16 plan (`docs/superpowers/plans/2026-09-30-plan16-review-round-1.md`, risk R13) and `docs/ui-kit.md` ("The text-overlap rule", the HandResult countdown paragraph ~218).
- Screenshots of the three R2-3 symptoms from the Plan 16 run: `C:\Users\LATHAN~1\AppData\Local\Temp\claude\D--Work-Other-Project-bind-poker\b95031d2-6e1b-411e-828e-633a4ee5bc04\scratchpad\plan16-shots\task-8\after-room-result-{1280x720,1366x768,1920x940,375x812}.png` and `after-room-inhand-{1280x720,1366x768}.png`.
  - The tray reads "Đang chờ đến lượt bạn" under a finished hand.
  - The own plate reads "Tam…" / "Tam6…".
  - The card hides the own seat.

**Executed and merged (`f6fe2f3`, 2026-10-01).** Changes from this text:
- **Lobby ticket (fix wave).** The busy-lobby check found a real 3 px overflow, so the lobby ticket head was changed: the name wraps beside the badge, is clamped to two lines, and carries `title`.
- **Name line height.** The clamped name uses line-height 1.3 with a 0.1em top pad; 1.15 clipped descenders.
- **Scrim.** It is painted in the overlay's content box as a 70 %×50 % ellipse, so it follows the card.
- **Clearance hook.** It also takes the viewer's seat as a dependency.
- **Phone tiers.** 375×812 with touch is tier 3 by 1 px. 390×844 is tier 2, and 412×915 is tier 1.

## Global Constraints

- **Worktree.**
  - Work only in `D:\Work\Other Project\bind-poker\.worktrees\plan17`, branch `plan17/review-round-2`.
  - Never touch the main checkout, and never merge or push.
  - Never open a real `.env`, and never stop or start the user's LAN host on :8080.
- **Shell.** In Bash, run `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm.
- **Editing files.**
  - Edit files with Edit/Write only, never with Bash heredocs or `node -e "…"`.
  - Keep each file's line endings and encoding.
- **Lint and locales.**
  - Lint `react/jsx-no-literals` (no bare JSX text) with `--max-warnings=0`.
  - The vi and en locale key sets stay identical: `packages/ui-kit/src/i18n/locales/{vi,en}/*.json` and `apps/normal-web/src/locales/{vi,en}/normal.json`.
- **Accounts.** The default e2e suite may not register more accounts: the server allows 10 sign-ups per minute per IP, and the suite already uses about 9. New browser checks ride on an account a test already signed in.
- **Test citations.** Tests cited in `docs/test-matrix.md` or `docs/acceptance-checklist.md` keep their titles. Otherwise every citation is updated in the same commit (`tooling/arch/acceptance-links.test.ts`).
- **The user's screen** is **1920×940**. "Desktop" means 1920×940. The room is also held to `ROOM_SCREENS` (1920×940, 1536×730, 1280×720, 1366×768), and the phone is 375×812.
- **Visual proof for every task that changes a screen.**
  - Run `pnpm build:normal`, then screenshot the real build with a throwaway Playwright spec (`apps/normal-web/e2e/zz-preview.spec.ts`, deleted before commit) against the e2e server.
  - Save the PNGs under `D:\Work\Other Project\bind-poker\.superpowers\sdd\2026-10-01-plan17-review-round-2-notes\shots\task-N\` (git-ignored) as before/after pairs, and list them in the report. Reviewers open them.
  - Viewports: 1920×940, 1366×768, 1280×720, 375×812.
  - A change to a component Lite shares (`ActionBar`, `HandResult`, `RoomScreen`, `Seat`) adds one Lite screenshot (`pnpm build:lite`, Lite e2e server).
  - Run the preview spec **on its own** (`playwright test zz-preview`) and delete it before the full-suite gate. Its sign-ups count toward the 10-per-minute limit.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Green bar.**
  - Every task ends green on `pnpm typecheck`, `pnpm lint` and `pnpm test`.
  - UI tasks also run `pnpm build:normal` and `pnpm e2e:normal`.
  - Tasks touching shared ui-kit table code also run `pnpm build:lite` and `pnpm --filter @bp/lite e2e`.
  - Task 3 also runs the ops pack: `pnpm --filter @bp/normal-web e2e:ops`, port 8093, throwaway PGlite, about 20 minutes.
- **Order.** Tasks run strictly one after another: T3 and T4 share `HandResult`/`RoomScreen`/`table.module.css`, and T4's e2e uses the result-card locator that T3 changes.

## Risk register

| # | Risk | Where | Mitigation built into the plan |
|---|---|---|---|
| R1 | The tray line is wrong in a state nobody listed | T2 | One pure function decides the line. A table-driven unit test covers every branch, both languages for one branch, and the unchanged Hold'em "waiting for your turn". |
| R2 | Clearing the own seat squeezes the result card below usefulness on short stages | T4 | Two tiers (whole seat block, then from the plate down) and a floor (`MIN_CARD`). Below the floor the card covers the stage as today. The measured space is ledgered at every viewport, and screenshots cover all four room sizes plus the phone. |
| R3 | The card jumps after it appears (measured after paint) | T4 | Measure in `useLayoutEffect` (before paint), re-measure through `ResizeObserver` on the stage and the seat and on `document.fonts.ready` |
| R4 | The widened own plate runs into a neighbour | T4 | The cap is computed from `geometry.ts` per seat count (see Task 4). The e2e overlap rule runs at 6 seats, and a playground screenshot covers 9 seats with a 30-character own name. |
| R5 | Moving `role="status"` breaks the result-card locators | T3 | Normal e2e, Lite e2e and the ops pack locate the card as a named group; all three change in one commit and all three suites run |
| R6 | A screen reader no longer hears the fee / carry-over / uncalled lines when the card appears | T3 | Ruled and documented. These lines stay in the card and are read on navigation. The countdown row keeps its one-line layout, and the alternative costs a line on a card Task 4 already shortens. |
| R7 | The busy-lobby test drifts from the protocol or flakes | T5 | Fixtures are typed `RoomSummary` from `@bp/core`. Only `ROOM_LIST` frames are patched: their `rooms` are **replaced** by six fixed rooms, so real rooms from earlier tests cannot change the count. The route is set before a reload, at the end of an existing test. `connectToServer` opens the real socket from inside the page, so the session cookie and Origin are the page's own (pre-flight verified). |
| R8 | The "already says Bàn" check misses casing or Unicode forms | T1 | NFC plus locale lower-casing, with tests for "BÀN VIP", an NFD "Bàn", "Bàn123" (no match) and the English "Table 5" |
| R9 | Lite shares `ActionBar`, `HandResult`, `RoomScreen` and `Seat` | T2–T4 | Lite e2e is green, plus one Lite result-card screenshot |
| R10 | Deploy while people play | controller | Deploy only after the full gate; restart the LAN host only when `/health` shows `rooms: 0` |

---

### Task 1: Hand history — no doubled "bàn", no doubled "bot" (R2-2)

**Files:**
- `apps/normal-web/src/screens/ProfileScreen.tsx` (~430-460, the history rows).
- `apps/normal-web/src/locales/{vi,en}/normal.json` (`profile.history`).
- `apps/normal-web/src/screens/ProfileScreen.test.tsx` (~215-255).
- `apps/normal-web/src/screens/normal.module.css` (`.seatChip` ~856).
- `docs/operation-test-plan.md` K-04 (it quotes "Tại bàn `<tên phòng>`").

**Now:**
- A room named "Bàn 123" prints "Tại bàn Bàn 123".
- A bot opponent prints "Bot 5" and then a muted "bot" badge.

**Target:**
- **Table line.** When the room name's first word already is the table word of the page's language, the line reads **"Tại {{name}}"** (en **"At {{name}}"**). Otherwise it reads "Tại bàn {{name}}" as today.
  - The table word is a locale key, `profile.history.tableWord`: vi `"bàn"`, en `"table"`.
  - "First word" means `name.normalize('NFC').trim().split(/\s+/u)[0].toLocaleLowerCase(lang)`. Compare it with `t('profile.history.tableWord').normalize('NFC').toLocaleLowerCase(lang)`.
  - Examples: "Bàn 123" → "Tại Bàn 123"; "BÀN VIP" → "Tại BÀN VIP"; "Bàn" → "Tại Bàn"; "Bàn123" → "Tại bàn Bàn123"; "123" → "Tại bàn 123". In en: "Table 5" → "At Table 5", "Bàn 5" → "At table Bàn 5".
  - New key `profile.history.tableNamed` = "Tại {{name}}" / "At {{name}}".
- **Bot chips.**
  - A bot seat's chip shows its label, then `<span className="visually-hidden">{t('profile.history.bot')}</span>`. That is the global class in `packages/ui-kit/src/theme/global.css` ~119; check its exact name there.
  - The visible "bot" badge goes. The label already reads "Bot n", and the badge made it read "Bot 5 bot".
  - A human may also be called "Bot 5": no names are reserved. So the bot chip keeps a mark that is **not colour alone** (project rule: `table.module.css` ~764, `Toasts.tsx` ~24, `docs/ui-kit.md` ~183):
    - `data-bot="true"` on the chip;
    - `.seatChip[data-bot='true'] .seatName { font-style: italic; color: var(--ink-muted); }`;
    - the visually hidden word for screen readers.
  - **Keep** the `profile.history.bot` key (vi and en).

- [ ] Failing tests in `ProfileScreen.test.tsx`:
  - The seven naming examples above, in vi and en. Extend `renderScreen(api, lang = 'vi')` (~129-130) to pass both the `lang` prop and `makeI18n(lang)`; the prop drives `toLocaleLowerCase(lang)`.
  - Exactly one "Tại …" line per row.
  - A bot chip:
    - shows "Bot 5";
    - carries `data-bot="true"`;
    - contains a visually hidden "bot";
    - has no *visible* element whose text is exactly "bot".
  - Update the assertion at ~216 that expects the visible badge.
  - A human chip has no `data-bot`.
- [ ] Run them, see them fail. Implement. Green: focused run, then `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [ ] `docs/operation-test-plan.md` K-04: the expected text becomes "Tại bàn `<tên phòng>`" (or "Tại `<tên phòng>`" when the name already starts with "Bàn"); bots show "Bot 1", "Bot 2" … in italics, without a visible "bot" badge.
- [ ] Visual proof: `pnpm build:normal`, then Profile → "Ván gần đây" at 1920×940 and 375×812 after one Blind hand with bots, in a room named "Bàn …". Before and after.
- [ ] Commit `fix(profile): history says "Tại Bàn 123", not "Tại bàn Bàn 123"; bot chips drop the doubled badge (R2-2)`.

### Task 2: The tray says what the seat is waiting for (R2-3, first part)

**Files:**
- `packages/ui-kit/src/table/ActionBar.tsx` (~101-125).
- `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` (`labels`).
- `packages/ui-kit/src/table/ActionBar.test.tsx`.
- `docs/ui-kit.md` (the ActionBar paragraph, if it quotes the line).

**Now:** whenever the seat has no legal action (`legal === null`), the tray prints "Đang chờ đến lượt bạn". That includes a finished hand whose result card is held, a folded seat, an all-in seat and a Blind seat that has already decided.

**Target:** one pure function, exported for the test, picks the key. Check the conditions in this order:

| # | Condition | Key | vi | en |
|---|---|---|---|---|
| 1 | `hand.phase === 'COMPLETE'` | `labels.handOver` | Ván đã kết thúc | Hand over |
| 2 | own seat `folded` | `labels.waitFolded` | Bạn đã bỏ bài — chờ ván sau | You folded — waiting for the next hand |
| 3 | own seat `allIn` | `labels.waitAllIn` | Bạn đã tất tay — chờ kết quả | You're all in — waiting for the result |
| 4 | Blind, `phase === 'DECISION'`, own seat `hasDecided` | `labels.waitDecided` | Đã chọn — chờ các ghế khác | Decided — waiting for the others |
| 5 | Blind, `phase === 'DECISION'`, not decided (brief: its legal action is on its way) | `labels.waitingForTurn` | (unchanged) | (unchanged) |
| 6 | Blind, any other phase (in practice `REVEAL`; decision mode `none` never enters `DECISION`) | `labels.waitReveal` | Chờ lật bài | Waiting for the reveal |
| 7 | Hold'em, `phase === 'REVEAL'`, and fewer than two seats neither folded nor all in (a run-out: no turn is coming) | `labels.waitReveal` | Chờ lật bài | Waiting for the reveal |
| 8 | otherwise (Hold'em between turns) | `labels.waitingForTurn` | Đang chờ đến lượt bạn | Waiting for your turn |

Notes from the pre-flight review:
- The reducer never produces `DEALING` for a real hand. `HAND_STARTED` sets `DECISION` (play-or-fold) or `REVEAL` (`none`) (`reducer.ts` ~58).
- `hasDecided` is set on `DECISION_MADE` (~189-193).
- The function must accept an own seat that is `undefined`, as the tests at `ActionBar.test.tsx` ~32 and ~165 pass it.
- The existing `seated()` helper (~139: only the viewer's seat, phase `BETTING`) must keep "Waiting for your turn" at ~145. Row 7 keys on `REVEAL` for exactly that reason.

- The `<p className={s.trayWait} role="status">` stays, so a change of line is announced once.
- The pre-action and auto-play rows are unchanged.
- Do not reuse the seat badge keys (`labels.folded`, `labels.allIn`, `labels.decided`): those are one-word badges.

- [ ] Failing tests: one per row of the table (build the hand with the existing test helpers), plus row 1 in vi. The two existing "Waiting for your turn" assertions stay (Hold'em between turns).
- [ ] Implement, green: focused run, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
- [ ] Visual proof: the held result state (the `sitOutAndPlay` flow in `normal.spec.ts` section 6) at 1920×940 and 1280×720 shows "Ván đã kết thúc" in the tray. Before and after.
- [ ] Commit `fix(table): the tray says what the seat waits for — hand over, folded, all in, decided (R2-3)`.

### Task 3: The countdown sits outside the result card's live region (R2-4)

**Files:**
- `packages/ui-kit/src/table/HandResult.tsx` and `packages/ui-kit/src/table/table.module.css` (`.result` ~1020, new `.resultLive`).
- `packages/ui-kit/src/table/HandResult.test.tsx` (every `getByRole('status')`, the countdown block ~120-170).
- `packages/ui-kit/src/screens/RoomScreen.test.tsx` ~505-510. It takes the card with `getAllByRole('status')` + the "Winner" heading and asserts `aria-live="off"` on the countdown. Take the card with `getByRole('group', { name: 'Winner' })` instead, and replace the `aria-live` assertion with the no-live-ancestor check.
- The only e2e definitions of the card locator are `apps/normal-web/e2e/normal.spec.ts` ~131, `apps/normal-web/e2e/ops/ops-helpers.ts` ~267 and `apps/lite/e2e/lite.spec.ts` ~122 (grep-verified); every other use goes through them. `expectCountdownOnTheCard` is at `normal.spec.ts` ~164.
- **Leaving the old locators in place would fail silently.** `[role="status"]` filtered by the heading would still match the inner live region, but the footer is outside it. Then `feeOn` (ops-helpers ~271) reads 0, the ops `04-blind` `cardText` (~153) loses "Hoàn lại phần cược dư", and the fee read in `normal.spec.ts` ~285 reads 0.
- `docs/ui-kit.md` (~218).

**Now:**
- The card's root is `role="status"`, and the countdown ticks inside it in a `<p aria-live="off">`.
- The WAI-ARIA rules make that nested "off" win, and Chromium honours it. Nobody has checked NVDA or JAWS, and there is no screen reader in this environment to check with.

**Target (ruling): make it structural, so it holds whatever the screen reader does.**
- **Root:** `<div className={s.result} role="group" aria-labelledby={titleId}>`. `titleId` comes from `useId()`, called **before** the component's early `return null`.
- **Live region:** `<div className={s.resultLive} role="status">` wraps the head (title + Close), the cancel note and the scrolling body (rows and pot ledger).
- **Footer:** `.resultFoot` (fee, carry-over, uncalled return, countdown) follows as the root's last child, **outside** every live region.
  - The countdown `<p className={s.resultNext}>` loses its `aria-live` attribute; it needs none now.
  - Update the prop comment (~17-23) and `docs/ui-kit.md` ~218 to say so.
- **CSS:** `.resultLive { display: flex; flex-direction: column; gap: var(--space-3); flex: 0 1 auto; min-height: 0; }`. The body keeps `flex: 0 1 auto; min-height: 0; overflow-y: auto`. `useMoreBelow` is unchanged.
  - The card must look the same as before: compare the before/after screenshots.
- **Cost (ledger it):** the fee, carry-over and uncalled lines are no longer part of the announcement when the card appears. They stay on the card and are read on navigation. The alternative was the countdown on its own row, which adds a line to a card that Task 4 shortens on 1280×720.

- [ ] Failing tests (`HandResult.test.tsx`):
  - The card is a `group` named by its title.
  - The one `status` inside it contains the title and the rows.
  - The countdown and the fee text have no ancestor matching `[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]`.
  - With no countdown there is no `.resultNext`.
  - Adapt every other test that took the card from `getByRole('status')`; their assertions stay.
- [ ] E2E locators, all three suites in this commit: `resultCard(page)` = `page.getByRole('group', { name: /^(Người thắng|Những người thắng|Ván bị hủy)$/ })`.
  - Lite renders the same `HandResult` and its e2e runs in `vi-VN` (Lite `playwright.config.ts` ~30), so the same regex works.
  - `expectCountdownOnTheCard` replaces the `aria-live="off"` assertion with: the countdown is visible on the card, and `next.evaluate(el => el.closest('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]') === null)` is `true`.
  - The other two checks stay: it is not a row, and it is not inside the fee text.
- [ ] Green:
  - Focused run, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  - `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
  - **The ops pack** (`pnpm --filter @bp/normal-web e2e:ops`).
- [ ] Visual proof: the result card counting down at 1920×940 and 1366×768, before and after; they must match. Add one Lite result screenshot.
- [ ] Commit `fix(table): the result card's live region stops short of the countdown (R2-4)`.

### Task 4: The viewer's own seat stays in sight (R2-3, second and third parts)

**Files:**
- `packages/ui-kit/src/table/Seat.tsx` (root and plate attributes).
- `packages/ui-kit/src/table/table.module.css` (`.ring .seatMe …` ~625-635).
- New `packages/ui-kit/src/screens/seat-clearance.ts` and `seat-clearance.test.ts`.
- `packages/ui-kit/src/screens/RoomScreen.tsx` (`<main>` ref, overlay custom property) and `packages/ui-kit/src/screens/screens.module.css` (`.overlay` ~118-132: padding rule and comment).
- `packages/ui-kit/src/screens/RoomScreen.test.tsx`, and `packages/ui-kit/src/table/PokerTable.test.tsx` for `data-me` (there is no `Seat.test.tsx`).
- `apps/normal-web/e2e/support.ts` (two new helpers, plus one shared seat-walk `evaluate` helper) and `apps/normal-web/e2e/normal.spec.ts` section 6 (calls).
- `packages/ui-kit/playground/scenarios.tsx`: an optional fifth hash segment `/long` on `#worst/<state>/<seats>/<lang>` (~10-45) that sets a 30-character own name. Do not edit `NAMES[0]` (21 characters): existing playground measurements depend on it.
- `docs/ui-kit.md` (room / seat sections).

#### (a) The own name is not cut short

**Root cause:** on the ring a seat is `max(--seat-w 15 %, 104 px)` wide, and the plate fills it. At 1280×720 the table is about 658 px wide, so the plate is 104 px. After the 40 px disc, gaps and padding, about 44 px is left for the name: "Tam6z80" prints as "Tam…". Bots fit only because "Bot 4" is short and bots show no stack.

**Target:** the viewer's own plate widens to its content, within a cap measured from the neighbours:
- CSS: `.ring .seatMe .plate { width: max-content; min-width: 100%; max-width: var(--seat-plate-max, 30cqw); }`.
- `.ring:is([data-seats='7'], [data-seats='8']) .seatMe { --seat-plate-max: 26cqw; }` and `.ring[data-seats='9'] .seatMe { --seat-plate-max: 22cqw; }`.
- The plate is a flex item centred in the seat's column, so it grows evenly both ways. A longer name than the cap still ends in "…".

The caps come from `geometry.ts`: the own seat is at x = 50 %, y = 88 %. The table below uses the bottom neighbours' positions, taken on the smallest ring (480×240, `min-height: 15rem`) where the plate floors weigh most:

| Seats | Neighbour x | Neighbour's inner edge | Own plate span | Gap at 480 px |
|---|---|---|---|---|
| ≤ 6 | 17.9 % | its lines (≤ 30cqw) reach 32.9 %; its plate (104 px floor) reaches 28.7 % | 35–65 % | ≈ 10 px |
| 7 | 22.2 % | 94 px plate floor → 32.0 % | 37–63 % | ≈ 24 px |
| 8 | 25.5 % | 35.3 % | 37–63 % | ≈ 8 px |
| 9 | 28.2 % | 38.0 % | 39–61 % | ≈ 5 px |

Opponents' plates are unchanged. The own plate on the phone (`.mine .seat`, 340 px) is outside the `.ring` rules and is not truncated.

#### (b) The result card stops above the own seat

**Root cause:** `.overlay` is `inset: 0` over the whole stage and centres the card. On a short stage the card reaches the bottom seat and covers it. At ≤ 1366 px it covers it entirely; at 1920×940 it covers the plate and leaves only the badges.

**Target:** the card's stage ends above the own seat, when that leaves the card enough room.
- **Markers.** `Seat` marks the viewer's own seat root with `data-me="true"` and its plate with `data-plate=""`. These attributes are the hook's contract, not CSS module class names.
- **Pure function** in `seat-clearance.ts`:

  ```ts
  export const CLEARANCE_GAP = 8
  /** The overlay height above the seat that the card needs: title, one full row and the footer (≈ 184 px of card) plus the overlay's own 2 × 16 px padding. */
  export const MIN_CARD = 216
  /** How far up from the stage's bottom edge the result card's stage must stop, or null to use the whole stage. */
  export function clearanceFor(stage: DOMRect, seat: DOMRect | null, plate: DOMRect | null): number | null
  ```

  The rule has three tiers:
  1. If `seat.top − stage.top − GAP ≥ MIN_CARD`, return `stage.bottom − seat.top + GAP`. This clears the whole seat block: cards, plate and lines.
  2. Else if `plate.top − stage.top − GAP ≥ MIN_CARD`, return `stage.bottom − plate.top + GAP`. This clears the plate and the lines under it; the card may lie over the top of the own hole cards, which the card's own row repeats.
  3. Else return `null` (as today).

  Also return `null` when there is no seat (a spectator), and clamp the result to ≥ 0. Never lower `MIN_CARD` below 216.
- **Hook** `useSeatClearance(stageRef, active)` in the same file:
  - While `active`, it measures in `useLayoutEffect` (before paint).
  - It re-measures on a `ResizeObserver` over the stage and the own seat element. Re-query `[data-me="true"]` on every measurement and re-observe it, because a ring↔stack switch replaces the element.
  - It also re-measures on `document.fonts?.ready`, ignoring a resolution that arrives after unmount or deactivation.
  - Where `ResizeObserver` is undefined (jsdom), measure once. This is the same guard as `useMoreBelow` in `HandResult.tsx` ~50; without it every RoomScreen and Lite test that shows a card crashes.
  - It returns the number or `null`. When not active it returns `null` and observes nothing.
- **RoomScreen:**
  - Call the hook **above the early `if (room === null) return null`** (~105); `rules-of-hooks` is an error here. Work out `active` there from the state, not from `resultCard` (computed after the return): `active = room !== null && state.hand?.phase === 'COMPLETE' && state.hand.result !== null && state.hand.handId !== dismissedHandId`.
  - Add a ref on `<main className={s.roomMain}>`.
  - The overlay keeps `inset: 0`, so its scrim still reaches the bottom of the stage. Use padding, not `bottom`: RoomScreen sets `style={{ '--seat-clearance': `${clearance}px` }}` (typed as `CSSProperties`), and CSS sets `.overlay { padding-bottom: calc(var(--space-4) + var(--seat-clearance, 0px)); }`. Setting `bottom` would cut the radial scrim off in a hard horizontal edge just above the seat.
  - Update the `.overlay` comment: the stage is the felt's box minus the viewer's seat when there is room.
- **Expected tiers.** Measured by Plan 16 in the held result state with six seats (`plan16-shots/task-8/after-measurements.json`), as `seat.top − stage.top`:

  | Viewport | `seat.top − stage.top` | Tier |
  |---|---|---|
  | 1920×940 | 409 | tier 1 |
  | 1536×730 | 257 | tier 1 |
  | 1366×768 | 291 | tier 1 |
  | 1280×720 | 248 | tier 1 (card ≈ 208 px) |
  | 375×812 | 174 | tier 3 |

  - On the phone (375×812) the card still covers the viewer's seat as today, and the user can close it. State this in the report and in `docs/ui-kit.md`.
  - Re-measure on the real build after the change and put the numbers in the report.

- [ ] Failing unit tests:
  - `clearanceFor`: each tier, a spectator (`null` seat), the tier boundaries (exactly `MIN_CARD`) and the clamp.
  - `RoomScreen.test.tsx`: with `getBoundingClientRect` stubbed for the stage and the `[data-me]` seat, the overlay carries `--seat-clearance` while a result card is shown. It carries none for a spectator, and none once the card is dismissed.
  - `PokerTable.test.tsx`: `data-me="true"` only on the viewer's seat, and `data-plate` on its plate.
- [ ] Failing e2e (`support.ts` helpers, called in `normal.spec.ts` section 6):
  - **Shared walk.** Move the plate-and-text-runs walk of `expectMySeatLines` (support.ts ~277-308, a closure inside `page.evaluate`) into one shared helper that both checks use.
  - `expectMyNameWhole(page, who, state, viewports = ROOM_SCREENS)`: the own seat's name element (`getByRole('group', { name: /^Ghế \d+$/ })` filtered by `getByText(who, { exact: true })`) has `scrollWidth ≤ clientWidth` at every size. Call it "in hand" and in "the result card". The e2e display names are ≤ 12 characters; long names are covered by the playground screenshot.
  - `expectCardClearsMySeat(page, card: Locator, who, viewports = ROOM_SCREENS)` (`resultCard` lives in `normal.spec.ts` ~129, so the card is passed in), in the held result state, at every size:
    - The card's box does not intersect the own plate's box or any text run under it.
    - The card is at least `MIN_CARD − 32` px tall and its title is inside the viewport, so an oversized clearance cannot pass.
    - Measure after each resize inside `expect.poll`, or after two `requestAnimationFrame`s as `overflowOf` does: the ResizeObserver update lands a frame or more after the resize.
    - Each size is measured before anything fails, and the page's own viewport is restored.
    - Never run it at 375×812 (tier 3).
  - The existing `expectRoomFits`, `expectMySeatLines` and overlap calls stay.
- [ ] Implement, green:
  - Focused runs, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  - `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
  - **The ops pack** (`pnpm --filter @bp/normal-web e2e:ops`). It is the only suite with side-pot cards and longer display names, and it runs the text-overlap rule on Hold'em result cards at 1440×900, 1920×940 and 1366×768 (test-matrix ~118-119).
- [ ] Visual proof, before and after:
  - Normal, six seats, in hand and held result, at 1920×940, 1536×730, 1280×720, 1366×768 and 375×812.
  - The ui-kit playground (`pnpm --filter @bp/ui-kit playground`, 5175) with 9 seats and 6 seats and the `/long` own name, at 1920×940, 1280×800 and the smallest ring (e.g. 1280×630). The own plate is widened and capped, and it touches no neighbour.
  - One Lite held-result screenshot at 1920×940.
- [ ] Commit `fix(table): the viewer's own name shows whole and the result card stops above their seat (R2-3)`.

### Task 5: A busy lobby in the browser suite (R2-1)

**Files:**
- `apps/normal-web/e2e/support.ts` (new `withBusyLobby`) and `apps/normal-web/e2e/normal.spec.ts` (a new last section of the Blind test that ends in the lobby, after section 6 leaves the room ~397).
- `docs/test-matrix.md` ~110 (the lobby-fits row): add "and a lobby of six rooms (patched `ROOM_LIST`)".

**Now:** `expectPageFits(page, 'the lobby')` runs with 0–1 rooms. Since No3 a bots-only room closes at once, so a layout bug that only shows in a busy lobby would slip through. With six rooms the lobby already fits 1920×940: the Plan 16 screenshot shows six tickets in three rows ending at y ≈ 880.

**Target:** six rooms of every kind in the lobby, checked for fit and for text over text. There are no new accounts and no server changes.
- **Setup:** `withBusyLobby(page)` calls `page.routeWebSocket(/\/ws$/, ws => { const server = ws.connectToServer(); server.onMessage(m => ws.send(patch(m))) })`, then `page.reload()` and waits for the lobby. Page-to-server forwarding is the default once `connectToServer` is called. The route only applies to sockets opened after it, hence the reload.
- **`patch`:** parse the frame as JSON. If `t === 'ROOM_LIST'`, **replace** `rooms` with exactly the six fixtures below. Pass every other frame through unchanged, including frames that are not JSON. `ROOM_LIST` is plain `{ t, rooms }` with no sequence number, and the reducer replaces the list outright (`reducer.ts` ~317).
- **The six fixtures** are typed `RoomSummary` (`import type { RoomSummary } from '@bp/core'`, which already resolves from the e2e tsconfig). Start from `packages/ui-kit/src/test-fixtures.ts` ~101 (`lobbyRooms`). All six have `isPrivate: false`, since only public rooms are listed. Together they cover:
  - Hold'em and Blind (2 and 3 cards; `none` and `playOrFold`). Hold'em blinds come from `ECONOMY.holdemBlindTiers`; Blind allows at most 8 players (`economy.ts` ~20), so the 9-seat room is Hold'em.
  - `OPEN` and `IN_GAME`.
  - One `closing: true` room, which is empty (0/N).
  - One `hasPassword: true`.
  - One 30-character name, the server's maximum (`packages/core/src/protocol/validate.ts:74`).
  - Player counts 1/6, 3/9 and 6/6.
- **Checks:**
  - At 1920×940, six room tickets are visible: `getByRole('button', { name: /^Vào phòng — / })` has count 6 (`RoomList.tsx` ~79).
  - `expectPageFits(page, 'a lobby of six rooms')`.
  - `expectNoTextOverlapAt(page, 'lobby, six rooms', OVERLAP_SCREENS)`.
  - At 375×812, `expectNoSidewaysScroll` and `expectNoTextOverlapDown`.
- [ ] Write it, then show that the new check adds coverage:
  1. Temporarily set `.list { grid-template-columns: 1fr }` (`lobby.module.css` ~13) and rebuild.
  2. The existing `expectPageFits(page, 'the lobby')` (0–1 rooms) still passes.
  3. The six-room check fails.
  4. Revert, and put both outputs in the report.
- [ ] Green: `pnpm typecheck`, `pnpm lint`, `pnpm build:normal`, `pnpm e2e:normal`. Run the spec twice to show it is deterministic.
- [ ] Visual proof: the six-room lobby at 1920×940, 1366×768 and 375×812.
- [ ] Commit `test(e2e): the lobby holds six rooms of every kind without scrolling or overlapping text (R2-1)`.

### Controller wrap-up (not a subagent task)

- Final whole-branch review; one fix wave if needed.
- Update the docs:
  - `docs/bug-log.md` §7: rows R2-1 … R2-4 read "Đã sửa — `<commits>`", merge sha, and short technical notes.
  - `CHANGELOG.md` gets a Plan 17 section.
  - Memory: `bind-poker-project-status.md`.
- Run the master gate after removing the worktree: typecheck, lint, test, `build:normal`, `e2e:normal`, `build:lite` + Lite e2e, and the ops pack.
- Merge `--no-ff`.
- Deploy:
  1. `pnpm build:normal`.
  2. Check that `/health` shows `rooms: 0`.
  3. `deploy/normal-windows/stop.ps1`, then `run.ps1 -NoMigrate`.
  4. Check `/health` again.
- Rebuild the Lite exe locally (not shipped).
