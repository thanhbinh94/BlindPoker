# Plan 16 — Review 2026-09-29, round 1 (bug fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten round-1 findings of the user's 2026-09-29 review (No15, No16, No6, No4, No3, No8b, No12, No17, No11b, No2) without regressing anything else, and add an automated text-overlap rule to the browser suites.

**Architecture:** Mostly bounded fixes in existing flows: the Normal CSP (tinted avatar layers), the auth screen, the history DTO, the room close rule in `@bp/server-kit`, and CSS/layout in `@bp/ui-kit` + `apps/normal-web`. One new test utility (text-overlap detector) is added to the Playwright suites. No schema migration, no protocol change.

**Tech Stack:** TypeScript, React, CSS modules, Vitest + Testing Library, Playwright, Fastify.

**Spec / source of truth:** `docs/bug-log.md` §7 (the user-approved classification, root causes and fix directions), the review note `other/review/20260929/Note.txt` and its screenshots in the same folder. Main product spec `docs/superpowers/specs/2026-09-04-bind-poker-design.md` (§11 room lifecycle).

## Global Constraints

- Work in the plan's worktree only; never touch the main checkout, never merge or push, never open a real `.env`, never stop/start the user's LAN host on :8080.
- Bash: `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm. Edit files with Edit/Write only (never Bash heredocs or `node -e "…"`); keep each file's line endings and encoding.
- Lint `react/jsx-no-literals` (no bare JSX text), `--max-warnings=0`. vi/en locale key sets must stay identical.
- The default e2e suite may not register more accounts (10 sign-ups/min per IP; it already uses ~9). New browser checks reuse existing accounts or go into the ops pack (`apps/normal-web/e2e/ops`, port 8093, throwaway PGlite).
- Tests cited in `docs/test-matrix.md` / `docs/acceptance-checklist.md` keep their titles, or every citation is updated in the same commit (`tooling/arch/acceptance-links.test.ts`).
- **Visual proof is required for every task that changes what a screen looks like:** build (`pnpm build:normal`), then screenshot the real build with a throwaway Playwright spec (e.g. `apps/normal-web/e2e/zz-preview.spec.ts`, deleted before commit) against the e2e server, save PNGs under `D:\Work\Other Project\bind-poker\.superpowers\sdd\2026-09-30-plan16-review-round-1\shots\task-N\` (git-ignored), and list them in the report. Viewports: **1920×960** (the user's PC), **1366×768**, **375×812** (phone), plus any the task names. Reviewers look at these images.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each task ends green on: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Tasks that change UI also run `pnpm build:normal` + `pnpm e2e:normal`; Task 4 and Task 8 also run the ops pack.

## Risk register (read before starting any task)

| # | Risk | Where | Mitigation built into the plan |
|---|---|---|---|
| R1 | Widening the CSP opens more than tinted images need | T1 | Only `img-src` gains `blob:`, only in the Normal edition's `normalCsp`; the exact header string is pinned by a test; `script-src`/`connect-src` untouched; `docs/security.md` records why |
| R2 | A fallback hides a future tint failure | T1 | Fallback renders the plain layer (never a blank head); the e2e asserts the tinted `<img>` really decoded (`naturalWidth > 0`, `src` starts with `blob:`) so a silent fallback fails the test |
| R3 | Closing a bots-only room at once drops a human who is only disconnected, or loses a pot | T4 | A disconnected human is still a member until the spectator grace removes them — the rule counts members, not connections; the carry-over release on close is unchanged (same path as the 60 s timer); unit tests for mid-hand leave, disconnect, carry-over |
| R4 | Ops case C-06 changes meaning (it uses a room with a bot) | T4 | C-06 is rewritten on a room without bots (60 s grace kept, bug 2 decision) and a new ops case covers the bots-only immediate close |
| R5 | Room layout change breaks the phone stacked layout or other viewports | T7 | Screenshot matrix (5 viewports × 3 states); existing mobile e2e (my seat above the tray) must stay green; an e2e assertion pins "no vertical scroll" at the target viewports |
| R6 | The overlap detector is flaky or full of false positives | T8 | Text-vs-text only, compared within one visual layer (base page vs overlays/dialogs/toasts), 2 px tolerance, animations settled first, an explicit `data-overlap-ok` escape hatch that must carry a reason; the suite is run twice in a row to prove determinism |
| R7 | The shared modal footer changes seven dialogs at once (Normal + Lite) | T5 | Screenshot every dialog before/after; existing dialog tests stay green; forms keep native submit (footer class, not a moved button) |
| R8 | History DTO change breaks the client or old rows | T3 | Old rows are handled by parsing the recorded bot label; `api.ts` type, mocks and ProfileScreen tests updated together |
| R9 | CSS-only fixes look right in tests but wrong on screen | T5–T8 | Visual proof rule (Global Constraints); reviewers must open the PNGs |
| R10 | Deploy while people play | controller | Deploy only after the full gate; restart the LAN host only when `/health` shows `rooms: 0` |

---

### Task 1: Tinted avatar layers load again (No15, No16)

**Files:** `apps/normal-server/src/app.ts` (`normalCsp`, `SCRIPT_SRC` comment), `apps/normal-server/src/app.test.ts` (~230-241 CSP assertions), `packages/ui-kit/src/avatar2d/Chibi.tsx` (`ChibiLayer`), its test file (find `Chibi.test.tsx` or the avatar2d tests), `apps/normal-web/e2e/avatar-tint.spec.ts` (~line 47), `docs/security.md` (~line 56), `docs/avatar-2d.md` if it states the CSP.

**Root cause (verified live):** the Normal CSP is `img-src 'self' data:`; `useTintedLayer` renders recoloured layers as `blob:` object URLs (`packages/ui-kit/src/avatar2d/tinted.ts:~88`), which Chrome blocks. A hair colour tints L30/L50/L60 → all blocked → only the outfit remains (No16). An eye colour tints L50 only → blocked → the base's own blue eyes on L30 show through (No15). The e2e passed because `toBeVisible` accepts a broken `<img>`.

- [ ] **Step 1 — failing tests.**
  - `app.test.ts`: the CSP assertion expects the Normal header's `img-src` directive to be exactly `img-src 'self' data: blob:` and every other directive unchanged (pin the full header string the test already pins, with the new token).
  - `avatar-tint.spec.ts`: after equipping a hair colour and an eye colour, for every tinted layer `<img>` on the wardrobe stage assert `src` starts with `blob:` **and** `naturalWidth > 0` (evaluate in the page); assert the same for a seat/portrait chibi if the spec already renders one.
  - Chibi unit test: when the tinted `<img>` fires `error`, the component re-renders that layer with the plain file URL (`srcSet` with 1x/2x), and a new tinted URL (different tint) is tried again.
- [ ] **Step 2 — run, see them fail** (`pnpm --filter @bp/normal-server exec vitest run src/app.test.ts`, the ui-kit test, and `pnpm build:normal && pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts avatar-tint`).
- [ ] **Step 3 — implement.**
  - `normalCsp`: map the `img-src` directive to `${d} blob:` (do not change `DEFAULT_CSP` in `@bp/http-kit`, which Lite also uses; Lite does not tint). Rewrite the `SCRIPT_SRC` comment so it no longer claims there is no `blob:` anywhere: tinted layers are `blob:` images (Plan 13), scripts stay `'self'`.
  - `ChibiLayer`: keep `const tinted = useTintedLayer(base, layer)`; add `const [failedUrl, setFailedUrl] = useState<string | null>(null)`; render the tinted `<img>` only when `tinted !== null && tinted !== failedUrl`, with `onError={() => setFailedUrl(tinted)}`; otherwise the plain two-density `<img>`. (A new tint produces a new URL, so it is tried again.)
  - `docs/security.md`: one paragraph — Normal adds `blob:` to `img-src` for the recoloured avatar layers generated in-page by `tinted.ts`; nothing else accepts `blob:`.
- [ ] **Step 4 — green** on the three commands above, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e:normal`.
- [ ] **Step 5 — visual proof:** wardrobe stage at 1920×960 with (a) "Tóc bạch kim" + "Mắt xanh lá", (b) "Tóc hồng" + "Mắt đỏ", (c) no colours; plus the lobby bar avatar with (a). The head and hair must be present and recoloured, eyes green/red.
- [ ] **Step 6 — commit** `fix(avatar): tinted layers load under the Normal CSP; fall back to the plain layer on error (No15, No16)`.

