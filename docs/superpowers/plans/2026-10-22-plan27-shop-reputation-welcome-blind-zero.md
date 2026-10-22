# Plan 27 — Shop, reputation rank, welcome gift, Blind to zero, lazy wardrobe, monthly check-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players earn a non-decreasing reputation rank shown beside their name, buy cosmetics for points in a new Cửa hàng screen gated by that rank, get a welcome pick and a 7-claim newcomer calendar, play Blind Poker down to zero with no table fee, open a wardrobe that loads only what is on screen, and keep their monthly check-in progress when they miss a day.

**Architecture:** One additive migration (`0006_plan27`) adds reputation, shop and newcomer tables plus three `players` columns. A new `ReputationService` writes `reputation_events` and the materialised `players.reputation`/`players.rank` inside the transactions that already pay points (daily claim, achievement unlock) or from the post-commit `HAND_SETTLED` listener. A new `ShopService` sells through the existing `creditWithin` with a new sink kind `shop`. The web gets a `/shop` screen, a welcome dialog in the lobby, a "Tuần đầu tiên" panel on Điểm danh, a rank label on seats and profile, and a lazy `Chibi`. Core drops Blind's required-stack guard and fee.

**Tech Stack:** TypeScript, Fastify 5, Drizzle + PostgreSQL (PGlite in tests), React 18 + Vite, CSS modules, Vitest, Playwright (Chromium only), pnpm 9 (`corepack pnpm` on this machine).

**Spec:** `docs/superpowers/specs/2026-10-21-plan27-shop-reputation-welcome-blind-zero-design.md` (Q1–Q13, R1–R21). Read it whole before any task.

## Global Constraints

- Points only, permanently (requirement.txt §3, SRS §33): no payment, conversion or marketplace code. "Gold"/"mua" = in-game points.
- Every new money path goes through `creditWithin`/`ledger.apply` and keeps `Σ balances + Σ sink rows`; it is pinned by a conservation test on PGlite.
- Reputation never decreases, is never purchasable, never transferable, and is not a `TxReason` (spec A1, R1).
- Every player-facing string exists in `vi` and `en` (`packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts`); no JSX literals; numbers via `formatPoints`.
- New stable Vietnamese terms (add to `docs/copy-review-2026-10-10.md` §3 in Task F1): **Cửa hàng**, **Kệ tuần này**, **Mua**, **Mặc thử**, **Danh vọng**, **Tân binh / Tay bài / Cao thủ / Bậc thầy / Huyền thoại**. Existing stable terms keep their exact text.
- Commits: Conventional Commits in the repo's voice, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; stage files by name; never push.
- pnpm on this machine: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm …`; root scripts need the shim dir on PATH (`/c/Users/thanh/AppData/Local/Temp/pnpm-shim`). Worktree: `.worktrees/BP-27`, branch `feature/BP-27-shop-reputation-welcome-blind-zero`.
- UI tasks ship real Playwright screenshots at 1920×940, 1366×768, 375×812 (and 915×412 where the table or the shop is involved) via a throwaway `apps/normal-web/e2e/zz-preview.spec.ts` that is deleted before commit. Text never overlaps text (`expectNoTextOverlap`).
- Pinned counts to bump when rows are added: `tooling/arch/acceptance-links.test.ts` (checklist `64 + 3 + 2 + 3 + 3`, matrix `43 + 10 + 4 + 7 + 5 + 8 + 3`), `routes-gm.test.ts:78` (22 GM routes), `GmScreen.test.tsx:52` (5 tabs), `app.test.ts:359-410` (every route), `locales.test.ts:33,41` (89 items, 34 achievements — unchanged by this plan).
- No new runtime dependency.

## Review Focus

1. **A purchase retried after a timeout** (same `purchaseId`): the player must be charged once and own the item once. Test in Task B1 (`buys once for a repeated purchaseId`).
2. **A Blind seat whose ante takes its whole stack in Chơi hoặc bỏ**: it must be dealt in, auto-played, never asked, never timed out, and must get its share of the main pot. Test in Task D1.
3. **A daily claim that also completes newcomer day 7 while the rare pool is empty**: the claim pays the fallback points, finishes the newcomer calendar, and both land in one transaction (a failure rolls back both). Test in Task C2.
4. **A GM raising a rank threshold above a player's reputation**: the player keeps the rank and keeps buying at it (R15). Test in Task A2.
5. **A welcome choice the player already owns, and all three owned**: the dialog disables owned items; claiming with all owned grants the reputation only; claiming an owned id over the API is refused `ALREADY_OWNED`. Tests in Tasks C1 and C3.

---

## File structure (what is created or changed, grouped by responsibility)

- `apps/normal-server/drizzle/0006_plan27.sql`, `drizzle/meta/_journal.json`, `src/db/schema.ts`, `src/db/migrate-plan27.test.ts` — schema.
- `apps/normal-server/src/reputation/reputation-service.ts` (+ `.test.ts`), `src/reputation/backfill.ts`, `src/reputation-backfill-cli.ts` — reputation.
- `apps/normal-server/src/shop/shop-service.ts` (+ `.test.ts`), `src/http/routes-shop.ts` — shop.
- `apps/normal-server/src/economy/welcome-service.ts` (+ `.test.ts`), `src/http/routes-welcome.ts`; `economy-service.ts`, `daily-rules.ts` (newcomer + monthly counting).
- `apps/normal-server/src/http/routes-gm.ts`, `src/gm/gm-service.ts` — GM additions. `src/http/routes-me.ts` — rank in payloads.
- `packages/server-kit/src/repositories.ts` (reasons, sink kind), `src/room/room.ts` (Blind rules), `src/domain-events.ts` if a field is missing.
- `packages/core/src/constants/economy.ts`, `src/protocol/validate.ts`, `src/hand/blind.ts` — Blind rules.
- `packages/ui-kit/src/table/Seat.tsx` + `table.module.css`, `src/avatar2d/Chibi.tsx` + `tinted.ts` + new `lazy.ts`, `src/theme/tokens.css`, `src/i18n/locales/{vi,en}/game.json`, `src/screens/RoomScreen.tsx`.
- `apps/normal-web/src/screens/shop/ShopScreen.tsx` (+ `ShopCard.tsx`, `shop.module.css`, tests), `src/screens/WelcomeDialog.tsx`, `src/screens/DailyScreen.tsx` (newcomer panel), `src/screens/ProfileScreen.tsx`, `src/screens/TableChrome.tsx`, `src/screens/gm/ShopTab.tsx`, `src/screens/gm/PlayerDetail.tsx`, `src/api.ts`, `src/App.tsx`, `src/screens/Shell.tsx`, `src/locales/{vi,en}/normal.json`.
- `apps/normal-web/e2e/ops/08-shop.spec.ts` — ops cases. Docs: CHANGELOG, known-limitations, player-guide, test-matrix, acceptance-checklist, ui-kit.md, normal-server.md, deployment-normal.md, copy glossary, lessons-learned.

Task order: A1 → G1 → A2 → A3 → B1 → B2 → C1 → C2 → B3 → C3 → B4 → A4 → D1 → D2 → E1 → E2 → G2 → A5 → F1 → F2 → F3 (final review, gate, merge, deploy).

---

### Task A1: Migration `0006_plan27` and schema

**Files:**
- Modify: `apps/normal-server/src/db/schema.ts` (players :49, dailyLogins :247, GM_ACTION_KINDS :130)
- Create: `apps/normal-server/drizzle/0006_plan27.sql`, `apps/normal-server/src/db/migrate-plan27.test.ts`
- Modify: `apps/normal-server/drizzle/meta/_journal.json` (+ snapshot from `db:generate`)

**Interfaces:**
- Produces (Drizzle tables, exported from `schema.ts`): `players.reputation integer not null default 0`, `players.rank integer not null default 1`, `players.welcomeClaimedAt timestamptz null`; `dailyLogins.consecutive integer not null default 0`; `reputationEvents { id bigserial, playerId uuid FK, delta integer, reason text, refId text, createdAt }` with unique `(player_id, reason, ref_id)` and index `(player_id, created_at)`; `reputationRules { key text PK, amount integer, updatedBy uuid null, updatedAt }`; `reputationRanks { rank integer PK, threshold integer, updatedBy, updatedAt }`; `shopPrices { itemId text PK, pricePoints integer, minRank integer, enabled boolean, salePrice integer null, updatedBy, updatedAt }`; `shopFeatured { weekKey text PK, itemIds jsonb, updatedBy, updatedAt }`; `shopConfig { key text PK, value jsonb, updatedBy, updatedAt }`; `newcomerProgress { playerId uuid PK FK, day integer default 1, claimedDays jsonb default '[]', finishedAt timestamptz null }`.
- `GM_ACTION_KINDS` gains `'grant_reputation' | 'set_reputation_rules' | 'set_reputation_ranks' | 'set_shop_prices' | 'set_shop_featured' | 'set_welcome_choices'`.
- Seeds (idempotent, `ON CONFLICT DO NOTHING`): `reputation_rules` rows `hand_played 1, hand_won 3, daily_login 10, achievement_small 50, achievement_big 150, achievement_item 500, welcome 100, newcomer_day7 200`; `reputation_ranks` `1→0, 2→100, 3→400, 4→1800, 5→5000`; `shop_config('welcome_choices', ["outfit_dealer01","outfit_tet_red01","head_conical_hat01"])`. **`shop_prices` is seeded at boot by code, not SQL** (Task B1, because the catalogue is a file) — the SQL creates the empty table only.
- Data step: `UPDATE daily_logins SET streak = claimed_days WHERE streak < claimed_days AND month = to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM')` (spec G; the zone is the economy default; a different `ECONOMY_TIMEZONE` is documented as a residual).

- [ ] **Step 1: Write the failing migration test** `apps/normal-server/src/db/migrate-plan27.test.ts`, modelled on `migrate-plan26.test.ts:1-20`:
  - `applies 0006 on a 0005 database and a second run changes nothing` — count of `drizzle.__drizzle_migrations` becomes 7, `information_schema.columns` has `players.reputation`, `players.rank`, `players.welcome_claimed_at`, `daily_logins.consecutive`; table list has the seven new tables; running `runMigrations` again leaves row counts equal.
  - `seeds rules, ranks and welcome choices once` — `reputation_rules` has 8 rows with `hand_won = 3`; `reputation_ranks` has 5 rows with `rank 4 → 1800`; `shop_config.welcome_choices` equals the three ids; a second run does not duplicate.
  - `lifts a broken streak to the month's claim count` — insert a `daily_logins` row `{streak: 2, claimedDays: 9, month: <current month>}` and one `{streak: 1, claimedDays: 5, month: '2026-01'}` before migrating; after: 9 and 1.
  - `the journal entry is newer than 0005` — `when > 1792459114276`.
