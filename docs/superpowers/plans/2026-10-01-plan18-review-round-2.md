# Plan 18 — Review 2026-09-29, Đợt 2 (No1, No5, No8a, No9, No10, No11a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six round-2 improvements from the user's review of 2026-09-29, using the directions Claude proposed and the user approved on 2026-10-01 ("Đợt 2 làm theo đề xuất của bạn luôn").

**Architecture:** Bounded changes to existing flows.
- **Copy:** Vietnamese strings change (No9).
- **Wardrobe:**
  - owned-only by default, with a checkbox to show the rest (No11a);
  - the profile's inventory screen folds into the wardrobe (No5);
  - colour variants get tinted icons, and a card follows the variant being worn (No8a);
  - the expression picker becomes a stepper (No10).
- **Table:** a face-down card that turns face-up flips over (No1).

There is no protocol, schema or server-logic change. The asset pipeline gains one output: an icon tint mask.

**Tech Stack:** TypeScript, React 18.3, CSS modules, Vitest + Testing Library, Playwright 1.62, Node asset pipeline (`apps/normal-web/scripts/avatar-pipeline*`).

**Spec / source of truth:**
- `docs/bug-log.md` §7: rows No1, No5, No8a, No9, No10 and No11a, with the directions given there.
- The original proposal (2026-09-29): No11a "mặc định chỉ hiện món đã có, thêm ô tích 'Hiện cả món chưa có'"; No10 "‹ tên biểu cảm › thay cho 6 nút"; No1 "lật hai mặt khoảng 0,6 giây, tắt khi giảm chuyển động"; No8a "cắt mặt nạ màu cho icon rồi tô"; No5 "gộp: bỏ Kho đồ khỏi hồ sơ, để một nút sang Phòng thay đồ"; No9 "lập danh sách cũ → mới / bỏ".
- The user's note: `other/review/20260929/Note.txt`, with No8-1.png, No8-2.png and No10-1.png. That folder is untracked and must never be committed.
- No9 copy list: `docs/copy-review-2026-10.md` (its header lists the rulings).
- Wardrobe design: `docs/superpowers/specs/2026-09-26-wardrobe-redesign-design.md`.

**Pre-flight review (2026-10-01):** an independent review checked the plan against the code. It returned 20 amendments:
- 3 blockers:
  - the "Chơi tiếp" prefix clash in `sitOutAndPlay`;
  - untracked inputs;
  - what a family card's button does.
- 10 important.

They are folded into each task as **"Amendments (pre-flight)"** blocks. Where an amendment and the task text differ, the amendment wins. Verified as correct: 102/102 rows of the copy list match the current files, the icon pipeline regenerates byte-identically here, and the task order is sound.

**Ruling on No9 approval:** the original proposal said the copy list would be approved before editing. The user's "làm theo đề xuất của bạn luôn" is the approval. The list is applied, committed as `docs/copy-review-2026-10.md`, and shown in the final report so the user can veto any line.

## Global Constraints

- **Worktree.**
  - Work only in `D:\Work\Other Project\bind-poker\.worktrees\plan18`, branch `plan18/review-round-2`.
  - Never touch the main checkout; never merge or push.
  - Never open a real `.env`.
  - Never stop or start the user's LAN host on :8080. Test servers on other ports are fine (e2e 8091, ops 8093, playground 5175); stop them afterwards.
