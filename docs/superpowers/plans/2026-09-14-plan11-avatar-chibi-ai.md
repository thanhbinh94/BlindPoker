# Just a Normal Poker — Plan 11: AI-generated chibi avatars on layered PNG

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every seat, bar, wardrobe and profile draws a chibi assembled from PNG layers on a fixed 384 × 448 frame — two locked bases (F01/M01) with six expressions, wardrobe slots head/face/outfit/aura/frame, five saved outfits — fed by a pipeline that turns the user's AI-generated pictures into clean, validated layers; the app works end to end on generated placeholders before a single real picture exists, and the 3D pipeline is gone.

**Architecture:** `apps/normal-web/scripts/avatar-pipeline.mjs` (Node + `sharp`) owns the asset side: `placeholder` (synthetic layers so everything runs today), `ingest` (green-screen removal, diff-against-base extraction, framing, @1x/@2x export), `check` (the ten acceptance criteria), `sheet` (contact sheet), and it writes `avatar-manifest.json` for both apps. `@bp/ui-kit/src/avatar2d/` renders a `ChibiConfig` as stacked `<img>` layers with the hide rules, head crop and hand-driven expressions. `apps/normal-server` moves the avatar config to v3 (`base`, `outfit`, `head?`, `face?`, `aura?`, `frame?`, `title?`, `badge?`), maps the old catalogue through aliases, validates assets against the manifest, and adds outfits. `apps/normal-web` maps API config to the kit, rewrites wardrobe and profile, deletes `avatar3d/`. Lite copies the base and bot layers into its build.

**Tech Stack:** TypeScript strict ESM (`.js` imports), React 18, Vitest 2, Playwright, Fastify 5 + Drizzle (PGlite in tests), esbuild, Node 22 scripts with `sharp` (devDependency of `@bp/normal-web`), PNG layers.

**Spec:** `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` (cited §n); asset rules in `docs/avatar/01-quy-cach-tai-san-nhan-vat-kho-do.md` (cited D01 §n) and prompts in `docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md` (D02).

## Global Constraints
- Frame 384 × 448; body box 224 × 336 at (80, 72); axis x = 192; baseline y = 408; avatar crop 160 × 160 at (112, 48); frame ring 208 × 208 (§3, D01 §3, §5). These numbers never change once an item exists.
- Layer orders: 5 backdrop · 10 aura · 20 hairBack · 30 body · 40 outfit · 50 face (6 expressions) · 60 hairFront · 70 faceAcc · 80 head · 90 frame (§3). Hide rules: `hidesHairFront`, `hidesHairBack` on `head` items (D01 §4.3).
- Files: PNG 32-bit sRGB, `@1x` 384 × 448 and `@2x` 768 × 896, alpha 0 where empty, no white fringe, ≥ 1 px soft edge (§3, D01 §8). Names `[loại]_[slot]_[mã]_L[lớp]@[mật độ].png`; bases `base_<id>_L<lớp>@<d>.png`, faces `base_<id>_face_<expr>_L50@<d>.png` (§3).
- Expressions: exactly `neutral happy sad surprised closed sleep` (§4.3). Bases: `f01`, `m01` (§5.1).
- Old item ids stay valid through `data/item-aliases.json`; achievements remap `login_days_100 → head_crown_gold01`, `holdem_wins_500 → outfit_champion01`, `hand_royal → aura_gold_cards01` (§5.2).
- Daily random draws come from slots `head | face | aura | frame` only (§5.2).
- Assets live at `apps/normal-web/public/avatar/` and are served at `/avatar/<file>`; Lite copies `base_*` and `bot_*` files only. Stage-1 budget: all `@2x` files ≤ 6 MB (§8).
- User-facing copy Vietnamese + English through i18n; lint `--max-warnings=0`, `pnpm typecheck`, `pnpm test` green at every commit; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never `git commit -a`.
- No AI-generated picture is committed under `apps/normal-web/public/avatar/` unless it passed `check`; originals go to `assets/avatar-src/` (gitignored).

