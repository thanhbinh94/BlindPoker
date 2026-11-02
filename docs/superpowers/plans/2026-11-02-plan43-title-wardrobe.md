# Plan 43 — The Thần title sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player who holds a Thần title also owns and can wear its set — outfit (two cuts), head piece, aura and
frame — granted with the title. Existing holders get their sets by a one-off backfill. The three set auras move gently,
and the `title_god` title reads "Thần Bài" in Vietnamese.

**Architecture:**
- The fifteen pictures go through the registry loop (`docs/avatar-2d.md` §10) and are cut into `public/avatar/`.
- The twelve items join `items.json`.
- Achievements gain `reward.setItems`. It is granted in the unlock's own transaction, and is reserved from the shop and
  the daily draw like `reward.itemId`.
- A CLI backfills owners.
- The kit maps the three aura layers to a CSS motion on non-lazy chibis.

**Tech Stack:**
- TypeScript, React 18, CSS modules (ui-kit).
- Fastify, Drizzle and PostgreSQL / PGlite in tests (normal-server).
- Node `sharp` art pipeline.

**Spec:** `docs/superpowers/specs/2026-11-02-title-wardrobe-design.md`, which amends
`docs/superpowers/specs/2026-10-31-title-entrance-design.md` §6–§7.

## Global Constraints

- No new runtime dependency. `@bp/core` untouched.
- Every player-facing string in `vi` and `en`. English item names are the spec §3 list, verbatim. Only `items.title_god`
  (vi) changes among existing strings: "Hóa Thần" → "Thần Bài".
- Item ids, verbatim:
  - `outfit_card_god01`, `head_ace_crown01`, `aura_card_god01`, `frame_card_god`;
  - `outfit_demigod01`, `head_laurel_silver01`, `aura_demigod01`, `frame_demigod`;
  - `outfit_godslayer01`, `head_godslayer_helm01`, `aura_godslayer01`, `frame_godslayer`.
  - All `epic`, `isDefault: false`.
- Vietnamese names, verbatim (spec BP-42 §6):
  - Long bào Thần Bài, Vương miện Át, Hào quang Thần Bài, Khung Thần Bài;
  - Áo choàng Bán Thần, Vòng nguyệt quế bạc, Hào quang Bán Thần, Khung Bán Thần;
  - Giáp Sát Thần, Mũ sừng Sát Thần, Hào quang Sát Thần, Khung Sát Thần.
- No money path changes: an unlock still pays its points once, and the backfill writes inventory rows only (no ledger,
  no reputation).
- New motion has a `prefers-reduced-motion` path and a test.
- Stable e2e terms unchanged.
- English copy outside the new names is not touched.

## Review Focus

1. **A set item on sale or drawn by chance.** `achievementItemIds` (shop seed) and `reservedItemIds` (`app.ts`, the
   daily draw) read only `reward.itemId` today. A set item missed there would be sold for 150 000 or handed out on a
   daily login. Task 2 pins both.
2. **A second unlock or a rerun of the backfill granting twice, or paying.** `inventory.grant` is idempotent. The tests
   must assert that row counts and balances are unchanged on a rerun.
3. **A GM's `unlockAchievement`** takes the same path as a natural unlock and must hand over the whole set. The test goes
   through the GM service, not only the achievement service.
4. **A lazy (grid) chibi or reduced motion animating the aura.** Neither may carry the motion class.
5. **The frame ring covering the portrait.** A frame is fitted by its whole ink box (`RING` 260), so wide ornaments
   shrink the ring. Check by eye on the sheet that the ring clears the 208-px crop (the art task).

## Amendments (pre-flight 2026-11-02)

An independent review against the real code. Each amendment binds the task it names and wins over that task's text.

- **A1 (blocker, Task 2): the shop's achievement lock.** `shop-service.ts:194-195` builds `rewardOwner` from
  `def.reward.itemId` only. It gates buying (`:318`), the auto-shelf (`sellable`, `:224`), `setFeatured` and the welcome
  choices (`gm-service.ts:828`).
  - Build it from `rewardItemIds(def)`.
  - Test: `entryOf(me,'aura_card_god01')` gives `lock {kind:'achievement', achievementId:'chaos_god'}`, and the purchase
    is still refused after `setPrices` sets `enabled: true`.