- [ ] **Step 2: Run it** — `corepack pnpm --filter @bp/normal-server exec vitest run src/db/migrate-plan27.test.ts` → FAIL (no 0006).
- [ ] **Step 3: Add the Drizzle tables and columns** to `schema.ts` (names above; `check` on `reputation_events.delta > 0`, on `reputation_ranks.rank between 1 and 5`, on `shop_prices.min_rank between 1 and 5`, on `shop_prices.price_points >= 0`). Extend `GM_ACTION_KINDS`.
- [ ] **Step 4: Generate** `corepack pnpm --filter @bp/normal-server db:generate --name plan27`, rename the output to `0006_plan27.sql`, guard every statement in `0005_plan26.sql`'s style (`IF NOT EXISTS`, `DO $$ … duplicate_object`), keep `--> statement-breakpoint`, append the three seed `INSERT … ON CONFLICT DO NOTHING` blocks and the `UPDATE daily_logins`. Header comment: what the plan adds, that it is additive.
- [ ] **Step 5: Run the test** → PASS. Run `corepack pnpm --filter @bp/normal-server exec vitest run src/db` → all migration tests pass.
- [ ] **Step 6: Commit** `feat(normal-server): migration 0006 — reputation, shop, newcomer and welcome tables, and a check-in count that forgives a missed day`.

### Task G1: Monthly check-in counts claims, consecutive days live beside it

**Files:**
- Modify: `apps/normal-server/src/economy/daily-rules.ts:107-144` (`DailyState`, `StreakOutcome`, `nextStreak`), `economy-service.ts:245-300` (`claimDaily`, `dailyStatus`), `src/events.ts:41` (`DAILY_CLAIMED`), `src/stats/stats-service.ts:161-168`
- Test: `daily-rules.test.ts:60-90`, `economy-service.test.ts`, `stats-service.test.ts`

**Interfaces:**
- Produces: `DailyState { streak: number; consecutive: number; lastClaimDate: string | null }`; `StreakOutcome { alreadyClaimed: boolean; streak: number; consecutive: number; day: number; points: number }` where `streak` is the month's claim count (= `day`) and `consecutive` the run of calendar days; `nextStreak(state, todayKey)` returns `day = min(streak + 1, MAX_STREAK)` whenever `lastClaimDate` is in the same month and not today, `1` on a new month, and `consecutive = yesterday ? consecutive + 1 : 1` (also across months). `DAILY_CLAIMED` becomes `{ type: 'DAILY_CLAIMED'; playerId; day; streak; consecutive }`; `stats-service` sets `loginStreak: e.consecutive`, `bestLoginStreak: atLeast('bestLoginStreak', e.consecutive)`. `DailyStatus` and `DailyClaimOk` gain `consecutive: number`.
- Consumes: `dailyLogins.consecutive` from Task A1.

- [ ] **Step 1: Rewrite the failing tests** in `daily-rules.test.ts`: replace the gap case at :82 with `a missed day keeps the month's count: {streak: 14, lastClaimDate: '2026-09-10'} claimed on '2026-09-12' → {streak: 15, day: 15, consecutive: 1}`; add `three missed days in a 31-day month still reach tier 28, four do not` (simulate claims over the month with `nextStreak` in a loop); add `consecutive survives a month boundary: 2026-08-31 → 2026-09-01 gives day 1, consecutive +1`; keep "today → alreadyClaimed".
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/economy/daily-rules.test.ts` → FAIL.
- [ ] **Step 3: Implement** `nextStreak` per the Interfaces block; `claimDaily` writes `consecutive` and publishes it; `dailyStatus` returns it. Doc comment: §13.1 as amended by Plan 27 Part G.
- [ ] **Step 4: Update** `stats-service.ts:161-168` to read `e.consecutive`; fix `events.test.ts:17` and `economy-service.test.ts` fixtures (`consecutive` field). Add `stats-service.test.ts` case `login streak follows consecutive days, not the month's count` (claim with `{day: 9, streak: 9, consecutive: 1}` → `loginStreak 1`).
- [ ] **Step 5: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/economy src/stats src/events.test.ts` → PASS. `corepack pnpm --filter @bp/normal-server typecheck`.
- [ ] **Step 6: Commit** `feat(normal-server): the check-in calendar counts the month's claims, so a missed day no longer sends a player back to day 1, while consecutive days still feed the two streak achievements`.

### Task A2: ReputationService

**Files:**
- Create: `apps/normal-server/src/reputation/reputation-service.ts`, `reputation-service.test.ts`
- Modify: `apps/normal-server/src/app.ts:313-351` (wire + `start()`), `src/economy/economy-service.ts` (`claimDaily` calls `grantWithin` for `daily_login`), `src/achievements/achievement-service.ts:73` (`unlockWithin` calls it), `src/events.ts` if a `REPUTATION_CHANGED` event is wanted (not required)

**Interfaces:**
- Produces:
  ```ts
  export type ReputationReason = 'hand_played' | 'hand_won' | 'daily_login' | 'achievement' | 'welcome' | 'newcomer_day' | 'gm_grant' | 'backfill'
  export type RuleKey = 'hand_played' | 'hand_won' | 'daily_login' | 'achievement_small' | 'achievement_big' | 'achievement_item' | 'welcome' | 'newcomer_day7'
  export interface RankRow { rank: 1 | 2 | 3 | 4 | 5; threshold: number }
  export interface ReputationGrant { reputation: number; rank: number; rankUp: boolean; applied: boolean }
  export interface ReputationService {
    rules(): Promise<Record<RuleKey, number>>            // read-through, no cache older than 5 s
    ranks(): Promise<RankRow[]>                          // ascending
    rankOf(reputation: number, ranks: RankRow[]): number
    achievementRuleFor(def: AchievementDef): RuleKey     // points ≤ 5000 → small; > 5000 → big; itemId → item
    grantWithin(tx: AppTx, playerId: string, delta: number, reason: ReputationReason, refId: string): Promise<ReputationGrant>
    grant(playerId: string, delta: number, reason: ReputationReason, refId: string): Promise<ReputationGrant>  // own transaction
    setRules(tx: AppTx, patch: Partial<Record<RuleKey, number>>, updatedBy: string): Promise<void>
    setRanks(tx: AppTx, ranks: RankRow[], updatedBy: string): Promise<void>  // throws RankOrderError unless strictly increasing and rank 1 → 0
    start(): () => void                                   // subscribes HAND_SETTLED
  }
  export function createReputationService(deps: { db: AppDb; bus: AppEventBus; notify: (playerId: string, msg: { t: 'NOTIFICATION'; kind: 'RANK_UP'; payload: { rank: number } }) => void; log: Logger }): ReputationService
  ```
  `grantWithin`: `INSERT … ON CONFLICT (player_id, reason, ref_id) DO NOTHING RETURNING id`; when nothing returned → `{ applied: false, rankUp: false, … current }`; else `UPDATE players SET reputation = reputation + delta, rank = GREATEST(rank, <rankOf(new)>) … RETURNING reputation, rank` and `rankUp = newRank > oldRank`; the caller sends `RANK_UP` **after commit** (`grant` does it itself; `grantWithin` returns `rankUp` and the economy/achievement callers notify after their commit).
  `HAND_SETTLED` handler: for each human seat of `summary.players` that was dealt (skip `summary.cancelled`/settlement error, as `stats-service.ts:78` does): `grant(pid, rules.hand_played, 'hand_played', summary.handId)` and, if `won`, `grant(pid, rules.hand_won, 'hand_won', summary.handId)`.
- Consumes: Task A1 tables; `AchievementDef` from `achievements/definitions.ts`.

- [ ] **Step 1: Write the failing tests** (`createTestDb()` from `src/db/test-db.ts`):
  - `grants, materialises and ranks up once` — two grants of 60 with different refIds → reputation 120, rank 2, first `rankUp false`, second `true`.
  - `a repeated (reason, refId) is a no-op` — same refId twice → `applied false`, reputation unchanged.
  - `rank is a high-water mark` — at reputation 450 rank 3; `setRanks` with rank 3 → 600 → rank stays 3; a further grant of 1 keeps 3.
  - `invariant: players.reputation = Σ events` after 50 random grants.
  - `HAND_SETTLED pays 1 per dealt human and 3 more per winner, never bots, never twice` — publish a summary twice.
  - `achievementRuleFor` — `login_days_7 → achievement_small`, `holdem_hands_1000 → achievement_big`, `login_days_100 → achievement_item`.
  - `setRanks refuses a non-increasing ladder` — `RankOrderError`.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/reputation` → FAIL.
- [ ] **Step 3: Implement** `reputation-service.ts` per Interfaces.
- [ ] **Step 4: Wire** in `app.ts`: create before `economy`; pass to `createEconomyService` deps as `reputation` and to `createAchievementService`; `unsubscribes` gains `reputation.start()` **after** `stats.start()`. `claimDaily`: inside its transaction call `grantWithin(tx, playerId, rules.daily_login, 'daily_login', refId)` (the existing `daily:<pid>:<day>` refId); after commit notify `RANK_UP` if `rankUp`. `unlockWithin`: add a `reputation` field to its `pay` arg and call `grantWithin(tx, playerId, rules[achievementRuleFor(def)], 'achievement', 'ach:<pid>:<def.id>')`; both call sites (`achievement-service.ts:136`, `gm-service.ts` unlock) pass it; the GM path notifies after commit too.
- [ ] **Step 5: Tests** — add to `economy-service.test.ts`: `a claim adds 10 reputation under the claim's ref`; to `achievement-service.test.ts`: `an unlock adds 500 reputation for an item reward`; to `gm-service.test.ts`: `a GM unlock adds reputation too`. Run `corepack pnpm --filter @bp/normal-server exec vitest run src/reputation src/economy src/achievements src/gm` → PASS.
- [ ] **Step 6: Commit** `feat(normal-server): reputation — every dealt hand, win, check-in and achievement raises a rank that never falls`.

### Task A3: Rank beside the name (payloads, profile, lobby, seat)

**Files:**
- Modify: `apps/normal-server/src/http/routes-me.ts` (`GET /api/me`, `GET /api/players/:id/avatar` :241), `src/repos/player-repo.ts` (`findByIdFull` returns `reputation`, `rank`)
- Modify: `apps/normal-web/src/api.ts` (`MeDto` :303, `PlayerAvatarDto`), `src/avatar/useAvatars.ts`, `src/screens/TableChrome.tsx:62` (`makeCaptionFor` → also a `rankFor`), `src/screens/ProfileScreen.tsx:251-268`, `src/screens/PlayerBar.tsx:29`, `src/screens/gm/RoomsTab.tsx:223`
- Modify: `packages/ui-kit/src/table/Seat.tsx:30-70, 286-299`, `table.module.css`, `src/theme/tokens.css`, `src/i18n/locales/{vi,en}/game.json`, `src/screens/RoomScreen.tsx` (pass `rank` through; its `rankFor?: (p: RoomPlayerView) => number | null` prop beside `captionFor`), `src/screens/Toasts.tsx` (RANK_UP uses `notify.RANK_UP` with `{{rank}}` resolved to the rank name)
- Create: `packages/ui-kit/src/table/RankLabel.tsx` (+ test), `packages/ui-kit/src/theme/rank.contrast.test.ts`

