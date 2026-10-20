# Plan 26 — GM round 2, phone-landscape table, sign-in hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second GM batch (unlock achievements, undo-and-reclaim a check-in, gift months in the database, a per-day source/sink table), a phone-landscape table layout with a compact result card, and a sign-in screen with the generated hero picture, then deploy to the Vietnix VPS.

**Architecture:** Part A extends `GmService` / `routes-gm.ts` / the `#/gm` screen along the Plan 25 seams (every action is one transaction that writes `gm_actions`), moves the gift schedule behind a store that the economy reads per call, and adds one migration `0005`. Part B adds a `frame` ("desktop" | "landscape") decided by `matchMedia` in `RoomScreen`, keyed in CSS by `data-frame`, with a compact header, a menu primitive, a bottom-right action dock and a three-row result card; nothing changes for desktop or portrait except two root fixes. Part C turns `AuthScreen` into a two-column layout at ≥ 1024 px with two WebP exports of `assets/login-hero-src/2026-10-20-v2.png`.

**Tech Stack:** TypeScript, Fastify 5 + Drizzle (PGlite in tests), React + CSS modules, i18next, Playwright (Chromium only), Vitest, sharp (devDependency).

**Spec:** `docs/superpowers/specs/2026-10-20-plan26-gm-round2-phone-landscape-login-design.md` (Vietnamese; Q1–Q11, R1–R11). Round-1 spec: `docs/superpowers/specs/2026-10-18-gm-role-design.md`.

## Global Constraints

- Toolchain on this machine: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm …`; root scripts need the shim `corepack enable --install-directory <scratch>/bin pnpm` on PATH. Node is 24, so `pnpm build:lite` stops at the exe step (record "rebuilt locally, not shipped"). Worktree: `.worktrees/BP-26`, branch `feature/BP-26-gm-round2-phone-landscape-login`.
- Points only (spec §33). Every money path keeps `Σ balances + Σ sink rows` conserved; a negative player row (`gm_checkin_undo`) lowers balance and ledger by the same amount and is classified as a sink in the overview.
- `@bp/core` stays pure; no new runtime dependency anywhere (sharp is already a devDependency of normal-web).
- Every player-facing string in `vi` and `en`; parity tests: `packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts`, `apps/lite/web/src/App.test.tsx`. `react/jsx-no-literals` forbids literals in JSX. Numbers through `formatPoints`, dates through `formatDay` (epoch ms) / `formatMoment`.
- Stable Vietnamese terms keep their exact text (only their place changes): Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Lật, Đã chọn, Xem/Bỏ, Theo mọi mức, Tự động chơi, Sẵn sàng / Hủy sẵn sàng, Bắt đầu, Tạm nghỉ / Chơi tiếp, Mời ra, Người thắng, Rời phòng, Quản lý bàn, Đứng dậy, Mã phòng, Quản trị.
- CSS: tokens from `packages/ui-kit/src/theme/tokens.css`; a phone/landscape block goes **after** the base rules it overrides; tap targets ≥ 44 px (`--tap`); `prefers-reduced-motion` honoured; text never overlaps text (`expectNoTextOverlap`).
- Sign-ups are rate-limited (10/min): new ops accounts only via `newPlayer` / `registerPatiently`; never add a registering test to `pnpm e2e:normal`.
- Commits: Conventional Commits, one sentence in the repo's voice, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push; never `git add -A`.
- Doc citations: `tooling/arch/acceptance-links.test.ts` pins checklist `64 + 3 + 2 + 3` and matrix `43 + 10 + 4 + 7`; bump when rows are added. Vietnamese files are edited with the Edit tool; read a heading back after scripted edits.
- Never print `.env`, `DATABASE_URL`, `SESSION_SECRET`. Production writes (VPS migration, `grant-gm-cli`) only in Task F4, which the user approved in Q11.

## Review Focus

1. **Nine seats at 915×355 in landscape** — the seat badges on the lower rim must not collide with the hero plate or the action dock; a person on a Galaxy with the URL bar showing expects every seat tappable. Pinned in Task B8 (`L-02` runs at 915×355 with 8 bots and asserts no two seat plates intersect and the dock sits below every rim seat).
2. **Reset check-in after the player spent today's points** — GM gets `INSUFFICIENT_BALANCE`, nothing changes, the log gets no row. Pinned in Task A3.
3. **Gift month edited while a claim is in flight** — the claim that started before `setMonth` commits uses the schedule it captured; the next claim sees the new one; nobody gets a month's fixed item twice. Pinned in Task A4.
4. **Amount dialog under the soft keyboard** — at 915×260 (keyboard open) the ✎ dialog's input and confirm button stay inside the viewport. Pinned in Task B4.
5. **Sign-in hero column in the light theme with the long English lead** — the lead text over the image stays readable (contrast ≥ 4.5:1 against the gradient) and does not overlap the card at 1024×700. Pinned in Task C2.

---

## Part A — GM round 2 (server, then web)

### Task A1: Migration `0005_plan26`, new ledger reasons, inventory `ref`

**Files:**
- Modify: `packages/server-kit/src/repositories.ts:16-29` (`TxReason`)
- Modify: `apps/normal-server/src/db/schema.ts` (`GM_ACTION_KINDS:128`, `inventory:209-216`, new `giftMonths`, `pointTransactions` index)
- Create: `apps/normal-server/drizzle/0005_plan26.sql`, `drizzle/meta/0005_snapshot.json`, journal entry (generated)
- Modify: `apps/normal-server/src/db/migrate-gm.test.ts` (BEFORE list), `src/db/schema.test.ts`, `src/test-harness.ts` (`resetDb` table list)
- Modify: `apps/normal-server/src/gm/gm-service.ts:127-129` (`SOURCE_REASONS`/`SINK_REASONS`), `apps/normal-web/src/screens/LedgerPanel.tsx:12-25` (`REASONS`), `apps/normal-web/src/locales/{vi,en}/normal.json` (`ledger.reason.gm_achievement`, `ledger.reason.gm_checkin_undo`, `gm.log.kind.{unlock_achievement,reset_checkin,set_gift_month,clear_gift_month}`)

**Interfaces:**
- Produces: `TxReason` gains `'gm_achievement' | 'gm_checkin_undo'`; `GM_ACTION_KINDS` gains `'unlock_achievement' | 'reset_checkin' | 'set_gift_month' | 'clear_gift_month'`; table `gift_months(month text pk, days jsonb not null, updated_at timestamptz not null default now(), updated_by uuid null references users(id) on delete set null)`; column `inventory.ref text null`; index `point_transactions_created_at_idx (created_at)`.

- [ ] **Step 1: Write the failing migration test** in `migrate-gm.test.ts`: `it('0005 adds gift_months, inventory.ref and the created_at index, idempotently')` — apply `0005` twice on a `0004` database, then `information_schema.columns` has `inventory.ref`, `pg_indexes` has `point_transactions_created_at_idx`, `gift_months` exists.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/db/migrate-gm.test.ts` → FAIL (no 0005).
- [ ] **Step 3: Edit `schema.ts`** (add `ref` to `inventory`, the `giftMonths` table, the index, the four kinds), then `corepack pnpm --filter @bp/normal-server db:generate --name plan26`, then guard the SQL by hand in the `0004_gm.sql` style (`IF NOT EXISTS`, `DO $$ … duplicate_object`). Add `gift_months` to `resetDb`.
- [ ] **Step 4: Add the two reasons** to `TxReason`, to `SOURCE_REASONS` (`gm_achievement`) and `SINK_REASONS` (`gm_checkin_undo`), to `REASONS` in `LedgerPanel.tsx`, and the vi/en strings: vi `gm_achievement` "GM mở thành tựu", `gm_checkin_undo` "GM hoàn tác điểm danh"; log kinds vi "Mở thành tựu", "Đặt lại điểm danh", "Đổi quà tháng", "Về quà mặc định".
- [ ] **Step 5: Run** the migration test, `schema.test.ts`, `gm-service.test.ts`, `locales.test.ts` → PASS. `corepack pnpm typecheck` (via shim) → PASS.
- [ ] **Step 6: Commit** `feat(normal-server): migration 0005 — gift months, an inventory ref and the ledger reasons GM round 2 needs`.