## Consumed facts (verified 2026-09-14)
```text
normal-web: package.json scripts test/typecheck/dev/build/preview/e2e/avatar:assets; devDeps include @gltf-transform/*, meshoptimizer, @types/three; deps three. public/ holds only avatar3d/. test/{footprint.test.ts (budgets, three marker, avatar3d chunk/asset), avatar-assets.test.ts (glb pipeline; uses execFileSync on scripts)}. src/avatar3d/* (Portrait, LazyStage, AvatarStage, portrait-cache, hash, assets, assemble, framing, gl-context, description, config, palettes.test, abort, environment, fake-*), src/avatar/useAvatars.ts (AvatarCache Map<playerId, PlayerAvatarDto|null>, resetAvatarCache), screens/TableChrome.tsx (makeAvatarFor → Portrait size="seat"; makeCaptionFor), App.tsx (Portrait + resetPortraitMemory for the lobby bar), screens/WardrobeScreen.tsx (536 lines; LazyAvatarStage, PartPortrait; api.inventory/catalogItems/setAvatar), ProfileScreen.tsx (LazyAvatarStage), InventoryScreen.tsx (PartPortrait tiles), api.ts DTOs (AvatarConfigDto v2, ItemDto{variants}, PlayerAvatarDto, InventoryDto, MeDto.avatar), e2e/{normal.spec.ts, avatar3d.spec.ts, support.ts}, locales items.* names.
normal-server: inventory/{slots.ts (ItemSlot hair|top|bottom|shoes|hat|accessory|jewelry|title|badge; REQUIRED_SLOTS hair/top/bottom/shoes; GEOMETRIC_SLOTS), items.ts (ItemDef{id,slot,rarity,nameKey,assetKey,isDefault,variants?}; loadItemCatalog(path) validates; seed(db) upsert items table columns id/category/rarity/name_key/asset_key/is_default), avatar.ts (AVATAR_CONFIG_VERSION=2; validateAvatarConfig(input, catalog); readAvatarConfig(raw, catalog); applyAvatarConfig(db, inventory, playerId, config) → AvatarView; defaultAvatar(catalog); itemIdsOf; palettes), avatar-migrate.ts (v1→v2), inventory-service.ts, grant-wardrobe.ts}, data/{items.json (42), palettes.json, achievements.json (32; rewards hat_crown,title_devoted,jacket_champion,title_hot_hand,ring_royal,badge_veteran)}, economy daily random pick excludes title/badge + reserved reward ids, http/{routes-me.ts (GET /api/me/inventory, PUT /api/me/avatar, GET /api/players/:id/avatar AVATAR_CACHE), routes-catalog.ts (/api/config, /api/catalog/items, /api/catalog/achievements)}, app.ts (SCRIPT_SRC 'wasm-unsafe-eval', IMG_SRC_EXTRA 'blob:'; loadItemCatalog at 231), app.test.ts route enumeration, drizzle/0000,0001, scripts/build.mjs ENTRIES main/migrate-cli/grant-wardrobe-cli, data/ shipped via packageRoot().
ui-kit: src/table/Seat.tsx (.avatar disc 40 px, data-face, `avatar ?? initial`, BotFace), PokerTable.tsx (avatarFor?: (player) => ReactNode), RoomScreen.tsx forwards avatarFor/captionFor, src/table/BotFace.tsx (botFaceIndex FNV-1a, 8 svg faces), playground/main.tsx. Branch plan10/avatar-chibi-2d (unmerged, c827b25) holds an SVG-based avatar2d module: types (layers/expressions), resolve/partsFor, Chibi, AvatarSprite, expression rules NOT implemented there; reusable by hand only.
http-kit assets: immutable only for assets/<hashed>; other public files served mutable (ETag). Lite: web build → apps/lite/dist/public (vite base './'), scripts/build.mjs folds every dist/public file into the SEA exe (walk(PUBLIC_DIR)); Lite App.tsx renders <RoomScreen client lang onLeft/> without avatarFor.
```

## File Structure
```text
apps/normal-web/scripts/avatar-pipeline.mjs                  T1  placeholder | ingest | check | sheet | manifest
apps/normal-web/scripts/avatar-pipeline/{png.mjs,extract.mjs,frame.mjs,checks.mjs,sheet.mjs}   T1  one module per stage
apps/normal-web/test/avatar-pipeline.test.ts                 T1  synthetic images → every stage
apps/normal-web/public/avatar/*.png                          T1 (placeholders) → T6/T7 (real art replaces them file by file)
apps/normal-web/public/avatar/avatar-manifest.json           T1  { frame, crop, files: { [name]: { layer, w, h, bytes } } }
apps/normal-server/data/avatar-manifest.json                 T1  copy written by the script; T2 validates catalogue against it
apps/normal-server/data/avatar-bases.json                    T2  bases f01/m01: layer files + face files
apps/normal-server/data/item-aliases.json                    T2  old id → new id
apps/normal-server/data/items.json, achievements.json        T2  new catalogue (asset refs), remapped rewards
apps/normal-server/src/inventory/{slots.ts,items.ts,avatar.ts,avatar-migrate.ts,aliases.ts,bases.ts,manifest.ts,outfits-service.ts}  T2
apps/normal-server/src/http/{routes-catalog.ts (+/api/catalog/avatar),routes-me.ts,routes-outfits.ts}; drizzle/0002_outfits.sql; db/schema.ts   T2
packages/ui-kit/src/avatar2d/{types.ts,layers.ts,Chibi.tsx,avatar2d.module.css,expression.ts,bot.ts,defaults.ts,index.ts}  T3
packages/ui-kit/src/table/{Seat.tsx,PokerTable.tsx}, screens/RoomScreen.tsx, playground/avatar2d.tsx   T3
apps/lite/scripts/build.mjs (copy bases+bots), apps/lite/web/src/App.tsx   T3
apps/normal-web/src/{api.ts,avatar/chibi.ts,screens/TableChrome.tsx,App.tsx,screens/wardrobe/*,ProfileScreen.tsx,InventoryScreen.tsx,locales}   T4
apps/normal-web/src/avatar3d (deleted), public/avatar3d (deleted), scripts/avatar-assets.mjs|avatar-map.json|avatar-shots.mjs (deleted), test/avatar-assets.test.ts (deleted), test/footprint.test.ts, e2e/avatar2d.spec.ts, assets/avatar-src (README only)   T5
docs/avatar-2d.md, docs/avatar-assets.md (deleted), docs/normal-web.md, docs/security.md, docs/known-limitations.md, docs/test-matrix.md, docs/acceptance-checklist.md, CHANGELOG.md, spec §15 note   T5
```