**Interfaces:**
- Produces: `GET /api/me` adds `reputation: number`, `rank: number`, `ranks: { rank: number; threshold: number }[]`; `GET /api/players/:id/avatar` adds `rank: number`. `RankLabel({ rank, lang, compact }: { rank: number; lang: Language; compact?: boolean })` renders nothing for rank 1, a `<span class="rankLabel" data-rank="3">Cao thủ</span>` otherwise, and `<span class="rankPill" data-rank="3" title="Cao thủ">III</span>` when `compact`. i18n keys `rank.1`…`rank.5` in `game.json` (vi: Tân binh, Tay bài, Cao thủ, Bậc thầy, Huyền thoại; en: Rookie, Card hand, Sharp, Master, Legend), `notify.RANK_UP` (vi "Bạn vừa lên bậc {{rank}}", en "You reached {{rank}}"), `profile.reputation` (vi "Danh vọng {{points}} · {{rank}} · còn {{left}} tới {{next}}", `profile.reputationTop` "Danh vọng {{points}} · {{rank}}"). Tokens `--rank-2: #9aa3ad; --rank-3: #7cc4ff; --rank-4: #c58cff; --rank-5: #f1c75b` (adjust until the contrast test passes). `Seat` gains `rank?: number | null`; compact when `useRoomFrame() === 'landscape'` **or** the plate text box is under 120 px (`ResizeObserver`, measured in a layout effect, default to the full label in jsdom).
- Consumes: Task A2's `players.rank`.

- [ ] **Step 1: Failing tests** — `routes-me.test.ts` (or `app.test.ts`): `me and a player's avatar carry rank`; `RankLabel.test.tsx`: rank 1 renders null, rank 3 renders "Cao thủ", compact renders "III" with title; `Seat.test.tsx`: a seat with `rank: 4` shows "Bậc thầy" after the name and the caption below is unchanged; in the landscape frame it shows "IV"; `rank.contrast.test.ts`: each `--rank-N` on `--plate-bg` (whatever `.plate` uses) ≥ 4.5 (model it on `normal.contrast.test.ts` / the Plan 20 badge test); `ProfileScreen.test.tsx`: shows "Danh vọng 455 · Cao thủ · còn 1.345 tới Bậc thầy" for `{reputation: 455, rank: 3}`; `TableChrome.test.tsx`: `rankFor` returns the cached rank and null for bots; `Toasts.test.tsx`: `RANK_UP {rank: 3}` → "Bạn vừa lên bậc Cao thủ".
- [ ] **Step 2: Run** the named test files → FAIL.
- [ ] **Step 3: Implement** server payloads, DTOs, `useAvatars` entry (`rank`), `RankLabel`, `Seat` wiring and CSS (`.seatName` becomes an inline-flex row: name, then label; `.rankLabel` uses `font-size: var(--text-xs)` and `color: var(--rank-N)`; `.rankPill` 11 px, 1 px border), `RoomScreen` `rankFor` prop, `TableChrome` `makeRankFor(avatars)`, `ProfileScreen` line with a CSS bar (`.repBar` width = `(reputation − threshold) / (next − threshold)`), `PlayerBar` label, `RoomsTab` pill, toast.
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/ui-kit test` and `corepack pnpm --filter @bp/normal-web test` → PASS; i18n parity passes.
- [ ] **Step 5: Screenshots** — playground `#worst/showdown/6/vi` and `/landscape` with a seat ranked 3 and 5 (add `rank` to the playground's fixture seats), and the real build's profile at 1920×940 and 375×812 via `zz-preview.spec.ts`. Save under the SDD workspace and list the paths in the report; delete the spec file.
- [ ] **Step 6: Commit** `feat(ui-kit, normal-web, normal-server): a player's rank stands beside the name on the seat, in the lobby and on the profile, as a word on a wide plate and a roman numeral on a narrow one`.

### Task B1: ShopService and the `shop` sink

**Files:**
- Create: `apps/normal-server/src/shop/shop-service.ts`, `shop-service.test.ts`, `shop-prices-seed.ts`
- Modify: `packages/server-kit/src/repositories.ts:16-52` (`TxReason` + `'shop_purchase' | 'shop'`, `SettlementMeta.kind` + `'shop'`), `apps/normal-server/src/gm/gm-service.ts:175-177` (`SINK_REASONS` + `'shop'`), `apps/normal-web/src/screens/LedgerPanel.tsx:13` (`REASONS` + both), `apps/normal-web/src/locales/{vi,en}/normal.json` (`ledger.reason.shop_purchase` "Mua ở Cửa hàng"/"Shop purchase", `ledger.reason.shop` "Cửa hàng (bể)"/"Shop (sink)"), `apps/normal-server/src/app.ts` (seed at boot after `catalog`)
- Test: `apps/normal-server/src/app.test.ts:877-909` (unchanged list), `gm-service.test.ts` (`totals()` helper sees the new sink)