### Task A2: `unlockWithin` and `GmService.unlockAchievement` + route

**Files:**
- Modify: `apps/normal-server/src/achievements/achievement-service.ts:93-133`
- Modify: `apps/normal-server/src/gm/gm-service.ts` (deps, method), `src/http/routes-gm.ts`, `src/http/routes-gm.test.ts:74-94` (route count/methods/placeholders), `src/app.test.ts:357-400` (surface list), `src/app.ts:345` (deps)
- Test: `src/achievements/achievement-service.test.ts`, `src/gm/gm-service.test.ts`, `src/http/routes-gm.test.ts`

**Interfaces:**
- Produces: `export async function unlockWithin(tx: AppTx, playerId: string, def: AchievementDef, at: Date, pay: { inventory: InventoryService; reason: TxReason; refId: string }): Promise<'unlocked' | 'already'>` — upserts the `player_achievements` row (`onConflictDoNothing` on insert, then the guarded UPDATE), credits `def.reward.points` with `pay.reason`/`pay.refId`, grants `def.reward.itemId` with source `'achievement'`. The service's private `unlock` calls it with `reason: 'achievement', refId: \`ach:${playerId}:${def.id}\``.
- Produces: `GmService.unlockAchievement(actor: GmActor, playerId: string, achievementId: string, reason: string): Promise<{ actionId: number; reward: AchievementReward; balance: number }>`; errors `INVALID_ACHIEVEMENT` (400), `ALREADY_UNLOCKED` (409), `TARGET_IS_LOCKED` (409). `GmServiceDeps` gains `defs: AchievementDef[]`.
- Produces: route `POST /api/gm/players/:id/achievements/:achievementId/unlock` `{ reason }` → `200 { actionId, reward, balance }`. Notice `GM_NOTICE { action: 'unlock_achievement', achievementId, reason }`.

- [ ] **Step 1: Failing tests.** `achievement-service.test.ts`: `it('unlockWithin pays once and reports already on the second call, even with no progress row')`. `gm-service.test.ts`: `it('unlockAchievement pays the full reward under gm_achievement, logs unlock_achievement, refuses a second time and refuses a locked target')` — assert the ledger row `{ reason: 'gm_achievement', amount: def.reward.points, ref_id: \`gm:${actionId}\` }`, the inventory row for `def.reward.itemId`, `actions` contains `unlock_achievement` with `item_id = achievementId`, and the conservation sum from `app.test.ts:896` extended with `gm_achievement`.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** `unlockWithin`, refactor `unlock` to use it, add `unlockAchievement` (`checkReason` → tx: `target(tx, playerId)` + locked check → `logAction` → `unlockWithin` → balance), route + `SERVICE_STATUS` entries, `GM_NOTICE` after commit, wire `defs` in `app.ts`.
- [ ] **Step 4: Update the guard tests**: route count 15 → 16 here (the final count after A3–A5 is 22; each task bumps), allow `PUT`/`DELETE`, replace `:achievementId` and `:month` placeholders too; add the route to `app.test.ts`'s surface list.
- [ ] **Step 5: Run** `vitest run src/achievements src/gm src/http/routes-gm.test.ts src/app.test.ts` → PASS.
- [ ] **Step 6: Commit** `feat(normal-server): a GM unlocks an achievement with its full reward through the same code path as earning it`.

### Task A3: Undo-and-reclaim a check-in

**Files:**
- Modify: `apps/normal-server/src/inventory/inventory-service.ts:63-136`, `src/economy/economy-service.ts:173-209` (pass `refId` as `ref` to `grant`), `src/gm/gm-service.ts`, `src/http/routes-gm.ts`, `src/http/routes-gm.test.ts`, `src/app.test.ts`, `src/app.ts`
- Test: `src/inventory/inventory-service.test.ts`, `src/gm/gm-service.test.ts`, `src/economy/economy-service.test.ts`

**Interfaces:**
- Produces: `InventoryService.grant(tx, playerId, itemId, source, ref?: string)`; `InventoryService.findByRef(tx: AppTx, playerId: string, ref: string): Promise<string[]>`; `InventoryService.revoke(tx: AppTx, playerId: string, itemId: string): Promise<boolean>` — clears the item from every optional slot of `players.avatar_config` (`head, face, aura, frame, hairColor, eyeColor, title, badge`) and from `equipped_title`/`equipped_badge`, then deletes the row.
- Produces: `GmService.checkinPreview(playerId): Promise<GmCheckinPreview>` with `GmCheckinPreview = { claimedToday: boolean; day: number; streak: number; points: number; itemIds: string[] }` (points = Σ `point_transactions.amount` where `ref_id = daily:<id>:<today>`; items = `findByRef`).
- Produces: `GmService.resetCheckin(actor, playerId, reason): Promise<{ actionId: number; undone: { points: number; itemIds: string[] }; balance: number }>`; errors `NOT_CLAIMED_TODAY` (409), `INSUFFICIENT_BALANCE` (409), `TARGET_IS_LOCKED`. In one tx: `logAction('reset_checkin', amount: points, details: { previousStreak, previousLastClaimDate, undone })`; `creditWithin(tx, [{ playerId, delta: -points, reason: 'gm_checkin_undo', refId: \`gm:${actionId}\` }])` (throws → `INSUFFICIENT_BALANCE`); `revoke` each item; `daily_logins` ← `{ lastClaimDate: addDaysKey(today, -1), streak: max(streak-1,0), claimedDays: max(claimedDays-1,0) }`; `player_stats.total_login_days ← greatest(-1, 0)`. `GmServiceDeps` gains `timezone: string`.
- Produces: routes `GET /api/gm/players/:id/checkin` → `GmCheckinPreview`; `POST /api/gm/players/:id/checkin/reset` `{ reason }`. Notice `GM_NOTICE { action: 'reset_checkin', reason }`.

- [ ] **Step 1: Failing tests.** `inventory-service.test.ts`: `it('revoke clears the slot and the equipped title before deleting the row')`; `it('findByRef returns the items a daily claim granted')`. `gm-service.test.ts`: `it('resetCheckin undoes today's points and item, steps the streak back, and a reclaim restores it with a fresh draw')` — claim (fixed day via `h.setNow`), reset, assert balance back to the pre-claim value, inventory row gone, `daily_logins` row `{ streak: n-1, lastClaimDate: yesterday, claimedDays: c-1 }`, `total_login_days` −1; then `claimDaily` again → `streak n`, points equal, and `Σ balance + Σ sinks` equal before and after. `it('resetCheckin refuses NOT_CLAIMED_TODAY and INSUFFICIENT_BALANCE and writes no log row in either case')` (Review Focus 2: spend the points with `adjustPoints(-all)` first). `economy-service.test.ts`: `it('a daily item carries the claim ref')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three inventory methods, pass `refId` from `applyItemRule`, the two service methods, routes, status map, `timezone` wiring (`config.timezone`), guard-test count 16 → 18, surface list.
- [ ] **Step 4: Run** the four files → PASS.
- [ ] **Step 5: Commit** `feat(normal-server): a GM can undo today's check-in — points back, item back, streak stepped back — so the player can claim again`.

### Task A4: Gift months in the database

**Files:**
- Create: `apps/normal-server/src/economy/gift-schedule-store.ts`, `src/economy/gift-schedule-store.test.ts`
- Modify: `src/economy/daily-gifts.ts` (export the raw-JSON reader), `src/economy/economy-service.ts:94-144` (`gifts` becomes a getter; `excludedIds` per claim), `src/app.ts:268,315-331,498`, `src/gm/gm-service.ts`, `src/http/routes-gm.ts`, `src/http/routes-gm.test.ts`, `src/app.test.ts`, `src/economy/economy-service.test.ts` (pass `() => schedule`)
- Docs: `docs/normal-server.md` "Changing the daily gifts"

