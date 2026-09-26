# Plan 14 — Wardrobe redesign ("dressing room")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Normal wardrobe screen as the approved "dressing room" layout: sticky stage + wearing list + saved-outfit portraits on the left, three category groups with counted sub-tabs, filters and rich cards on the right, responsive down to phones.

**Architecture:** UI-only change inside `apps/normal-web/src/screens/wardrobe/` plus three rarity colour tokens in `@bp/ui-kit`. The screen keeps its data loading, draft/commit state, save and leave-guard logic; the tab strip, tiles and outfit bar are replaced by focused components (`CategoryNav`, card components, `StagePanel`, `EquippedList`, `SavedOutfits`) that `WardrobeScreen` composes.

**Tech Stack:** React 18, CSS modules, i18next, vitest + testing-library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-wardrobe-redesign-design.md` — binding; its §-numbers are cited below. Mockups: `docs/wardrobe-redesign/mockup-desktop.png`, `mockup-mobile.png` (look at them before writing CSS).

## Global Constraints

- No change to the server, `/api/*`, `AvatarConfigDto`, ownership rules or `chibiFromApi`.
- Visual language: existing tokens only (`--bg`, `--bg-elev`, `--line`, `--ink`, `--ink-muted`, `--gold`, `--gold-soft`, `--gold-ink`, `--focus`, `--font-display`, `--font-body`) plus the new `--rarity-common|rare|epic`. Gold means selected/wearing and the primary button — never rarity.
- Rarity tokens: dark `#9aa4c0`, `#5b9be0`, `#b58af0`; light `#5c6076`, `#1f5fae`, `#6b3fb3`; each ≥ 4.5:1 against that theme's `--bg-elev`.
- Breakpoints: desktop ≥ 1024 px (columns `360px 1fr`, gap 28 px); tablet 768–1023 px (`300px 1fr`); phone < 768 px (one column, spec §3.2 order).
- Every user-facing string goes through i18n in both `apps/normal-web/src/locales/vi/normal.json` and `en/normal.json` (`react/jsx-no-literals` is on).
- `pnpm lint` `--max-warnings=0`, `pnpm -r typecheck` clean.
- Do not use `git stash` (the stack is shared with other checkouts).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/ui-kit/src/theme/tokens.css`, `tokens.test.ts` | 1 | rarity tokens + contrast test |
| `apps/normal-web/src/screens/wardrobe/categories.ts` | 2 | groups, sub-tabs, slot↔tab mapping, counts, filter |
| `.../wardrobe/CategoryNav.tsx` | 2 | group segmented control + sub-tabs with counts + filters |
| `.../wardrobe/cards.tsx` | 2 | `ItemCard`, `ColourCard`, `BaseCard`, `WordCard` |
| `.../wardrobe/ItemTab.tsx`, `ColourTab.tsx`, `BaseTab.tsx` | 2 | grids built from the cards, honouring the filter |
| `.../wardrobe/StagePanel.tsx` | 3 | stage (full body / frame portrait) + expression segmented row |
| `.../wardrobe/EquippedList.tsx` | 3 | "Đang mặc" rows with remove and jump |
| `.../wardrobe/SavedOutfits.tsx` (replaces `OutfitBar.tsx`) | 3 | 5 portrait slots + slot menu + existing save/rename dialogs |
| `.../wardrobe/WardrobeScreen.tsx`, `wardrobe.module.css` | 4 | header, layout, state wiring, responsive CSS |
| tests beside each file; `apps/normal-web/e2e/*.spec.ts` | 2–5 | unit + e2e |

---

### Task 1: Rarity tokens

**Files:** Modify `packages/ui-kit/src/theme/tokens.css`, `packages/ui-kit/src/theme/tokens.test.ts`.

**Interfaces:** Produces CSS custom properties `--rarity-common`, `--rarity-rare`, `--rarity-epic` in every theme block that defines `--bg-elev` (dark default, light, and the forced-dark block).

- [ ] Step 1: In `tokens.test.ts`, add a test in the file's existing style that parses each theme block and asserts the contrast ratio of each rarity token against that block's `--bg-elev` is ≥ 4.5. Run it — FAIL (tokens missing).
- [ ] Step 2: Add the tokens with the Global Constraints values to each block. Run the test — PASS. If a light value misses 4.5:1, darken it and note the value in the commit message.
- [ ] Step 3: `pnpm --filter @bp/ui-kit test`, `pnpm lint`; commit `feat(ui-kit): rarity colour tokens`.

---

### Task 2: Right column — categories, filters, cards

**Files:** Create `categories.ts`, `CategoryNav.tsx`, `cards.tsx`, `categories.test.ts`, `CategoryNav.test.tsx`, `cards.test.tsx`; modify `ItemTab.tsx`, `ColourTab.tsx`, `BaseTab.tsx`, `wardrobe.module.css`, locales.

**Interfaces (produces):**

```ts
// categories.ts
export type GroupId = 'look' | 'wear' | 'decor'
export type TabId = 'base' | 'hairColor' | 'eyeColor' | 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'words'
export const GROUPS: readonly { id: GroupId; tabs: readonly TabId[] }[] = [
  { id: 'look', tabs: ['base', 'hairColor', 'eyeColor'] },
  { id: 'wear', tabs: ['head', 'face', 'outfit'] },
  { id: 'decor', tabs: ['aura', 'frame', 'words'] },
]
export function groupOf(tab: TabId): GroupId
export function tabOfSlot(slot: ItemSlot): TabId            // title|badge → 'words'
export type OwnershipFilter = 'all' | 'owned' | 'locked'
/** Items a tab lists as cards: its slot(s), minus colour variants (they render as dots), in spec §5.4 order. */
export function tabItems(tab: TabId, catalog: readonly ItemDto[]): ItemDto[]
export function counts(tab: TabId, catalog: readonly ItemDto[], owned: ReadonlySet<string>): { owned: number; total: number } | null // null for 'base'
export function applyFilter(items: readonly ItemDto[], owned: ReadonlySet<string>, filter: OwnershipFilter): ItemDto[]