- **A2 (Task 2): reservation helpers.** Draws are common or rare only (`daily-gifts.ts:74-76`), so a daily-draw test
  observes nothing.
  - Export both `rewardItemIds(def): string[]` (drops an undefined `itemId`) and
    `rewardItemIdsOf(defs: readonly AchievementDef[]): string[]` from `definitions.ts`.
  - Use them in `app.ts:368`, in `achievementItemIds` (`shop-prices-seed.ts:28-30`) and in `rewardOwner`.
  - Unit-test the pure function, plus the seed test "seeds a price per catalogue item once" with a set item seeded
    `enabled: false`.
- **A3 (Task 2): the rows already exist.** Task 1 committed the 12 rows (with `variants.m`) and their vi/en names in
  `c2427ac`. Task 2 verifies them and does not re-add them.
- **A4 (Task 2): hide flags.** Item rows carry hide flags inside `asset`, and only when true. `items.ts:266-281` fails at
  load on a disagreement with the manifest. The v4 head layers carry none (the helm is clipped by its `hairClip` mask),
  so write none.
- **A5 (Task 2): count pins** broken by Tasks 1–2. Fix every one:
  - 130 → 142 at `apps/normal-server/src/inventory/items.test.ts:121,124` (and the "a hundred and thirty" in the
    title), `apps/normal-server/src/shop/shop-service.test.ts:116,118,165` and
    `apps/normal-web/src/locales/locales.test.ts:33`;
  - `apps/normal-server/src/inventory/bodies.test.ts:68` (26 → 32 outfit layers with skin line art);
  - `apps/normal-web/test/avatar-pipeline.test.ts:1287` (the layer count) and `:1413` (26).
  - Run the affected suites to find any other pin.
- **A6 (Task 3): existing tests to update.** In `achievement-service.test.ts`:
  - `:153-157` uses `toEqual` on the three chaos definitions: add `setItems`;
  - `:391` and `:396` use `inv.list(...)` `toEqual([title only])`: list all five items.
  - The GM test goes in `apps/normal-server/src/gm/gm-service.test.ts`, beside `:122`; that file uses the real
    definitions.
- **A7 (Task 3): one code path.** The GM path calls `unlockWithin` (`gm-service.ts:489`), so the one change covers both.
- **A8 (Task 3): load rule for set items.** Also reject at load a `setItems` id whose item is `isDefault` or `free`.
  Whether an item is on sale cannot be checked at load (prices live in the database); A1's lock keeps a set item off
  sale. That is a deviation (CHANGELOG).
- **A9 (blocker, Task 4): the backfill's signature.**
  - Export `ACHIEVEMENT_SOURCE` from `achievement-service.ts`.
  - Build `createInventoryService(db)` inside `backfillTitleSets`.
  - Under `dryRun`, count the missing rows with a select.
  - "Owner" means an `inventory.item_id = reward.itemId` row, any source.
  - Test file: `apps/normal-server/src/inventory/title-sets.test.ts`, with `createTestDb` from `../db/test-db.js`, as
    `reputation/backfill.test.ts` does.
- **A10 (Task 4): what a sixth dist entry touches.**
  - `build.mjs:47-48` and its header comment `:6-7` ("five" → "six");
  - `test/build.test.ts:26` (`ENTRY_FILES`);
  - `docs/acceptance-checklist.md:194` (66.31): add the file, "the five" → "the six"; the cited title stays;
  - `docs/normal-server.md:28` (file tree);
  - the commands beside `docs/deployment-normal.md:416` and `deploy/normal-windows/README.md:406` (Task 7).
  - The Docker image needs nothing.
- **A11 (controller, after merge):** on the VPS, after `docker compose up`:
  1. `docker compose exec app node dist/title-set-backfill-cli.js --dry-run`;
  2. then the real run;
  3. report `players` / `granted`.
  - The LAN host (Neon) waits for the user's yes.