**Interfaces:**
- Produces: `export function readDailyGiftsRaw(path = defaultDailyGiftsPath()): unknown` in `daily-gifts.ts`.
- Produces: `createGiftScheduleStore(deps: { db: AppDb; catalog: ItemCatalog; defaults: unknown; now?: () => number; timezone: string }): Promise<GiftScheduleStore>`; `interface GiftScheduleStore { current(): DailyGiftSchedule; months(): Promise<GiftMonthRow[]>; setMonth(tx: AppTx, month: string, days: unknown, actorUserId: string | null): Promise<void>; clearMonth(tx: AppTx, month: string): Promise<boolean>; reload(): Promise<void> }`; `GiftMonthRow = { month: string; days: Record<string, unknown>; source: 'file' | 'db'; updatedAt: number | null; updatedBy: string | null }`. `setMonth` builds `{ default, months: { ...fileMonths, ...dbMonths, [month]: days } }`, runs `parseDailyGifts(candidate, catalog, 'gift_months')` (throws → `ServiceError('INVALID_GIFTS', message)`), refuses `month < monthKey(now)` → `MONTH_IN_PAST`, and for the current month refuses any day key `≤ dayOfMonth(today)` that differs from the merged current value → `TIER_LOCKED` (R7). The caller commits; the store swaps `current()` in `reload()` called after commit.
- Produces: `EconomyServiceDeps.gifts: () => DailyGiftSchedule`; `excludedIds` computed inside `claimDaily` from `deps.gifts().fixedItemIds()`.
- Produces: `GmService.giftMonths(): Promise<GiftMonthRow[]>` (default + file months + db months, 13 months from the current one), `setGiftMonth(actor, month, days, reason): Promise<{ actionId }>`, `clearGiftMonth(actor, month, reason): Promise<{ actionId }>` (logs `set_gift_month` / `clear_gift_month` with `details: { month, days }`, `targetPlayerId: null`).
- Produces: routes `GET /api/gm/gifts` → `{ default: Record<string, unknown>; months: GiftMonthRow[] }`, `PUT /api/gm/gifts/:month` `{ days, reason }`, `DELETE /api/gm/gifts/:month` `{ reason }`; 400 `INVALID_GIFTS` / `MONTH_IN_PAST` / `TIER_LOCKED` (message carried through).

- [ ] **Step 1: Failing tests.** `gift-schedule-store.test.ts`: `it('merges file months under db months and refuses a past month, a locked tier and an invalid candidate with the parser's message')`; `it('a claim that began before setMonth keeps its schedule; the next claim sees the new fixed item; the item is granted once')` (Review Focus 3: capture `gifts()` at claim start, `setMonth` between two claims across two players). `gm-service.test.ts`: `it('setGiftMonth and clearGiftMonth log with the month in details')`. `routes-gm.test.ts`: PUT/DELETE through `gmReq`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** store, economy getter, GM methods, routes (count 18 → 21), `app.ts` wiring (`gifts: () => store.current()`; `AppServices.gifts` becomes the store), docs paragraph.
- [ ] **Step 4: Run** `vitest run src/economy src/gm src/http src/app.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(normal-server): the monthly gift schedule lives in gift_months with the JSON file as default, and a GM edits a month without a restart`.

### Task A5: Per-day source/sink sums

**Files:**
- Modify: `apps/normal-server/src/repos/balance-repo.ts:215-253` (`LedgerReader`), `src/gm/gm-service.ts`, `src/http/routes-gm.ts`, tests as before
- Test: `src/repos/balance-repo.test.ts`, `src/gm/gm-service.test.ts`

**Interfaces:**
- Produces: `LedgerReader.sumsByDay(sinceMs: number, timeZone: string): Promise<DaySums[]>` with `DaySums = { day: string /* YYYY-MM-DD */; sources: Record<string, number>; sinks: Record<string, number>; net: number }`, one SQL `GROUP BY (created_at AT TIME ZONE $tz)::date, reason, kind`; sinks are rows with `player_id IS NULL` plus player rows whose reason is in `SINK_REASONS` (amount made positive). Days with no rows are filled in by the caller.
- Produces: `GmService.dailyStats(days: 7 | 30): Promise<DaySums[]>` (ascending, exactly `days` entries, zeros filled); route `GET /api/gm/stats/daily?days=7|30` (other values → 400 `INVALID_DAYS`). Route count 21 → 22.

- [ ] **Step 1: Spike first (5 min):** in `balance-repo.test.ts` run `select (now() at time zone 'Asia/Ho_Chi_Minh')::date` on PGlite. If it throws, implement `sumsByDay` as "select rows since `sinceMs` and bucket with `dayKey(createdAt, tz)` in JS" and note it in the test's comment.
- [ ] **Step 2: Failing tests.** `balance-repo.test.ts`: `it('sumsByDay buckets by the economy day: 23:30 and 00:30 Ho Chi Minh land on different days')`. `gm-service.test.ts`: `it('dailyStats fills 7 zero days and classifies gm_checkin_undo as a sink')`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(normal-server): GET /api/gm/stats/daily sums the ledger's sources and sinks per economy day for 7 or 30 days`.

### Task A6: Web — unlock achievement and reset check-in in `PlayerDetail`

**Files:**
- Modify: `apps/normal-web/src/api.ts` (DTOs + methods), `src/screens/gm/PlayerDetail.tsx:16-27,52-81,211-221`, `src/screens/gm/ReasonDialog.tsx:22-33`, `src/notifications.ts:61-78`, `src/screens/AchievementsScreen.tsx:96-99`, `src/locales/{vi,en}/normal.json` (`gm.actions.{unlockAchievement,resetCheckin}`, `gm.dialog.{achievement,checkinBody}`, `gm.done.{unlockAchievement,resetCheckin}`, `gm.errors.{INVALID_ACHIEVEMENT,ALREADY_UNLOCKED,NOT_CLAIMED_TODAY}`, `gm.notice.{unlock_achievement,reset_checkin}`)
- Test: `src/screens/gm/PlayerDetail.test.tsx`, `src/screens/gm/ReasonDialog.test.tsx`, `src/notifications.test.ts`