- **Shell and editing.**
  - In Bash, run `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm.
  - Edit files with Edit/Write only (never Bash heredocs or `node -e "…"`), and keep each file's line endings and encoding.
  - The Edit tool turns a typed `\uXXXX` into the real character.
- **Lint and locales.**
  - Lint rules: `react/jsx-no-literals`, `react-hooks/rules-of-hooks`, `exhaustive-deps`, `--max-warnings=0`.
  - The vi/en locale key sets stay identical (`apps/normal-web/src/locales/locales.test.ts`, the ui-kit i18n tests).
  - New user-visible text goes through i18n, in both languages.
- **Accounts.** The default e2e suite may not register more accounts: 10 sign-ups per minute, and the suite already uses 9. New browser checks ride on an existing account in a spec that already visits the screen (`wardrobe-layout.spec.ts`, `avatar2d.spec.ts`, `avatar-tint.spec.ts`, `normal.spec.ts`), or go into the ops pack (`apps/normal-web/e2e/ops`, port 8093, throwaway PGlite).
- **Test citations.** Tests cited in `docs/test-matrix.md` / `docs/acceptance-checklist.md` keep their titles, or every citation is updated in the same commit (`tooling/arch/acceptance-links.test.ts`).
- **The user's screen** is **1920×940**. "Desktop" means 1920×940 unless stated otherwise.
- **Visual proof for every task that changes a screen.**
  - Run `pnpm build:normal`, then screenshot the real build with a throwaway `apps/normal-web/e2e/zz-preview.spec.ts`. Run it on its own (`pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts zz-preview`) and delete it before the full runs and the commit, since its sign-ups count toward the limit.
  - Save before/after PNGs under `.superpowers/sdd/2026-10-01-plan18-review-round-2/shots/task-N/` in the worktree (git-ignored).
  - Viewports: 1920×940, 1366×768 and 375×812, plus any the task names.
  - A change to a ui-kit component Lite renders (table: `Card`, `Seat`, `RoomScreen`, `HandResult`, `ActionBar`; lobby: `RoomList`, `CreateRoomForm`) adds one Lite screenshot.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Green bar.**
  - Every task ends green on `pnpm typecheck`, `pnpm lint` and `pnpm test`.
  - UI tasks also run `pnpm build:normal` and `pnpm e2e:normal`.
  - Tasks touching ui-kit code or strings that Lite renders also run `pnpm build:lite` and `pnpm --filter @bp/lite e2e`.
  - Tasks 1, 3 and 6 also run the ops pack (`pnpm --filter @bp/normal-web e2e:ops`, about 10–20 minutes).
- **Inputs outside the worktree.** The plan and `docs/copy-review-2026-10.md` are committed on master before the worktree is created. The user's note and screenshots are read only through the absolute path `D:\Work\Other Project\bind-poker\other\review\20260929\`; that folder is never in the worktree and never committed.
- **Order.** Tasks run strictly in order:
  - T1 sets the vocabulary every later task uses.
  - T2 and T3 share `WardrobeScreen`, `wardrobe-layout.spec.ts` and the locale files.
  - T4 builds on T3, since the inventory screen is gone.

## Risk register

| # | Risk | Where | Mitigation |
|---|---|---|---|
| R1 | Copy changes break tests that find elements by Vietnamese text (unit, e2e, ops) | T1 | Grep every old string in `apps/` and `packages/`, update in the same commit, run all three browser suites |
| R2 | A renamed control label breaks a Lite flow | T1 | Lite e2e. Lite strings are in `apps/lite/web/src/locales/vi/lite.json` |
| R3 | A longer string overlaps or wraps badly ("Thùng phá sảnh hoàng gia", "Hào quang hoa anh đào", "Hủy sẵn sàng" on 375 px) | T1 | The text-overlap rule runs on the main screens. Screenshot the result card, the wardrobe cards and the room controls at 375×812 |
| R4 | Owned-only hides an owned colour variant whose original the player does not own (beret) | T2 | Ownership is family-aware: a card shows when the original **or** any variant is owned. Unit test with the beret fixture |
| R5 | Owned-only leaves fresh accounts with empty tabs, and existing e2e break (empty grids, locked items expected) | T2 | Clear empty-state message. Every e2e that needs locked cards ticks the box first. A new e2e checks the default (owned only) |
| R6 | Removing the inventory loses information or a deep link | T3 | `#/inventory` replaces itself with `#/avatar` (no history bounce). Loss of acquired date and source is accepted and recorded. Acceptance row 66.19 is re-pointed |
| R7 | Tinted icons misalign with their mask, or fail silently | T4 | The icon mask is cut from the layer mask with the **layer's** alpha box. A pipeline test checks every tint-masked layer has both icon-mask densities. An e2e checks the tinted icon decodes as `blob:` |
| R8 | The pipeline's exact file list and icon-key tests break | T4 | Update `avatar-pipeline.test.ts` expectations in the same commit; keep the three manifests identical |
| R9 | The stepper is worse for keyboard or screen-reader users than six buttons | T5 | Real buttons with names, the current value in a polite live `<output>`, arrow keys on the group, 44 px targets on the phone |
| R10 | The flip double-counts cards for assistive tech and tests, restarts the deal animation, or ignores reduced motion | T6 | One labelled `role="img"` per card at any time, with the hidden face `aria-hidden` and unlabelled. The flip sits on an inner element. CSS respects `prefers-reduced-motion`. Unit tests, ops 03/04/05 |
| R11 | The flip is never seen, because the result card opens over the felt at once | T6 | Screenshot or record the showdown in the playground (real showdowns), and put a visual check of the timing in the report |
| R12 | Deploy while people play | controller | Deploy only after the full gate, and only when `/health` shows `rooms: 0` |
| R13 | A renamed label becomes a prefix of another button's name ("Chơi tiếp" vs "Chơi 1.000") | T1 | Scope or `exact: true` every lookup a rename touches. `sitOutAndPlay` is rewritten (T1 amendment 1) |
| R14 | An ops helper skips a step silently when a name changes (`takeSeat`'s buy-in dialog `isVisible().catch(() => false)`) | T1 | Rename it in the same commit; the ops pack must pass |
| R15 | Wardrobe state survives a same-URL `page.goto` in e2e (no remount), so a click toggles the box back off | T2 | Use `.check()` / `toBeChecked()`, never `.click()`, on the checkbox |
| R16 | Under reduced motion (global `animation: none`) a flip whose end state lives in keyframes rests on the wrong face | T6 | The resting style is face-up; the keyframe has only `from`. Nothing depends on `animationend` |
| R17 | Acceptance row 66.19 cites a test that does not exist under that exact title | T2/T3 | T2 fixes the exact title; T3 cites it |

---

### Task 1: Copy review (No9)

**Files:**
- `packages/ui-kit/src/i18n/locales/vi/common.json` and `vi/game.json`.
- `apps/normal-web/src/locales/vi/normal.json`.
- `apps/lite/web/src/locales/vi/lite.json`.
- `apps/normal-web/src/screens/SettingsScreen.tsx` (~46 and ~62, remove the two lead paragraphs) and the matching en keys.
- Every unit, e2e and ops test that reads a changed string.
- Docs that quote a changed string: `docs/operation-test-plan.md`, `docs/normal-web.md`, `docs/ui-kit.md`; grep.

**Target:** apply every row of `docs/copy-review-2026-10.md` §2 verbatim, with the exclusions in its header:
- skip `inventory.*`, which Task 3 handles;
- keep `achievements.ui.progress` as it is;
- skip §4's ambiguous items and the unused-key cleanup.

The three **(bỏ)** rows mean:
- remove the rendered `<p>` lines;
- remove the keys in **both** vi and en;
- skip `inventory.lead`, which Task 3 removes.

English text does not change otherwise.

- [ ] **Grep first.** For each old Vietnamese string, find every reference in `apps/` and `packages/`: tests, e2e (`apps/normal-web/e2e/**`, `apps/lite/e2e/**`) and ops helpers. List them in the report.
- [ ] **Apply and update.** Apply the list, then update every reference in the same commit. Watch these ones closely:
  - "Ngồi ngoài" / "Vào lại" → "Tạm nghỉ" / "Chơi tiếp" (ops helpers and `normal.spec.ts` `sitOutAndPlay`);
  - "Chưa sẵn sàng" → "Hủy sẵn sàng";
  - "Những người thắng" → "Người thắng". The result-card group locator becomes `/^(Người thắng|Ván bị hủy)$/` in three e2e files: `normal.spec.ts`, `ops/ops-helpers.ts`, `apps/lite/e2e/lite.spec.ts`;
  - "Hoàn lại phần cược dư" → "Hoàn cược dư cho" (ops `04-blind`);
  - "Đang mặc" → "Đang dùng";
  - "Thân nền" → "Nhân vật";
  - the wardrobe sub-tab "Trang phục" → "Quần áo". The group "Trang phục" keeps its name, and `goToWardrobeTab` callers change;
  - "Đuổi" → "Mời ra";
  - "Thùng phá sảnh vua" → "Thùng phá sảnh hoàng gia";
  - achievement names used by e2e progressbar lookups ("Mười ván Blind Poker…");
  - "Xoá" → "Xóa";
  - "Lưu đè vào đây" → "Lưu đè".
- [ ] **Unit tests.** Where a unit test reads a string through the locale JSON (`viNormal.…`), it follows automatically. Where it hard-codes the old text, update it.
- [ ] **Green.**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`;
  - `pnpm build:normal`, `pnpm e2e:normal`;
  - `pnpm build:lite`, `pnpm --filter @bp/lite e2e`;
  - the ops pack.
- [ ] **Visual proof** at 1920×940 and 375×812, before and after:
  - Settings (the two lines gone);
  - the room controls (Tạm nghỉ / Hủy sẵn sàng / Chơi tiếp);
  - a result card;
  - the wardrobe tabs ("Nhân vật", "Quần áo", "Đang dùng");
  - Daily;
  - the Profile stats;
  - one Lite screen (room controls).
- [ ] **Commit** `copy(vi): natural Vietnamese across the app — the review list of 2026-10 (No9)`.

**Amendments (pre-flight):**

1. **Blocker — `sitOutAndPlay`** (`normal.spec.ts` ~188-192, called at ~397 and ~568). After "Tạm nghỉ" is clicked, the sit-in button reads "Chơi tiếp", and `/^Chơi\b/` would match it and "Chơi 1.000". Use:

   ```ts
   await page.getByRole('button', { name: 'Tạm nghỉ', exact: true }).click()
   await expect(page.getByRole('button', { name: 'Chơi tiếp', exact: true })).toBeVisible()
   await page.getByRole('group', { name: 'Hành động' }).getByRole('button', { name: /^Chơi\b/ }).click()
   ```

   Check every other `/^Chơi/` lookup the same way.
2. **References the plan text missed.** Update every one in the same commit.
   - **Ops:**
     - `ops-helpers.ts`:
       - ~244 `takeSeat`: dialog name 'Chọn số điểm mang vào bàn'. This one is a **silent failure** (R14).
       - ~205 type union and ~221: 'Hoàn toàn may rủi', 'Cách chơi'.
       - ~220: 'Số lá mỗi người'.
       - ~254: 'Hủy sẵn sàng'.
       - ~271: the result-card regex.
     - `01-accounts.spec.ts`:
       - ~54: `/^Lần điểm danh tiếp theo: 00:00, \d{1,2} thg \d{1,2}$/`.
       - ~106: 'Mật khẩu cần 8–128 ký tự và không trùng với email'.
       - ~119: 'Email này đã được đăng ký'.
     - `02-lobby-rooms.spec.ts`:
       - ~63: 'Tạm nghỉ'.
       - ~180: 'Buy-in tối thiểu không được lớn hơn buy-in tối đa.'
       - ~198: the buy-in dialog name.
     - `04-blind.spec.ts`:
       - ~60, ~313: 'Hoàn toàn may rủi'.
       - ~118, 119, 151, 152, 242, 289: 'Tạm nghỉ'.
       - ~154: 'Hoàn cược dư cho'.
       - ~178: 'Mời ra — Bot 1'.
       - ~238: 'Chọn một ghế trống để vào chơi.'
     - `05-network-profile.spec.ts` ~81-82: 'Tạm nghỉ'.
   - **Normal e2e:**
     - `normal.spec.ts` ~158, ~160: `/^Hoàn cược dư cho\s+(.*?)\s+([\d.,]+)$/`.
     - `support.ts` ~183-184: labels.
     - `avatar2d.spec.ts` ~70 `{ name: 'Nhân vật', exact: true }` and ~145 'Mặc bộ này'.
     - `wardrobe-layout.spec.ts` ~109-115 and ~192: sub-tab 'Quần áo'; ~155 'Mặc bộ này'.
     - `avatar-tint.spec.ts` ~92: 'Quần áo'.
   - **Lite e2e** `lite.spec.ts`: ~79-80 labels, ~145/~147 the uncalled-bet regex, ~125 regex.
   - **Unit tests:**
     - `CreateRoomForm.test.tsx` ~77: 'Thiết lập phòng không hợp lệ'.
     - `HandResult.test.tsx` ~197: 'Người thắng', since single and split now share the title; ~218: 'Hoàn cược dư cho Ann 500'.
     - `ProfileScreen.test.tsx` ~151: `/Tham gia từ/`.
     - `SavedOutfits.test.tsx` ~98: title text only.
3. **Docs.** Update:
   - `docs/ui-kit.md` ~210 (waitDecided), ~234 (regex);
   - wardrobe spec ~23-26, 33, 41, 45, 82;
   - `operation-test-plan.md` ~128, 146, 155, 159, 162, 181, 190, 203, 204, 213, 267.

   Leave alone: "Xoá" in `deployment-*.md` / `README-lite.md` (prose), `test-runs/`, older specs, the bug-log, and comments that only quote old text.
4. **Lite proof (R3).** Also screenshot Lite's Daily seal: "Chuỗi điểm danh" in `.sealEyebrow`.
5. **Do not touch `aria-pressed`** on Sẵn sàng / Hủy sẵn sàng or Tạm nghỉ / Chơi tiếp; the e2e relies on it.

### Task 2: Wardrobe shows what you own, with a box for the rest (No11a)

**Files:**
- `apps/normal-web/src/screens/wardrobe/categories.ts` (`OwnershipFilter`, `applyFilter` ~100-104, `counts`).
- `CategoryNav.tsx` (filter row ~130-143, props).
- `WardrobeScreen.tsx` (state ~136, `changeTab` ~249-252).
- `ItemTab.tsx` (~120, empty state, words-tab headings ~132) and `ColourTab.tsx` (~33-38).
- `cards.tsx` (variant dots).
- `wardrobe.module.css` (`.filterRow` ~955-987; reuse the lobby checkbox look: `packages/ui-kit/src/lobby/lobby.module.css` `.check` / `.checkbox` ~333-348).
- Locales (vi/en `wardrobe.*`).
- Unit tests: `categories.test.ts` ~110-128; `CategoryNav.test.tsx` ~153-177 and fixture ~20; `WardrobeScreen.test.tsx` ~195-262, ~366-449, ~506-521.
- e2e: `wardrobe-layout.spec.ts` ~94-139 and `avatar2d.spec.ts` ~89-97, ~175-179.
- Wardrobe spec §3.1 item 3, §5.5 and §7; `docs/operation-test-plan.md` (new J row).

**Target:**
- **The checkbox.** The three filter buttons (Tất cả / Đã có / Chưa có) become one checkbox labelled **"Hiện cả món chưa có"** (en "Show items you don't own yet"), key `wardrobe.showLocked`.
  - It is unticked when the wardrobe opens.
  - Its value **persists across tab changes** for the visit (no reset in `changeTab`, no storage).
  - It sits where the filter row was, beside the "n/m đã có" count, which stays. It is hidden on the base tab, as now.
  - Markup is a native `<input type="checkbox">` in a `<label>`, with `accent-color: var(--gold)` and a `--tap` row height, as in the create-room form. Do not add a ui-kit primitive.
- **Family-aware ownership.** A family is an original plus its colour variants, grouped by `variantsByFile` / `tabItems`. With the box unticked, a family's card shows when the original **or any of its variants** is owned. Within a shown card, dots for variants the player does not own are hidden.
  - With the box ticked, everything shows as today: locked cards and locked dots.
  - Colour tabs (hair/eye) follow the same rule per swatch, and "Tự nhiên" always shows.
- **Empty state.** When the box is unticked and a tab (or one heading's grid on the words tab) has nothing owned:
  - the grid is replaced by a short line, **"Bạn chưa có món nào ở mục này."** (en "You don't own anything here yet."), key `wardrobe.emptyOwned`, and it is not a `tabpanel` with an empty grid;
  - on the words tab, a heading whose grid is empty is hidden; when both are empty, the line shows once.
- **Keys.** Remove `wardrobe.filter.all` and `wardrobe.filter.owned`. **Keep** `wardrobe.filter.locked`: it is part of every locked card's accessible name (`cards.tsx` ~26).

- [ ] **Failing unit tests.**
  - `categories`: family-aware ownership — original owned; only a variant owned (beret: `head_beret_red01` unowned, `head_beret_blue01` owned → card shown, only the owned dot shown); none owned → hidden unless ticked.
  - `CategoryNav`: the checkbox renders unticked, toggles `onShowLocked`, and is hidden when `showFilter` is false.
  - `WardrobeScreen`: the default view shows only owned cards; ticking shows locked cards; the value survives a tab change; the empty-state line appears on a tab with nothing owned.
  - Rewrite the old filter tests (~506-521 "resets the ownership filter…") to the new behaviour, keeping titles where `docs/test-matrix.md` / `docs/acceptance-checklist.md` cite them (grep).
- [ ] **E2e.**
  - Every check that needs locked cards ticks the box first: `wardrobe-layout.spec.ts` `expectCardGrids` (measure grids with the box ticked) and `avatar2d.spec.ts` ~89-97 and ~175-179.
  - Add one check to an existing `wardrobe-layout.spec.ts` test, with no new account:
    - the Mũ tab shows the empty line by default;
    - ticking shows cards;
    - the Quần áo tab shows the owned tee family by default.
  - Run the overlap rule on the empty state at 1920×940 and 375×812.
- [ ] **Docs.** Wardrobe spec §3.1, §5.5, §7; a new row in `docs/operation-test-plan.md`.
- [ ] **Green.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] **Visual proof**, before and after:
  - the wardrobe for a fresh account at 1920×940 and 375×812, on Mũ (empty line) and Quần áo (owned tees);
  - the same tabs with the box ticked;
  - the colour tab.
- [ ] **Commit** `feat(wardrobe): owned items by default, a box shows the rest; a variant you own shows its family (No11a)`.

**Amendments (pre-flight):**

1. **Ticking in e2e (R15).** `page.goto` to the URL the page is already on keeps the document, so the wardrobe keeps its state.
   - Tick with `await page.getByRole('checkbox', { name: 'Hiện cả món chưa có' }).check()` (idempotent) and assert `toBeChecked()`; never `.click()`.
   - Make the "unticked by default" assertions right after a fresh mount. In the desktop test that is just after `useLightTheme(page); openWardrobe(page)`, which arrives from `#/settings`.
   - Run the 375×812 empty-state overlap check inside the existing `@mobile điện thoại…` test.
   - Keep all three `wardrobe-layout` test titles (test-matrix row ~127 cites them).
2. **Unit tests the plan missed.**
   - `WardrobeScreen.test.tsx` ~534-556 (words tab): `TITLE_ROOKIE` is unowned, so tick the box or add it to the fixture.
   - ~572-595 (`aria-controls` across three panel shapes): must stay green.
3. **Panel structure.** The empty line is a `<p>` inside the **same** `role="tabpanel"` element (same `id`, same `aria-labelledby`); only the grid goes. On the words tab the single line sits inside the words panel.
4. **Shared variant map.**
   - Move `variantsByFile` from `ItemTab.tsx` ~91 into `categories.ts` (exported).
   - Give `applyFilter` the variant map, so the family rule is unit-tested there.
   - Compute `reserveDots` from the dots actually visible.
   - "§3.1 item 3" in the docs list means the right-column item 3 (Bộ lọc).
5. **Unowned original, box unticked.** The card shows the **first owned variant**: its name, its owned state, and a click equips it. Task 4 extends this to "worn member first" and adds the original's dot.
6. **Acceptance row 66.19 (R17).** Title one WardrobeScreen test exactly `lists only what the account owns by default, and the box shows the rest`; Task 3 re-points the row to it.
7. **Docs.** In `docs/test-matrix.md` ~115, mention the owned-only empty state. Add a wardrobe spec §3.2 note for the phone filter row.

### Task 3: The inventory folds into the wardrobe (No5)

**Files:**
- `apps/normal-web/src/App.tsx`: lazy import ~57, `ACCOUNT_ROUTES` ~63, route ~292-293.
- `apps/normal-web/src/screens/ProfileScreen.tsx` ~392-394 (the "Kho đồ" link).
- Delete `InventoryScreen.tsx` and `InventoryScreen.test.tsx`, `OwnedCard` in `cards.tsx` ~230-259, `.cardStatic` in `wardrobe.module.css` ~281-282, and `.invGroup` / `.invSlot` in `normal.module.css` ~907-920.
- Locales: remove `profile.toInventory` and `inventory.{title,lead,summary,acquired,empty,source.*}` in vi and en. **Keep** `inventory.rarity.*` and `inventory.error`, which the wardrobe uses.
- `apps/normal-web/test/footprint.test.ts` ~74 (`LAZY_SCREENS`).
- e2e:
  - `wardrobe-layout.spec.ts` ~129-138 (the inventory half of `expectCardGrids`) and ~187-208 (icon size wardrobe vs inventory): drop or re-aim them;
  - ops `01-accounts.spec.ts` ~191 (route list);
  - the `e2e/support.ts` ~577 comment.
- Docs:
  - `docs/acceptance-checklist.md` ~165, row 66.19: re-point to a Task 2 wardrobe test such as "lists only what the account owns by default"; `acceptance-links.test.ts` enforces this;
  - `docs/operation-test-plan.md` J-08, K-01 and the M screen list;
  - `docs/test-matrix.md` ~115;
  - `docs/normal-web.md` ~10, ~49, ~165;
  - main spec ~947 (`docs/superpowers/specs/2026-09-04-bind-poker-design.md`);
  - `Shell.tsx` ~10 comment.

**Target:**
- **No more inventory screen.** Profile's quick links are Phòng thay đồ and Thành tựu only.
- **Old links redirect.** `#/inventory` (an old bookmark or link) **replaces** itself with `#/avatar`, with no extra history entry:
  - use `history.replaceState` and re-read the route, or route both paths to `WardrobeScreen` and normalise the hash with `replaceState`;
  - a unit test pins it (`App.test.tsx`).
- **Information that is lost.** The acquired date and source ("Nhận ngày …", "Khởi đầu", "Miễn phí") and the total "Đang sở hữu N món" are no longer shown anywhere. Accepted and recorded: the wardrobe's "n/m đã có" counts remain.
  - Colour-variant names stay visible through Task 4: a card shows the name of the variant being worn, and each dot gets a `title`.

- [ ] **Failing tests.** `App.test.tsx`: `#/inventory` lands on the wardrobe heading "Phòng thay đồ" and `location.hash === '#/avatar'`. `ProfileScreen.test.tsx`: there is no "Kho đồ" link, and the wardrobe link is present.
- [ ] **Implement and delete.** Grep `InventoryScreen`, `inventory.` keys, `#/inventory`, "Kho đồ" and `OwnedCard` across the repo; nothing may remain except the kept keys and history docs (bug-log, CHANGELOG, old plans).
- [ ] **Green.**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test` (incl. `acceptance-links`);
  - `pnpm build:normal`, `pnpm e2e:normal`;
  - the ops pack.
- [ ] **Visual proof.** Profile at 1920×940 and 375×812, before and after.
- [ ] **Commit** `feat(profile): the inventory folds into the wardrobe — one place for what you own (No5)`.

**Amendments (pre-flight):**

1. **The redirect.** `useHashRoute` (`packages/ui-kit/src/router/useHashRoute.ts` ~34-54) has no replace, and `history.replaceState` fires no `hashchange`. Instead:
   - In `App.tsx`, use `const path = route.path === '/inventory' ? '/avatar' : route.path`. The Shell, `ACCOUNT_ROUTES.includes`, the `UpdateBoundary` key and `useDailyNudge` all read `path`.
   - Add `useEffect(() => { if (route.path === '/inventory') window.history.replaceState(window.history.state, '', '#/avatar') }, [route.path])`.
   - Remove `'/inventory'` from `ACCOUNT_ROUTES`.
   - Do **not** touch ui-kit's router, which would pull in the Lite gates.
   - Ops `01-accounts` S-07: re-aim, do not drop. `goto('/#/inventory')` → heading 'Phòng thay đồ' and `toHaveURL(/#\/avatar$/)`.
2. **The `App.test.tsx` redirect test.** The test stubs (~20-37) lack `inventory`, `outfits` and `catalogAchievements`, so `WardrobeScreen` would show its error branch. Add overrides:
   - `inventory: …({ items: [], avatar: { v: 3, base: 'f01', outfit: 'outfit_casual01' } })`
   - `outfits: …({ outfits: [null, null, null, null, null] })`
   - `catalogAchievements: …({ achievements: [] })`
3. **Acceptance row 66.19.** It cites `` `apps/normal-web/src/screens/wardrobe/WardrobeScreen.test.tsx` → `lists only what the account owns by default, and the box shows the rest` `` (format per `acceptance-links.test.ts` ~61-80).
4. **Comments to update:**
   - `support.ts` ~582 and ~706; ~577 stays, since it cites the kept `inventory.rarity.*`;
   - the `App.tsx` "six" comments;
   - `wardrobe.module.css` ~212 and ~441-449;
   - the `normal.module.css` ~905 header;
   - `Shell.tsx` ~10;
   - `normal.spec.ts` ~198-204.
5. **`inventory.error`** ("Không tải được kho đồ của bạn") is now shown only by the wardrobe. Keep the key; its vi text may say "Không tải được đồ của bạn". Ruling: change the vi text to "Không tải được phòng thay đồ" and leave en as is.

### Task 4: Colour variants get their own icon (No8a)

**Files:**
- Pipeline:
  - `apps/normal-web/scripts/avatar-pipeline/manifest.mjs` (~209-221: `iconName`, `writeIcon`);
  - `png.mjs` (~359-368: `iconPicture`; add a crop-by-box helper);
  - `masks.mjs` (~604-636, ~713-725 overrides);
  - `extract.mjs` (write order);
  - the placeholder path.
- Assets: 8 new PNGs in `apps/normal-web/public/avatar/` and the three manifests (`public`, `apps/normal-server/data/avatar-manifest.json`, any dist copy), kept identical.
- Client:
  - `apps/normal-web/src/screens/wardrobe/ItemTab.tsx` (`ItemPreview` ~48-66);
  - `cards.tsx` (`ItemCard` thumb ~114-116, dots ~126-143);
  - `packages/ui-kit/src/avatar2d/tinted.ts` (`useTintedLayer` ~142-177; export if needed).
- Tests:
  - `apps/normal-web/test/avatar-pipeline.test.ts` (~1186-1210 exact PNG list, ~1288-1307 icon keys, ~1324-1328 identical manifests);
  - `WardrobeScreen.test.tsx`, `cards.test.tsx`;
  - `apps/normal-web/e2e/avatar-tint.spec.ts`.
- Docs: `docs/avatar-2d.md` ~97-98, ~368-384, ~425-447.

**Target:**
- **Pipeline: icon tint masks.** For every layer that has a tint mask (today beanie01, beret_red01, party_cone01 and casual01), the pipeline writes `<icon>_tintmask@2x.png` and `@1x.png`, where `<icon>` = the layer's icon name.
  - Cut it from the written layer tint mask (so hand overrides count) with the **layer's alpha bounding box** and the same fit as the icon (192 px square, 84 %, centred; @1x = @2x halved).
  - The manifest's icon entry for that layer records it (e.g. `tintMask: true`).
  - Re-running the pipeline is idempotent. The committed icon PNGs stay byte-identical.
- **Client: tinted icon.** `ItemPreview` tints the icon when the item has `asset.tint`, the same way avatar layers are tinted:
  - `useTintedLayer` with the icon file and `{ mask: <icon>_tintmask, colour, meanL }`, where `meanL` is the layer's tint `meanL` from the manifest;
  - the hook is called before any early return;
  - drop `srcSet` for the blob;
  - fall back to the plain icon on error, as `ChibiLayer` does.
- **Client: the card follows the variant being worn.** A family card's thumb and name show the variant currently in the draft (`draft[slot]`) when it belongs to that family; otherwise they show the original.
  - Each variant dot gets a `title` (and keeps its `aria-label`) with the variant's name.
  - Clicking a dot still equips that variant. Check the current behaviour and keep it.

- [ ] **Failing tests.**
  - Pipeline: each tint-masked layer has both icon-mask densities, the mask's size equals the icon's, and the exact file and icon-key lists are updated.
  - Unit: `ItemPreview` asks `useTintedLayer` for the variant's tint (mock `tinted.js` as existing tests do); the card shows the worn variant's name and tinted icon; dots carry `title`.
- [ ] **Generate.** Run the pipeline (`pnpm --filter @bp/normal-web avatar:check`, and the generation command the scripts use; read `docs/avatar-2d.md` §10). Commit the 8 PNGs and the identical manifests. `footprint.test.ts` stays under budget.
- [ ] **E2e.** Extend `avatar-tint.spec.ts`, with no new account: after equipping "Áo phông đỏ", the Quần áo card thumb is a decoded `blob:` image and the card reads "Áo phông đỏ".
- [ ] **Green.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`.
- [ ] **Visual proof.** At 1920×940 and 375×812, the Quần áo tab and the Mũ tab with the box ticked:
  - the tee family wearing red, then navy;
  - the beanie family;
  - the party cone family.

  Plus a zoom on the icons.
- [ ] **Commit** `feat(wardrobe): colour variants show their own colour — tinted icons, the card follows the worn variant (No8a)`.

**Amendments (pre-flight):**

1. **Blocker — which family member the card is.** This replaces the "card follows the variant being worn" bullet. Today the button's `aria-pressed`, pill and `onPick` key on the original (`cards.tsx` ~103-112).
   - **The shown member.** The card shows one family member:
     - the member in `draft[slot]`;
     - else the original, when it is owned or the box is ticked;
     - else the first owned variant.
   - **The pick button is that member in every respect:**
     - icon, tinted if it has `asset.tint`;
     - name and rarity;
     - `cardLabel`;
     - `aria-pressed` and the "Đang dùng" pill;
     - `aria-disabled` and the lock hint;
     - click → `onPick(shown.id)`.

     Today's toggle rule and the required-outfit rule still apply.
   - **The dot row** lists the whole family, original first:
     - the original's dot is an untinted swatch (the `.naturalSwatch` look) named after the original;
     - every dot keeps `aria-label`, gains `title`, has `aria-pressed` = worn, and equips its member;
     - with the box unticked, dots of unowned members are hidden;
     - the row is omitted when it would hold only the shown member.
   - **The group** keeps `aria-label` = the original's name.
   - **Tests:**
     - `cards.test.tsx` ~80: `^Mũ nồi đỏ` would also match the new original dot, so match the exact button label.
     - `WardrobeScreen.test.tsx` ~426-449: the beret card now shows "Mũ nồi xanh dương" as owned; rewrite ~434 and ~437.
   - **Docs:** add wardrobe spec §4.1 ("Biến thể màu", "Bấm thẻ đã có").
2. **How to generate the 8 PNGs** (replaces the Generate step). `avatar:check` only checks. No source art is needed: the layer masks and icons regenerate byte-identically with sharp 0.33.5 here.
   - Refactor `iconPicture` (`png.mjs` ~359-368) into a fit step (box, width, height, offsets) and an apply step, so the mask reuses the icon's exact fit.
   - In `writeOneMask` (`masks.mjs` ~703-738), for kind `tint`:
     - crop `<layer>_tintmask@2x` with `alphaBBox(<layer>@2x)`;
     - apply the same fit;
     - `writeDensities` as `<icon>_tintmask`;
     - flag `manifest.icons[<icon>]`, e.g. `tintMask: true`, a field and not a new key.
   - Skip aura and frame layers; their icons come from the source picture.
   - Run `pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs masks item_head_beanie01_L80 item_head_beret_red01_L80 item_head_party_cone01_L80 item_outfit_casual01_L40`.
   - Then `git status --short apps/normal-web/public/avatar apps/normal-server/data` must show exactly 8 `??` (new PNGs) and the manifest `M`s. If any existing PNG shows `M`, revert it and stop.
   - In `avatar-pipeline.test.ts`, `stageOnePngs` (~1185-1211) adds the icon masks from the flag.
3. **Screenshots of variants a fresh account cannot own.** Beanie and party-cone variants are not free, and there is no grant hook. In `zz-preview.spec.ts` only, `page.route('**/api/me/inventory', …)` adds the variant ids to `items`. Never do this in committed specs.
4. **Client details.**
   - `useTintedLayer` is already exported (`packages/ui-kit/src/avatar2d/index.ts` ~10), so there is no ui-kit change and no Lite gate.
   - Take `meanL` from `item.asset.tintMeanL` (`apps/normal-web/src/api.ts` ~100); the client never reads the manifest.
   - In normal-web tests, mock partially: `vi.mock('@bp/ui-kit', async (o) => ({ ...(await o()), useTintedLayer: vi.fn() }))`.

### Task 5: The expression picker becomes a stepper (No10)

**Files:**
- `apps/normal-web/src/screens/wardrobe/StagePanel.tsx` (~7, ~48-60) and `wardrobe.module.css` (~130-171, the ~567-570 note).
- Locales: `wardrobe.expression.*`; add `prev` / `next`.
- `StagePanel.test.tsx` ~42-60.
- Docs: `docs/operation-test-plan.md` J-06, `docs/normal-web.md` ~51, ~165, wardrobe spec §3.1 item 2, §3.2, §7.

**Target:** under the stage, one row `‹  Vui  ›`.
- **Buttons.** Two real `<button>`s with accessible names "Biểu cảm trước" / "Biểu cảm sau" (en "Previous expression" / "Next expression"). They wrap around at both ends.
- **Current name.** Between them, the current expression's name in an `<output aria-live="polite">`.
- **Group.** It keeps `role="group"` and the label `wardrobe.expression.legend`. ArrowLeft and ArrowRight on the group step too.
- **Sizing.** Targets are ≥ `--tap` (44 px) on the phone, and the row is no taller than today's on desktop. The left column must still fit 1920×940 and a 900 px-tall window (note ~567-570).
- **Behaviour.** State and `onExpression` are unchanged; the framed head portrait still follows.

- [ ] **Failing tests** (keep the old test titles only if cited; grep):
  - the row shows "Bình thường";
  - next → "Vui" and `onExpression('happy')`;
  - previous from "Bình thường" → "Ngủ" (wrap);
  - arrow keys step;
  - the output is `aria-live="polite"`.
- [ ] **Implement, green.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, `pnpm e2e:normal`. The overlap rule already reads the Ngoại hình tab.
- [ ] **Visual proof.** The stage panel at 1920×940, 1366×768 and 375×812, before (the No10-1.png row) and after.
- [ ] **Commit** `feat(wardrobe): pick the preview expression with a ‹ name › stepper (No10)`.

**Amendments (pre-flight):**

- **Test wrapper.** `StagePanel` is controlled, so the "next → shows 'Vui'" test needs a small stateful wrapper.
- **Glyphs.** Put the ‹ › glyphs in constants (`react/jsx-no-literals`).
- **Row height.** Today the desktop row is 30 px (`wardrobe.module.css` ~160-166) and `--tap` is 44 px (`tokens.css` ~146). On desktop keep the stepper row no taller than about 36 px; on the phone the buttons are ≥ 44 px.

### Task 6: Cards flip over (No1)

**Files:**
- `packages/ui-kit/src/table/Card.tsx`.
- `packages/ui-kit/src/table/table.module.css` (`.card` ~5-37, sizes, the reduced-motion block ~1404-1414).
- Possibly `packages/ui-kit/src/theme/tokens.css` (a `--dur-flip` token at `:root` only; `tokens.test.ts` forbids nested at-rules).
- `Card.test.tsx`, `PokerTable.test.tsx`.
- `docs/ui-kit.md` ~408-410.
- Lite is shared.

**Target:**
- **When a card flips.** A mounted card that changes from face-down to face-up (today: opponents' hole cards at showdown, Hold'em and Blind) **turns over**: a two-sided rotation about the vertical axis, about **600 ms**, `var(--ease)`, with the back visible for the first half and the face for the second, staggered by the existing `delayMs`.
  - Cards that mount face-up keep their deal animation and do not flip: own hole cards, board cards, result-card minis.
  - A snapshot rebuild mounts cards face-up with no flip.
- **Structure.**
  - An HTML wrapper keeps `.card`: size, drop-shadow and the deal animation.
  - An inner element carries the flip (`transform-style: preserve-3d`, `perspective` about 420 px so flank seats are not clipped).
  - Two faces with `backface-visibility: hidden`.
  - At any time exactly **one** element per card has `role="img"` and an `aria-label` (and `data-card` / `data-face`): the face that is showing. The other face is `aria-hidden` with no role, label or `data-*`.
  - Card remembers it was face-down (a ref that survives StrictMode). The flip plays once per down→up change.
- **Reduced motion.** Under `prefers-reduced-motion: reduce` the change is instant. Cover it in CSS; also in JS if any JS timing is used.
- Existing DOM contracts hold. Check them against:
  - `Card.test.tsx` ~10-21;
  - `PokerTable.test.tsx` ~45-47 (exact label counts);
  - ops `04-blind` `faceUp` (`getByRole('img', { name: FACE_UP })` counts);
  - ops `03-holdem` ~213 (board img count 5);
  - ops `05-network-profile` ~65;
  - the overlap rule (skips `svg`, `role=img`, `aria-hidden`).

- [ ] **Failing tests.**
  - A rerender from `faceDown` to a card gives one `role=img` labelled with the card's name, with the back `aria-hidden` and a flip class or state while turning.
  - A card mounted face-up has no flip.
  - Counts in `PokerTable.test.tsx` are unchanged.
- [ ] **Implement, green.**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`;
  - `pnpm build:normal`, `pnpm e2e:normal`;
  - `pnpm build:lite`, `pnpm --filter @bp/lite e2e`;
  - the ops pack.
- [ ] **Visual proof.**
  - The ui-kit playground drives real showdowns (`pnpm --filter @bp/ui-kit playground`, 5175): capture a sequence of frames (e.g. 0 / 150 / 300 / 450 / 600 ms) of a showdown flip at 1920×940, and one at 375×812.
  - One Lite frame mid-flip if reachable, else a Lite showdown after it.
  - Confirm in the report whether the flip is visible before the result card covers the felt. If it is hidden, say so with the timing; do not change the result-card timing in this task.
- [ ] **Commit** `feat(table): a card turns over when it is revealed — a 0.6 s two-sided flip, off under reduced motion (No1)`.

**Amendments (pre-flight):**

1. **Reduced motion (R16).** `global.css` ~137-145 sets `* { animation: none !important; transition: none !important }`.
   - The flipper's **resting** style is face-up.
   - The keyframe has only `from { transform: rotateY(180deg) }`, with `animation-fill-mode: backwards`, staggered by `--deal-delay`.
   - `role`, label and `data-card`/`data-face` move to the face-up side **on the state change itself**, not at the visual midpoint.
   - Nothing depends on `animationend`.
2. **The wrapper.** It needs `display: block; max-width: 100%`. Today `svg { display: block; max-width: 100% }` (`global.css` ~98-102) covers the root, and an HTML wrapper loses that.
   - Keep `filter`, `opacity` and `overflow` off the `preserve-3d` flipper; the shadow and the deal animation stay on the wrapper.
3. **Detecting down→up.** Do it StrictMode-safely: either `useState(prevDown)` updated during render (the documented pattern), or `useLayoutEffect` plus a ref. Never mutate a ref during render.
4. **Frame capture.**
   - Capture frames by pausing `document.getAnimations()` at `currentTime` 0/150/300/450/600, not by timed screenshots.
   - At 375×812 use the playground's 4-seat table. From 4 opponents up, `.othersChip .seatCards { display: none }` (`table.module.css` ~739) hides their cards.
5. **The result card opens in the same render as the flip.** Check first whether the flip is visible at 1920×940, so a "hidden" report comes early.

### Controller wrap-up (not a subagent task)

- **Reviews.** Run a final whole-branch review on the most capable model, then one fix wave and a scoped re-review.
- **Docs.**
  - `docs/bug-log.md` §7: rows No1, No5, No8a, No9, No10 and No11a read "đã sửa — `<commits>`", with technical notes.
  - `CHANGELOG.md`: a Plan 18 section.
  - The memory file.
- **Master gate.** Remove the worktree first, then run typecheck, lint, test, `build:normal`, `e2e:normal`, `build:lite` + Lite e2e, and the ops pack.
- **Merge** with `--no-ff`.
- **Deploy.**
  1. `/health` shows `rooms: 0`.
  2. `deploy/normal-windows/stop.ps1`.
  3. `run.ps1 -NoMigrate`.
  4. `/health` again, and check that the served bundle has the new strings.
- **Lite.** Rebuild the Lite exe locally (not shipped).