### Task 2: Auth screen — drop the duplicate switch links (No6)

**Files:** `apps/normal-web/src/screens/AuthScreen.tsx` (~line 289 and wherever the "Chưa có tài khoản? Đăng ký" / "Đã có tài khoản? Đăng nhập" link renders), its test, `apps/normal-web/src/locales/{vi,en}/normal.json` (remove the now-unused keys), any e2e that clicks those links (grep `Chưa có tài khoản`, `Đã có tài khoản`).

**Decision (user-approved in bug-log §7):** the two tabs ("Đăng nhập" / "Đăng ký") already switch the form; the inline links duplicate them and are broken (the anchor's `href` flips during the click so the browser navigates back). Remove the links, keep the tabs.

- [ ] Failing test first: the auth screen in both modes renders no link named `/Chưa có tài khoản|Đã có tài khoản/` (vi) / the en equivalents, and the two tabs still switch modes (keep/extend the existing tab test).
- [ ] Implement: remove the link markup and its i18n keys (vi + en); nothing else in the form changes (layout audit L-series spacing must still hold — screenshot).
- [ ] Green: `pnpm --filter @bp/normal-web exec vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof: auth screen, both tabs, 1920×960 and 375×812.
- [ ] Commit `fix(auth): drop the switch links that duplicated the tabs (No6)`.

### Task 3: Recent hands name bots and the room (No4)

**Files:** `apps/normal-server/src/history/history-service.ts` (seat label, DTO), its test, the history DTO type (grep `HistoryHand` / `HistorySeat` in normal-server and `apps/normal-web/src/api.ts`), `apps/normal-server/src/repos/history-repo.ts` only if `config` is not already returned (it is selected), `apps/normal-web/src/screens/ProfileScreen.tsx` (~440-460), its test, locales vi/en `normal.json` (`profile.history.*`), `docs/normal-server.md` / `docs/known-limitations.md` ("History names opponents by their recorded label" entry).

**Root cause:** a bot seat's recorded label is its engine id `bot:<roomId>:<i>`; the service falls back to it because bots have no account; the room name (`games.config.name`) is selected but dropped.

- [ ] Failing tests (server): a bot seat recorded as `bot:<uuid>:4` is returned with `label: 'Bot 5'` (index + 1, matching the in-room name `Bot ${i + 1}` in `packages/server-kit/src/room/room.ts`); a label that does not match `/^bot:.+:(\d+)$/` is returned unchanged; the hand DTO carries `roomName` from the stored config (`null` when absent — old rows).
- [ ] Failing tests (client): a hand row shows the room name (e.g. "Blind Poker · 123" — the mode title followed by `·` and the room name; en the same) and bot seats read "Bot 5", not the raw id.
- [ ] Implement server mapping in `history-service.ts` (one small pure helper `botLabel(label)`, unit-tested), add `roomName: string | null` to the DTO, update `api.ts` types and every test fixture/mock that builds a history hand.
- [ ] Update the known-limitations entry: bots now read "Bot n"; deleted accounts still fall back to the recorded label.
- [ ] Green: unit suites for both packages, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof: profile → Ván gần đây at 1920×960 and 375×812 with a bot hand (use the e2e account that plays a Blind hand, or seed one in the preview spec through the real UI).
- [ ] Commit `fix(history): bots read "Bot n" and each hand names its room (No4)`.

### Task 4: A room with only bots left closes at once (No3)

**Files:** `packages/server-kit/src/room/room.ts` (`removePlayer` ~806, `scheduleClose` ~848), `packages/server-kit/src/room/room.test.ts` / `room-hands.test.ts` / `room-manager.test.ts` (empty-room tests), `apps/normal-web/e2e/ops/02-lobby-rooms.spec.ts` (S-06 C-06), `docs/operation-test-plan.md` (C-06 + new row), main spec §11 (room lifecycle — the empty-room grace sentence), `docs/server-kit.md` (close rule).

**Rule:** when the last human member leaves (leave, kick, spectator-grace removal, leave-after-hand) and the room still has seated bots, the room closes immediately (`close('empty')`: carry-over released → with no humans the whole pot goes to the `carry_over` sink, exactly as the 60 s timer path does today). A room with no humans **and no bots** keeps the 60 s grace and the lobby's "Đang đóng…" badge (bug 2, decision (d)). "Human member" = anyone in `players` who is not a bot, connected or not (a disconnected human inside the 90 s reconnect window or the 5-minute spectator grace keeps the room open).

- [ ] Failing unit tests: (a) Blind room with 2 bots, host leaves between hands → room `CLOSED` in the same queue turn, `onClosed` fired with `'empty'`, summary no longer listed; (b) host leaves mid-hand → room closes when that hand ends (after its settlement/history), not before; (c) a disconnected host (still a member) does not close the room until the spectator-grace removal, then it closes at once; (d) a carried-over pot on that close goes to the `carry_over` sink (money conservation holds); (e) a Hold'em room (no bots) left empty still schedules the 60 s close and reports `closing: true`.
- [ ] Implement: in `removePlayer`, after the existing bookkeeping, `if (this.humanCount === 0) { if (this.seatedBotCount > 0) await this.close('empty'); else this.scheduleClose() }` — keep the `onHandComplete` loop safe (it already returns when `status === 'CLOSED'`); make sure no timer or runner callback touches a closed room.
- [ ] Update existing unit tests that expected the 60 s grace on a room with bots: switch them to a no-bot room (keep their titles unless a title is now false; update citations if renamed).
- [ ] Ops pack: rewrite S-06 C-06 to create a **Blind room with 0 bots** (the 60 s grace, badge, rejoin and final close stay as they are); add a new test `C-07: a room left with only bots closes at once` (host creates Blind with 2 bots, a guest watches the lobby; host leaves → the ticket disappears from the guest's lobby within 10 s with no "Đang đóng…" badge). Add C-07 to `docs/operation-test-plan.md` §C and adjust C-06's row wording.
- [ ] Docs: main spec §11 empty-room sentence + `docs/server-kit.md` close rule.
- [ ] Green: server-kit suite, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, **ops pack** (all tests).
- [ ] Commit `feat(server-kit): a room left with only bots closes at once (No3)`.

### Task 5: One modal footer for every dialog; create-room keeps its height (No17, No12)

**Files:** `packages/ui-kit/src/primitives/Modal.tsx`, `packages/ui-kit/src/primitives/primitives.module.css`, primitives tests; call sites: `packages/ui-kit/src/screens/RoomScreen.tsx` (buy-in dialog ~308, manage dialog ~342), `packages/ui-kit/src/screens/LobbyScreen.tsx` (create room ~108) + `packages/ui-kit/src/lobby/CreateRoomForm.tsx` / `lobby.module.css` (`.formFoot`, the fields grid ~236), `apps/normal-web/src/screens/SettingsScreen.tsx` (~122), `apps/normal-web/src/screens/wardrobe/SavedOutfits.tsx` (~208), `apps/normal-web/src/screens/wardrobe/WardrobeScreen.tsx` (~458, leave dialog), `apps/lite/web/src/screens/SettingsScreen.tsx` (~98); the CSS classes they use for their button rows (`.stageActions`, `.choices`, `.buyInFoot`).

**Target (No17):** every dialog's action row is **centred**, separated from the body by `var(--space-5)` (or the token the design system uses for section spacing — name it in the report), with a consistent gap between buttons; buttons keep their current order and variants. **Target (No12):** the create-room dialog's outer height is identical (±1 px) whether "Texas Hold'em" or "Blind Poker" is selected, at 1920×960 and 375×812 (on the phone the dialog may scroll inside; the rule is that its outer box does not jump).

- [ ] Add to `Modal` an optional `footer?: ReactNode` rendered after the body in a `div.dialogFoot` (centred flex row, wrap, gap, top margin). Export nothing new beyond the prop. Unit test: footer renders after the body inside the dialog; absent footer renders no empty row.
- [ ] Migrate the dialogs whose buttons are not part of a `<form>` to `footer` (leave dialog, saved-outfit dialog, settings sign-out Normal + Lite, room manage if it has actions). For dialogs whose buttons submit a form (create room, buy-in), keep the buttons inside the form and give their row the same `dialogFoot` look (shared class or the same tokens) — never move a submit button outside its form.
- [ ] No12: make the create-room fields area keep one height across modes (e.g. `min-height` computed from the taller mode, or reserving hint lines) — measure, do not guess; e2e assertion in an existing lobby/create spec (default e2e or ops, no new account) comparing `boundingBox().height` of the dialog in both modes.
- [ ] Green: ui-kit + normal-web + lite unit suites, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
- [ ] Visual proof: every migrated dialog at 1920×960 and 375×812 (leave-without-saving, saved outfit, settings sign-out Normal, Lite settings sign-out, buy-in, manage table, create room in both modes).
- [ ] Commit(s) `fix(ui): one centred footer for every dialog (No17)`, `fix(lobby): the create-room dialog keeps its height across modes (No12)`.

### Task 6: Equal card heights and group spacing in inventory and wardrobe (No8b, No11b-1)

**Files:** `apps/normal-web/src/screens/wardrobe/wardrobe.module.css` (`.cardGrid` ~181, `.cardCell` ~204, `.card` ~222, `.colourDots`), `apps/normal-web/src/screens/wardrobe/cards.tsx`, `apps/normal-web/src/screens/InventoryScreen.tsx` + its CSS (`.invGroup`, `.invSlot`, OwnedCard), `apps/normal-web/src/screens/wardrobe/WardrobeScreen.tsx` (~343, the tabpanel wrapping two `ItemTab`s), `apps/normal-web/src/screens/normal.module.css` (`.groupTitle` ~718).

**Targets:** in every card grid (wardrobe item/colour/word cards, inventory owned cards) cards in the same row have equal outer heights (±1 px) and their bottom rows (rarity/price/colour dots) align; the space between the last card of a group and the next group heading is at least `var(--space-4)` (≥ 16 px) — the "Tay nóng" / "HUY HIỆU" case in `other/review/20260929/No11-1.png`.

- [ ] E2E assertions (add to the existing wardrobe-layout spec or inventory spec — no new account): for each rendered grid row, max − min card height ≤ 1 px; on "Trang trí → Danh hiệu & Huy hiệu", `headingTop − lastCardBottom ≥ 16`.
- [ ] Implement with CSS only (`.cardCell > .card { flex: 1 }`, bottom row `margin-top: auto`, group wrapper with a gap / heading top margin). No markup changes beyond a wrapper class if the tabpanel needs one.
- [ ] Green: `pnpm --filter @bp/normal-web exec vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof: inventory "Trang phục" group (the No8-1 view), wardrobe Trang phục/Mũ (No8-2 view), wardrobe Trang trí → Danh hiệu & Huy hiệu (No11-1 view), at 1920×960, 1366×768, 375×812.
- [ ] Commit `fix(wardrobe): cards in a row share one height; groups keep their spacing (No8b, No11b)`.

### Task 7: The room fits a standard PC screen; the countdown stays inside the result card (No2, No11b-2)

**Files:** `packages/ui-kit/src/table/table.module.css` (`.ring` ~520-527, seat rows), `packages/ui-kit/src/table/Seat.tsx` (~132-149, the viewer's stacked rows), `packages/ui-kit/src/screens/RoomScreen.tsx` (~227-237 overlay + countdown), `packages/ui-kit/src/screens/screens.module.css` (`.roomMain` ~113, `.overlay` ~117-129), `packages/ui-kit/src/table/HandResult.tsx` (+ tests), e2e: `apps/normal-web/e2e/normal.spec.ts` or a layout spec (no new account).

**Targets:**
- In the room, at viewports **1920×960, 1536×730 and 1280×720** (the user's PC, a 1920×1080 laptop at 125 % scaling, a small laptop), with **6 seats** in each of three states — waiting (OPEN), in hand with the action tray, and the result card showing — the room's scroll container (`.roomMain`) and the document have **no vertical scroll** (`scrollHeight − clientHeight ≤ 1`). Below 720 px of height the room may scroll.
- The viewer's own seat block is compact: at most two text rows under the plate on desktop (e.g. name/stack on the plate, tags + bet on one row, hand name + payout on one row); nothing is removed from the information shown.
- "Ván tiếp theo sau N giây" is rendered **inside** the result card (e.g. its footer), never as a free sibling in the overlay; the overlay no longer places text over the viewer's seat.
- The phone stacked layout (375×812) keeps working: the existing test "on mobile with 5 bots, my seat sits above the tray" stays green.
- **Priority and escape hatch:** 1920×960 is mandatory (the user's screen). If 1536×730 or 1280×720 cannot be met without hiding information, shrinking text below the design tokens' minimum, or making cards/plates illegible, stop at the best legible result, report DONE_WITH_CONCERNS with the measured `scrollHeight − clientHeight` per viewport and state, and do not cram.
- Lobby and inventory: at 1920×960 the lobby with ≤ 6 rooms has no document scroll; inventory/wardrobe are list pages and may scroll only because their content is long (no layout-induced scroll: no element wider/taller than its container because of fixed sizes). State in the report what you measured.

- [ ] E2E assertion first (fails today at 1920×960): open a Blind room with 5 bots (existing e2e account and flow), assert no vertical scroll in the three states at the three desktop viewports; assert the countdown element is a descendant of the result card.
- [ ] Implement (CSS first; minimal markup change for the seat rows and the countdown move). Keep `prefers-reduced-motion` behaviour unchanged.
- [ ] Green: ui-kit suite (HandResult/RoomScreen/PokerTable tests), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
- [ ] Visual proof: the room at 1920×960, 1536×730, 1280×720, 1366×768 and 375×812 in the three states (15 PNGs) + lobby at 1920×960.
- [ ] Commit `fix(table): the room fits a standard screen; the countdown lives in the result card (No2, No11b)`.

### Task 8: A text-overlap rule in the browser suites (No11b — "đưa vào rule test")

**Files:** new `apps/normal-web/e2e/overlap.ts` (helper), wired into existing specs (`normal.spec.ts`, `wardrobe-layout.spec.ts`, `avatar-tint.spec.ts` or whichever already visits each screen) and into the ops pack where it plays a hand (`ops/03-holdem.spec.ts`, `ops/04-blind.spec.ts`); `docs/test-matrix.md` row; `docs/ui-kit.md` note on `data-overlap-ok`.

**Helper contract:** `expectNoTextOverlap(page, label)` collects every visible text run (TreeWalker over text nodes → `Range.getClientRects()`; skip empty/whitespace, `visibility:hidden`, `opacity:0`, zero-size, off-viewport, `aria-hidden` decorative glyphs), groups them by **layer** (the nearest ancestor that is a dialog `[role=dialog]`, a toast region, or the table's result overlay — else the page), and fails if two runs of the **same layer** intersect by more than 2 px in both axes, unless one of them is inside an element carrying `data-overlap-ok="<reason>"`. The failure message lists each pair's text, rect and a CSS path. Wait for fonts (`document.fonts.ready`) and for animations to finish (`getAnimations()` settled) before measuring.

- [ ] Unit-check the helper on a tiny static page (Playwright `page.setContent`) with an overlapping pair, a non-overlapping pair, a dialog over text (different layers, allowed), and a `data-overlap-ok` pair.
- [ ] Wire it into the screens: lobby, room (waiting, in hand, result), wardrobe (three tabs), inventory, profile, daily, achievements, settings, auth — at 1920×960, 1366×768 and 375×812 where the spec already runs that screen (the default e2e has desktop + mobile projects; add the 1366×768 check inside a desktop test by resizing the viewport). No new account registrations.
- [ ] Fix every real overlap it finds if the fix is a small CSS change on that screen; for anything bigger, add `data-overlap-ok` **only** where the overlap is by design, with the reason, and list it in the report — never to silence a real bug.
- [ ] Run `pnpm e2e:normal` twice in a row and the ops pack once; all green both times.
- [ ] Commit `test(e2e): a text-overlap rule on every main screen (No11b)`.

### Task 9: Bookkeeping and roadmap

**Files:** `docs/bug-log.md` §7 (statuses → "đã sửa (commit)"), `docs/operation-test-plan.md` (any case whose expectation changed: C-06, C-07, room layout note), main spec §34 roadmap (add No7: email notifications — daily reminder, password reset, account security mail; not scheduled), `CHANGELOG.md` (Plan 16 section, merge placeholder for the controller).

- [ ] Update, then `pnpm exec vitest run tooling`, `pnpm lint`.
- [ ] Commit `docs: review round 1 — bug-log, test plan, roadmap, changelog`.

---

## After the tasks (controller)

Full gate on the branch: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, ops pack, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`. Whole-branch review on the most capable model with the screenshot folder. Merge `--no-ff`; remove the worktree before the master gate; `pnpm build:normal`; `/health` `rooms: 0` → `stop.ps1` → `run.ps1 -NoMigrate`; `pnpm build:lite`.