**Interfaces:**
- Consumes: A2/A3 routes.
- Produces: `api.gmUnlockAchievement(id, achievementId, reason)`, `api.gmCheckin(id): Promise<GmCheckinDto>`, `api.gmResetCheckin(id, reason)`; `GmCheckinDto = { claimedToday, day, streak, points, itemIds }`.
- Produces: `ReasonDialogProps.fields` gains `achievement?: AchievementDefDto[]` (a `<select>` of definitions, unlocked ones disabled — the caller passes the player's `unlockedIds`), `ReasonValues` gains `achievementId?`. `ActionKind` gains `'unlockAchievement' | 'resetCheckin'`; the reset action is enabled only when `gmCheckin(id).claimedToday`, and its `body` names the points and items that will be taken back (`formatPoints`, item names from `items.*`).
- Produces: `gmNoticeText` handles `unlock_achievement` (achievement name) and `reset_checkin` (vi "Lượt điểm danh hôm nay đã được mở lại"). `AchievementsScreen` draws a full bar when `unlockedAt !== null`.

- [ ] **Step 1: Failing tests** (RTL, as the existing files do): dialog renders the achievement select with the unlocked option disabled; PlayerDetail disables "Đặt lại điểm danh" until the preview says `claimedToday`; notice text for the two kinds; AchievementsScreen bar width 100 % when unlocked with `progress < threshold`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/normal-web test` → PASS; `locales.test.ts` parity.
- [ ] **Step 5: Commit** `feat(normal-web): Quản trị unlocks an achievement from a picker and resets a check-in after showing what it takes back`.

### Task A7: Web — the "Quà tháng" tab

**Files:**
- Create: `apps/normal-web/src/screens/DailyCalendar.tsx` (extracted from `DailyScreen.tsx:358-422`), `src/screens/gm/GiftsTab.tsx`, tests for both
- Modify: `src/screens/DailyScreen.tsx`, `src/screens/gm/GmScreen.tsx:12-13` (`Tab` gains `'gifts'`), `src/api.ts`, locales (`gm.tabs.gifts` "Quà tháng", `gm.gifts.*`: month label, source file/db, tier kinds, save, reset to default, locked-day hint)

**Interfaces:**
- Consumes: A4 routes. `api.gmGifts()`, `api.gmSetGiftMonth(month, days, reason)`, `api.gmClearGiftMonth(month, reason)`.
- Produces: `DailyCalendar({ entries: CalendarEntryDto[]; day?: number | null; claimable?: boolean; onPick?: (day: number) => void; lockedThrough?: number; lang: Language })` — the grid DailyScreen renders today, plus an optional pick handler and a locked range; `GiftsTab(props: GmTabProps)`: month `Select` (current + 12), the calendar built from the merged rules (`markerOf` for icons), tap a day → a small editor (`Segmented`: Không · Ngẫu nhiên thường · Ngẫu nhiên hiếm · Cố định + item `Select` from `api.catalogItems()`), Lưu (opens `ReasonDialog`) and Về mặc định (ReasonDialog, only when `source === 'db'`). Days `≤ today` of the current month are locked.

- [ ] **Step 1: Failing tests:** `DailyCalendar.test.tsx` renders 31 cells and calls `onPick` except for locked days; `GiftsTab.test.tsx` builds the `days` payload from edits and sends `PUT` with the reason; `DailyScreen.test.tsx` still passes after the extraction.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Screenshot the tab at 1920×940, 1366×768, 375×812 (playwright `zz-preview`, deleted after).
- [ ] **Step 5: Commit** `feat(normal-web): a Quà tháng tab lets a GM set a month's check-in gifts on the same calendar players see`.

### Task A8: Web — per-day table with CSS bars in the Overview

**Files:**
- Modify: `apps/normal-web/src/screens/gm/OverviewTab.tsx`, `src/api.ts` (`gmDailyStats(days)`), `src/screens/gm/gm.module.css`, locales (`gm.overview.byDay`, `gm.overview.days7/30`, column heads)
- Test: `src/screens/gm/OverviewTab.test.tsx`

- [ ] **Step 1: Failing test:** with a 7-day fixture, the table has 7 rows, each with a gold bar whose width % equals `sources / max` and a red bar for sinks; the `Segmented` switch requests `days=30`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (bars are two `<span>`s with inline `width`, `aria-hidden`; numbers via `formatPoints`; day label via `formatDay(Date.parse(day + 'T00:00:00'), lang)`).
- [ ] **Step 4: Run** → PASS. Screenshots as in A7. **Step 5: Commit** `feat(normal-web): the Quản trị overview shows sources and sinks per day for 7 or 30 days as a table with bars`.

### Task A9: Ops `Q-03` and Part A docs

**Files:**
- Modify: `apps/normal-web/e2e/ops/06-gm.spec.ts` (add `Q-03`), `docs/normal-server.md` (GM section + gifts), `docs/normal-web.md` "The Quản trị screen", `docs/security.md` (new routes), `docs/acceptance-checklist.md` (row P26.1), `docs/test-matrix.md` (Q-03 row), `tooling/arch/acceptance-links.test.ts` counts, `CLAUDE.md` §3 ops count, `docs/player-guide.md` (one line: a GM may reopen today's check-in)

- [ ] **Step 1: Write `Q-03`** ("Q-03 GM mở thành tựu, đặt lại điểm danh, đổi quà tháng"): promote via `/e2e/promote`, player claims, GM resets (sees the points named in the dialog), player claims again, GM unlocks `login_days_7`, GM sets next month's day 7 to a fixed item and the player's Điểm danh calendar shows it. Accounts only via `newPlayer`.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "Q-03"` → PASS. Update docs and counts; `corepack pnpm exec vitest run --root . tooling/arch` → PASS.
- [ ] **Step 3: Commit** `test(e2e): Q-03 walks the GM's second batch; docs for the new routes, the gift store and the per-day table`.

## Part B — phone-landscape table

### Task B1: Root fixes and the `frame` plumbing

**Files:**
- Create: `packages/ui-kit/src/table/frame.ts` (`RoomFrame`, `LANDSCAPE_PHONE`, `useRoomFrame`), test `frame.test.ts`
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx:21-35,222` (prop `frame?: RoomFrame`, `data-frame`), `screens/screens.module.css:102-108`, `table/table.module.css:1268-1302,1439-1444`, `screens/seat-clearance.ts:28-33`, `table/PokerTable.tsx:107-108` (ring when frame is landscape), `src/index.ts` (exports)
- Test: `screens/seat-clearance.test.ts`, `table/HandResult.test.tsx`

**Interfaces:**
- Produces: `type RoomFrame = 'desktop' | 'landscape'`; `const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 500px)'`; `useRoomFrame(override?: RoomFrame): RoomFrame`. `RoomScreen` root carries `data-frame={frame}`; every landscape rule in CSS is keyed `[data-frame='landscape']` (R1). `PokerTable` gets `frame` and uses `'ring'` when `frame === 'landscape'` regardless of `STACKED`.
- Produces (root fixes, all frames): `.resultLive { overflow: hidden }`, `.resultHead { flex-shrink: 0 }`, `.resultFoot { flex-shrink: 0 }`; `clearanceFor` tier 3 returns `0` instead of `null`; `[data-frame='landscape'] .room { height: 100dvh; min-height: 0; overflow: hidden; overscroll-behavior: none; padding-left: max(var(--space-3), env(safe-area-inset-left)); padding-right: max(var(--space-3), env(safe-area-inset-right)) }`.

- [ ] **Step 1: Failing tests:** `frame.test.ts` (override wins; without `matchMedia` → `'desktop'`); `seat-clearance.test.ts` `it('returns 0, not null, when the stage is shorter than MIN_CARD')`; `HandResult.test.tsx` `it('keeps the footer below the head when the card is 140 px tall')` (jsdom cannot lay out, so assert the class contract: `resultLive` has `overflow: hidden` via the module's computed style in a Playwright check instead — put that check in B8 `L-03` and keep the jsdom test to the clearance change).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/ui-kit test` → PASS; `pnpm e2e:normal` result-card tests still PASS (`expectScrimLeavesNoEdge`, overlap at 1920/1366/375).
- [ ] **Step 5: Commit** `fix(ui-kit): the result card's head can no longer spill over its footer; a room knows its frame`.

### Task B2: `MenuButton` primitive, compact header, the ⋯ menu, fullscreen

**Files:**
- Create: `packages/ui-kit/src/primitives/MenuButton.tsx`, `MenuButton.test.tsx`
- Modify: `packages/ui-kit/src/table/RoomHeader.tsx` (prop `compact?: boolean`, `menu?: ReactNode`), `table/table.module.css` (after line 1630: `[data-frame='landscape'] .header` strip), `screens/RoomScreen.tsx:224,269-336`, `screens/screens.module.css`, `i18n/locales/{vi,en}/game.json` (`room.more` "Thêm", `room.fullscreen` "Toàn màn hình", `room.exitFullscreen` "Thoát toàn màn hình"), `primitives/index`/`src/index.ts`
- Test: `screens/RoomScreen.test.tsx`

**Interfaces:**
- Produces: `MenuButton({ label: string; items: MenuItem[]; align?: 'right' | 'left' })` with `MenuItem = { id: string; label: string; onSelect: () => void; disabled?: boolean; pressed?: boolean }`; renders `<button aria-haspopup="menu" aria-expanded>` with the label "⋯" (`aria-label={label}`) and a `role="menu"` panel of real `<button role="menuitem">` elements (text = `label`, `aria-pressed` when `pressed` is defined); closes on Escape, outside pointerdown and after a select; returns focus to the trigger.
- Produces: `RoomHeader compact` renders a one-line `<header>` (≤ 28 px text): `.conn` dot + text, `h1.roomName`, `.code` with `aria-label={t('labels.code')}` (helpers read it), `.stakes`; right side: `{menu}` then the "Rời phòng" `Button` (unchanged text and `onLeave`, R2).
- Produces: in `RoomScreen`, when `frame === 'landscape'`: the footer `.controls` row is not rendered; the menu items are, in order and only when their footer counterpart would show today: Đứng dậy, Tạm nghỉ / Chơi tiếp (`pressed`), Quản lý bàn, and Toàn màn hình / Thoát toàn màn hình when `document.fullscreenEnabled` (R3; `document.documentElement.requestFullscreen()` / `document.exitFullscreen()`); a bottom-right `.dock` holds Sẵn sàng / Hủy sẵn sàng, Bắt đầu, the ready count and the hint while `waiting` and no `ActionBar` is shown. The "Mời ra" buttons stay inside the Quản lý bàn modal.

- [ ] **Step 1: Failing tests:** `MenuButton.test.tsx` (opens, lists items by text, Escape closes, select closes and calls); `RoomScreen.test.tsx` `it('in the landscape frame the footer row is gone and Đứng dậy, Tạm nghỉ, Quản lý bàn live in the Thêm menu')`, `it('offers Toàn màn hình only when document.fullscreenEnabled')`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** ui-kit tests + i18n parity (three files) → PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): on a landscape phone the room header is one line and the table buttons move into a Thêm menu, with Toàn màn hình where the browser allows it`.

### Task B3: The landscape ring — seats, hero, geometry

**Files:**
- Modify: `packages/ui-kit/src/table/geometry.ts:15-73` (`ringPositions(seatOrder, anchorSeat, box?: { w: number; h: number })`), `table/PokerTable.tsx:117,151`, `table/Seat.tsx:217-237,307-323`, `table/table.module.css` (new block after 897)
- Test: `table/geometry.test.ts`, `table/PokerTable.test.tsx`

**Interfaces:**
- Produces: `ringPositions` takes the real box ratio (from a `ResizeObserver` on `.ring` in `PokerTable`, default 2) so seats sit on the drawn ellipse when width caps the box; `[data-frame='landscape'] .ring { height: calc(100% - 8px); max-height: none; margin: 4px auto; width: min(100%, calc((100dvh - 150px) * 2.3)); aspect-ratio: auto }`; seats: `--seat-min: 94px; --seat-disc: 30px; --seat-name: .75rem; --seat-gap: 2px`, `.cardSm` 20×28 px, `.seat::after { content: ''; position: absolute; inset: calc((44px - 100%) / 2) 0 }` only when the plate is shorter than 44 px (hit area), `.seatMe .plate` anchored to the rim bottom with `.tags` directly under it and `.cardMd` ≥ 50 px wide, `PeelCard` ≥ 60 px wide.

- [ ] **Step 1: Failing tests:** `geometry.test.ts` `it('with a 2.5:1 box the top seat still lies on the ellipse RX·w, RY·h')`; `PokerTable.test.tsx` `it('renders the ring in the landscape frame even under the STACKED query')` (pass `frame="landscape"` and `layout` unset with `matchMedia` stubbed true).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; playground `#worst/turn/9/vi` at 915×355 screenshot (B7 adds the frame param; until then resize the window) shows no plate overlap.
- [ ] **Step 5: Commit** `feat(ui-kit): the landscape table is a full-height ellipse with compact seats, a 44 px tap pad and the hero on the rim`.

### Task B4: The landscape action dock and the amount dialog

**Files:**
- Modify: `packages/ui-kit/src/table/ActionBar.tsx:12-27,164-307`, `table/table.module.css` (after 1263), `primitives/Modal.tsx` (prop `anchor?: 'center' | 'top'`), `primitives/primitives.module.css:310-340`, `i18n` (`labels.amountDialog` "Nhập số điểm", reuse `actions.confirm`)
- Test: `table/ActionBar.test.tsx`, `primitives/Modal.test.tsx`

**Interfaces:**
- Produces: `ActionBarProps.frame?: RoomFrame`. In the landscape frame the tray is `position: absolute; right: var(--space-3); bottom: calc(var(--space-3) + env(safe-area-inset-bottom))`, column: `.presets` row (existing Min · ½ · Pot · Max, 30 px tall) + a `✎` `.preset` that opens `AmountDialog`, then `.trayRow` with the same action buttons at `min-height: 48px` (Tất tay stays an action button; spec's "½ pot / Pot / Tất tay" preset list maps to these existing names — deviation recorded in the CHANGELOG). No `.slider` and no inline `.amount` in landscape. The pre-action toggles and Tự động chơi render in a `.trayLeft` dock (`left: var(--space-3)`, pills 34 px). Waiting-state height is reserved (`min-height: 86px`) so the dock does not jump.
- Produces: `Modal anchor="top"` places the dialog at `top: var(--space-4)` instead of centring (R11). `AmountDialog` = `Modal` with a `type="number"` input (`aria-label={t('labels.amount')}`), min/max from `legal`, confirm sets the amount and closes.

- [ ] **Step 1: Failing tests:** `ActionBar.test.tsx` `it('in the landscape frame there is no slider; ✎ opens the amount dialog and confirm sets the raise amount')`; `Modal.test.tsx` `it('anchor top adds the top class')`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Playwright check (in B8 `L-04`): at 915×260 the dialog input and confirm are within the viewport (Review Focus 4).
- [ ] **Step 5: Commit** `feat(ui-kit): on a landscape phone the betting buttons sit in a bottom-right dock, presets replace the slider and a typed amount opens a small dialog`.

### Task B5: Compact result card in landscape

**Files:**
- Modify: `packages/ui-kit/src/table/table.module.css` (after the B4 block), `table/HandResult.tsx` (no prop; CSS only unless a class is needed), `screens/screens.module.css:135-152` (overlay padding in landscape)

- [ ] **Step 1: Implement** `[data-frame='landscape'] .result { width: min(560px, 100%); padding: var(--space-3) var(--space-4) }`, `.resultHead` single line with Đóng right, `.resultBody` the only scrolling row, `.resultFoot` one line with `.resultNext` pushed right; overlay keeps the dock visible (`inset: 0 0 var(--dock-h, 0) 0` where `.room` sets `--dock-h` from the tray height via `ResizeObserver` in `RoomScreen`).
- [ ] **Step 2: Verify** with playground `#worst/result/6/vi/long` at 915×355 and 844×390: no text overlap (B8 `L-03` pins it), the Đóng button ≥ 44 px, countdown visible.
- [ ] **Step 3: Commit** `feat(ui-kit): the result card on a landscape phone is one compact block — title, winners, fee and countdown never overlap`.

### Task B6: Portrait debts — the 11 px scroll and the player guide

**Files:**
- Modify: `packages/ui-kit/src/table/RoomHeader.tsx` + `table.module.css:1566-1630` (at ≤ 767 px the "Nặn bài" badge renders inside `.headText` after the name; `.players` hidden ≤ 480 px when squeeze), `table/Seat.tsx:269-280` + `table.module.css:475-494` (`.revealBtn` becomes `position: absolute; bottom: -4px; left: 50%` over `.seatCards`, no own row; `.revealBtnIdle` keeps `visibility: hidden`), `apps/normal-web/e2e/ops/04-blind.spec.ts:435-508` (F-12 also runs the play-or-fold squeeze table and asserts `expectRoomFits([PHONE_SCREEN])`), `docs/known-limitations.md:513-523` (remove), `docs/player-guide.md:27`
- Test: `table/Seat.test.tsx` (pill still toggles `revealBtnIdle`), F-12

- [ ] **Step 1: Extend F-12** with the play-or-fold variant and `expectRoomFits`. **Step 2: Run** F-12 → FAIL by 11 px. **Step 3: Implement.** **Step 4: Run** F-12 both variants → PASS; `expectCardClearsMySeat` and the Blind peel tests still PASS.
- [ ] **Step 5: Rewrite** the player-guide sentence (vi): on a landscape phone the table is a small oval, the buttons sit bottom-right, Đứng dậy / Tạm nghỉ / Quản lý bàn are under ⋯. Remove the known-limitation entry.
- [ ] **Step 6: Commit** `fix(ui-kit): a play-or-fold squeeze table no longer scrolls 11 px on a 375 px phone; the guide says what a landscape phone really shows`.

### Task B7: Playground `#worst` learns `blindS` and a frame parameter

**Files:**
- Modify: `packages/ui-kit/playground/scenarios.tsx:29-52,86-160,228-251`, `playground/main.tsx:124-127`, `playground/screenshots/README.md`

- [ ] **Step 1: Implement** `WorstState` + `'blindS'` (squeeze room, `phase: 'SQUEEZE'`, seat 0 `holeCards` unrevealed), and an optional sixth hash segment `landscape` that passes `frame="landscape"` to `RoomScreen` (`#worst/turn/9/vi/short/landscape`; `short` is the existing fifth slot's default name — keep `long` working).
- [ ] **Step 2: Verify** `corepack pnpm --filter @bp/ui-kit playground`, open the four states at 915×355, 915×412, 844×390 with Playwright from `apps/normal-web` and save the screenshots under the SDD workspace; record the sizes in the README.
- [ ] **Step 3: Commit** `chore(playground): #worst renders a squeeze table and a forced landscape frame for screenshots`.

### Task B8: The `landscape` e2e project and the `L-0x` cases

**Files:**
- Modify: `apps/normal-web/e2e/ops/ops.config.ts:43-54` (project `landscape`: `grep: /@landscape/`, viewport 915×412, `hasTouch`, `isMobile`, `deviceScaleFactor: 2.6`; `desktop.grepInvert: /@mobile|@landscape/`), `e2e/playwright.config.ts:59-70` (same), `e2e/support.ts` (`LANDSCAPE_SCREEN = {915,412}`, `SHORT_LANDSCAPE = {915,355}`, `IPHONE_LANDSCAPE = {844,390}`; `openRoomMenu(page)` that clicks the "Thêm" button; `takeSeat`/`sit` accept `{ via: 'menu' }` so "Đứng dậy" is looked for inside the open menu), `e2e/ops/ops-helpers.ts` (export `touchDrag` from `04-blind.spec.ts` into helpers)
- Create: `apps/normal-web/e2e/ops/07-landscape.spec.ts`
- Modify: `e2e/normal.spec.ts` (after 621: `expectRoomFits(page, 'landscape …', [LANDSCAPE_SCREEN])` for the four states)

**Interfaces:** cases, each ending with `expectRoomFits` (page and `main` do not scroll) and `expectNoTextOverlapAt`:
- `L-01 @landscape` Hold'em waiting: compact header shows "Mã phòng", menu holds Đứng dậy / Tạm nghỉ / Quản lý bàn, dock shows Sẵn sàng and Bắt đầu; Rời phòng visible top-right.
- `L-02 @landscape` nine seats at `SHORT_LANDSCAPE`: no two `[data-plate]` boxes intersect, every seat box lies inside the viewport, the dock's top is below the lowest rim seat (Review Focus 1).
- `L-03 @landscape` result card at 915×412 and 844×390: no text overlap in the card, Đóng ≥ 44 px, countdown visible; `getComputedStyle(.resultLive).overflow === 'hidden'`.
- `L-04 @landscape` my turn: presets visible, no `input[type=range]`, ✎ opens the dialog; at 915×260 the dialog's input and confirm are inside the viewport (Review Focus 4); raise 300 goes through.
- `L-05 @landscape` squeeze table: `touchDrag` peels, Lật works, Mời nặn bài → Người thắng; Rời phòng from the header leaves.

- [ ] **Step 1: Write the cases** (accounts via `newPlayer(browser, stem)`; rooms via `createHoldemRoom` / `createBlind`). **Step 2: Run** `-c e2e/ops/ops.config.ts --project landscape` → expect failures where B2–B5 are incomplete; fix in the owning files. **Step 3: Run** the whole ops pack → PASS (36 + 5 + Q-03 = 42 cases). **Step 4: Run** `pnpm e2e:normal` → 24/24.
- [ ] **Step 5: Commit** `test(e2e): a landscape project runs five phone-landscape cases and the room-fits check at 915×412`.

### Task B9: Part B docs

**Files:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md:954` (replace the "< 768 ngang" line with the B1–B5 summary, marked "Plan 26"), `docs/ui-kit.md:671-697` (Responsive rules: the frame, the menu, the dock, the dialog), `docs/known-limitations.md` (add: no orientation lock on iOS; a portrait soft keyboard can trip the landscape query; items from claims before 0005 have no `ref` and are not taken back by a reset), `docs/test-matrix.md` (rows for L-01…L-05 and the extended F-12), `docs/acceptance-checklist.md` (row P26.2), `tooling/arch/acceptance-links.test.ts` counts, `CLAUDE.md` §3 (ops count, project list), `docs/copy-review-2026-10-10.md` §3 ("Thêm", "Toàn màn hình").

- [ ] **Step 1: Edit** each with the Edit tool; read a Vietnamese heading back. **Step 2: Run** `corepack pnpm exec vitest run --root . tooling/arch` → PASS. **Step 3: Commit** `docs: the landscape frame in the SRS, the ui-kit rules, the test matrix and the limitations`.

## Part C — the sign-in screen

### Task C1: Export the hero picture

**Files:**
- Create: `apps/normal-web/scripts/login-hero.mjs`, `apps/normal-web/public/login/hero-1536.webp`, `public/login/hero-768.webp`
- Modify: `apps/normal-web/package.json` (script `login:hero`), `docs/login-hero-art.md` §6/§7 (the command, the sizes)

- [ ] **Step 1: Write** `login-hero.mjs`: `sharp(src).resize(1536).webp({ quality: 82 }).toFile(...)` and `resize(768)`; `src` = `assets/login-hero-src/2026-10-20-v2.png` (copy it from the main checkout into the worktree's `assets/login-hero-src/` first; it stays ignored). Print both sizes; exit 1 if 1536 > 250 KB or 768 > 90 KB (then rerun with `quality: 76` and record it).
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-web login:hero` → two files, sizes printed. **Step 3: Commit** `art(normal-web): the sign-in hero picture, 1536 and 768 px WebP, from the 2026-10-20 V2 render` (stage the two webp files and the script by name).

### Task C2: `AuthScreen` layout A

**Files:**
- Modify: `apps/normal-web/src/screens/AuthScreen.tsx:181-294`, `src/screens/normal.module.css:333-386` (+ a new `@media (min-width: 1024px)` block **after** them), `src/locales/{vi,en}/normal.json` (`auth.heroLead`: vi "Poker điểm thưởng, chơi với bạn bè. Một tài khoản, mọi thiết bị: điểm, tủ đồ và thành tựu đi theo bạn." / en "Points poker with friends. One account, every device: your points, wardrobe and achievements go with you."), `src/screens/AuthScreen.test.tsx`
- Modify: `apps/normal-web/e2e/normal.spec.ts:231-249` (add: the hero `<img>` has `naturalWidth > 0`; at 320×812 `expectNoSidewaysScroll`; at 1024×700 light theme the lead's contrast ≥ 4.5 against its backdrop sample — compute from a 1-px canvas sample under the text box, Review Focus 5)

**Interfaces:**
- Produces: `main.authStage` becomes a two-column grid at ≥ 1024 px: `.authHero` (grid column 1, `data-surface="night"`, `<img className={s.heroImg} srcSet="/login/hero-768.webp 768w, /login/hero-1536.webp 1536w" sizes="(min-width: 1024px) 62vw, 100vw" fetchpriority="high" decoding="async" alt="">`, a gradient overlay, and `.heroText` with `<h1 className={s.heroTitle}>` + `<p className={s.heroLead}>`) and the card in column 2; below 1024 px `.authHero` is a 300 px band above the card (`object-position: 34% 28%`) and the card overlaps it by 50 px (`margin-top: -50px`). R10: the card's `cardHead` h1 + lead get `display: none` at ≥ 1024 px and the hero's `h1` + lead `display: none` below; jsdom sees both, so the unit test asserts by class, and Playwright's role query sees one.
- The auth e2e check already runs at 1920×940, 1366×768 and 375×812 (`tourStart`); only the three assertions above are added.

- [ ] **Step 1: Failing tests:** `AuthScreen.test.tsx` `it('renders the hero picture with both sources and the hero lead')`; the e2e additions.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** unit + `pnpm e2e:normal` (auth tests) → PASS; screenshots at 1920×940, 1366×768, 375×812, plus 1024×700 light.
- [ ] **Step 5: Commit** `feat(normal-web): the sign-in screen seats the card beside a table of friends — the hero picture fills the left column on a desktop and crowns the card on a phone`.

### Task C3: Part C docs

**Files:** `docs/normal-web.md` (new section "The sign-in screen" before "The Daily screen"), `docs/known-limitations.md:441-451` (the AI-art entry also covers `public/login/`), `docs/copy-review-2026-10-10.md` §4 table (`auth.heroLead` row), `docs/login-hero-art.md` §7 (final file names), `docs/acceptance-checklist.md` (row P26.3), counts.

- [ ] **Step 1: Edit; run `tooling/arch`** → PASS. **Step 2: Commit** `docs: the sign-in screen, its picture and its licence note`.

## Final

### Task F1: CHANGELOG, lessons, final review

- [ ] **Step 1:** `CHANGELOG.md` new top section ``## Plan 26 — GM round 2, a landscape table and a sign-in picture — merged `MERGE` (2026-10-2x)`` with: what the player sees, what is under it, tests and docs, **Khác với spec / Deviations from the spec** (presets keep Min · ½ · Pot · Max; Tất tay stays an action button; any PGlite tz fallback; items before 0005 not taken back), **Still open**. `docs/lessons-learned.md`: Plan 26 rulings R1–R11 + the SDD rulings.
- [ ] **Step 2:** whole-branch review by an opus subagent → one fix wave → re-review.
- [ ] **Step 3: Commit** `docs: Plan 26 in the CHANGELOG and the lessons learned`.

### Task F2: The full gate (one step at a time, each to a log)

- [ ] typecheck → lint (in the worktree) → `pnpm test` (expect ≈ 2 900, 14 skipped) → `build:normal` → `build:lite` (exe step skipped on Node 24: record) → `avatar:check` → `e2e:normal` 24/24 → `--filter @bp/lite e2e` 4/4 → ops pack (expect 42/42 across desktop, mobile, landscape). Report every number.

### Task F3: Merge

- [ ] In the main checkout: `git merge --no-ff feature/BP-26-gm-round2-phone-landscape-login -m "Merge feature/BP-26-gm-round2-phone-landscape-login: <one sentence>"`, then a `docs:` commit replacing `MERGE` with the hash. Remove the worktree (`git -C .worktrees/BP-26 status` clean → `cmd /c rmdir /s /q`, `git worktree prune`).

### Task F4: Deploy to the Vietnix VPS (Q11; production writes approved)

- [ ] **Step 1:** ask the user to `git push origin main` (the assistant never pushes); wait for their word.
- [ ] **Step 2:** `ssh -i ~/.ssh/bind-poker ubuntu@14.225.254.250 'cd /opt/bind-poker/deploy/normal && ./backup.sh'` (a fresh dump before the migration), then `git -C /opt/bind-poker pull --ff-only && cd /opt/bind-poker/deploy/normal && docker compose up -d --build` (the `migrate` service applies `0004_gm` and `0005_plan26`). Watch `docker compose logs migrate app --tail 50` for both tags and `"db":"ok"`.
- [ ] **Step 3:** `docker compose exec app node dist/grant-gm-cli.js tbinh9031@gmail.com` (the GM account the user named in Plan 25).
- [ ] **Step 4:** smoke in the built-in browser at `https://play.14-225-254-250.sslip.io/`: the sign-in screen shows the hero picture at desktop and at 375×812; never sign in. Report the new container ids and the `/health` body.
- [ ] **Step 5:** the LAN Windows kit has no `.env` on this machine (memory `toolchain-corepack-node24`): record "not deployed to the LAN kit" in the report.
- [ ] **Step 6:** the one report: what shipped, gate numbers, rulings, deviations, residuals, what the user must check by hand (real phone landscape in Chrome Android and iOS Safari; the GM screen on a phone; `docs/vps_acc.txt` / `docs/my_root.txt` to delete).

---

## Amendments (pre-flight 2026-10-20)

An independent opus reviewer checked every task against the code and ran PGlite, sharp and the WebP export. Each item
below overrides the task text above. Decisions marked **Ruling** are the plan author's.

**Part A**

- **P1 (A1, blocking).** `migrate-gm.test.ts:140` and `migrate-ledger-keys.test.ts:123` count applied migrations: change `toHaveLength(5)` → `6`. Put the 0005 test in a new `src/db/migrate-plan26.test.ts` modelled on `migrate-gm.test.ts:113-141` (apply `[...BEFORE, '0004_gm']` first; a "real migrator" case cutting the journal at `0004_gm` and asserting 0005's `when` > `1792330901284`).
- **P2 (A1/A5/Global, blocking). Ruling:** `gm_checkin_undo` is a **negative source** (`SOURCE_REASONS`), exactly like `gm_adjust` (`repositories.ts:27`): `overview()` sums signed totals, so listing it under `SINK_REASONS` would shrink the sinks figure. Conservation holds (balance and ledger fall together). A5's test becomes `'dailyStats … counts gm_checkin_undo against the sources'`. Record as a spec deviation (spec A2 said "tính như một bể").
- **P3 (A2 → A6, blocking).** `GmPlayerDetail` (`gm-service.ts:59`) gains `unlockedAchievementIds: string[]` (`select achievement_id from player_achievements where player_id=$1 and unlocked_at is not null`), mirrored in `GmPlayerDetailDto` (`api.ts:447`), asserted in `gm-service.test.ts`. A6's picker disables those ids.
- **P4 (A2, minor).** After commit call `void deps.game.balanceChanged(playerId)` when points were paid. `unlockWithin` imports `creditWithin` from `'../repos/index.js'`. The test uses a definition with an item (`login_days_100`). Add the unlock POST to the reasons URL list (`routes-gm.test.ts:97-110`) and fix the "fifteen" wording at `:77`.
- **P5 (A3, blocking).** A reclaim reuses `ref_id = daily:<pid>:<today>`, so "Σ amount by ref" would double on a second reset. Define today's claim as the **latest** one: rows `where ref_id = $ref and reason in ('daily_login','daily_item_fallback') and created_at = (select max(created_at) from point_transactions where <same filter>)`; items likewise by `inventory.ref` and `acquired_at = max`. Test: reset → claim → reset takes back X, not 2X; conservation holds. Decrement as `greatest(total_login_days - 1, 0)`.
- **P6 (A3/A4, blocking for typecheck).** `gm-service.test.ts:33` spreads `h.app.services` into `deps()`: add `timezone: testConfig().timezone` there, and name the store dependency `gifts: GiftScheduleStore` so the same spread supplies it (so `AppServices.gifts` **is** the store).
- **P7 (A3/A4, blocking-ish).** `revoke` clears every key of `OPTIONAL_SLOTS` (`inventory/slots.ts`, includes `skinColor`) plus `title`/`badge`, and **also strips the item from every `avatar_outfits.config` row of that player** (Ruling: strip, no known-limitation). `setMonth` refuses fixed ids whose slot is not in `[...DAILY_DRAW_SLOTS, 'title', 'badge']` (`INVALID_GIFTS`), because required slots (`outfit`, `hairStyle`) cannot be revoked. `src/inventory/inventory-service.test.ts` does not exist: **Create** it (or extend `inventory/avatar.test.ts:280`).
- **P8 (A4, blocking).** `GmService.giftMonths(): Promise<{ default: Record<string, unknown>; months: GiftMonthRow[] }>` to match the route. `DELETE` on a month without a db row → `NOTHING_TO_CLEAR` (409), no log row. Validate `:month` against `/^\d{4}-(0[1-9]|1[0-2])$/` (400 `INVALID_MONTH`). `TIER_LOCKED` applies to `clearMonth` of the current month too. `setMonth`/`clearMonth` read existing db months **through the given `tx`** (PGlite serialises; `deps.db` would deadlock). `readDailyGiftsRaw` keeps the duplicate-month-key check (`daily-gifts.ts:176-180`). **Ruling:** a db month that no longer validates at boot (catalogue changed) is logged at `warn`, skipped, and boot continues.
- **P9 (A4, minor).** `claimDaily` takes `const gifts = deps.gifts()` once and passes it to `applyItemRule`; the draw exclusion is built from that copy; `dailyStatus` likewise. Review Focus 3 is tested by injecting `gifts: vi.fn()` returning schedule A then B and asserting one call per claim. All five `createEconomyService` calls in `economy-service.test.ts` (lines 72, 456, 495, 531, 605) pass `() => schedule`.
- **P10 (A5, blocking).** Drizzle binds the timezone twice (`$1`, `$2`) and Postgres refuses the GROUP BY: write a raw `sql` query with `group by 1, 2, 3`, select `(created_at at time zone ${tz})::date::text`. `AT TIME ZONE 'Asia/Ho_Chi_Minh'` works on PGlite 0.5.8 (verified): drop the spike step and the JS fallback. `balance-repo.ts` returns raw `{ day, reason, playerless, total }` rows (`LedgerReader.sumsByDay(sinceMs, timeZone): Promise<DayReasonRow[]>`, interface at `:61`, impl at `:215`); `GmService.dailyStats` classifies and fills zero days.
- **P11 (A6, minor).** `gmFields` (`notifications.ts:33`) also reads `achievementId`. `ReasonDialog`'s `valid` requires `achievementId` when `fields.achievement` is set. `resetCheckin`'s body is computed (points via `formatPoints`, item names). `AchievementsScreen` sets the counter and `aria-valuenow` to the threshold when unlocked.
- **P12 (A7, blocking).** "Cố định" is a **list** of items pre-filled from the merged rule (day 28 holds 2–3). Replace "Không" with "Như mặc định" (delete the month key; an absent key falls back to the default) and offer "none" only where the default has no rule. The item `Select` excludes free/default items and slots outside P7's set. `DailyCalendar` takes `month: string` for its legend. Check the `Segmented` fits at 375 px.
- **P13 (A8, minor).** `OverviewTab.test.tsx` does not exist: **Create**.
- **P14 (A9 and every Playwright step, blocking).** The player's calendar shows only the current month: Q-03 asserts the change on the GM's Quà tháng tab after reload (`source: 'db'`) and on the wardrobe's locked tile (catalogue `dailyGifts` includes future months). Pick an item `daily-gifts.json` does not already name (`refuseRepeats`). Every Playwright step (A9, B6, B8, C2) runs `pnpm build:normal` first: `e2e-server.mjs` rebuilds only the server.

**Part B**

- **P15 (B1, blocking).** `data-frame` sits on `.room` itself: the selector is `.room[data-frame='landscape']` (and `.room[data-frame='landscape'] .tray` etc.), with `height: var(--bp-stage, 100dvh)` (the playground sets `--bp-stage: 100%`), `min-height: 0`, `position: relative`, smaller vertical padding. Call `useRoomFrame` above the early return at `RoomScreen.tsx:128`.
- **P16 (B1, minor).** `clearanceFor` returning `0` renders the same as `null`: **drop that change** and keep `seat-clearance.test.ts:31,43,47` as they are.
- **P17 (B2/B8, minor).** Menu items are `role="menuitem"` (`getByRole('menuitem')` in helpers); "Tạm nghỉ" is `menuitemcheckbox` with `aria-checked`. "⋯" and "✎" go in constants (`eslint.config.js:28` `allowedStrings`). Export from `src/index.ts` (there is no `primitives/index`). The dock also shows the between-hands countdown (`RoomScreen.tsx:289-295`). Helpers close the menu with Escape after use.
- **P18 (B3, blocking).** `angleCache` (`geometry.ts:55`) is keyed by seat count and `AX` is a module constant: key the cache by `count:ratio` and compute `AX` per call. Replace the test with: a `{w: 2.5, h: 1}` box gives equal pixel spacing between neighbouring seats and angles that differ from ratio 2. Guard `ResizeObserver` with `typeof ResizeObserver === 'undefined'` (as `seat-clearance.ts:54`).
- **P19 (B3, blocking).** **Drop the `.seat::after` tap pad** (inverted formula, not conditional, would cover the peel). Occupied seats have no click target; the only seat target is `.sitBtn` (`PokerTable.tsx:159`), already `min-height: var(--tap)` (`table.module.css:701`): keep it ≥ 44 px in landscape and let L-02 assert it. Set the seat custom properties on `.room[data-frame='landscape'] .ring .seat` (the `@container (max-height: 400px)` block at `:885-897` sets them on the seat), and add `min-height: 0` to the ring override (base `15rem` at `:746`).
- **P20 (B4, minor).** The absolute tray becomes the containing block, so the left dock uses `position: fixed` and stays inside the "Hành động" group's DOM. The "R" shortcut (`ActionBar.tsx:136`) opens the dialog in landscape. The top-anchored dialog gets `max-height: calc(100dvh - 2*var(--space-4))` and tighter padding. `primitives/Modal.test.tsx` does not exist: use `primitives.test.tsx`.
- **P21 (B6, blocking-ish).** An absolutely positioned pill against `.seat` (`position: relative`, `:456`) lands below the tags: move the button **inside `.seatCards`** and give that `position: relative`. The "Nặn bài" badge already lives in `.headMeta` inside `.headText`: moving it beside the name needs a grid column in the ≤ 767 px block (`:1566-1580`, e.g. `'glyph name badge right'`), and it must stay inside `<header>` for F-12's locator (`04-blind.spec.ts:443`).
- **P22 (B8, blocking).** Hold'em has no bots and Blind allows at most 8 players (`economy.ts:22`): L-02 uses a Blind room with 8 seats and 7 bots for occupied plates plus a 9-seat Hold'em room for empty-seat `.sitBtn` checks; nine occupied seats stay a B7 playground screenshot. Replace "dock below the lowest rim seat" with "no `[data-seat]` box intersects the dock or tray box". L-04 needs two humans. Drop the `playwright.config.ts` change (no `@landscape` test lives there).

**Part C**

- **P23 (C2, minor).** Use `fetchPriority` (camel case, typed in `@types/react`) and drop it if React-DOM 18.3 warns at runtime. The contrast check uses `page.screenshot({ clip })` of the lead's box with the text hidden, decoded with sharp to raw pixels, lightest pixel vs the computed text colour.
- **P24 (C1, minor).** The source already sits in the worktree's `assets/login-hero-src/`; the script runs from `apps/normal-web`, so the path is `../../assets/login-hero-src/2026-10-20-v2.png`. Measured at q82: 1536 px → 178 KB, 768 px → 66 KB.

**Global / Final**

- **P25 (Global, F3, F4, minor).** The trailer is the one the session prescribes. F4 checks the migration count with `docker compose exec -T db psql -U postgres -d bind_poker -tc 'select count(*) from drizzle.__drizzle_migrations'` (expect 6) and `\d gift_months`; `grant-gm-cli` exits 1 for an account that is not registered on the VPS, so confirm the GM email is registered there before running. F3 removes the worktree with `Remove-Item -Recurse -Force` (CLAUDE.md §8).
- **P26 (A9/B9/C3, minor).** Checklist count becomes `64 + 3 + 2 + 3 + 3`; the matrix gains a Plan 26 term; update `acceptance-checklist.md:80` and the comments at `acceptance-links.test.ts:189-192, 260-265`.

Verified correct by the reviewer (no change): `db:generate` workflow, `TxReason` consumers, no CHECK on `gm_actions.action`, `unlockWithin` extraction, negative `creditWithin` as the debit, the day helpers, `parseDailyGifts` on a merged candidate, route 15 → 22 and ops 36 → 42, `ringPositions`'s single caller, jsdom frame default, `Modal` portal + `anchor`, `newPlayer` inheriting the project viewport, `expectRoomFits` measuring `.roomMain`, `deviceScaleFactor: 2.6`, sharp 0.33.5 on Node 24, `/login/*.webp` served `no-cache`, the hidden-`h1` ruling, and the F4 paths.