**Interfaces:**
- Produces:
  ```ts
  export interface ShopPrice { itemId: string; pricePoints: number; minRank: number; enabled: boolean; salePrice: number | null }
  export type ShopLock = { kind: 'achievement'; achievementId: string } | { kind: 'gift_month'; month: string } | { kind: 'gift_default' } | { kind: 'free' } | { kind: 'default' } | { kind: 'disabled' } | { kind: 'unpriced' }
  export interface ShopEntry { itemId: string; slot: string; rarity: Rarity; price: number; minRank: number; purchasable: boolean; owned: boolean; lock: ShopLock | null }
  export interface ShopView { weekKey: string; featured: string[]; featuredSource: 'gm' | 'auto'; entries: ShopEntry[]; me: { balance: number; reputation: number; rank: number; ranks: RankRow[] } }
  export type BuyResult = { ok: true; balance: number; itemId: string; repeated: boolean } | { ok: false; code: 'SHOP_DISABLED' | 'RANK_TOO_LOW' | 'ALREADY_OWNED' | 'INSUFFICIENT_POINTS' | 'UNKNOWN_ITEM' }
  export interface ShopService {
    view(playerId: string, now?: number): Promise<ShopView>
    buy(playerId: string, itemId: string, purchaseId: string, now?: number): Promise<BuyResult>
    prices(): Promise<ShopPrice[]>
    setPrices(tx: AppTx, changes: Partial<ShopPrice>[] & { itemId: string }[], updatedBy: string): Promise<void>
    featuredFor(weekKey: string): Promise<{ itemIds: string[]; source: 'gm' | 'auto' }>
    setFeatured(tx: AppTx, weekKey: string, itemIds: string[], updatedBy: string): Promise<void>   // ≤ 6, all priced+enabled
    welcomeChoices(): Promise<string[]>
    setWelcomeChoices(tx: AppTx, itemIds: string[], updatedBy: string): Promise<void>               // exactly 3
    seedPrices(): Promise<number>   // inserts a row per catalogue item missing one: common 10000/1, rare 30000/3, epic 150000/4; enabled=false for isDefault, free, achievement rewards
  }
  export function createShopService(deps: { db: AppDb; repos: NormalRepositories; inventory: InventoryService; catalog: ItemCatalog; defs: AchievementDef[]; gifts: GiftScheduleStore; reputation: ReputationService; timezone: string; onBalanceChanged: (playerId: string, balance: number) => void; now?: () => number }): ShopService
  export function isoWeekKey(nowMs: number, timeZone: string): string   // 'YYYY-Www'
  export function autoFeatured(enabledIds: string[], weekKey: string): string[]  // 6 ids, rotation by week number, stable
  ```
  `lock` precedence: `default` → `free` → `achievement` → `gift_default` (in `daily-gifts.json` `default.fixed`) → `gift_month` (in the live schedule's `fixed` for the current month or any later month — ask `gifts.current()` for every month it knows) → `unpriced` → `disabled`. `purchasable = lock === null && !owned`.
  `buy`: one `db.transaction`: `INSERT INTO ledger_keys (key) VALUES ('shop:<pid>:<purchaseId>') ON CONFLICT DO NOTHING RETURNING key`; none returned → look up the earlier purchase (`inventory` row with `ref = 'shop:<pid>:<purchaseId>'`) and return `{ ok: true, repeated: true, … }`; else validate (unknown item → `UNKNOWN_ITEM`; lock or `!enabled` → `SHOP_DISABLED`; `rank < minRank` → `RANK_TOO_LOW`; owned → `ALREADY_OWNED`), then `creditWithin(tx, [{ playerId, delta: -price, reason: 'shop_purchase', refId: itemId }], { refId: itemId, fee: price, kind: 'shop' })` (catch `InsufficientBalanceError` → `INSUFFICIENT_POINTS`, which rolls back the key too), `inventory.grant(tx, pid, itemId, 'shop', 'shop:<pid>:<purchaseId>')`; after commit `onBalanceChanged`.
- Consumes: A1 tables, A2 `ReputationService.ranks()`.

- [ ] **Step 1: Failing tests** `shop-service.test.ts` (PGlite, seed through `seedPrices`):
  - `seeds a price per catalogue item once` — 89 rows; `outfit_casual01` disabled (default), `outfit_casual_red01` disabled (free), `outfit_champion01` disabled (achievement), `outfit_tuxedo01` enabled 150000/4, `head_beanie01` enabled 10000/1; second call inserts 0.
  - `locks follow the live gift schedule` — with `now` in 2026-10, `head_tophat01` (2026-11) is locked `gift_month 2026-11`; with `now` in 2026-12, it is purchasable; `badge_monthly` is `gift_default`; a GM `gift_months` row adding `outfit_tuxedo01` to 2027-05 locks it.
  - `buys once for a repeated purchaseId` — two `buy` calls with the same id → one ledger pair, one inventory row, second returns `repeated: true`.
  - `refuses below rank, when owned, when disabled, when poor` — each code; balances unchanged; the key row is gone after `INSUFFICIENT_POINTS`.
  - `conservation` — 40 random buys across 3 players: `Σ players.balance + Σ sink rows (player_id null) = 3 × 100000` and `Σ sink(reason='shop') = Σ prices paid`; the sink row has `reason 'shop'`, the player row `reason 'shop_purchase'`.
  - `autoFeatured is stable within a week and ≤ 6`; `featuredFor` prefers a GM row.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/shop` → FAIL.
- [ ] **Step 3: Implement** `shop-service.ts`, `shop-prices-seed.ts`, widen `TxReason`/`SettlementMeta.kind`, add `'shop'` to `SINK_REASONS`, `LedgerPanel.REASONS`, locales. Wire `createShopService` in `app.ts` and call `seedPrices()` at boot after the catalogue seed (log the count).
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/shop src/gm src/app.test.ts` and `corepack pnpm --filter @bp/normal-web exec vitest run src/screens/LedgerPanel src/locales` → PASS; `corepack pnpm --filter @bp/server-kit test` → PASS.
- [ ] **Step 5: Commit** `feat(normal-server, server-kit): a shop that sells catalogue items for points behind a rank, with a sink row per purchase and a price table a GM can edit`.

### Task B2: Shop routes and web API

**Files:**
- Create: `apps/normal-server/src/http/routes-shop.ts`, `routes-shop.test.ts`
- Modify: `apps/normal-server/src/app.ts` (register), `src/app.test.ts:359-410` (route list), `apps/normal-web/src/api.ts` (`ShopViewDto`, `BuyResultDto`, `shop()`, `shopBuy(itemId, purchaseId)`)

**Interfaces:**
- Produces: `GET /api/shop` (authed) → `ShopView`; `POST /api/shop/buy { itemId: string; purchaseId: string }` → `200 { balance, itemId, repeated }` or `409 { code }` for the four refusals and `404 UNKNOWN_ITEM`; `purchaseId` must match `/^[0-9a-f-]{36}$/` else `400 INVALID_BODY`. Both carry the app's CSRF header rule and the rate-limit class of other writes (`app.test.ts:346` `UNMETERED_BY_DESIGN` is not extended). Web: `api.shop(): Promise<ShopViewDto>`, `api.shopBuy(itemId: string, purchaseId: string): Promise<BuyResultDto>`.
- Consumes: B1.

- [ ] **Step 1: Failing tests** `routes-shop.test.ts`: `GET /api/shop needs a session`; `a buy returns the new balance and a second identical buy is repeated`; `a bad purchaseId is 400`; `a refusal is 409 with its code`. Extend the exact route list in `app.test.ts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** routes and API client. **Step 4: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/http/routes-shop.test.ts src/app.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(normal-server, normal-web): /api/shop lists the shelves and /api/shop/buy sells, once per purchase id`.

### Task C1: WelcomeService and `/api/welcome`

**Files:**
- Create: `apps/normal-server/src/economy/welcome-service.ts`, `welcome-service.test.ts`, `src/http/routes-welcome.ts` (+ test)
- Modify: `apps/normal-server/src/http/routes-me.ts` (`GET /api/me` adds `welcome`), `src/app.ts`, `src/app.test.ts` (route list), `apps/normal-web/src/api.ts` (`MeDto.welcome`, `welcomeClaim(itemId)`)

**Interfaces:**
- Produces:
  ```ts
  export interface WelcomeStatus { claimed: boolean; choices: { itemId: string; owned: boolean }[] }
  export type WelcomeClaimResult = { ok: true; itemId: string | null; reputation: number; rank: number; rankUp: boolean } | { ok: false; code: 'WELCOME_CLAIMED' | 'NOT_A_CHOICE' | 'ALREADY_OWNED' }
  export interface WelcomeService {
    status(playerId: string): Promise<WelcomeStatus>
    claim(playerId: string, itemId: string | null): Promise<WelcomeClaimResult>   // null only when every choice is owned
  }
  export function createWelcomeService(deps: { db: AppDb; inventory: InventoryService; catalog: ItemCatalog; shop: Pick<ShopService, 'welcomeChoices'>; reputation: ReputationService; avatars: { wearWithin(tx: AppTx, playerId: string, itemId: string): Promise<void> }; onNotify: (playerId: string, rankUp: boolean, rank: number) => void; now?: () => number }): WelcomeService
  ```
  `claim`: one transaction: `UPDATE players SET welcome_claimed_at = now() WHERE id = $1 AND welcome_claimed_at IS NULL RETURNING id` (none → `WELCOME_CLAIMED`); `itemId` must be in `welcomeChoices()` (else `NOT_A_CHOICE`) and unowned (else `ALREADY_OWNED`); `itemId === null` allowed only when all three are owned; `inventory.grant(tx, pid, itemId, 'welcome', 'welcome')`; wear it (put it in the matching slot of `avatar_config` through the existing avatar-config writer used by `PUT /api/me/avatar`); `reputation.grantWithin(tx, pid, rules.welcome, 'welcome', 'welcome')`; `INSERT newcomer_progress (player_id, day, claimed_days) VALUES (pid, 1, '[1]')`. Routes: `GET /api/welcome` → `WelcomeStatus`; `POST /api/welcome/claim { itemId: string | null }`. `GET /api/me` adds `welcome: WelcomeStatus`.
- Consumes: A1, A2, B1 (`welcomeChoices`).

- [ ] **Step 1: Failing tests** `welcome-service.test.ts`: `claims once: item, worn, +100 reputation, newcomer day 1`; `a second claim is WELCOME_CLAIMED`; `an owned choice is ALREADY_OWNED and status marks it owned`; `all three owned: claim(null) grants reputation only`; `a non-choice is NOT_A_CHOICE`. Route tests: `GET /api/welcome` shape, `POST` happy and 409 paths; route list.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/economy/welcome src/http/routes-welcome.test.ts src/app.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(normal-server): a welcome gift — one of three rare items, worn at once, with the first hundred reputation`.

### Task C2: Newcomer calendar inside `claimDaily`

**Files:**
- Modify: `apps/normal-server/src/economy/economy-service.ts:245-300`, `daily-rules.ts` (add `NEWCOMER_DAYS = 7`, `newcomerGiftFor(day): 'common' | 'rare' | null` → 3 → common, 7 → rare), `src/events.ts` (optional), `apps/normal-web/src/api.ts` (`DailyClaimDto.newcomer`, `DailyStatusDto.newcomer`)
- Test: `economy-service.test.ts`

**Interfaces:**
- Produces: `DailyClaimOk.newcomer?: { day: number; item: string | null; fallbackPoints: number; reputation: number; finished: boolean }`; `DailyStatus.newcomer?: { day: number; claimedDays: number[]; finished: boolean }` (absent when no `newcomer_progress` row or finished). Inside `claimDaily`'s transaction, when a `newcomer_progress` row exists with `finished_at IS NULL` and today's `dayKey` is not the day of the last newcomer increment (store `last_day_key text` — add it in A1's migration as a nullable column; the implementer of A1 adds it if this task starts after A1 — see Amendments): `day += 1`, push to `claimed_days`; day 3 → `unownedOfRarity(tx, pid, 'common')` random pick (same rng path as the monthly draw) or `NO_ITEM_FALLBACK_POINTS` with `reason 'daily_item_fallback'`, `refId 'newcomer:<pid>:3'`; day 7 → rare pick or fallback, plus `reputation.grantWithin(tx, pid, rules.newcomer_day7, 'newcomer_day', 'newcomer:<pid>:7')`, `finished_at = now()`. Items are granted with `source 'newcomer'`, `ref 'newcomer:<pid>:<day>'`. The `DAILY_CLAIMED` event is unchanged.
- Consumes: A1, A2, G1.

- [ ] **Step 1: Failing tests**: `a claim advances the newcomer day and day 3 pays a common`; `day 7 pays a rare, 200 reputation and finishes`; `the rare pool empty on day 7 pays the fallback and still finishes, in one transaction` (force the grant to throw after the points → both rolled back); `two claims on one day advance the newcomer day once`; `a player without the welcome claim has no newcomer field`; `GM resetCheckin does not touch newcomer_progress`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/economy src/gm` → PASS.
- [ ] **Step 5: Commit** `feat(normal-server): the first seven check-ins carry a newcomer calendar — a common on the third, a rare and reputation on the seventh`.

### Task B3: The Cửa hàng screen

**Files:**
- Create: `apps/normal-web/src/screens/shop/ShopScreen.tsx`, `ShopCard.tsx`, `ShopStage.tsx`, `shop.module.css`, `ShopScreen.test.tsx`, `ShopCard.test.tsx`
- Modify: `apps/normal-web/src/App.tsx:56-64, 340-360` (route `/shop`, `ACCOUNT_ROUTES`), `src/screens/Shell.tsx:17-21` (nav item `/shop`, key `nav.shop`, a tag icon path), `src/locales/{vi,en}/normal.json` (`shop.*`), `src/screens/wardrobe/cards.tsx:121` (`ItemCard` gains `footer?: ReactNode`)

**Interfaces:**
- Consumes: B2 `api.shop()`, `api.shopBuy()`; wardrobe `ItemCard`, `ColourCard`, `WordCard`, `StagePanel`'s `Chibi` usage, `slotCards` from `categories.ts`.
- Produces: route `/shop`; `ShopScreen({ api, lang, me, onBalance }: { api: NormalApi; lang: Language; me: MeDto; onBalance: (balance: number) => void })`; try-on state `tryOn: Partial<AvatarConfigDto>` merged over `me.avatar` for the stage only; `ShopCard({ entry, lang, onTry, onBuy, onWear })` renders `ItemCard`/`ColourCard`/`WordCard` with a footer: `Mua · 30.000` button (`purchasable && balance ≥ price`), `Mua` disabled + "thiếu 12.000 điểm" (`shop.short`), `🔒 cần Bậc thầy` (`shop.needRank`), `✓ Đã có` + `Mặc` (navigates to `/avatar?item=<id>`), or the lock label (`shop.lock.achievement {{name}}`, `shop.lock.giftMonth {{month}}`, `shop.lock.giftDefault`, `shop.lock.free`). Confirm dialog (ui-kit `Modal`): `shop.confirm` "Mua {{item}} với {{price}} điểm? Còn lại {{left}}." → "Mua". After a buy: toast `shop.bought`, card flips to owned, stage keeps the try-on with a "Mặc luôn" button that calls `api.setAvatar(merged)`. Layout: ≥ 1024 px two columns (stage 320 px | shelves); 768–1023 stage 240 px; ≤ 767 stage becomes a 96 px head strip above the shelves. Segmented Common/Rare/Epic, then a slot filter row (Mũ, Mặt, Trang phục, Hào quang, Khung, Danh hiệu, Huy hiệu, Màu sắc). "Kệ tuần này" above the shelves with up to 6 cards and the week label (`shop.featured {{week}}`).

- [ ] **Step 1: Failing tests** `ShopScreen.test.tsx` (mock api): renders featured and the three shelves; clicking a card changes the stage's `data-chibi-hash`; `Mua` on an affordable card opens the confirm and a confirmed buy calls `shopBuy` with a UUID and updates the balance text; a card with `minRank > me.rank` shows "cần Bậc thầy" and no button; an owned card shows "Đã có" and "Mặc"; locks render their labels; `purchaseId` is reused if the first call rejected with a network error and the user confirms again (keep the id per open dialog). `ShopCard.test.tsx` covers the footer states.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/normal-web exec vitest run src/screens/shop` → FAIL.
- [ ] **Step 3: Implement** screen, cards, stage, CSS (one namespace: `shop.module.css`; reuse wardrobe card CSS through `ItemCard`), route, nav, locales (vi first, en mirrored).
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/normal-web test` → PASS incl. parity and no-literal lint (`corepack pnpm --filter @bp/normal-web lint` if the package has it, else root lint later).
- [ ] **Step 5: Screenshots** via `zz-preview.spec.ts` on the built Normal (`pnpm build:normal`, e2e server): `/shop` at 1920×940, 1366×768, 375×812, 915×412, with one owned item, one locked by rank, one affordable; run `expectNoTextOverlap` on it. Delete the spec file.
- [ ] **Step 6: Commit** `feat(normal-web): the Cửa hàng — try an item on the figure, buy it for points when the rank allows, and see this week's shelf`.

### Task C3: Welcome dialog and the "Tuần đầu tiên" panel

**Files:**
- Create: `apps/normal-web/src/screens/WelcomeDialog.tsx` (+ test), `src/screens/NewcomerPanel.tsx` (+ test)
- Modify: `apps/normal-web/src/App.tsx` (open the dialog once per session when `me.welcome.claimed === false` on the lobby; a lobby button `🎁 Quà chào mừng` while unclaimed), `src/screens/DailyScreen.tsx:172-330` (panel under the summary when `status.newcomer` exists), `src/locales/{vi,en}/normal.json` (`welcome.*`, `daily.newcomer.*`), `src/api.ts`

**Interfaces:**
- Consumes: C1 `api.welcome()` / `api.welcomeClaim(itemId | null)`, C2 DTO fields, `Chibi` + `chibiFromApi`.
- Produces: `WelcomeDialog({ api, lang, me, onClaimed }: …)` — title `welcome.title` "Chào mừng đến Blind Luck Poker", lead `welcome.lead` "Chọn một bộ đồ để bắt đầu", three cards each rendering `me`'s figure wearing that item (full frame 144 px), owned ones disabled with `welcome.owned` "✓ Đã có", buttons `welcome.claim` "Nhận" (disabled until a card is picked, or enabled with `welcome.claimReputationOnly` "Nhận 100 danh vọng" when all owned) and `welcome.later` "Để sau". After a claim: toast `welcome.done` "{{item}} đã vào tủ đồ, +100 danh vọng", `onClaimed(me')` refreshes `me`. `NewcomerPanel({ newcomer, lang })` — `Panel` titled `daily.newcomer.title` "Tuần đầu tiên", seven cells (✓ claimed, ★ today, 🔒 rest), cells 3 and 7 labelled `daily.newcomer.common` "1 món common" / `daily.newcomer.rare` "1 món rare +200 danh vọng"; the Daily receipt lists `receipt.newcomer` lines when `claim.newcomer` is present.

- [ ] **Step 1: Failing tests** — `WelcomeDialog.test.tsx`: three figures with distinct hashes; picking and claiming calls `welcomeClaim('outfit_dealer01')`; owned card disabled; all-owned → claim(null) button text; "Để sau" closes and the lobby button remains. `NewcomerPanel.test.tsx`: day 2 → one ✓, one ★, five 🔒; finished → not rendered. `DailyScreen.test.tsx`: a claim with `newcomer` prints the extra receipt line. `App.test.tsx`: the dialog opens once on the lobby when unclaimed and never when claimed.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/normal-web test` → PASS.
- [ ] **Step 5: Screenshots** of the dialog at 1920×940, 375×812 and 915×412 (it must fit without scroll at 915×412 or scroll inside the modal), and the Daily page with the panel at 375×812. Delete `zz-preview`.
- [ ] **Step 6: Commit** `feat(normal-web): a welcome gift on the first visit and a first-week calendar beside the check-in`.