- **A12 (Task 6): test mechanics.**
  - Reduced motion is stubbed through `stubReducedMotion` (`Chibi.test.tsx:461`, a helper scoped in its `describe`, with
    `vi.unstubAllGlobals()` in `afterEach`). Put the new tests in that `describe`.
  - A lazy chibi is in view at once in jsdom (no `IntersectionObserver`), so only the `lazy` gate keeps the class off.
  - Compute the class inside `renderLayer`, joined with `s.headCrop` where the frame border passes it.
  - Assert `toHaveClass('auraGlow')`.
  - `global.css:137-145` already stops animations; keep the module `@media` block for convention.
- **A13 (Task 5): fixtures and DTOs.** Add a `chaos_god` fixture row with `setItems` to `AchievementsScreen.test.tsx`.
  Widen `GmUnlockDto.reward` (`api.ts:737`) too.
- **A14 (Task 2): player guide.** `docs/player-guide.md:448`: the title "Thần Bài". `:653`: "ba danh hiệu" → "ba thành
  tựu". Leave "Hóa Thần Bài!" (`game.json:409`, the reign toast, a verb phrase).
- **A15 (Task 7): known limitation.** A GM's gift schedule and `grantItem` can still name a set item, as
  `title_devoted` can. Record it in `docs/known-limitations.md`.

---

### Task 1: The fifteen pictures (controller, with Claude in Chrome — not dispatched)

**Files:**
- `assets/avatar-src/registry.json`: 15 entries, `note` "BP-43…".
- `apps/normal-web/public/avatar/*`: layers and icons.
- Both avatar manifests.
- `docs/avatar-2d-sheet.png` and `docs/avatar-2d-fit-sheet.png`.

**Steps:**
- [x] Queue the entries (scratchpad `bp43-registry.mjs`), generate in ChatGPT (§10.3), measure each draft with
  `verify --picture` before `collect`, then `verify`.
- [ ] Record the description a redrawn draft was actually asked with in its entry's `look.description`.
- [ ] `avatar:registry ingest`, then `avatar:check` and `avatar:sheet`. On the sheet, check:
  - the outfits on both bodies, with no skin-coloured holes;
  - the head items on all eight hairstyles, with no face or hair pulled into the layer;
  - the frames clear of the portrait.
- [ ] Commit `art: …` with the registry, the layers, the manifests and the sheets. Copy the source pictures to the main
  checkout's gitignored `assets/avatar-src/`.

### Task 2: Catalogue, names, reservation and the title rename

**Files:**
- `apps/normal-server/data/items.json`
- `apps/normal-web/src/locales/{vi,en}/normal.json`
- `apps/normal-server/src/shop/shop-prices-seed.ts`
- `apps/normal-server/src/app.ts`
- `apps/normal-server/src/achievements/definitions.ts`
- `docs/player-guide.md`
- Tests beside each.

**Interfaces:**
- Produces `rewardItemIds(def: AchievementDef): string[]` in `definitions.ts`: `[itemId, ...setItems]`, the ids an
  unlock grants, in that order.
- Produces `AchievementReward.setItems?: string[]`. Task 2 adds only the type; Task 3 parses it.

**Steps:**
- [ ] **12 rows in `items.json`,** after the existing aura and frame rows of their slot, shaped like their peers:
  - **Outfits:** `asset.layer` 40, `file` `item_outfit_<code>_L40`, `variants.m` `item_outfit_<code>_m_L40`,
    `fitsAvatarCrop: false`.
  - **Heads:** layer 80, with the hide flags the manifest gives the layer (`avatar:hides` output).
  - **Auras:** layer 10, `fitsAvatarCrop: true`.
  - **Frames:** layer 90, `fitsAvatarCrop: true`.
  - The server's boot validation (`items.ts`) must pass.
- [ ] **Names** in both locales. Change `items.title_god` (vi) to "Thần Bài".
- [ ] **`rewardItemIds`.** Use it in `achievementItemIds` (shop seed) and in `app.ts`'s `reservedItemIds`.
- [ ] **Tests:**
  - shop seed: an item named only in `setItems` seeds `enabled: false`;
  - the daily draw's reserved ids include a `setItems` id;
  - `locales.test.ts` passes, since it checks names for every served id.
