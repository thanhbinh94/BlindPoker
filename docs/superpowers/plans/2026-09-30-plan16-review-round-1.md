# Plan 16 — Review 2026-09-29, round 1 (bug fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten round-1 findings of the user's 2026-09-29 review (No15, No16, No6, No4, No3, No8b, No12, No17, No11b, No2) without regressing anything else, and add an automated text-overlap rule to the browser suites.

**Architecture:** Bounded fixes in existing flows: the Normal CSP (tinted avatar layers), the auth screen, the history DTO, the room close rule in `@bp/server-kit`, CSS/layout in `@bp/ui-kit` + `apps/normal-web`. One new Playwright utility (text-overlap detector). No schema migration, no protocol change.

**Tech Stack:** TypeScript, React, CSS modules, Vitest + Testing Library, Playwright, Fastify.

**Spec / source of truth:** `docs/bug-log.md` §7 (user-approved classification, root causes, fix directions), the review note `other/review/20260929/Note.txt` and its screenshots in the same folder; main spec `docs/superpowers/specs/2026-09-04-bind-poker-design.md` (§11 room lifecycle).

**Pre-flight review (2026-09-30):** an independent review verified every root cause against the code and returned 14 amendments; all are folded into this version (see the ledger for the list).

## Global Constraints

- Work in the plan's worktree only (`D:\Work\Other Project\bind-poker\.worktrees\plan16`, branch `plan16/review-round-1`); never touch the main checkout, never merge or push, never open a real `.env`, never stop/start the user's LAN host on :8080.
- Bash: `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm. Edit files with Edit/Write only (never Bash heredocs or `node -e "…"`); keep each file's line endings and encoding.
- Lint `react/jsx-no-literals` (no bare JSX text), `--max-warnings=0`. vi/en locale key sets stay identical.
- The default e2e suite may not register more accounts (10 sign-ups/min per IP; it already uses ~9). New browser checks reuse existing accounts or go into the ops pack (`apps/normal-web/e2e/ops`, port 8093, throwaway PGlite).
- Tests cited in `docs/test-matrix.md` / `docs/acceptance-checklist.md` keep their titles, or every citation is updated in the same commit (`tooling/arch/acceptance-links.test.ts`).
- **The user's screen:** desktop viewport **1920×940** (measured from the user's screenshots: 1920×1080 minus browser chrome and taskbar). Every "desktop" target below means 1920×940 unless stated.
- **Visual proof for every task that changes a screen:** `pnpm build:normal`, then screenshot the real build with a throwaway Playwright spec (e.g. `apps/normal-web/e2e/zz-preview.spec.ts`, deleted before commit) against the e2e server; save PNGs under `D:\Work\Other Project\bind-poker\.superpowers\sdd\2026-09-30-plan16-review-round-1\shots\task-N\` (git-ignored) and list them in the report. Viewports: **1920×940**, **1366×768**, **375×812**, plus any the task names. If the change touches a component Lite shares (`Seat`, `HandResult`, `Modal`, `RoomScreen`), add one Lite screenshot (`pnpm build:lite`, Lite e2e server). Reviewers open these PNGs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each task ends green on `pnpm typecheck`, `pnpm lint`, `pnpm test`. UI tasks also run `pnpm build:normal` + `pnpm e2e:normal` (and Lite build + e2e where Lite shares the component). Tasks 4 and 9 also run the ops pack.
- Tasks run strictly one after another (T6/T7 share `normal.module.css` and `WardrobeScreen.tsx`; T6/T8 share `RoomScreen.tsx` and `screens.module.css`).

## Risk register

| # | Risk | Where | Mitigation built into the plan |
|---|---|---|---|
| R1 | Widening the CSP opens more than tinted images need | T1 | Only `img-src` gains `blob:`, only in `normalCsp`; exact header pinned by a test; `script-src`/`connect-src` untouched; `docs/security.md` records why. (A blob URL can only be minted by same-origin script; `data:` is already wider. `data:` URLs instead would mean main-thread base64 of ~96 cached layers of several hundred KB — rejected.) |
| R2 | A fallback hides a future tint failure | T1 | The fallback renders the plain layer (never a blank head); the e2e asserts every tinted `<img>` really decoded (`complete && naturalWidth > 0`, `src` starts with `blob:`, at least 3 blob layers) so a silent fallback fails the test |
| R3 | Closing a bots-only room at once drops a disconnected human or loses a pot | T4 | The rule counts members (a disconnected human stays a member until the spectator grace removes them); carry-over release on close is the existing path; unit tests for mid-hand leave, disconnect, carry-over |
| R4 | Ops C-06 changes meaning (it uses a room with a bot) | T4 | C-06 moves to a room without bots (60 s grace kept); new C-07 covers the immediate close |
| R5 | Room layout change breaks the phone stacked layout or other viewports | T8 | Screenshot matrix; existing mobile e2e stays green; e2e pins "no vertical scroll" at the target viewports |
| R6 | Overlap detector flaky or noisy | T5, T9 | Reduced motion, finite animations only (capped 2 s), rects clipped by overflow ancestors, SVG/`role=img` text skipped, `checkVisibility`, 20 % line-height shrink, opaque-cover test via `elementsFromPoint`, self-test fixtures; run twice to prove determinism |
| R7 | The shared modal footer changes seven dialogs (Normal + Lite) | T6 | Screenshot every dialog before/after; existing dialog tests stay green; shared layout classes (`.choices`, `.stageActions`, `.modalActions`) are not restyled |
| R8 | History DTO change breaks client or old rows | T3 | Old rows handled by parsing the recorded bot label; `api.ts`, mocks and ProfileScreen tests updated together |
| R9 | CSS fixes look right in tests but wrong on screen | T6–T9 | Visual proof rule; reviewers open the PNGs |
| R10 | Deploy while people play | controller | Deploy only after the full gate; restart the LAN host only when `/health` shows `rooms: 0` |
| R11 | The immediate close re-enters during `shutdown()` / `close()` (both run `onHandComplete`) → `onClosed` twice | T4 | A `closing` flag set first in `close()`/`shutdown()`; `removePlayer` closes at once only when not closing; test that `onClosed` fires exactly once with the shutdown reason |
| R12 | Detector hangs on infinite animations / false positives on ellipsis, card SVG text, tight line-height | T5 | See R6 mitigations, written into the helper contract |
| R13 | The countdown inside the result card is announced every second (`HandResult` root is `role="status"`) | T8 | Countdown in its own `aria-live="off"` element in the card footer, or the live region moved to an inner wrapper; never inside a `<li>` or the fee text |
| R14 | Target viewport taller than the user's real one | all UI | 1920×940 everywhere |
| R15 | Restyling shared `.choices` recentres the Settings rows | T6 | Do not restyle shared classes; move dialog buttons into `footer` |
| R16 | After T1 the 12 coloured items render tinted for the first time | T1 | Screenshot two of them (a coloured t-shirt, a coloured hat or beanie) |
| R17 | Lite shares `Seat`, `HandResult`, `Modal` | T6, T8 | One Lite room screenshot and the Lite settings dialog screenshot; Lite e2e green |

---

### Task 1: Tinted avatar layers load again (No15, No16, and every coloured item)

**Files:** `apps/normal-server/src/app.ts` (`normalCsp`, the `SCRIPT_SRC` comment), `apps/normal-server/src/app.test.ts` (~230-241 CSP assertions and the comment at ~232-235), `packages/ui-kit/src/avatar2d/Chibi.tsx` (`ChibiLayer`), the avatar2d unit tests (mock `useTintedLayer`), `apps/normal-web/e2e/avatar-tint.spec.ts` (~line 47), `docs/security.md` (~45-60, which says no image source is for the avatar), main spec ~line 708 (CSP text), `docs/avatar-2d.md` if it states the CSP.

**Root cause (verified live twice):** Normal's CSP is `img-src 'self' data:` (`packages/http-kit/src/security.ts:22`, inherited by `normalCsp`); `useTintedLayer` renders recoloured layers as `blob:` object URLs (`packages/ui-kit/src/avatar2d/tinted.ts:~88`), which Chrome blocks. A hair colour tints L30/L50/L60 → all blocked → only the outfit remains (No16). An eye colour tints L50 → blocked → the base's own blue eyes on L30 show (No15). The 12 item colour variants (e.g. the free "Áo phông đỏ", `items.json` ~105) are blocked the same way. The e2e passed because `toBeVisible` accepts a broken `<img>`.

- [ ] **Failing tests first.**
  - `app.test.ts`: the Normal header's `img-src` is exactly `img-src 'self' data: blob:`; every other directive unchanged (pin the full header string the test already pins).
  - `avatar-tint.spec.ts`: equip a hair colour, an eye colour **and "Áo phông đỏ"**; then `expect.poll` that every `<img>` in the wardrobe stage preview is `complete && naturalWidth > 0`, and that at least 3 of them have `src` starting with `blob:`.
  - Chibi unit test (with `useTintedLayer` mocked): when the tinted `<img>` fires `error`, that layer re-renders with the plain file URL (`srcSet` 1x/2x); a different tinted URL (new tint) is tried again.
- [ ] Run them, see them fail.
- [ ] **Implement.**
  - `normalCsp`: map the `img-src` directive to `${d} blob:`; do not change `DEFAULT_CSP` in `@bp/http-kit` (Lite uses it; Lite does not tint). Rewrite the `SCRIPT_SRC` comment: tinted layers are `blob:` images (Plan 13); scripts stay `'self'`.
  - `ChibiLayer`: `const [failedUrl, setFailedUrl] = useState<string | null>(null)`; render the tinted `<img>` only when `tinted !== null && tinted !== failedUrl`, with `onError={() => setFailedUrl(tinted)}`; otherwise the plain two-density `<img>`.
  - Docs: `docs/security.md` (~45-60) — Normal adds `blob:` to `img-src` for the recoloured avatar layers generated in-page by `tinted.ts`, nothing else accepts `blob:`; main spec ~708 CSP text; the `app.test.ts` comment.
- [ ] Green: the three focused runs, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] **Visual proof** (1920×940): wardrobe stage with (a) "Tóc bạch kim" + "Mắt xanh lá", (b) "Tóc đỏ" + "Mắt hổ phách" + "Áo phông đỏ", (c) no colours; the lobby bar avatar with (a); two coloured items in the wardrobe grid (R16). Head and hair present and recoloured, eyes recoloured.
- [ ] Commit `fix(avatar): tinted layers load under the Normal CSP; fall back to the plain layer on error (No15, No16)`.

### Task 2: Auth screen — drop the duplicate switch links (No6)

**Files:** `apps/normal-web/src/screens/AuthScreen.tsx` (~289), `apps/normal-web/src/screens/AuthScreen.test.tsx` (delete the link test ~81-86), `apps/normal-web/src/screens/normal.module.css` (remove the now-dead `.switcher` rules ~539-551), `apps/normal-web/src/locales/{vi,en}/normal.json` (remove the unused keys), `docs/deployment-normal.md` (~184, mentions the link), any e2e clicking those links (grep `Chưa có tài khoản`, `Đã có tài khoản`).

**Decision (user-approved, bug-log §7):** the tabs "Đăng nhập" / "Đăng ký" already switch the form; the inline links duplicate them and are broken (the anchor's `href` flips during the click so the browser navigates back). Remove the links, keep the tabs.

- [ ] Failing test: both modes render no link named `/Chưa có tài khoản|Đã có tài khoản/` (and the en equivalents); the tabs still switch modes.
- [ ] Implement the removals listed above; nothing else in the form changes.
- [ ] Green: normal-web unit suite, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof: auth screen, both tabs, 1920×940 and 375×812.
- [ ] Commit `fix(auth): drop the switch links that duplicated the tabs (No6)`.

### Task 3: Recent hands name the table and the bots (No4)

**Files:** `apps/normal-server/src/history/history-service.ts` (seat label, DTO), `apps/normal-server/src/history/history-service.test.ts` (the `toEqual` at ~66 gains `roomName`), the history DTO types (grep `HistoryHand`/`HistorySeat` in normal-server and `apps/normal-web/src/api.ts`), `apps/normal-web/src/screens/ProfileScreen.tsx` (~440-460) + test, locales vi/en `normal.json` (`profile.history.*`), `docs/known-limitations.md` ("History names opponents by their recorded label"), `docs/normal-server.md` if it documents the DTO.

**Root cause:** a bot seat's recorded label is its engine id `bot:<roomId>:<i>` (`room.ts:77`, `history-repo.ts:74`); bots have no account, so the service falls back to it. The room name is stored (`summary().config`, `room.ts:584`) and selected, but dropped. The label "Tại bàn" in front of the opponent list (vi `normal.json` ~189) is why the raw ids read as a table code.

**Target (bug-log §7):** each hand row shows **"Tại bàn {{name}}"** (en "At table {{name}}") with the room name; the opponent list's label becomes **"Đối thủ"** (en "Opponents"); bot seats read **"Bot n"** (index + 1, matching the in-room name `Bot ${i + 1}`). Old rows without a stored name show no "Tại bàn" line.

- [ ] Failing server tests: a seat with `isBot: true` recorded as `bot:<uuid>:4` → `label: 'Bot 5'`; a human seat whose label happens to match the pattern is left alone (mapping applies only when `isBot`); non-matching bot labels unchanged; the hand DTO carries `roomName` from the stored config, `null` when absent.
- [ ] Failing client tests: "Tại bàn 123" is shown for a hand with `roomName: '123'`; no such line when `roomName` is null; bot seats render "Bot 5"; the list label reads "Đối thủ".
- [ ] Implement: a small pure helper `botLabel(label)` in the history service (unit-tested), `roomName: string | null` on the DTO, `api.ts` types and every fixture/mock building a history hand, ProfileScreen rendering, locale keys (rename `profile.history.opponents` text to "Đối thủ"/"Opponents", add `profile.history.table` "Tại bàn {{name}}"/"At table {{name}}").
- [ ] Update the known-limitations entry: bots now read "Bot n"; a deleted account still falls back to the recorded label.
- [ ] Green: both unit suites, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof: profile → Ván gần đây with a bot hand at 1920×940 and 375×812.
- [ ] Commit `fix(history): each hand names its table and bots read "Bot n" (No4)`.

### Task 4: A room left with only bots closes at once (No3)

**Files:** `packages/server-kit/src/room/room.ts` (`removePlayer` ~806, `scheduleClose` ~848, `close` ~436, `shutdown` ~416), `packages/server-kit/src/room/room.test.ts` (~26 and ~312), `room-hands.test.ts`, `room-manager.test.ts` (empty-room tests), `apps/normal-web/e2e/ops/02-lobby-rooms.spec.ts` (S-06 C-06), docs: main spec lines ~120 (FR-R05), ~321, ~1051 (empty-room rule); `docs/operation-test-plan.md` (C-06 row, new C-07 row, §6 step 7 at ~255 "Rời hết → Đang đóng…" which uses a 1-bot Blind room); `docs/server-kit.md` (~127 and ~200); `docs/test-matrix.md` row ~63 wording.

**Rule:** when the last human member leaves (leave, kick, spectator-grace removal, leave-after-hand) and the room still has seated bots, the room closes immediately with `close('empty')` (carry-over released → no humans → whole pot to the `carry_over` sink, as the 60 s timer does today). A room with no humans **and no bots** keeps the 60 s grace and the lobby's "Đang đóng…" badge (bug 2, decision (d)). "Human member" = anyone in `players` who is not a bot, connected or not.

- [ ] Failing unit tests: (a) Blind room with 2 bots, host leaves between hands → `CLOSED` in the same queue turn, `onClosed` with `'empty'`; (b) host leaves mid-hand → the room closes when that hand ends (after settlement/history), not before; (c) a disconnected host does not close the room until the spectator-grace removal, then it closes at once; (d) a carried-over pot on that close goes to the `carry_over` sink (conservation holds); (e) a no-bot room left empty still schedules the 60 s close with `closing: true`; (f) a `shutdown()` during a Blind hand whose only human pressed Leave calls `onClosed` exactly once, with the shutdown reason.
- [ ] Implement: a private `closing` flag set first thing in `close()` and `shutdown()`; `close()` returns early if already closing; in `removePlayer` after the existing bookkeeping: `if (this.humanCount === 0) { if (this.seatedBotCount > 0 && !this.closing) await this.close('empty'); else if (!this.closing) this.scheduleClose() }`. `onHandComplete` already returns when `status === 'CLOSED'`.
- [ ] Existing tests: keep the titles and configs of room.test.ts ~26 (`join: password, capacity net of seated bots, … empty-room close`, cited in test-matrix ~63 and acceptance-checklist 66.8) and ~312 ("Bot-only rooms"); change only their endings: ~26 expects `CLOSED`/`'empty'` right after the last leave; ~312 expects `CLOSED` right after the hand. Run the full server-kit suite; list every changed assertion in the report.
- [ ] Ops pack: S-06 C-06 on a room **without bots** (`createHoldemRoom`), the 60 s grace/badge/rejoin/final close unchanged; new `C-07: a room left with only bots closes at once` — host creates Blind with 2 bots, guest watches the lobby; host leaves → the guest's ticket is gone within 5 s.
- [ ] Docs listed above.
- [ ] Green: server-kit suite, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, **ops pack**.
- [ ] Commit `feat(server-kit): a room left with only bots closes at once (No3)`.

### Task 5: The text-overlap detector (No11b test rule, part 1: helper + self-test)

**Files:** new `apps/normal-web/e2e/overlap.ts`, new `apps/normal-web/e2e/overlap.spec.ts` (self-test on static content; no account), `docs/ui-kit.md` (a short section: the rule, `data-overlap-ok="<reason>"`, what it does not catch).

**Helper contract** — `expectNoTextOverlap(page: Page, label: string, opts?: { ignore?: string[] })`:
1. Before measuring: the caller's context uses `reducedMotion: 'reduce'` (the helper also calls `page.emulateMedia({ reducedMotion: 'reduce' })`); wait for `document.fonts.ready`; wait for **finite** animations only (`getAnimations()` filtered to those with a finite end), capped at 2 s — never wait on infinite ones.
2. Collect visible text runs: TreeWalker over text nodes; skip whitespace-only; skip text inside `svg`, `[role=img]`, `[aria-hidden=true]`; skip elements failing `checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })`; take `Range.getClientRects()`; clip each rect by every ancestor whose computed `overflow`/`overflow-x`/`overflow-y` is not `visible` (handles ellipsis and scroll areas); drop empty rects and rects outside the viewport; shrink each rect vertically by 20 % of the element's font-size (tight line-height must not count).
3. Layers: text inside `[role=dialog][aria-modal=true]` or the toast region is compared only within its own layer; everything else is one page layer. For a page-layer pair that intersects by more than 2 px in both axes, call `document.elementsFromPoint` at the centre of the intersection: the lower text counts as covered (not an overlap) only if some non-ancestor element above it has a computed `background-color` alpha ≥ 0.9; otherwise it is an overlap.
4. Skip any run inside an element carrying `data-overlap-ok="<non-empty reason>"`.
5. Fail with a message listing each pair: both texts (trimmed to 40 chars), their rects, and a short CSS path.

- [ ] Self-test with `page.setContent` fixtures: two overlapping spans → fails; two separate spans → passes; text under a **transparent** overlay → fails; text under an **opaque** card → passes; a sticky footer over scrolled fields → passes; ellipsis-clipped long text next to a neighbour → passes; SVG text over a span → passes; a `data-overlap-ok` pair → passes; an element with an infinite CSS animation on the page → the helper returns within 3 s.
- [ ] Green: `pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts overlap` (twice), `pnpm typecheck`, `pnpm lint`.
- [ ] Commit `test(e2e): a text-overlap detector with self-tests (No11b)`.

Note in `docs/ui-kit.md`: text touching a card's edge (the No11-1 "Tay nóng"/"HUY HIỆU" case) is a box-spacing problem this rule does not detect; Task 7's spacing assertion covers it.

### Task 6: One centred footer for every dialog; create-room keeps its height (No17, No12)

**Files:** `packages/ui-kit/src/primitives/Modal.tsx`, `packages/ui-kit/src/primitives/primitives.module.css`, primitives tests; call sites: `packages/ui-kit/src/screens/RoomScreen.tsx` (buy-in ~308-340 — **not** a form; manage ~342 — no action row), `packages/ui-kit/src/screens/LobbyScreen.tsx` (~108) + `packages/ui-kit/src/lobby/CreateRoomForm.tsx` + `lobby.module.css` (`.formFoot` sticky ~299-310, fields grid ~236), `apps/normal-web/src/screens/SettingsScreen.tsx` (~122), `apps/normal-web/src/screens/wardrobe/SavedOutfits.tsx` (~208), `apps/normal-web/src/screens/wardrobe/WardrobeScreen.tsx` (~458 leave dialog), `apps/lite/web/src/screens/SettingsScreen.tsx` (~98).

**Targets.** No17: every dialog's action row is **centred**, separated from the body by the design system's section spacing token (name it in the report; ≥ 20 px), with a consistent gap between buttons; order and variants unchanged. No12: the create-room dialog's outer height is identical (±1 px) for "Texas Hold'em" and "Blind Poker", at 1920×940 and 375×812.

- [ ] `Modal` gains `footer?: ReactNode`, rendered after the body in `div.dialogFoot` (centred flex row, wrap, gap, top margin); no empty row when absent. Unit test both.
- [ ] Move the buttons of the leave dialog, saved-outfit dialog, Settings sign-out (Normal and Lite) and the buy-in dialog into `footer`. **Do not restyle** the shared classes `.choices` (it also lays out Settings' theme/language rows), `.stageActions`, `.modalActions` — remove their use from these dialogs only. The manage dialog has no action row: leave it.
- [ ] Create-room: keep its buttons inside the form and keep `.formFoot` sticky; only centre it and give it the same top spacing.
- [ ] No12: reserve one height for the mode-dependent fields (measure both modes; e.g. `min-height` on the fields area); e2e assertion comparing the dialog's `boundingBox().height` in both modes inside an existing lobby/create spec (default e2e or ops; no new account). Also run `expectNoTextOverlap` on the open dialog in both modes.
- [ ] Green: ui-kit + normal-web + lite unit suites, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
- [ ] Visual proof at 1920×940 and 375×812: leave-without-saving, saved outfit, Settings sign-out (Normal), Lite settings sign-out, buy-in, create room in both modes; plus the Settings page itself (theme/language rows unchanged, R15).
- [ ] Commit(s) `fix(ui): one centred footer for every dialog (No17)`, `fix(lobby): the create-room dialog keeps its height across modes (No12)`.

### Task 7: Equal card heights and group spacing in inventory and wardrobe (No8b, No11b part 2)

**Files:** `apps/normal-web/src/screens/wardrobe/wardrobe.module.css` (`.cardGrid` ~181, `.cardCell` ~204, `.card` ~222, `.colourDots`), `apps/normal-web/src/screens/wardrobe/cards.tsx`, `apps/normal-web/src/screens/InventoryScreen.tsx` + CSS (`.invGroup`, `.invSlot`, OwnedCard), `apps/normal-web/src/screens/wardrobe/WardrobeScreen.tsx` (~343, the tabpanel wrapping two `ItemTab`s), `apps/normal-web/src/screens/normal.module.css` (`.groupTitle` ~718).

**Targets:** in every card grid (wardrobe item/colour/word cards, inventory owned cards) cards in the same row have equal outer heights (±1 px) and their bottom rows (rarity/price/colour dots) align; the gap between the last card of a group and the next group heading is ≥ 16 px (the "Tay nóng"/"HUY HIỆU" case in `No11-1.png`).

- [ ] E2E assertions first (existing wardrobe-layout/inventory specs; no new account): per rendered grid row, max − min card height ≤ 1 px; on "Trang trí → Danh hiệu & Huy hiệu", `headingTop − lastCardBottom ≥ 16`; `expectNoTextOverlap` on the three wardrobe tabs and the inventory.
- [ ] Implement with CSS (`.cardCell > .card { flex: 1 }`, bottom row `margin-top: auto`, a gap/heading margin between groups); markup only if the tabpanel needs a wrapper class.
- [ ] Green: normal-web unit suite, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] Visual proof at 1920×940, 1366×768, 375×812: inventory "Trang phục" group (No8-1 view), wardrobe Trang phục → Mũ (No8-2 view), wardrobe Trang trí → Danh hiệu & Huy hiệu (No11-1 view).
- [ ] Commit `fix(wardrobe): cards in a row share one height; groups keep their spacing (No8b, No11b)`.

### Task 8: The room fits the user's screen; the countdown lives in the result card (No2, No11b part 3)

**Files:** `packages/ui-kit/src/table/table.module.css` (`.ring` ~520-527, seat rows), `packages/ui-kit/src/table/Seat.tsx` (~132-149, the viewer's stacked rows), `packages/ui-kit/src/screens/RoomScreen.tsx` (~227-237 overlay + countdown), `packages/ui-kit/src/screens/screens.module.css` (`.roomMain` ~113, `.overlay` ~117-129), `packages/ui-kit/src/table/HandResult.tsx` (root is `role="status"`, ~56) + tests; ui-kit playground (worst-case layouts); e2e in `apps/normal-web/e2e/normal.spec.ts` (inside "một tài khoản chơi trọn một ván Blind với bot", after its money assertions; no new account). Protect the selectors other tests use: the card's `listitem`s and `/^Phí bàn/` (`normal.spec.ts` ~229-231, `ops/ops-helpers.ts` ~265-272), the countdown's i18n string (`ops/03-holdem.spec.ts` ~80).

**Targets:**
- **Mandatory:** at **1920×940**, with 6 seats, in three states — waiting (OPEN), in hand with the action tray, result card showing — `.roomMain` and the document have no vertical scroll (`scrollHeight − clientHeight ≤ 1`).
- **Also aimed for:** 1536×730 and 1280×720 in the same states. Escape hatch: if they cannot be met without hiding information, shrinking text below the design tokens' minimum or making plates/cards illegible, stop at the best legible result, report DONE_WITH_CONCERNS with the measured overflow per viewport and state, and do not cram. Heights ≤ 768 px left with concerns are reported by Task 9's overlap run, never annotated away.
- The viewer's seat block is compact: at most two text rows under the plate on desktop (e.g. tags + bet on one row, hand name + payout on one row); no information removed.
- The result card has `max-height: 100%` of the table area; its rows scroll inside it when there are many.
- "Ván tiếp theo sau N giây" is rendered **inside** the result card's footer as its own element with `aria-live="off"` (or the card's live region moves to an inner wrapper that excludes it) — never inside a `<li>` or the fee text; the overlay no longer places free text over the viewer's seat. Keep the i18n string.
- Deterministic measuring of the result state: press "Ngồi ngoài" during the hand so the table has only bots, the room goes OPEN after the hand and the card stays up; measure the worst case (6 showdown rows, the Hold'em sizing tray) in the ui-kit playground.
- Phone (375×812): the existing test "on mobile with 5 bots, my seat sits above the tray" stays green.
- Lobby at 1920×940 with ≤ 6 rooms: no document scroll. Inventory/wardrobe: may scroll only because the content is long (no element overflowing its container because of fixed sizes) — state what you measured.

- [ ] E2E first (fails today at 1920×940): the three states × the target viewports assert no vertical scroll; the countdown is a descendant of the result card; `expectNoTextOverlap` on the room in the three states at 1920×940 and 375×812.
- [ ] Implement (CSS first; minimal markup for the seat rows and the countdown move). `prefers-reduced-motion` behaviour unchanged.
- [ ] Green: ui-kit suite (HandResult/RoomScreen/PokerTable), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`.
- [ ] Visual proof: the room at 1920×940, 1536×730, 1280×720, 1366×768, 375×812 in the three states (15 PNGs), the lobby at 1920×940, one Lite room (R17).
- [ ] Commit `fix(table): the room fits the screen; the countdown lives in the result card (No2, No11b)`.