---

### Task 1: The asset pipeline, and placeholders so the app can be built before the art exists

**Files:**
- Create: `apps/normal-web/scripts/avatar-pipeline.mjs`, `apps/normal-web/scripts/avatar-pipeline/{png.mjs,extract.mjs,frame.mjs,checks.mjs,sheet.mjs,manifest.mjs}`, `apps/normal-web/test/avatar-pipeline.test.ts`, `apps/normal-web/public/avatar/` (placeholders + manifest), `apps/normal-server/data/avatar-manifest.json`, `assets/avatar-src/README.md`
- Modify: `apps/normal-web/package.json` (devDependency `sharp@^0.33`, scripts `avatar:placeholder`, `avatar:ingest`, `avatar:check`, `avatar:sheet`), `.gitignore` (`assets/avatar-src/*` except README)
- Test: `test/avatar-pipeline.test.ts`

**Interfaces (produced):**
```text
Frame constants (frame.mjs, exported): FRAME = { w: 384, h: 448 }, BODY = { x: 80, y: 72, w: 224, h: 336 }, AXIS_X = 192, BASELINE_Y = 408, CROP = { x: 112, y: 48, size: 160 }, RING = 208, DENSITIES = [1, 2]
Layer table (frame.mjs): LAYERS = { backdrop: 5, aura: 10, hairBack: 20, body: 30, outfit: 40, face: 50, hairFront: 60, faceAcc: 70, head: 80, frame: 90 }
File naming (manifest.mjs): baseFile(baseId, layer) → `base_<id>_L<n>`; faceFile(baseId, expr) → `base_<id>_face_<expr>_L50`; itemFile(slot, code, layer) → `item_<slot>_<code>_L<n>`; every file exists as `<name>@1x.png` and `<name>@2x.png`
Manifest (avatar-manifest.json): { version: 1, frame: FRAME, crop: CROP, files: { "<name>": { layer: 80, w: 384, h: 448, bytes2x: 12345 } } }
CLI:
  node scripts/avatar-pipeline.mjs placeholder            # writes every stage-1 file as a labelled silhouette; idempotent; skips names that already hold real art (marker in manifest: real: true)
  node scripts/avatar-pipeline.mjs ingest <png> --as base:f01 | expr:f01:happy | item:head:tophat01 [--hides-hair-front] [--hides-hair-back] [--base f01] [--tolerance 40] [--out public/avatar]
  node scripts/avatar-pipeline.mjs check [<name>...]       # all files or the named ones; exit 1 on any failure; prints a table
  node scripts/avatar-pipeline.mjs sheet                    # docs/avatar-2d-sheet.png
```