- [ ] **`docs/player-guide.md`:** the title's name and the set (Vietnamese).
- [ ] **Commit:** `feat(normal-server, normal-web): the three Thần sets join the catalogue, never sold or drawn, and the
  Card God's title reads Thần Bài`.

### Task 3: The set granted with the title

**Files:**
- `apps/normal-server/src/achievements/{definitions,achievement-service}.ts`
- `apps/normal-server/data/achievements.json`
- `apps/normal-server/src/gm/gm-service.test.ts` (or the existing GM unlock test file)
- Tests.

**Interfaces:**
- Consumes `rewardItemIds` (Task 2).
- `def.reward.setItems` flows unchanged into `GET /api/catalog/achievements`, `/api/me/achievements` and the
  `ACHIEVEMENT_UNLOCKED` payload. They already serialise `def.reward`.

**Steps:**
- [ ] **Parse `reward.setItems`** in `definitions.ts`. Fail at load when any of these holds:
  - it is not a non-empty string array;
  - an id repeats, or equals `itemId`;
  - an id is not in the catalogue;
  - `itemId` is absent.
- [ ] **Grant `rewardItemIds(def)`** with `ACHIEVEMENT_SOURCE` inside the unlock transaction (the loop at
  `achievement-service.ts:117`).
- [ ] **`achievements.json`:**

  | Achievement | `setItems` |
  |---|---|
  | `chaos_god` | `["outfit_card_god01","head_ace_crown01","aura_card_god01","frame_card_god"]` |
  | `chaos_demigod` | `["outfit_demigod01","head_laurel_silver01","aura_demigod01","frame_demigod"]` |
  | `chaos_godslayer` | `["outfit_godslayer01","head_godslayer_helm01","aura_godslayer01","frame_godslayer"]` |

- [ ] **Tests:**
  - each rejection above;
  - a natural unlock of `chaos_god` leaves the player owning all five items, with the balance up by exactly 300 000
    once;
  - a second evaluation grants nothing and pays nothing;
  - a GM `unlockAchievement('chaos_demigod')` grants its five;
  - the conservation test of the achievement path still holds.
- [ ] **Commit:** `feat(normal-server): a Thần title's achievement hands over its whole set in the same unlock, paid once`.

### Task 4: The backfill

**Files:**
- Create `apps/normal-server/src/inventory/title-sets.ts` and its test.
- Create `apps/normal-server/src/title-set-backfill-cli.ts`.
- Modify `apps/normal-server/scripts/build.mjs` (`ENTRIES` / `OUTPUTS`).
- Modify `apps/normal-server/test/build.test.ts`.
- Modify `apps/normal-server/package.json` (`backfill:title-sets`).
- Modify `docs/acceptance-checklist.md` 66.31 (the entry list text; the cited test title stays).

**Interfaces:**
- `backfillTitleSets(db: AppDb, opts: { dryRun: boolean; defs: readonly AchievementDef[] }): Promise<{ players: number; granted: number }>`
- `parseTitleSetArgs(argv: string[]): { dryRun: boolean } | null`
- `TITLE_SET_USAGE: string`

**Steps:**
- [ ] **`backfillTitleSets`.** For every achievement with `setItems`, every player who owns its `reward.itemId` (any
  source) gets each missing set item, by `inventory.grant(tx, id, item, ACHIEVEMENT_SOURCE)`.
  - Use one transaction per player.
  - `players`: how many owners it found.
  - `granted`: the rows it inserted, or under `dryRun` the rows it would insert, writing nothing.
- [ ] **The CLI** mirrors `reputation-backfill-cli.ts`: the `DATABASE_URL` rules, the exit codes 0 / 1 / 2, and the
  usage line printed on an unknown argument. It prints `players=<n> granted=<n>`, prefixed `(dry run) `.
- [ ] **Tests (PGlite):**
  - owners of each title, including a GM-granted one, get exactly the missing items;
  - a holder who already owns two of the four gets two;
  - a second run grants 0;
  - `dryRun` writes nothing and reports the same count;
  - no `ledger` or reputation rows appear, and balances are unchanged;
  - argument parsing.
  - `build.test.ts` lists `dist/title-set-backfill-cli.js`.