// CategoryNav.tsx
export interface CategoryNavProps {
  tab: TabId
  onTab: (tab: TabId) => void           // choosing a group selects its first tab
  counts: Partial<Record<TabId, { owned: number; total: number }>>
  filter: OwnershipFilter
  onFilter: (f: OwnershipFilter) => void
  showFilter: boolean                   // false on 'base'
}

// cards.tsx — all are <button>s with aria-pressed, data-rarity, and an accessible name "<name>, <rarity>[, wearing|, locked: <hint>]"
export function ItemCard(props: { item: ItemDto; wear?: string; owned: boolean; wearing: boolean; hint: string; variants?: { item: ItemDto; owned: boolean; wearing: boolean }[]; onPick: (id: string) => void }): JSX.Element
export function ColourCard(props: { item: ItemDto | null /* null = Natural */; owned: boolean; wearing: boolean; hint: string; onPick: (id: string | undefined) => void }): JSX.Element
export function BaseCard(props: { base: BaseDto; portrait: ChibiConfig; selected: boolean; onPick: (id: BaseId) => void }): JSX.Element
export function WordCard(props: { item: ItemDto; owned: boolean; wearing: boolean; hint: string; onPick: (id: string) => void }): JSX.Element
```

Existing tab components keep their props and gain `filter: OwnershipFilter` (ItemTab, ColourTab) and render the new cards in a grid `repeat(auto-fill, minmax(150px, 1fr))` gap 14 px. The words tab renders two sub-headings ("Danh hiệu", "Huy hiệu") each with `WordCard`s.

Card visuals exactly per spec §4.1–4.4 and the mockup: 118 px thumb on `--bg` with a radial glow of the rarity colour, 3 px bottom rule in the rarity colour, name 14 px/600, rarity label 11 px uppercase letter-spaced in the rarity colour; wearing = gold border + gold pill "✓ Đang mặc" top-right; locked = thumbnail `grayscale(.85) brightness(.55)`, muted name, lock icon + hint line; variant dots 16 px under the card (unowned 35 % opacity). Pressing a worn optional item unequips it (existing `pick` behaviour — keep it).

i18n keys to add (vi / en): `wardrobe.groups.look` Ngoại hình / Look, `wardrobe.groups.wear` Trang phục / Clothing, `wardrobe.groups.decor` Trang trí / Decor; `wardrobe.tabs.face` → Phụ kiện mặt / Face accessory; `wardrobe.filter.all|owned|locked` Tất cả / Đã có / Chưa có — All / Owned / Locked; `wardrobe.ownedCount` "{{owned}}/{{total}} đã có" / "{{owned}}/{{total}} owned"; `wardrobe.wearingBadge` Đang mặc / Wearing; `wardrobe.words.titles` Danh hiệu / Titles, `wardrobe.words.badges` Huy hiệu / Badges; rarity labels — reuse the existing rarity keys if the app has them (search the locale files), else add `wardrobe.rarity.common|rare|epic` Thường / Hiếm / Sử thi — Common / Rare / Epic.

- [ ] Step 1: `categories.test.ts` — GROUPS/tabOfSlot/groupOf mapping; `tabItems('head', catalog)` excludes variants and orders common → rare → epic then catalogue order; `counts` over a fixture; `applyFilter` three modes. FAIL, implement `categories.ts`, PASS.
- [ ] Step 2: `CategoryNav.test.tsx` — three group tabs (`role="tab"` in a tablist), choosing "Trang phục" selects "Mũ"; sub-tabs show "5/8"-style counts, none on "Thân"; arrow keys move between sub-tabs; filters are `aria-pressed` buttons and hidden when `showFilter` is false. FAIL, implement, PASS.
- [ ] Step 3: `cards.test.tsx` — each card's accessible name, `aria-pressed`, locked state (click does not call `onPick`, hint visible), wearing pill, variant dots clickable only when owned, Natural colour card calls `onPick(undefined)`. FAIL, implement, PASS.
- [ ] Step 4: Rewire ItemTab/ColourTab/BaseTab to the cards and the filter; keep their existing tests passing (update selectors only where the markup legitimately changed). `pnpm --filter @bp/normal-web test`, typecheck, lint; commit `feat(normal-web): wardrobe categories, filters and cards`.

---

### Task 3: Left column — stage, wearing list, saved outfits

**Files:** Create `StagePanel.tsx`, `EquippedList.tsx`, `SavedOutfits.tsx` and tests; delete `OutfitBar.tsx` after moving its logic (dialogs, api calls, error handling) into `SavedOutfits.tsx`; modify `wardrobe.module.css`, locales.

**Interfaces (produces):**

```ts
export function StagePanel(props: { subject: ChibiConfig; expression: Expression; onExpression: (e: Expression) => void; portrait: boolean /* true on the frame tab */; compact?: boolean }): JSX.Element
export function EquippedList(props: { config: AvatarConfigDto; items: ReadonlyMap<string, ItemDto>; bases: ReadonlyMap<string, BaseDto>; onRemove: (slot: ItemSlot) => void; onJump: (tab: TabId) => void }): JSX.Element
export function SavedOutfits(props: OutfitBarProps /* same props as today's OutfitBar */): JSX.Element
```

- StagePanel per spec §3.1 item 1–2: 330 px stage (compact: 250 px), radial gold glow + podium ellipse, full-body `Chibi` 320 px tall; `portrait` swaps to a 240 px head `Chibi` with its frame. Expression row: one segmented row of six `aria-pressed` buttons that never wraps (scrolls horizontally when narrow).
- EquippedList per spec §3.1 item 3: rows in the order Thân, Màu tóc, Màu mắt, Mũ, Phụ kiện mặt, Trang phục, Hào quang, Khung, Danh hiệu, Huy hiệu; empty = "Không có" (colours: "Tự nhiên"); item names coloured by rarity; colour rows show a swatch; "×" (accessible name "Bỏ <tên món>") only on optional slots that hold something (never on base/outfit); clicking a row calls `onJump(tabOfSlot(slot))`.
- SavedOutfits per spec §3.1 item 4: five 54 px round portraits (filled: gold-tinted border + name; empty: dashed circle "+" and "Trống"). Clicking a filled slot opens a small menu (Áp dụng · Lưu đè vào đây · Đổi tên · Xoá); clicking an empty slot opens the existing name dialog to save the current draft there. All API calls, errors and the rename/save dialogs are OutfitBar's current behaviour — move, don't rewrite.
- i18n: `wardrobe.equipped.title` Đang mặc / Wearing, `wardrobe.equipped.none` Không có / None, `wardrobe.equipped.remove` "Bỏ {{item}}" / "Remove {{item}}", `outfits.overwrite` Lưu đè vào đây / Overwrite, `outfits.menu` "Bộ đồ {{name}}" / "Outfit {{name}}" (menu label). Reuse the existing `outfits.*` keys for everything else; delete keys nothing uses any more (`outfits.emptySlot` if unused).

- [ ] Step 1: tests for each component (StagePanel portrait swap and expression buttons; EquippedList order, empty labels, "×" presence rules, remove and jump callbacks; SavedOutfits menu actions calling the api like OutfitBar's tests do, empty-slot save). Move OutfitBar's existing tests into `SavedOutfits.test.tsx` and adapt. FAIL, implement, PASS.
- [ ] Step 2: web tests, typecheck, lint; commit `feat(normal-web): wardrobe stage, wearing list and saved-outfit portraits`.

---

### Task 4: Screen composition and responsive layout

**Files:** Modify `WardrobeScreen.tsx`, `wardrobe.module.css`, `WardrobeScreen.test.tsx`, locales.

- Header per spec §3.1: `h1` "Tủ đồ" (`--font-display`, 40 px; 28 px on phones), dirty label `wardrobe.dirty` "● Có thay đổi chưa lưu" / "● Unsaved changes" shown only when the draft differs from the committed config, `wardrobe.undo` "Hoàn tác" / "Undo" (ghost; disabled when clean; resets the draft to the committed config, no server call), "Lưu tủ đồ" (gold, existing save). Error/saved notices sit under the header.
- Layout per Global Constraints breakpoints. Left column sticky (`top: 16px`) on ≥ 768 px. Phones: order stage → expressions → CategoryNav → grid → collapsible "Đang mặc (n)" and "Bộ đồ đã lưu" sections (native `<details>` is fine), header shows "Lưu" + an icon-only undo button with accessible name "Hoàn tác".
- State: `tab: TabId` (default 'base'), `filter: OwnershipFilter` (reset to 'all' on every tab change), expression unchanged; `EquippedList.onJump` sets the tab; `onRemove` = the existing `pick(slot, undefined)`/`withSlot` path.
- Remove the old tab strip, tile styles and page-level rule under the heading that the new header replaces; keep the leave-without-saving modal.

- [ ] Step 1: Update `WardrobeScreen.test.tsx` for the new structure: dirty label appears after a change and disappears after save and after undo; undo restores the preview hash; jump from the wearing list opens the right group/tab; filter resets on tab change; the frame tab swaps the stage to the portrait. FAIL, implement, PASS.
- [ ] Step 2: web tests, typecheck, lint; commit `feat(normal-web): dressing-room wardrobe layout`.

---

### Task 5: End to end, screenshots, rollout

**Files:** Modify `apps/normal-web/e2e/avatar2d.spec.ts`, `avatar-tint.spec.ts` (new labels/structure); create `apps/normal-web/e2e/wardrobe-layout.spec.ts`; modify `docs/bug-log.md`.

- [ ] Step 1: Update existing specs' locators for the new markup (group → sub-tab navigation, card names, saved-outfit menu).
- [ ] Step 2: `wardrobe-layout.spec.ts`: register, open the wardrobe, assert the sub-tab row and group row each fit on one line (no element of the tablist wraps: all tabs share one `offsetTop`), no horizontal page scroll on the mobile project, and save full-page screenshots to `apps/normal-web/e2e/screenshots/wardrobe-{desktop,mobile}-{dark,light}.png` (light via the app's theme setting).
- [ ] Step 3: Gate: `pnpm build:normal`, `pnpm --filter @bp/normal-web e2e`, `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:lite`.
- [ ] Step 4: `docs/bug-log.md` F4 row: status "đã sửa theo (B)", a Vietnamese summary and the screenshot paths. Commit `test(e2e): wardrobe layout; log F4`.