### Task B4: GM tab "Cửa hàng" (prices, featured, welcome choices, reputation rules and ranks)

**Files:**
- Create: `apps/normal-web/src/screens/gm/ShopTab.tsx` (+ test), sections `PricesEditor`, `FeaturedEditor`, `WelcomeEditor`, `ReputationEditor` in the same folder
- Modify: `apps/normal-server/src/http/routes-gm.ts` (+6 routes), `routes-gm.test.ts:78` (22 → 28), `src/gm/gm-service.ts` (methods below), `gm-service.test.ts`, `apps/normal-web/src/screens/gm/GmScreen.tsx:14-15, 101-114` (tab `shop`), `GmScreen.test.tsx:52` (6 labels), `src/api.ts` (`gmShopPrices`, `gmSetShopPrices`, `gmShopFeatured(week)`, `gmSetShopFeatured`, `gmSetWelcomeChoices`, `gmReputationConfig`, `gmSetReputationRules`, `gmSetReputationRanks`, `gmGrantReputation`), `src/locales/{vi,en}/normal.json` (`gm.tabs.shop` "Cửa hàng", `gm.shop.*`, `gm.log.kind.*` for the six kinds)

**Interfaces:**
- Produces (server): `GmService.setShopPrices(actor, changes, reason) → { actionId, changed: number }`, `setShopFeatured(actor, weekKey, itemIds, reason) → { actionId }`, `setWelcomeChoices(actor, itemIds, reason) → { actionId }`, `setReputationRules(actor, patch, reason)`, `setReputationRanks(actor, ranks, reason)` (409 `RANK_ORDER` on `RankOrderError`), `grantReputation(actor, playerId, amount, reason) → { actionId, reputation, rank }` (amount integer 1..100000); each writes one `gm_actions` row with `details` holding the change. Routes: `GET /api/gm/shop` (prices + featured for the current and next 8 weeks + welcome choices + reputation rules/ranks), `PUT /api/gm/shop/prices`, `PUT /api/gm/shop/featured/:week`, `PUT /api/gm/shop/welcome`, `PUT /api/gm/reputation`, `POST /api/gm/players/:id/reputation`.
- Produces (web): `ShopTab({ api, lang, guard })`; the Players → `PlayerDetail` gets a "Danh vọng: {{points}} ({{rank}})" line and a "Cộng danh vọng" form (amount, reason) → `gmGrantReputation`.
- Consumes: B1, A2.

- [ ] **Step 1: Failing tests** — `gm-service.test.ts`: each method logs its kind and applies; `setReputationRanks` refuses `[0,100,50,…]`; `grantReputation` adds an event with reason `gm_grant`. `routes-gm.test.ts`: count 28 and one happy path per route. `ShopTab.test.tsx`: renders the four sections; saving a price change sends only changed rows with the reason; the featured picker refuses a seventh item; `GmScreen.test.tsx` six tabs in order (`Tổng quan, Người chơi, Phòng, Quà tháng, Cửa hàng, Nhật ký`). `PlayerDetail.test.tsx`: the reputation line and the grant form.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** server and web test suites → PASS.
- [ ] **Step 5: Screenshots** of the GM shop tab at 1920×940 and 375×812. Delete `zz-preview`.
- [ ] **Step 6: Commit** `feat(normal-server, normal-web): a GM prices the shop, picks the week's shelf and the welcome choices, tunes reputation, and grants it`.

### Task A4: Reputation and rank in the GM overview and the ledger panel

**Files:**
- Modify: `apps/normal-server/src/gm/gm-service.ts` (`overview()` adds `reputation: { total: number; byRank: number[] }`), `apps/normal-web/src/screens/gm/OverviewTab.tsx` (a line "Danh vọng: N người ở mỗi bậc"), `src/locales/*`, tests.

- [ ] **Step 1: Failing test** `overview counts players by rank`. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(gm): the overview counts players per rank`.

### Task D1: Core — Blind with no fee, dealt at any positive stack, auto-play when all in

**Files:**
- Modify: `packages/core/src/constants/economy.ts` (`blindTableFeeRate: 0`), `src/protocol/validate.ts:131` (`tableFeeRate: ECONOMY.blindTableFeeRate`), `src/hand/blind.ts:41-48, 96-100, 183-200` and the timeout path, `src/hand/blind.test.ts:35, 73, 118-119, 188`, `src/hand/engine.test.ts:147`
- Test: `blind.test.ts`, `engine.test.ts`

**Interfaces:**
- Produces: `createBlindHand` accepts any seat with `stack > 0` (throws `INVALID_SETUP` only for `stack <= 0`); `blindLegalActions` returns `none` for a seat with `allIn === true` and otherwise `callAmount = min(stack, fixedWager)`; in `playOrFold`, a seat that is all-in after the ante is given `decision = 'play'` as soon as the decision phase opens (its `PLAYER_ACTED` event carries `timedOut: false`, `allIn: true`, `amount: 0`), it is excluded from the timeout sweep and from `DECISIONS_REVEALED` ordering changes; `resolveDecisions` commits `min(stack, wager)` via `commit` (already). Fee: `settle` computes `fee = 0` for Blind because `rules.tableFeeRate === 0`. `blindRequiredStack` stays exported (clients use it for the sit-down hint) but no engine path reads it.
- Consumes: nothing new.

- [ ] **Step 1: Failing tests** in `blind.test.ts`: `a seat with 3,000 at a 5,000 wager is dealt, antes 3,000 all-in, and a win pays it only the main pot it covered` (3 seats, side pot to the others; `Σ stacks` conserved; `fee === 0`); `play-or-fold: a seat emptied by the ante is auto-played and never asked` (`blindLegalActions` → `[]`, no `TURN` for it, `DECISIONS_REVEALED` shows `play`); `play-or-fold: a seat short for the second commit plays all in for the rest`; update the fee expectations at :73, :118-119, :188 to 0; `engine.test.ts:147` simulation keeps conservation with short stacks mixed in (seed stacks from 1 to 5 × wager).
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/core test` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (keep `@bp/core` pure).
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/core test` → PASS; `tooling/arch` boundaries still pass.
- [ ] **Step 5: Commit** `feat(core): Blind Poker takes no table fee, deals any seat with points left and plays a seat that went all in on the ante`.

### Task D2: Room — play to zero, stand up at zero, the sit-down needs one wager

**Files:**
- Modify: `packages/server-kit/src/room/room.ts:340-344, 935-937, 1009-1020`, `room-hands.test.ts`, `soak.test.ts`
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` (`notify.STACK_SPENT` "Bạn đã hết điểm ở bàn này. Nhận Cứu trợ nếu số dư dưới {{threshold}} điểm, hoặc chọn ghế trống khi có điểm." / en; keep `TABLE_LIMIT_SPENT` strings), `src/screens/RoomScreen.tsx:225` (hint uses `room.config.blind.fixedWager`), `src/table/ActionBar.tsx` (Blind "Chơi" reads `Tất tay {{amount}}` when `callAmount < fixedWager`; key `action.playAllIn`), tests
- Modify: `apps/normal-server/src/app.test.ts:877-909` (blind e2e: fee 0 expectations)

**Interfaces:**
- Produces: `requiredStack()` returns 1 for both modes; sit-down refuses when `balance < this.rules.fixedWager`; `standUpSpent` sends `NOTIFICATION { kind: 'STACK_SPENT', payload: { roomId, threshold: ECONOMY.reliefThreshold } }` when `stack === 0` (Blind and Hold'em alike — Hold'em already could not reach it), and keeps `TABLE_LIMIT_SPENT` for the carry-over-claimant path only if any remains (if none, delete that branch and its strings in the same commit).
- Consumes: D1.