- [ ] **Commit:** `feat(normal-server): an operator backfill hands every existing title holder the set that came after
  their title`.

### Task 5: The set on the Achievements screen

**Files:**
- `apps/normal-web/src/api.ts` (`AchievementRewardDto.setItems?: string[]`)
- `apps/normal-web/src/screens/AchievementsScreen.tsx` (`rewardParts`)
- `apps/normal-web/src/locales/{vi,en}/normal.json`
- Tests.

**Steps:**
- [ ] **`rewardParts`** appends `{ text: t('achievements.ui.setReward'), whole: true }` after the item when
  `setItems` is non-empty.
  - vi "cả bộ trang phục", en "the full outfit set".
  - The `AchievementsScreen.tsx:25` comment's example becomes "Thần Bài".
- [ ] **Tests:** the reward line reads "300.000 điểm · Thần Bài · cả bộ trang phục" for `chaos_god`, and is unchanged
  for an achievement without a set.
- [ ] **Commit:** `feat(normal-web): a Thần achievement's reward says it brings the whole set`.

### Task 6: The three auras move

**Files:**
- Create `packages/ui-kit/src/avatar2d/aura-motion.ts`.
- Modify `packages/ui-kit/src/avatar2d/Chibi.tsx`.
- Modify `packages/ui-kit/src/avatar2d/avatar2d.module.css`.
- Modify `packages/ui-kit/src/avatar2d/Chibi.test.tsx`.

**Interfaces:**
- `AURA_MOTION: Readonly<Record<string, 'glow' | 'twinkle' | 'flicker'>>`, keyed by layer file:
  - `item_aura_card_god01_L10` → `glow`
  - `item_aura_demigod01_L10` → `twinkle`
  - `item_aura_godslayer01_L10` → `flicker`
- `auraMotionOf(file: string): 'glow' | 'twinkle' | 'flicker' | null`

**Steps:**
- [ ] **In `Chibi`,** a layer whose `auraMotionOf(layer.file)` is non-null gets the matching class (`s.auraGlow`,
  `s.auraTwinkle`, `s.auraFlicker`). Only when the chibi is not `lazy` and `reducedMotion` is false.
- [ ] **CSS** animates `opacity` and `filter: brightness()` only. No transform, so the layer never moves off the
  frame.
  - glow: 3 s ease-in-out infinite, opacity 0.85 ↔ 1, brightness 1 ↔ 1.25.
  - twinkle: 1.6 s steps-like keyframes with brightness peaks at 1.35.
  - flicker: 0.9 s, irregular stops between 0.8 and 1.15 brightness.
  - Under `@media (prefers-reduced-motion: reduce)`: `animation: none`.
- [ ] **Tests:**
  - each of the three files carries its class;
  - another aura (`item_aura_fire01_L10`) carries none;
  - a `lazy` chibi carries none;
  - reduced motion (mock `useMediaQuery`, as the existing life tests do) carries none.
- [ ] **Screenshots:** the playground or `zz-preview` at 1920×940, 1366×768 and 375×812, showing a seat and the
  wardrobe wearing a full set.
- [ ] **Commit:** `feat(ui-kit): the Thần, Bán Thần and Sát Thần auras breathe, twinkle and flicker, still under reduced
  motion`.

### Task 7: Docs

**Files:**
- `docs/avatar-2d.md`: a §10.8 BP-43 section on what the drafts taught.
- `docs/normal-server.md`: `setItems` and the backfill CLI.
- `docs/ui-kit.md`: aura motion.
- `docs/deployment-normal.md` and `deploy/normal-windows/README.md`: the backfill step, in Vietnamese; the LAN host asks
  first.
- `docs/known-limitations.md`: residuals.

**Steps:**
- [ ] Write the docs.
- [ ] Run `pnpm exec vitest run --root . tooling/arch`.
- [ ] **Commit:** `docs: …`.

CHANGELOG and lessons come after the final review (controller).