**Algorithms (the plan's contract for the implementer):**
- **Green removal** (`png.mjs` `removeChroma(raw, { key: [0,255,0], tolerance })`): per pixel, distance to the key colour in RGB; alpha = 0 when distance ≤ tolerance, ramp to 255 between tolerance and 2·tolerance; then *despill*: for pixels with alpha > 0, clamp G to max(R, B) + 8 to kill the green fringe; then a 1 px alpha erosion + 1 px feather (box blur of alpha only). White background variant: key `[255,255,255]`, no despill.
- **Body anchoring** (`frame.mjs` `anchorBase(layer)`): bounding box of alpha > 8; scale so that the box height maps to 336 (top of hair at 72, feet at 408) — **scale uniformly**, centre the box's horizontal centre on x = 192; report `scale` and `offset`; `--lock-scale <n>` reuses a base's scale for its expressions and items so everything shares one mapping (the CLI stores the base's scale/offset in the manifest under `bases.f01.transform` and `ingest --as expr/item` reads it).
- **Item extraction** (`extract.mjs` `diffAgainstBase(itemPic, basePic, { colorTol: 28, minRegion: 400 })`): both pictures already chroma-keyed and anchored with the same transform; a pixel belongs to the item when it is opaque in the item picture and either transparent in the base or its colour differs from the base by more than `colorTol` (Euclidean RGB); keep connected components ≥ `minRegion` px; dilate the mask by 2 px then intersect with item alpha; feather 1 px. For `head` items, additionally clear anything below y = 260 (a hat never reaches the waist); for `face`, keep only the crop box; for `outfit`, keep the union with the base's underwear region (so an outfit covers it) — implemented as: mask ∪ (base alpha ∧ y ≥ 176).
- **Checks** (`checks.mjs`, each returns `{ id, ok, detail }`): C1 size equals density × frame; C2 nothing opaque touches the frame edge; C3 alpha exactly 0 outside the alpha bbox dilated by 3 px (stray semi-transparent pixels); C4 no white fringe: among edge pixels (alpha 8–200), mean RGB is not within 24 of white unless the interior mean is also near white; C5 `head`/`face` alpha bbox inside CROP (dilated by 4 px); C6 `outfit` covers the base underwear region: base pixels within y 176–300 that are the underwear colours must be opaque in the outfit layer (≥ 98 %); C7 both densities present and the 1x is the 2x downscaled (correlation check); C8 name matches the pattern; C9 file listed in the manifest with the right layer; C10 bytes2x ≤ 400 KB. `check` prints a table and exits 1 on any `ok: false`.
- **Placeholders** (`placeholder`): for every stage-1 name (§4.4 list + bases + faces + 8 bots), draw with `sharp` from an SVG string: a rounded silhouette of the right region (head region for `head`, eye band for `face`, torso+legs for `outfit`, ring for `aura`/`frame`, full figure in grey for bases, face oval with the expression name for faces), tinted per slot, with the item code as text — so the app is visibly working on stand-ins. Placeholder files are marked `placeholder: true` in the manifest; `ingest` flips the entry to `real: true`.
- **Sheet**: composes, with the layer table and hide rules, both bases × every outfit/head/face/aura/frame, the six expressions per base, the three crop sizes (192/40/32), into one PNG.

- [ ] **Step 1: Tests first** (`test/avatar-pipeline.test.ts`): builds synthetic pictures with `sharp` (a green 1152 × 1344 canvas with a grey figure = base; the same plus a red hat = head item; the same plus blue clothes over the torso = outfit) in a temp dir, then: `removeChroma` leaves the figure opaque and the background alpha 0 with no green fringe (sample 20 edge pixels, G ≤ max(R,B)+8); `anchorBase` puts the feet at 408 ± 1 and centre at 192 ± 1; `diffAgainstBase` yields a mask whose bbox is the hat's box ± 3 px and nothing below y = 260; `checks` pass on the pipeline's own output and each check fails on a crafted bad file (wrong size, edge-touching, white fringe, stray pixel, head outside crop, outfit not covering); `placeholder` writes every stage-1 name at both densities and a manifest listing them; `sheet` writes a PNG larger than 1000 × 1000. Run → FAIL.
- [ ] **Step 2: Implement** the modules and the CLI; `pnpm --filter @bp/normal-web add -D sharp@^0.33`; run `placeholder` to fill `public/avatar/` and both manifests; run `check` (must pass on placeholders); run `sheet`.
- [ ] **Step 3:** `assets/avatar-src/README.md` (Vietnamese: where originals go, tool/seed log format, never commit), `.gitignore`. `pnpm --filter @bp/normal-web test`, lint, typecheck. Commit: `feat(normal-web): avatar asset pipeline — placeholders, ingest, check, sheet`.

---

### Task 2: Server — config v3, aliases, bases, asset-referenced catalogue, outfits

**Files:**
- Create: `apps/normal-server/data/avatar-bases.json`, `data/item-aliases.json`, `src/inventory/{aliases.ts,bases.ts,manifest.ts,outfits-service.ts}` (+tests), `src/http/routes-outfits.ts` (+test), `drizzle/0002_outfits.sql`
- Modify: `data/items.json`, `data/achievements.json`, `src/inventory/{slots.ts,items.ts,avatar.ts,avatar-migrate.ts,inventory-service.ts (unowned draw pool),grant-wardrobe.ts}` (+tests), `src/economy/*` (daily draw slots), `src/http/{routes-catalog.ts,routes-me.ts,routes.ts}`, `src/app.ts`, `src/app.test.ts`, `src/db/schema.ts`, `docs/normal-server.md`
- Test: listed.

**Interfaces:**
```ts
// slots.ts
export type ItemSlot = 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'title' | 'badge'
export const REQUIRED_SLOTS = ['outfit'] as const
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'title', 'badge'] as const
export const DRAWN_SLOTS: readonly ItemSlot[] = ['head', 'face', 'outfit', 'aura', 'frame']
export const DAILY_DRAW_SLOTS: readonly ItemSlot[] = ['head', 'face', 'aura', 'frame']
export type BaseId = 'f01' | 'm01'
export const BASES: readonly BaseId[]
// items.ts
export interface AssetRef { layer: 5 | 10 | 40 | 70 | 80 | 90; file: string; hidesHairFront?: boolean; hidesHairBack?: boolean; fitsAvatarCrop: boolean }
export interface ItemDef { id; slot; rarity; nameKey; assetKey; isDefault; asset?: AssetRef }   // asset required for DRAWN_SLOTS; `variants` gone
export function loadItemCatalog(path?: string, manifest?: AvatarManifest): ItemCatalog   // every asset.file must be in manifest.files with the same layer
// manifest.ts
export interface AvatarManifest { version: 1; frame: { w: number; h: number }; crop: { x: number; y: number; size: number }; files: Record<string, { layer: number; w: number; h: number; bytes2x: number; placeholder?: boolean; real?: boolean }> }
export function loadAvatarManifest(path?: string): AvatarManifest   // data/avatar-manifest.json
// bases.ts
export interface BaseDef { id: BaseId; nameKey: string; layers: { hairBack: string; body: string; hairFront: string }; faces: Record<Expression, string> }
export function loadBases(path?: string, manifest?: AvatarManifest): Record<BaseId, BaseDef>   // data/avatar-bases.json
// aliases.ts
export function loadAliases(path?: string): ReadonlyMap<string, string>   // old id → new id; `resolveItemId(id)` = alias ?? id
// avatar.ts
export const AVATAR_CONFIG_VERSION = 3
export interface AvatarConfigV3 { v: 3; base: BaseId; outfit: string; head?: string; face?: string; aura?: string; frame?: string; title?: string; badge?: string }
export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'MISSING_LAYER' | 'INVALID_BASE'
validateAvatarConfig(input, catalog) → v3; readAvatarConfig(raw, catalog) → v3 (v1→v2→v3 with the alias map); defaultAvatar(catalog) = { v:3, base:'f01', outfit:'outfit_casual01' }; itemIdsOf(config) = every set slot except base
// routes
GET /api/catalog/avatar → { frame, crop, bases: BaseDef[], manifestVersion }   (public)
GET/PUT/DELETE /api/me/outfits[/:slot], POST /api/me/outfits/:slot/apply       (authed; body { name ≤ 24, config v3 })
```
`v2 → v3` mapping: `base = body === 'female' ? 'f01' : 'm01'`; `outfit = 'outfit_casual01'`; `hat → head` via alias (`hat_crown → head_crown_gold01`), `accessory` → alias (`accessory_conical_hat → head_conical_hat01`, `accessory_glasses → face_glasses_round_gold01`, `accessory_sunglasses → face_sunglasses01`, `accessory_mask → face_masquerade01`, `accessory_headband` → dropped), `jewelry` dropped (`ring_royal → aura_gold_cards01`), `title`/`badge` kept, `clothing_suit → outfit_tuxedo01`, `clothing_aodai → outfit_tet_red01`, `clothing_kimono → outfit_royal_robe01`, `jacket_champion → outfit_champion01`, other tops/bottoms/shoes → `outfit_casual01`. Inventory rows keep old ids; `inventory-service.missingOf/owns` and `grant` resolve aliases both ways (owning `hat_crown` satisfies `head_crown_gold01`). `items` table: seed upserts the **new** ids and keeps old rows (never deleted — FK).

New `items.json` (stage 1, 42 → 47 ids): head ×8, face ×4, outfit ×6, aura ×8, frame ×6, title ×5, badge ×5, plus the 5 old titles/badges unchanged; rarities: commons `head_beanie01, head_dealer_visor01, face_glasses_round_gold01, outfit_casual01 (default), aura_water01, aura_wind01, frame_bronze`, rares `head_beret_red01, head_conical_hat01, head_party_cone01, face_sunglasses01, face_masquerade01, outfit_dealer01, outfit_tet_red01, aura_fire01, aura_earth01, aura_sakura01, aura_ice01, frame_silver, frame_monthly`, epics `head_tophat01, head_crown_gold01, head_hood_black01, face_eyepatch01, outfit_tuxedo01, outfit_royal_robe01, outfit_champion01, aura_lightning01, aura_gold_cards01, frame_gold, frame_veteran, frame_founder`. `achievements.json`: rewards remapped per Global Constraints; `badge_founder`/`frame_founder` → new achievement `login_days_365`; `frame_veteran` granted with `games_500` alongside `badge_veteran` (reward becomes `{ itemIds: [...] }`? **No** — keep one `itemId` per achievement: `frame_veteran` is rewarded by a new `games_1000`). Daily fixed day-28 rewards unchanged.

- [ ] **Step 1:** manifest/bases/aliases loaders with tests (missing file in manifest → named error; alias cycles rejected). `avatar-bases.json` per §5.1 using the placeholder file names from T1.
- [ ] **Step 2:** slots/items/avatar v3 + migration tests (every old catalogue id maps through `resolveItemId` to a current id or to `null` for dropped ones; v2 configs from `avatar.test.ts` fixtures read to v3; `missingOf` honours aliases; `defaultAvatar`; `validateAvatarConfig` rejects an unknown base with `INVALID_BASE` and a `face` item in `head` with `WRONG_CATEGORY`).
- [ ] **Step 3:** outfits (schema + migration + service + routes) exactly as Plan 10 T4 specified (5 slots, name ≤ 24, ownership re-checked on apply, cascade) — tests included.
- [ ] **Step 4:** routes (`/api/catalog/avatar`), daily draw slots test, achievements test count (34), `grant-wardrobe` (grants new ids; total = catalog size), `app.test.ts` route lists, CSP untouched here (T5). `pnpm --filter @bp/normal-server test`, lint, typecheck. Commit: `feat(normal-server): avatar config v3 on layered assets, aliases for the old wardrobe, outfits`.

---

### Task 3: ui-kit — PNG-layer `Chibi`, expressions, seats, Lite

**Files:**
- Create: `packages/ui-kit/src/avatar2d/{types.ts,layers.ts,layers.test.ts,Chibi.tsx,Chibi.test.tsx,avatar2d.module.css,expression.ts,expression.test.ts,bot.ts,defaults.ts,AvatarAssets.tsx,index.ts}`, `packages/ui-kit/playground/avatar2d.tsx`
- Modify: `src/table/Seat.tsx`, `PokerTable.tsx` (+test), `src/screens/RoomScreen.tsx` (+test), `src/index.ts`, `playground/main.tsx`; delete `src/table/BotFace.tsx` (+test); `apps/lite/scripts/build.mjs` (copy `base_*`/`bot_*` from `apps/normal-web/public/avatar` into `dist/public/avatar` before the SEA step), `apps/lite/web/src/App.tsx` (`<AvatarAssets base="./avatar/">`)
- Test: listed; Lite smoke test asserts the exe answers `/avatar/base_f01_L30@1x.png` with 200.

**Interfaces:**
```ts
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'
export type ChibiFrame = 'head' | 'full'
export interface LayerRef { order: number; file: string }                     // file without @dx.png
export interface BaseRef { id: string; hairBack: string; body: string; hairFront: string; faces: Record<Expression, string> }
export interface WearRef extends LayerRef { id: string; hidesHairFront?: boolean; hidesHairBack?: boolean }
export interface ChibiConfig { kind: 'human'; base: BaseRef; outfit: WearRef; head?: WearRef; face?: WearRef; aura?: WearRef; frame?: WearRef }
export interface BotChibi { kind: 'bot'; index: number }                        // bot_<n> files: bot_<n>_L30, bot_<n>_face_<expr>_L50 (placeholders until real)
export type ChibiSubject = ChibiConfig | BotChibi
export function layersFor(subject: ChibiSubject, expression: Expression, frame: ChibiFrame): LayerRef[]   // ordered; applies hide rules; `head` frame drops aura (order 10) and keeps frame (90); `full` drops frame
export function hashChibi(subject: ChibiSubject): string
export function AvatarAssets(props: { base: string; children: ReactNode }): JSX.Element   // context: url prefix, e.g. '/avatar/'
export function assetUrl(prefix: string, file: string, density: 1 | 2): string
export function Chibi(props: { subject: ChibiSubject; expression?: Expression; frame?: ChibiFrame; size?: number; label?: string; className?: string; bounce?: boolean }): JSX.Element
   // <div class=chibi data-chibi-hash data-expression data-frame> with one <img srcset="@1x 1x, @2x 2x" loading="lazy" decoding="async"> per layer, absolutely stacked; frame='head' = overflow hidden box showing the 160×160 crop scaled to `size`; frame='full' = 6:7 box
export function defaultChibi(seed: string): ChibiConfig    // base f01|m01 by hash parity, outfit_casual01, nothing else
export function botChibi(seed: string): BotChibi
// expression.ts — pure memory + hook, rules from spec 08 §3.4 (happy 4 s on payout, sad 3 s on showdown loss, surprised 2 s on all-in, closed while folded, sleep while sitting out/offline/idle > 60 s; priority sleep > closed > timed > neutral; bounce when it is my turn)
export function useTableExpressions(state: ClientState, serverNow: () => number): (seat: number) => Expression
// PokerTable / RoomScreen: chibiFor?: (player: RoomPlayerView) => ChibiSubject | null   (replaces avatarFor); Seat receives `chibi` + `expression` + `bounce`
```
Placeholders make Lite and the playground work with no real art: `defaultChibi` and bots reference the placeholder file names produced by T1.

- [ ] **Step 1:** `layers.test.ts`: order, hide rules (`hood` hides both hair layers; beret hides none), head frame drops aura and includes frame, full frame drops frame, bot has body+face only, expression picks the face file, hash stable. `expression.test.ts`: every rule + priority + expiry (fixtures from `test-fixtures.ts`). `Chibi.test.tsx`: one `img` per layer in order (compare `style.zIndex` or DOM order), `srcset` carries both densities with the context prefix, `data-chibi-hash`, head crop box style, `label` → `role="img"`. Run → FAIL.
- [ ] **Step 2:** Implement; CSS: `.chibi { position: relative; overflow: hidden }`, `.layer { position: absolute; inset: 0; width: 100%; height: 100% }`, head crop via `transform: translate(-112/384*100%, -48/448*100%) scale(384/160)` on an inner box (compute exact percentages), `.bounce` keyframe, reduced-motion off.
- [ ] **Step 3:** Seat/PokerTable/RoomScreen wiring (`data-face` bot|app|default kept), delete BotFace, playground page listing both placeholder bases × every placeholder item and the six expressions (reads `avatar-manifest.json` via a small fixture list), Lite build copy + `AvatarAssets`. Lite dev note in docs (T5).
- [ ] **Step 4:** ui-kit, lite tests; lint; typecheck. Commit: `feat(ui-kit): layered PNG chibi with hand-driven expressions; Lite ships the bases`.

---

### Task 4: Normal web — DTOs, table, bar, wardrobe, profile, inventory

**Files:**
- Create: `src/avatar/chibi.ts` (+test), `src/screens/wardrobe/{WardrobeScreen.tsx,BaseTab.tsx,ItemTab.tsx,OutfitBar.tsx,wardrobe.module.css}` (+tests)
- Modify: `src/api.ts` (+test), `src/screens/TableChrome.tsx` (+test), `src/App.tsx` (+`App.avatars.test.tsx`; mount `<AvatarAssets base="/avatar/">`), `src/screens/ProfileScreen.tsx` (+test), `src/screens/InventoryScreen.tsx` (+test), `src/screens/catalog.ts`, `src/catalog-i18n.ts`, `src/locales/{vi,en}/normal.json`; delete `src/screens/WardrobeScreen.tsx`

**Interfaces:**
```ts
export interface AvatarConfigDto { v: 3; base: 'f01' | 'm01'; outfit: string; head?: string; face?: string; aura?: string; frame?: string; title?: string; badge?: string }
export interface AssetRefDto { layer: number; file: string; hidesHairFront?: boolean; hidesHairBack?: boolean; fitsAvatarCrop: boolean }
export interface ItemDto { id; slot; rarity; nameKey; assetKey; isDefault; asset?: AssetRefDto }
export interface BaseDto { id: string; nameKey: string; layers: { hairBack: string; body: string; hairFront: string }; faces: Record<string, string> }
export interface AvatarCatalogDto { frame: { w: number; h: number }; crop: { x: number; y: number; size: number }; bases: BaseDto[]; manifestVersion: number }
export interface OutfitDto { slot: number; name: string; config: AvatarConfigDto; updatedAt: number }
NormalApi += avatarCatalog(): Promise<AvatarCatalogDto>; outfits(); saveOutfit(slot, name, config); deleteOutfit(slot); applyOutfit(slot)
export function chibiFromApi(config: AvatarConfigDto, items: ReadonlyMap<string, ItemDto>, bases: ReadonlyMap<string, BaseDto>): ChibiConfig | null   // null when the base is unknown; unknown item ids are omitted
```
- [ ] **Step 1:** api + mapper tests/impl. `App` loads `avatarCatalog` and `catalogItems` once (`useAsync`), passes maps to `makeChibiFor(avatars, items, bases)`; lobby bar `<Chibi frame="head" size={32}>`.
- [ ] **Step 2:** Wardrobe per spec §7: tabs Thân nền (2 tiles with the base head crop), Mũ, Mặt, Trang phục, Aura, Khung, Danh hiệu & Huy hiệu; preview `<Chibi frame="full" size={192}>` + expression picker; tile = the item's `@1x` layer cropped by its alpha bbox (use `object-fit` on the full layer inside a fixed box — no per-item bbox data needed: the tile shows the whole 384 × 448 layer scaled; for head/face items use the crop box) on a rarity background; locked + hint; Outfit bar 5 slots (as Plan 10 T6). Profile: `<Chibi frame="head" size={192}>` inside the frame ring + aura behind (render `full` with only aura+frame? no — render `head` frame which already includes frame; aura shows in `full` only) — **decision:** profile shows `full` at 240 px (aura visible) plus the 192 px head crop next to it. Inventory tiles reuse `ItemTab`'s tile.
- [ ] **Step 3:** i18n for 47 ids + base names + wardrobe/outfit copy (vi/en); tests. Commit: `feat(normal-web): chibi table and bar, wardrobe with bases and outfits, profile`.

---

### Task 5: Remove 3D, CSP, footprint, e2e, docs

**Files:** delete `src/avatar3d/`, `public/avatar3d/`, `scripts/avatar-assets.mjs|avatar-map.json|avatar-shots.mjs`, `test/avatar-assets.test.ts`, `e2e/avatar3d.spec.ts`, `assets/avatar-src/*` except the new README, `docs/avatar-assets.md`; deps `three`, `@types/three`, `meshoptimizer`, `@gltf-transform/*`; create `e2e/avatar2d.spec.ts`, `docs/avatar-2d.md`; modify `apps/normal-server/src/app.ts` (`script-src 'self'`, drop `blob:`) + `app.test.ts` + `docs/security.md`, `test/footprint.test.ts` (drop 3D budgets; add: `public/avatar` `@2x` total ≤ 6 MB; entry unchanged), `docs/normal-web.md`, `docs/known-limitations.md` (AI-art legal note, Lite dev has no avatars unless built, placeholders until real art), `docs/test-matrix.md`, `docs/acceptance-checklist.md` (+ `tooling/arch/acceptance-links.test.ts` green), `CHANGELOG.md`, main spec §15 note, spec 2026-09-08 and 2026-09-05 marked superseded, `apps/lite/e2e/lite.spec.ts` (seat has `.chibi[data-chibi-hash]`).

- [ ] **Step 1:** delete + unwire + `pnpm install`; typecheck.
- [ ] **Step 2:** e2e `avatar2d.spec.ts` (placeholders are enough): register → bar has `[data-chibi-hash]` → wardrobe: switch base to `m01`, equip `head_beanie01` (owned? fresh accounts own only `outfit_casual01`: so equip the base change and save; the locked `head_tophat01` tile is `aria-disabled`) → save → bar hash changes → Blind room with 2 bots → my seat hash equals the bar's and its `img[src*="base_m01_L30"]` exists; bots show `img[src*="bot_"]`; outfit save slot 1 "Đi làm" → switch base back → apply slot 1 → hash returns. Lite e2e updated.
- [ ] **Step 3:** docs, budgets, CSP; full `pnpm test`, lint, typecheck, both e2e. Commit: `chore: retire the 3D avatar pipeline; docs, CSP and budgets follow the layered chibi`.

---

### Task 6: Ingest the first real art — F01, six expressions, three items (the style gate)

**Depends on the user:** candidate pictures in `assets/avatar-src/` generated with D02 §4 + spec §4.2 (`F01`), §4.3 (expressions), and D02 §5 for `head_tophat01`, `face_glasses_round_gold01`, `outfit_dealer01`.

- [ ] **Step 1:** `ingest <candidate> --as base:f01 --dry-run` on every candidate: the CLI prints head height, total height in heads, eye line ratio, centre offset, and a verdict per D02 §8; the controller picks one with the user.
- [ ] **Step 2:** `ingest --as base:f01`, then `expr:f01:<each>`, then the three items (`--hides-hair-*` as decided); `check`; `sheet`; commit the layers (manifest entries `real: true`) — the sheet goes to the user. **Gate:** "duyệt" before Task 7.

### Task 7: Ingest the rest, grant the test wardrobe, deploy

- [ ] **Step 1:** As batches arrive: `M01` + expressions, remaining heads/faces/outfits, 8 auras, 6 frames, 8 bots — `ingest`, `check`, `sheet`, commit per batch.
- [ ] **Step 2:** `pnpm build:normal`; `grant-wardrobe-cli neon.test@example.com`; `run.ps1` **without** `-NoMigrate` once (0002); `pnpm build:lite`; screenshots of table/wardrobe/profile for the user; `docs/bug-log.md` CR1 → done.

---

## Self-review
- **Spec coverage:** §3 → T1 constants/checks; §4 → T6/T7 (prompts are the user's input; the CLI verifies); §5.1–5.2 → T2; §5.3 → T2; §6 → T1; §7 → T3/T4; §8 → T1 tests, T5 footprint/e2e; §9 gates → T6; §10 risks → T1 diff extraction + checks, aliases.
- **Placeholders:** none; the pipeline algorithms carry concrete thresholds; the art itself is the user's deliverable, gated by `check` and the sheet.
- **Type consistency:** `ChibiConfig/WearRef/BaseRef/Expression` (T3) ↔ `chibiFromApi` (T4) ↔ `AvatarConfigDto/BaseDto/ItemDto.asset` (T4) ↔ `AvatarConfigV3/BaseDef/AssetRef` (T2); layer numbers (T1 LAYERS) ↔ `AssetRef.layer` (T2) ↔ `LayerRef.order` (T3); file naming (T1 manifest.mjs) ↔ `avatar-bases.json`/`items.json` (T2) ↔ `assetUrl` (T3).