### Task 9: Wire the overlap rule into every main screen (No11b part 4)

**Files:** existing specs that already visit each screen (`normal.spec.ts`, `wardrobe-layout.spec.ts`, `avatar-tint.spec.ts`, the daily/achievements/settings/profile/auth paths in the default e2e), ops `03-holdem.spec.ts` and `04-blind.spec.ts` where a hand is played; `docs/test-matrix.md` (a row for the rule); `docs/operation-test-plan.md` (mention the rule under M).

- [ ] Call `expectNoTextOverlap` on: lobby, room (waiting, in hand, result), wardrobe (three tabs), inventory, profile, daily, achievements, settings, auth — at 1920×940, 1366×768 and 375×812 where the spec already runs that screen (the default e2e has desktop and mobile projects; add the 1366×768 check inside a desktop test with `page.setViewportSize`). No new account registrations.
- [ ] Fix every real overlap it finds when the fix is a small CSS change on that screen; add `data-overlap-ok="<reason>"` **only** where an overlap is by design, and list each one in the report; never to silence a real bug. Anything bigger → report it (DONE_WITH_CONCERNS) with screenshots.
- [ ] Run `pnpm e2e:normal` twice in a row and the ops pack once; all green both times.
- [ ] Commit `test(e2e): the text-overlap rule on every main screen (No11b)`.

### Task 10: Bookkeeping and roadmap

**Files:** `docs/bug-log.md` §7 (statuses → "đã sửa (commit)"), `docs/operation-test-plan.md` (C-06/C-07 and any expectation that changed), main spec §34 roadmap (No7: email notifications — daily reminder, password reset, account-security mail; not scheduled), `CHANGELOG.md` (Plan 16 section; merge placeholder for the controller).

- [ ] Update, then `pnpm exec vitest run tooling`, `pnpm lint`.
- [ ] Commit `docs: review round 1 — bug-log, test plan, roadmap, changelog`.

---

## After the tasks (controller)

Full gate on the branch: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`, ops pack, `pnpm build:lite`, `pnpm --filter @bp/lite e2e`. Whole-branch review on the most capable model, with the screenshot folder. Merge `--no-ff`; remove the worktree before the master gate; `pnpm build:normal`; `/health` `rooms: 0` → `stop.ps1` → `run.ps1 -NoMigrate`; `pnpm build:lite`.