- [ ] **Step 1: Failing tests** `room-hands.test.ts`: `a Blind seat with 3,000 at a 5,000 table is dealt and plays all in` ; `a seat that reaches 0 is stood up after the hand with STACK_SPENT and books() stays 0`; `sitting down needs one wager, not two, in play-or-fold`; `Blind writes no table_fee sink` (the `sinks` array stays empty over 20 hands); `soak.test.ts` passes with the Blind config. `ActionBar.test.tsx`: `Tất tay 3.000` label. `RoomScreen.test.tsx`: the hint quotes the wager.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/server-kit test` and `corepack pnpm --filter @bp/ui-kit test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `corepack pnpm --filter @bp/normal-server exec vitest run src/app.test.ts` → PASS after updating the fee expectations.
- [ ] **Step 5: Commit** `feat(server-kit, ui-kit): a Blind seat plays until its last point, stands up at zero with a nudge toward Cứu trợ, and sits down with one wager`.

### Task E1: Lazy `Chibi` and a tint queue

**Files:**
- Create: `packages/ui-kit/src/avatar2d/lazy.ts` (`useInView(ref, margin = '200px'): boolean` with an `IntersectionObserver` and a `true` fallback when the API is missing), `tint-queue.ts` (`enqueue<T>(job: () => Promise<T>, priority: number): Promise<T>` with concurrency 4, higher priority first), tests
- Modify: `Chibi.tsx:80` (`lazy?: boolean` prop; when `lazy && !inView` render the root with its size and no layers), `tinted.ts:147` (`useTintedLayer` runs its `loadImage` through the queue; `@2x` only when `devicePixelRatio >= 1.5`), `clip.ts:26` (same gate), `docs/ui-kit.md` (Chibi section)

**Interfaces:**
- Produces: `Chibi({ …, lazy })`; `useInView`; the queue. Behaviour unchanged for `lazy` undefined.

- [ ] **Step 1: Failing tests** `lazy.test.tsx`: with a mocked `IntersectionObserver`, a `lazy` Chibi renders no `<img>` until the observer fires, then all layers; without the API it renders at once. `tint-queue.test.ts`: at most 4 jobs run concurrently; priority order. `tinted.test.ts`: `@1x` chosen at DPR 1, `@2x` at 2.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/ui-kit test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; reduced-motion untouched.
- [ ] **Step 5: Commit** `perf(ui-kit): a chibi can wait until it is on screen, and tinted layers are drawn four at a time`.

### Task E2: Wardrobe and shop use lazy figures; request-count test; 3G measurement

**Files:**
- Modify: `apps/normal-web/src/screens/wardrobe/SavedOutfits.tsx:183`, `HairStyleTab.tsx:54`, `ItemTab.tsx:70-89` (`ItemPreview` tinted icons through the queue with priority by index), `src/screens/shop/ShopCard.tsx` (lazy), `WardrobeScreen.tsx:126-131` (keep `Promise.all` but render the stage before achievements resolve)
- Create: `apps/normal-web/e2e/wardrobe-perf.spec.ts` (runs in `playwright.config.ts`'s suite on the e2e server; CDP `Network.emulateNetworkConditions` 1.6 Mbps / 150 ms; asserts the stage and the first row of cards are visible within 2 s at 1366×768 and 375×812, and that the number of `/avatar/` requests before any scroll is ≤ (visible cards + 1 stage) × 8). This spec registers no account beyond the one the suite already makes for the wardrobe case — reuse `wardrobe-layout.spec.ts`'s session helper.
- Modify: `docs/normal-web.md` (perf note), `docs/test-matrix.md` (+1 row), `tooling/arch/acceptance-links.test.ts` (matrix count +1)

- [ ] **Step 1: Write the Playwright test** and run it against the current build → FAIL (request count).
- [ ] **Step 2: Implement** the usage changes. **Step 3: Build** (`pnpm build:normal`) and run `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts wardrobe-perf` → PASS; record the before/after request counts in the report.
- [ ] **Step 4: Commit** `perf(normal-web): the wardrobe and the shop draw the figures you can see first, and no more images than that`.

### Task G2: Check-in copy and calendar for monthly counting

**Files:**
- Modify: `apps/normal-web/src/screens/DailyScreen.tsx` (summary line `daily.summaryCount` "Lần điểm danh thứ {{day}} của tháng {{month}} · không cần liên tiếp"; helper line `daily.daysLeft` "Còn {{days}} ngày trong tháng cho {{cells}} ô"), `DailyCalendar.tsx` (the next cell is "Hôm nay" by count, not by date), `src/locales/{vi,en}/normal.json`, `docs/player-guide.md` (§Điểm danh), `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §13.1 (one amending sentence pointing at Plan 27 G), tests
- Modify: `apps/normal-web/src/screens/gm/GiftsTab.tsx:24` only if it assumes consecutive days (it keys by day number — unchanged)

- [ ] **Step 1: Failing tests** `DailyScreen.test.tsx`: the summary for `{day: 12, month: '2026-10', nextResetAt}` on 2026-10-13 reads the two lines; `DailyCalendar.test.tsx`: cell 13 is today when `day` is 12 and claimable.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Screenshot** Daily at 375×812. **Step 6: Commit** `copy(vi, en): the check-in page counts the month's claims and says a missed day is forgiven`.

### Task A5: `reputation-backfill-cli`

**Files:**
- Create: `apps/normal-server/src/reputation/backfill.ts` (+ test), `src/reputation-backfill-cli.ts`
- Modify: `apps/normal-server/scripts/build.mjs:47-48` (entry + output), `package.json` scripts (`"backfill:reputation": "node dist/reputation-backfill-cli.js"`), `docs/deployment-normal.md` (§ deploy steps: after `compose up`, `docker compose exec app node dist/reputation-backfill-cli.js --dry-run` then without), `deploy/normal/README.md` if it lists the CLIs

**Interfaces:**
- Produces: `backfillReputation(db, { dryRun: boolean; now?: Date }): Promise<{ players: number; applied: number; byRank: number[] }>` — per player without a `backfill` event: `delta = max(0, formula − Σ existing deltas)` with the formula from spec A6 using `reputation_rules` as stored; `dryRun` computes only. CLI: `node dist/reputation-backfill-cli.js [--dry-run]`, reads `DATABASE_URL` like `grant-gm-cli.ts`, prints `players=… applied=… ranks=[…]`, exit 0/1/2 like the GM CLI.

- [ ] **Step 1: Failing tests** `backfill.test.ts`: `a player with 120 hands, 30 wins, 10 login days and one item achievement gets 120+90+100+500`; `live events already written are subtracted`; `a second run applies 0`; `dry run writes nothing`; `rank is raised to the high-water mark of the result`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** + CLI + build entries. **Step 4: Run** `corepack pnpm --filter @bp/normal-server exec vitest run src/reputation` → PASS; `corepack pnpm --filter @bp/normal-server build` produces `dist/reputation-backfill-cli.js`.
- [ ] **Step 5: Commit** `feat(normal-server): a one-shot CLI that credits every existing account the reputation its history already earned`.

### Task F1: Docs

**Files:**
- Modify: `CHANGELOG.md` (new top section `## Plan 27 — … — merged \`MERGE\` (2026-10-2x)` with the structure CLAUDE.md §6 prescribes; deviations list starts with the spec's R6/R20 outcomes and anything the tasks reported), `docs/known-limitations.md` (R1 no reputation deduction; GM reset does not touch the newcomer calendar; pre-0005 items have no ref; K1 two devices: no "Tiếp quản", no device list; monthly counting assumes `Asia/Ho_Chi_Minh` in the data migration; epic shelf thin until gift months pass), `docs/player-guide.md` (Cửa hàng, Danh vọng, Quà chào mừng, Tuần đầu tiên, Blind tới 0, Hai thiết bị), `docs/copy-review-2026-10-10.md` §3 (new stable terms), `docs/normal-server.md` (reputation, shop, welcome, backfill), `docs/ui-kit.md` (RankLabel, lazy Chibi, STACK_SPENT), `docs/normal-web.md` (shop screen), `docs/deployment-normal.md` (backfill step), `docs/acceptance-checklist.md` (+ rows for shop conservation, Blind to zero, rank display), `docs/test-matrix.md` (+ rows), `tooling/arch/acceptance-links.test.ts` (counts), `docs/bug-log.md` §9 (K2–K5 → Plan 27, K1 closed), `docs/superpowers/specs/2026-09-04-bind-poker-design.md` (§12 Blind fee 0, §13 monthly counting, §14 shop — one amending paragraph each pointing at this spec).

- [ ] **Step 1: Write** the docs. **Step 2: Run** `corepack pnpm exec vitest run --root . tooling/arch` → PASS (citations verbatim). **Step 3: Read back** one Vietnamese heading of each edited doc. **Step 4: Commit** `docs: Plan 27 in the CHANGELOG, the player guide, the limitations, the glossary and the package docs`.

### Task F2: Ops cases

**Files:**
- Create: `apps/normal-web/e2e/ops/08-shop.spec.ts`
- Modify: `apps/normal-web/e2e/ops/ops-helpers.ts` (a `grantReputation(page, playerId, amount)` through the GM API with the ops GM account; `buyItem` helper), `04-blind.spec.ts` (+ one case), `06-gm.spec.ts` (+ one case), `docs/test-matrix.md`, counts

**Cases (titles are stable text the matrix cites):**
- `S-01 the welcome dialog offers three rare items and the pick is worn` (desktop) — a `newPlayer` sees the dialog on the lobby, picks "Bộ chia bài", the lobby figure's hash changes, Phòng thay đồ lists it as owned.
- `S-02 a common buys at rank 1, a rare needs Cao thủ, and the balance drops once @mobile` — buy `head_beanie01`; the rare card shows "cần Cao thủ"; after `grantReputation 400` the rare buys; the ledger panel shows "Mua ở Cửa hàng".
- `S-03 the rank label stands beside the name on the seat and the profile` — after the grant, the profile reads "Cao thủ" and a seat at a table shows it; `@landscape` variant asserts the "III" pill.
- `B-xx a Blind seat plays down to zero and is stood up with the Cứu trợ nudge` in `04-blind.spec.ts` — a player sits with 3 × wager at a bot table and loses on purpose (fold-free "Chơi" every hand until 0; cap at 30 hands or use a GM point adjustment to shrink the balance first).
- `Q-xx the GM shop tab reprices an item and the shelf follows` in `06-gm.spec.ts`.

- [ ] **Step 1: Write** the cases; **Step 2: Run** `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "S-0|Blind seat plays down|shop tab"` → PASS (three projects as tagged). **Step 3: Commit** `test(e2e): the ops pack buys in the shop, opens the welcome gift, reads the rank on the seat, and plays a Blind seat to zero`.

### Task F3: Final review, gate, merge, deploy

- [ ] Whole-branch review (opus) → one fix wave → re-review.
- [ ] Full gate on the branch's final tree (merge `main` in first if it moved): typecheck → lint → test → build:normal → build:lite → avatar:check → e2e Normal → e2e Lite → ops. Logs in the SDD workspace; numbers in the report.
- [ ] Merge `--no-ff` into `main`: `Merge feature/BP-27-shop-reputation-welcome-blind-zero: <one sentence>`; docs commit replacing `MERGE`.
- [ ] Deploy (the user approved in the brainstorm, 2026-10-22): user pushes `main`; on the VPS `cd /opt/bind-poker/deploy/normal && ./backup.sh`, `git -C /opt/bind-poker pull --ff-only`, check `/health` rooms = 0, `docker compose up -d --build` (applies `0006_plan27`), verify 7 migration rows and the new tables, `docker compose exec app node dist/reputation-backfill-cli.js --dry-run` then without `--dry-run`, `/health` ok, smoke `/shop` and the sign-in page without signing in. LAN kit: not deployed (no `.env`). Lite: rebuilt locally, not shipped.
- [ ] One report: what shipped, gate numbers, every ruling, deviations, residuals, manual checks (welcome dialog on a real account, a purchase, the rank on a phone seat, a Blind table to zero, the Daily page after a missed day).

---

## Self-review notes (2026-10-22)

- Spec coverage: A1–A6 → A1/A2/A3/B4/A4/A5; B1–B4 → B1/B2/B3/B4; C1–C2 → C1/C2/C3; D1–D2 → D1/D2; E → E1/E2; F → F1; G → G1/G2. Q9 (K1 docs) → F1. R14 (auto-play) → D1; R15 (high-water mark) → A2; R16 (colours) → B1/B3; R17 (owned choice) → C1/C3; R18 (backfill subtraction) → A5; R19 (carry-over) → D1 test asserts conservation only, documented; R21 (consecutive) → G1.
- Known gap left to the pre-flight review: C2 needs `newcomer_progress.last_day_key` (or equivalent) that A1 must add — A1's implementer adds `lastDayKey text null`. The reviewer should also confirm the avatar-config writer `wearWithin` exists or name the function C1 must call, and whether `HandSummary` exposes `won` per seat (`game_players.won` says yes).

## Amendments (pre-flight 2026-10-22)

An independent opus review of the plan against the code at `5fbeeba` (93 tool uses). Each amendment overrides the task text it names. BLOCKER = an implementer would build the wrong thing or be stuck; MINOR = a correction of a name, path or count. P36 was **rejected** (see it).

**Part A — schema, check-in counting, reputation**

- **P1 (Task A1, BLOCKER).** Three tests count applied migrations with `toHaveLength(6)`; change each to `7`: `migrate-gm.test.ts:140`, `migrate-ledger-keys.test.ts:123`, `migrate-plan26.test.ts:117`. Model `migrate-plan27.test.ts` on `migrate-plan26.test.ts` (`BEFORE = [..., '0005_plan26']`, `WHEN_0005 = 1792459114276`).
- **P2 (Task A1 → C1/C2, BLOCKER).** `newcomer_progress.last_day_key text NULL` (Drizzle `lastDayKey`). C1 sets it to `dayKey(now, timezone)` when it inserts the row (so `createWelcomeService` deps gain `timezone: string`); C2 advances only when `last_day_key !== today`, then writes today. Without it a check-in on the welcome day would move the calendar to day 2 (spec C2 "ngày khác ngày C1").
- **P3 (Task A1/A2/B1, BLOCKER).** `resetDb` (`src/db/test-harness.ts:152-155`) truncates `users … cascade`, which would empty every table whose `updated_by` references `users`. Ruling: `updated_by` on `reputation_rules`, `reputation_ranks`, `shop_prices`, `shop_featured`, `shop_config` has **no foreign key** (plain `uuid NULL`). Add `reputation_events`, `newcomer_progress`, `shop_featured`, `shop_prices` to the truncate list. Also seed rules, ranks and `welcome_choices` idempotently **in code at boot** (`reputation.seedDefaults()` in A2, `shop.seedPrices()` + `shop.seedConfig()` in B1, `ON CONFLICT DO NOTHING`, next to `catalog.seed`), and keep the SQL seeds for the VPS.
- **P4 (Task A1, MINOR).** Seeds after the DDL as separate `--> statement-breakpoint` blocks. The data step's month comes from `now()` in the database; the test computes the expected month with `monthKey(Date.now(), 'Asia/Ho_Chi_Minh')` and tolerates a run across midnight.
- **P5 (Task G1, BLOCKER).** `DAILY_CLAIMED` literals that need `consecutive`: `economy-service.test.ts:181`, `stats-service.test.ts:212-216`, `events.test.ts:17`, `achievement-service.test.ts:242,245`, `app.test.ts:1001`. `nextStreak` keeps `streak` as the month's count: `claimDaily` (`economy-service.ts:262-275`) already keeps `claimed_days` (+1 within a month, 1 on a new month) and the A1 data step makes `streak = claimed_days`. Ruling: derive `day` from `streak`; `dailyStatus` (`:217-222`) needs no extra column; `lockDaily` (`:149-159`) must also select `consecutive`.
- **P6 (Task G1, BLOCKER).** `gm-service.ts:450` (`resetCheckin`) must also set `consecutive: Math.max(login.consecutive - 1, 0)` and record `previousConsecutive` in `details`, or a reclaim after an undo counts the consecutive run twice. `checkinPreview` (`:415-419`) unchanged.
- **P7 (Task A2, BLOCKER).** Inside a transaction never read through `deps.db`: PGlite has one connection and deadlocks (see `economy-service.ts:333`). Signature change: `grantRuleWithin(tx, playerId, key: RuleKey, reason: ReputationReason, refId: string): Promise<ReputationGrant>` reads the amount from `reputation_rules` and the ladder from `reputation_ranks` **through `tx`**. Keep `grantWithin(tx, playerId, delta, …)` for the GM grant and the backfill only (also reading ranks through `tx`). `rules()` / `ranks()` (db, cached ≤ 5 s) are for views only.
- **P8 (Task A2, MINOR).** `HandSummary` is `packages/server-kit/src/repositories.ts:114-136`: per seat `playerId`, `isBot`, `won` (= `net > 0`, `room.ts:829`); per hand `cancelled` and `settlementError?`. `summary.players` holds only the dealt seats (folded included). Copy the skip from `stats-service.ts:146`: `if (summary.cancelled || summary.settlementError !== undefined) return`. Write both rows for a seat in one `grant` transaction.
- **P9 (Task A2, MINOR).** `unlockWithin(tx, playerId, def, at, pay)` (`achievement-service.ts:73-79`): `pay.reputation?: Pick<ReputationService, 'grantRuleWithin'>` optional; return `{ outcome: 'unlocked' | 'already'; rankUp: boolean; rank: number }` so both call sites (`:136`, `gm-service.ts:400`) notify after commit. Reputation ref `ach:<pid>:<def.id>` on both paths.
- **P10 (Task A2, MINOR).** `EconomyServiceDeps` (`economy-service.ts:90-121`), `AchievementServiceDeps`, `GmServiceDeps` get `reputation?: ReputationService` optional (seven direct `createEconomyService` calls in tests: `economy-service.test.ts:72,470,509,545,619`, `gift-schedule-store.test.ts:192,235`; one `createAchievementService` at `achievement-service.test.ts:56`). Add `reputation`, `shop`, `welcome` to `AppServices` (`app.ts:201-224`); `gm-service.test.ts` spreads `h.app.services`. `reputation.start()` after `achievements.start()` (`app.ts:351`).
- **P11 (Task A3, BLOCKER).** Rank travels `RoomScreen → PokerTable → Seat`: add `rankFor` to `PokerTable` (`PokerTable.tsx:41` props, `:142` destructure, `:248` beside `caption`); `Seat` gets `rank?: number | null` and `frame?: RoomFrame`, PokerTable passes its own `frame` (`:139`). Do **not** call `useRoomFrame()` inside Seat (it would ignore RoomScreen's `frame` override used by the playground). Label inside `<span className={s.seatName}>` (`Seat.tsx:293`) or a sibling in `plateText` (`:292-295`); measure `plateText` for the 120 px rule.
- **P12 (Task A3, BLOCKER).** `PlayerBar` is `packages/ui-kit/src/lobby/PlayerBar.tsx:29` (not normal-web). Add `rank?: number | null` to `PlayerBarProps` and `LobbyScreenProps` (`LobbyScreen.tsx:17-25`, pass-through `:80`); App passes `avatars.get(myId)?.rank` (`App.tsx:385-396`).
- **P13 (Task A3, MINOR).** The "Mời ra" dialog (ui-kit `RoomScreen.tsx:461`) uses the same `rankFor`. `GmRoomDetailDto.members` (`api.ts:479`) has no rank: ruling — `RoomsTab` calls `useAvatars(api, humanIds)`; no server change.
- **P14 (Task A3/D2/B4, MINOR).** `Toasts.tsx:76-85` only interpolates `amount`, `id`, `reason`: add `rank` (resolved through `t('rank.N')`) and `threshold` (`formatPoints`). `GmPlayerDetail` (`gm-service.ts:59`) and `GmPlayerDetailDto` (`api.ts:447`) gain `reputation` and `rank`.

**Part B — shop**

- **P15 (Task B1, BLOCKER).** `pruneLedgerKeys` (`balance-repo.ts:229`, `app.ts:274`) empties `ledger_keys` at every boot, so the key alone is no guard. `buy` order: (1) pre-transaction alias-aware `inventory.owns()`; (2) in the transaction `inventory.findByRef(tx, pid, 'shop:<pid>:<purchaseId>')` non-empty → `{ ok: true, repeated: true }`; (3) insert the key, conflict → repeated; (4) validate, `creditWithin`; (5) `inventory.grant(...)` returning `false` → throw so the debit rolls back, mapped to `ALREADY_OWNED`. Nothing inside the transaction may call `owns`, `missingOf`, `list` or `balances.get` (db, not tx; P7).
- **P16 (Task B1, MINOR).** Gift-month lock: `gifts.current().noticesFrom(monthKey(now, tz))` (`daily-gifts.ts:152-164`) returns each fixed item once with its month: `month: null` → `gift_default`; `month ≥ current` → `gift_month`; past months are left out already. `GiftScheduleStore.current()` is synchronous. `view.owned` resolves aliases from `inventory.list` as `routes-me.ts:195-206` does (`resolveItemId`).
- **P17 (Task B1, MINOR).** `TxReason` (`repositories.ts:16-32`) gains `'shop_purchase' | 'shop'`; `SettlementMeta.kind` (`:47-51`) gains `'shop'`. The sink row's `reason` and `kind` both come from `meta.kind` (`balance-repo.ts:176-184`). Lite's SQLite repo writes `meta.kind` too, unaffected. `app.test.ts:905` unchanged.
- **P18 (Task B2/C1/B4, MINOR).** `app.test.ts:359-410` route list gains `GET /api/shop`, `POST /api/shop/buy`, `GET /api/welcome`, `POST /api/welcome/claim` and the GM routes of P19; `routes-gm.test.ts:97-110` (reasons list) gains `POST /api/gm/players/:id/reputation`.
- **P19 (Task B4, BLOCKER).** Ruling: follow the spec — `PUT /api/gm/reputation/rules` and `PUT /api/gm/reputation/ranks` (two routes, two kinds), plus `GET /api/gm/shop`, `PUT /api/gm/shop/prices`, `PUT /api/gm/shop/featured/:week`, `PUT /api/gm/shop/welcome`, `POST /api/gm/players/:id/reputation` = **7 new GM routes** → `routes-gm.test.ts:78` 22 → **29** (and its "twenty-two" comment).
- **P20 (Task B3, BLOCKER).** Shell nav (`Shell.tsx:8-22`) is capped at four tabs (bug 8, 375 px): do **not** add `/shop` there. Put a shop link beside the wardrobe link in LobbyScreen's `avatar` slot (`App.tsx:391-395`) or its `header` slot. Add `/shop` to `ACCOUNT_ROUTES` (`App.tsx:64`) and a `lazyScreen` entry (`:56-61`); `App.test.tsx:322` checks the route list.
- **P21 (Task B3, BLOCKER).** `ItemCard` (`cards.tsx:121-138`) and `ColourCard` (`:199`) refuse to pick an unowned card: add `pickable?: boolean` (default `owned`) and `footer?: ReactNode` to `ItemCard`, `ColourCard`, `WordCard`. `ShopEntry` has no `ItemDto`: ShopScreen loads `api.catalogItems()` and the avatar catalogue like WardrobeScreen; `ShopCard` takes `item: ItemDto`.
- **P22 (Task B3, MINOR).** App has no `MeDto`, only `gate.me: AuthMeDto` and the live `balance` from the socket push. Signature: `ShopScreen({ api, lang, balance, playerId })`; no `onBalance` (the server's `onBalanceChanged` pushes the new balance). Stage reads `avatars.get(playerId)?.avatar` or `api.inventory().avatar`. normal-web has no HTTP toast: "toast" becomes an inline `role="status"` line. `/avatar?item=<id>` needs App to pass `route.query.get('item')` to `WardrobeScreen` as `initialItem` (`App.tsx:346`).

**Part C — welcome gift and newcomer calendar**

- **P23 (Task C1, BLOCKER).** No in-transaction "wear" exists: `applyAvatarConfig(db, …)` (`inventory/avatar.ts:147-169`) uses `inventory.missingOf` on `db`. Write `wearItemWithin(tx, catalog, aliases, bodies, playerId, itemId): Promise<void>` in `inventory/avatar.ts`: read `players.avatar_config` through `tx` → `readAvatarConfig` → `config[catalog.get(itemId).slot] = itemId` → `validateAvatarConfig` → update `avatarConfig`, `equippedTitle`, `equippedBadge` through `tx` (as `inventory.revoke` does, `inventory-service.ts:207-216`). Wire `avatars: { wearWithin: (tx, pid, id) => wearItemWithin(tx, catalog, aliases, bodies, pid, id) }` in `app.ts`.
- **P24 (Task C1/C3, MINOR).** Drop `welcome` from `GET /api/me` (App never fetches it); App calls `api.welcome()` on the lobby. `WelcomeDialog({ api, lang, status: WelcomeStatusDto, avatar: AvatarConfigDto | null, items, bodies, onClaimed })` on the ui-kit `Modal` (`primitives/Modal.tsx:10-31`: `open`, `title`, `onClose`, `children`, `footer`, required `closeLabel`, `anchor`). The "🎁 Quà chào mừng" button goes in LobbyScreen's `header` or `avatar` slot.
- **P25 (Task C3 + F2 + e2e, BLOCKER).** (a) `useDailyNudge` (`daily-nudge.ts:61`) sends a fresh sign-in from the lobby to `/daily` whenever a reward waits, so a new account would never see the dialog: ruling — while the welcome gift is unclaimed, skip the nudge. (b) Every e2e and ops test that registers an account now gets a modal over the lobby: the e2e `register` helper (`apps/normal-web/e2e/support.ts`) and the ops `registerPatiently` / `newPlayer` (`ops-helpers.ts:59,87`) press "Để sau"; S-01 opts out; `App.test.tsx` stubs return `{ claimed: true }`.
- **P26 (Task C2, MINOR).** Day-3/day-7 picks reuse the monthly draw's exclusion `drawExclusionOf(gifts)` with `withinSlots: DAILY_DRAW_SLOTS`, `.filter(id => catalog.get(id))`, and `rng`. The fallback ref `newcomer:<pid>:<day>` sits outside `CLAIM_REASONS` / `latestClaim` (`gm-service.ts:238-247`), so a GM undo leaves it alone. Reputation key for day 7: `('newcomer_day', 'newcomer:<pid>:7')`.

**Part D — Blind to zero**

- **P27 (Task D1, BLOCKER).** `ECONOMY.blindTableFeeRate` does not exist: add `blindTableFeeRate: 0` to `constants/economy.ts` (+ a line in `economy.test.ts`); `validate.ts:131` uses it; `validate.test.ts:19` expects `tableFeeRate: 0`. Core fixtures (`blind.test.ts:9`, `engine.test.ts:9`) pass `tableFeeRate: 0.02` explicitly: leave `blind.test.ts:73,118-119,188` as they are (rate maths) and add one case with `tableFeeRate: 0`.
- **P28 (Task D1, BLOCKER).** Auto-play: in `createBlindHand` (`blind.ts:77-87`), after the antes, set `decision = 'play'` on every seat that is now `allIn` while the phase is `DECISION`, emit `DECISION_MADE {seat}` for each, and if no seat is left undecided call `resolveDecisions` at once. `blindLegalActions` (`:99`) already returns `none` when `decision !== null`; the runner only times out / schedules bots for `decision === null` (`hand-runner.ts:122,156,172`); `TIMEOUT` on a decided seat is a no-op (`blind.ts:121`). `callAmount = Math.min(p.stack, fixedWager)`. On a squeeze table the auto-played seat stays unrevealed until the reveal phase, like a bot.
- **P29 (Task D1→D2, MINOR).** `app.test.ts:888-890` asserts `sinks.length > 0` for the Blind hand: move that edit (to 0, and drop `table_fee` from the `settled` sum) into D1's commit.
- **P30 (Task D2, BLOCKER).** Tests the new rules break: `room-hands.test.ts:368,696,760-774,788,809,840,1277` (`TABLE_LIMIT_SPENT`); `Toasts.test.tsx:177,192`, `Toasts.tsx:79`; `RoomScreen.tsx:225`; `apps/normal-web/e2e/normal.spec.ts:430` (fee 2 % in "một tài khoản chơi trọn một ván Blind với bot"); `apps/lite/e2e/lite.spec.ts:24,319`; ops `04-blind.spec.ts:170-176` (F-07 cash-out arithmetic) and `:217-250` (F-10 relies on four folds leaving 1 000 and the TABLE_LIMIT_SPENT text). Ruling: rewrite **F-10 as the Blind-to-zero case** (it replaces F2's "B-xx"), updating `docs/operation-test-plan.md` if the title changes. `standUpSpent` (`room.ts:1009-1020`) drops the `mode === 'blind'` guard, so a busted Hold'em seat also gets `STACK_SPENT` (CHANGELOG). `TABLE_LIMIT_SPENT` can no longer happen: delete the branch and its strings (`game.json:269-270`, both locales). The Cứu trợ nudge is text only (Toasts has no action buttons): a deviation.
- **P31 (Task D2, MINOR).** `soak.test.ts` is `packages/server-kit/src/soak.test.ts`: add `expect(r.fees).toBe(0)` to its blind case (`:80-88`). Lite changes for the CHANGELOG: Blind has no fee and writes no `table_fee` sink; a seat is dealt with any stack above 0; play-or-fold needs one wager to sit; a seat stands up at 0 with `STACK_SPENT`, Hold'em included; the Blind result card shows no "Phí bàn" line; the sit-down hint quotes one wager. Lite's own `ECONOMY` reads (`routes.ts:149-153`, `web/…/DailyScreen.tsx:162-164`, `economy-service.ts:49`, `daily.ts:90-93`, `session-service.ts:36`) do not change.

**Part E — lazy wardrobe**

- **P32 (Task E1, MINOR).** `tinted.ts:153` already picks density by `devicePixelRatio > 1`: change to `>= 1.5`. Keep the clip mask at @2x (`Chibi.tsx:17` deliberate; `Chibi.test.tsx:189,225` pin it); gate the clip on `lazy` only.
- **P33 (Task E2, BLOCKER).** `wardrobe-layout.spec.ts` has no session helper and `e2e:normal` is at the sign-up limit. Put the 3G measurement in the ops pack as cases of `08-shop.spec.ts` using `newPlayer` / `registerPatiently`, `desktop` at 1366×768 and `@mobile`. Bump the ops count (43) in CLAUDE.md and the docs.

**Part F — CLI, docs, ops**

- **P34 (Task A5, BLOCKER).** The backfill subtracts only the live events that mirror `player_stats` / `player_achievements`: `Σ delta WHERE reason IN ('hand_played','hand_won','daily_login','achievement')`. Spec R18's premise is false for `welcome`, `newcomer_day`, `gm_grant` (subtracting them would take away a player's +100 welcome). Record as a spec deviation. Add `'reputation-backfill-cli.js'` to `apps/normal-server/test/build.test.ts:26` and `scripts/build.mjs:47-48`.
- **P35 (Task F2, MINOR).** GM access in the ops pack exists: `promoteToGm(page, email)` (`ops-helpers.ts:429-433`, `POST /e2e/promote`, then reload) and `postApi` (`:153`); `grantReputation` builds on those. `feeOn` (`:353`) stays for Hold'em.
- **P36 (Global) — REJECTED.** The reviewer proposed the trailer "Claude Opus 5.5"; this session's prescribed trailer is `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (CLAUDE.md §6 "the attribution trailer the session prescribes"). Keep Fable 5.1.

**Verdict used for scheduling.** A1 → G1 → A2 first. D1+D2 and E1 touch no normal-server/normal-web file of Parts A–C and could run in a second worktree after A1, but D2 and A3 both edit `game.json`, `Toasts.tsx`, `RoomScreen.tsx` (ui-kit), and E2 and B3 both touch `cards.tsx`; A5 needs only A1 and A2. This run keeps one worktree and the task order (one writer), with D1 and D2 after A3.
