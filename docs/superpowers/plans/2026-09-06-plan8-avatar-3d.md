# Bind Poker — Plan 8: 3D avatar for the Normal edition (assets pipeline, catalog v2, client portraits, three.js editor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim flat-SVG avatar of `apps/normal-web` with a 3D character built from CC0 modular assets: a build pipeline that normalises glTF parts into same-origin `.glb` files plus a manifest; catalog/config **v2** on the server (body male/female, skin, eyes, hair colour, slots hair/top/bottom/shoes/hat/accessory/jewelry/title/badge) with a v1→v2 migration; a shared client portrait renderer with memory + IndexedDB cache feeding the table, lobby, rail and inventory as static images; a three.js `AvatarStage` in the profile and a new wardrobe editor; tests, budgets and docs. Lite is untouched.

**Architecture:** Server keeps owning truth (a ~150-byte config) and never stores images. `apps/normal-web/scripts/avatar-assets.mjs` (gltf-transform + meshoptimizer) turns downloaded packs into `public/avatar3d/*.glb` + `manifest.json`. In the browser, `src/avatar3d/` holds one lazy chunk: asset loader (GLTFLoader + meshopt decoder), scene assembly from a config, `portraits.ts` (one hidden renderer, queue, hash, cache) and `AvatarStage` (event-driven rendering). `usePortrait(config)` replaces the SVG `Avatar`; `useAvatars` (config-by-playerId cache) stays.

**Tech Stack:** three@0.170 (+ `three/examples/jsm/loaders/GLTFLoader`, `MeshoptDecoder`), `@gltf-transform/core|extensions|functions@4`, `meshoptimizer@0.22` (build only), Vitest jsdom + fake renderer, Playwright (real WebGL in Chromium).

**Spec:** `docs/superpowers/specs/2026-09-05-avatar-3d-design.md` (§2 scope S1–S7, §3 data model + migration, §4 pipeline, §5 portraits, §6 UI, §7 budgets, §8 tests, §9 risks); main spec §15, §19.2, §24, §27.

## Global Constraints

- Dependency direction unchanged: `apps/normal-web → @bp/core, @bp/ui-kit`; `apps/normal-server → core, server-kit, http-kit`. three.js and gltf-transform live only in `apps/normal-web` (runtime `three`; build-time devDeps). No Node built-ins in browser code.
- Item ids that are rewarded stay: `hat_crown`, `jacket_champion`, `ring_royal`, `badge_veteran`, `badge_monthly`, `title_devoted`, `title_hot_hand`; achievements.json and daily rules are unchanged; the money/economy tests stay green untouched.
- Config v2 validation errors keep the §19.2 codes `MISSING_LAYER | INVALID_COLOR | INVALID_ITEM | WRONG_CATEGORY | NOT_OWNED`. Every response carries v2 (migrated on read); `PUT` accepts only v2.
- Assets are same-origin (`/avatar3d/…`), CSP unchanged; budgets: three chunk ≤ 200 KB gzip lazy; entry chunk ≤ 500 KB; assets total ≤ 6 MB, any single file ≤ 1.5 MB; portrait ≤ 80 ms after assets loaded (measured in e2e, logged).
- No WebGL / any failure → initial-letter fallback; the play UI is never blocked by avatars.
- Licensing: sources are CC0 (Quaternius); `assets/avatar-src/README.md` records URL, licence, date, sha256 of each archive; only build outputs are committed.
- i18n parity; `react/jsx-no-literals`; touch targets ≥ 44 px; no horizontal scroll at 375 px. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Consumed APIs (verified)
```ts
// server: apps/normal-server/src/inventory/items.ts — ItemDef{id, category, rarity, nameKey, assetKey, isDefault}, ItemCatalog{all,get,defaults,byRarity,defaultAvatar,seed(db)} loaded from data/items.json (validated); inventory/avatar.ts — AvatarConfig{base,face,clothing,hair,hairColor,accessory?,jewelry?,title?,badge?}, validateAvatarConfig(input, catalog), applyAvatarConfig(db, inventory, playerId, config), defaultAvatar(catalog), readAvatarConfig(stored, catalog); inventory-service.ts — grant/unownedOfRarity(exclude ids/categories); economy-service.ts reservedItemIds + category exclusions ['title','badge']; routes-me.ts PUT /api/me/avatar + GET /api/players/:id/avatar; db/schema.ts items(id, category, rarity, name_key, asset_key, is_default), inventory(player_id,item_id,source,acquired_at), players.avatar_config jsonb; drizzle/0000_init.sql only migration so far; catalog.seed() upserts on boot
// web: src/api.ts AvatarConfigDto, PlayerAvatarDto, api.setAvatar/inventory/playerAvatar(id,{fresh}); src/avatar/{Avatar.tsx (SVG), parts.tsx, PartThumb.tsx, useAvatars.ts (config cache by playerId, invalidate, resetAvatarCache)}; screens/{AvatarScreen.tsx, TableChrome.tsx (makeAvatarFor/makeCaptionFor), ProfileScreen.tsx, InventoryScreen.tsx, catalog.ts}; App.tsx wiring (lobby avatar link, RoomScreen avatarFor); test/footprint.test.ts (entry/total/css budgets); e2e/normal.spec.ts (avatar round-trip via data-part)
```

## File Structure (this plan)

```text
assets/avatar-src/README.md (+ .gitignore for the packs)                         T1
apps/normal-web/scripts/avatar-assets.mjs, scripts/avatar-map.json               T1 (source part → slot/itemId/body mapping)
apps/normal-web/public/avatar3d/{body-male,body-female,hair,outfits,accessories}.glb, manifest.json   T1 (built, committed)
apps/normal-web/test/avatar-assets.test.ts                                        T1 (manifest ↔ budgets ↔ node naming)
docs/avatar-assets.md                                                             T1
apps/normal-server/data/items.json (v2), src/inventory/{items.ts,avatar.ts,avatar-migrate.ts}, drizzle/0001_avatar_v2.sql, tests, routes-me.ts, economy exclusions   T2
apps/normal-server/test (catalog ↔ manifest check reading ../normal-web/public/avatar3d/manifest.json)   T2
apps/normal-web/src/api.ts (v2 DTO), src/avatar3d/{assets.ts, assemble.ts, hash.ts, portraits.ts, portrait-cache.ts, usePortrait.ts, Portrait.tsx, fake-renderer.ts}, remove src/avatar/{parts.tsx,PartThumb.tsx,Avatar.tsx}, update TableChrome/App/Inventory/Profile/locales   T3
apps/normal-web/src/avatar3d/{AvatarStage.tsx, stage.ts}, src/screens/WardrobeScreen.tsx (replaces AvatarScreen), ProfileScreen stage, locales   T4
apps/normal-web/test/footprint.test.ts (three chunk + assets), e2e/normal.spec.ts (+ avatar3d spec), docs/normal-web.md, docs/known-limitations.md, spec §15 + Appendix A, CHANGELOG   T5
```

---

### Task 1: Asset pipeline — download, normalise, manifest, budgets

**Files:**
- Create: `assets/avatar-src/README.md`, `assets/avatar-src/.gitignore` (`*`, `!README.md`), `apps/normal-web/scripts/avatar-assets.mjs`, `apps/normal-web/scripts/avatar-map.json`, `apps/normal-web/public/avatar3d/*.glb` + `manifest.json`, `apps/normal-web/test/avatar-assets.test.ts`, `docs/avatar-assets.md`
- Modify: `apps/normal-web/package.json` (devDeps `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`; script `avatar:assets`), root `.gitattributes` (`*.glb binary`), root `package.json` (`avatar:assets` alias)

**Interfaces:**
```ts
// manifest.json
interface AvatarManifest {
  version: 1
  generatedAt: string                       // ISO
  files: Record<string, { bytes: number; sha256: string }>              // 'body-male.glb' …
  nodes: Record<string, { file: string; bytes: number }>                // key '<slot>/<itemId>/<body>' e.g. 'top/clothing_aodai/female'; bodies: 'body/male', 'body/female'
  materials: string[]                        // canonical material names present: skin, eyes, hair, cloth_primary, cloth_secondary, metal
  budget: { totalBytes: number; maxFileBytes: number }
}
// avatar-map.json (hand-written, the only place a source mesh name is mentioned)
interface AvatarMap { sources: { pack: string; archive: string; sha256: string; license: 'CC0' }[]; bodies: Record<'male'|'female', { file: string; node: string }>; items: { id: string; slot: Slot; variants: Record<'male'|'female', { file: string; node: string; tint?: string } | null> }[] }
```
Script (`node scripts/avatar-assets.mjs [--check]`): reads the packs from `assets/avatar-src/`, for every `avatar-map.json` entry loads the source glTF, extracts the named node (mesh + material), drops skins/animations/cameras/lights, renames the node to the canonical key, renames materials to the canonical set (`skin`, `eyes`, `hair`, `cloth_primary`, `cloth_secondary`, `metal` — mapping rules in the map file; unknown → `cloth_secondary`), applies `tint` as the material base colour, welds/quantizes/meshopt-compresses, resizes textures to ≤ 512 px WebP (`sharp` is NOT available — use gltf-transform `textureCompress` with `encoder` from `sharp` only if present; otherwise keep PNG ≤ 512 via `textureResize`), writes the five `.glb` files and `manifest.json`, fails when a budget is exceeded or a mapped node is missing; `--check` only verifies the committed outputs against the map (used by the test).

**Sourcing ruling:** (1) try to download automatically — Universal Base Characters [Standard] from itch.io (`https://quaternius.itch.io/universal-base-characters`; itch's free-download flow is `POST https://quaternius.itch.io/universal-base-characters/download_url` with the page's `csrf_token` → JSON `{ url }`, then GET the zip) and Modular Character Outfits – Fantasy from `https://quaternius.com/packs/modularcharacteroutfitsfantasy.html` (follow the "Download here" link); record sha256 + date in the README. (2) If automated download is impossible (403/captcha/no network), do NOT stall: generate a **placeholder pack** with gltf-transform in `scripts/placeholder-pack.mjs` — two low-poly bodies (capsule torso, sphere head, cylinder limbs; male/female proportions), 6 hair silhouettes, tops/bottoms/shoes/hats/accessories/jewelry as simple primitives — so the pipeline, manifest, budgets and every later task work end to end; mark `manifest.version` `1` with `placeholder: true`, say so loudly in `docs/avatar-assets.md` (how to drop in the real packs: download, put the zips in `assets/avatar-src/`, fill `avatar-map.json` node names from the pack's node list printed by `node scripts/avatar-assets.mjs --list <archive>`, run `pnpm avatar:assets`), and in the report. Either way the map must cover every geometric item id in Task 2's catalog (see Task 2 list) with both body variants where the source has them.

- [ ] **Step 1:** README + gitignore + deps; `--list` mode printing node/material names of an archive.
- [ ] **Step 2:** map file for the catalog in Task 2 (ids below) + the script; run it; commit outputs.
- [ ] **Step 3:** `test/avatar-assets.test.ts`: manifest parses; every node key matches `^(body/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)/[a-z0-9_]+/(male|female))$`; budgets hold (total ≤ 6 MB, file ≤ 1.5 MB); sha256 of each file matches; `--check` passes. `docs/avatar-assets.md`.
- [ ] **Step 4:** `pnpm --filter @bp/normal-web test`, `pnpm lint`, `pnpm typecheck`. Commit `feat(normal-web): avatar asset pipeline and manifest`.

---

### Task 2: Server catalog v2, config v2, migration

**Files:**
- Modify: `apps/normal-server/data/items.json` (v2 shape), `src/inventory/items.ts` (`slot`, `variants`, validation incl. manifest check), `src/inventory/avatar.ts` (`AvatarConfigV2`, `validateAvatarConfig` v2, `defaultAvatar`, `readAvatarConfig` = migrate-on-read via new `avatar-migrate.ts`), `src/inventory/inventory-service.ts` (`unownedOfRarity` exclusions use `slot`), `src/economy/economy-service.ts` (exclude `title`/`badge` slots — rename category→slot), `src/achievements/definitions.ts` (unchanged ids), `src/db/schema.ts` (`items.category` → `slot` rename via migration; keep column name `category`? **Ruling: keep the DB column named `category` and treat it as the slot** — no rename migration; the TS field is `slot`), `drizzle/0001_avatar_v2.sql` (grant new default items to every player; delete `inventory` rows of removed ids; delete removed `items` rows — generated with drizzle-kit for schema deltas + hand-written data statements), `src/http/routes-me.ts` (accept v2), tests everywhere, `docs/normal-server.md`
- Create: `src/inventory/avatar-migrate.ts` (+ test), `apps/normal-server/test/catalog-manifest.test.ts` (reads `../normal-web/public/avatar3d/manifest.json`; every `variants.*.node` exists; skips with a warning if the manifest is missing)

**Catalog v2 (ids):** bodies are not items. Slots and ids — `hair`: `hair_none` (default), `hair_short`, `hair_curly`, `hair_ponytail`, `hair_long`, `hair_bun`, `hair_mohawk`; `top`: `top_tee` (default; renamed from `clothing_tee`, keep `clothing_tee` as an alias in the migration map), `clothing_hoodie`, `clothing_polo`, `clothing_aodai`, `clothing_suit`, `clothing_kimono`, `jacket_champion` (epic); `bottom`: `bottom_jeans` (default), `bottom_shorts`, `bottom_skirt`, `bottom_trousers`; `shoes`: `shoes_sneakers` (default), `shoes_boots`, `shoes_sandals`; `hat`: `accessory_headband`, `accessory_conical_hat`, `hat_crown` (epic); `accessory`: `accessory_glasses`, `accessory_mask`, `accessory_sunglasses`; `jewelry`: `jewelry_stud`, `jewelry_ring`, `jewelry_chain`, `jewelry_pendant`, `ring_royal` (epic); `title`/`badge` unchanged. Removed: `base_*`, `face_*`. Rarities as before; new ids `common` except `bottom_skirt`/`shoes_boots` `rare`.

**Config v2** exactly as spec §3.1 (`v: 2, body, skin, eyes, hairColor, hair, top, bottom, shoes, hat?, accessory?, jewelry?, title?, badge?`); `SKIN_TONES` (8) and `EYE_COLORS` (6) constants exported (server validates membership for `skin`/`eyes`; `hairColor` any `#rrggbb`). Migration on read: v1/no-`v` → body `male`, defaults, `clothing_*` → `top`, `accessory_conical_hat|headband` → `hat`, others → `accessory`; unknown/removed ids → slot default. `PUT` rejects v1 with `MISSING_LAYER`.

- [ ] **Step 1: Tests first** (PGlite): catalog loads v2 and rejects an item whose variant node is missing from the manifest (test uses a stub manifest); v1 stored configs read back as valid v2 with the mapped items; `PUT` v2 happy path and every error code; a v2 config referencing an item without the chosen body's variant → `INVALID_ITEM`; migration grants the new defaults to existing players and removes `base_*`/`face_*` rows idempotently; daily random tiers still exclude reserved ids and `title`/`badge`; achievements' reward ids exist; `/api/players/:id/avatar` returns v2.
- [ ] **Step 2: Implement.** Register keeps granting `catalog.defaults()`.
- [ ] **Step 3:** `pnpm --filter @bp/normal-server test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`; spec §19.2 avatar rows + §15 updated. Commit `feat(normal-server): avatar catalog and config v2 with migration`.

---
### Task 3: Client portraits — loader, assembly, renderer, cache, `usePortrait`; retire the SVG parts

**Files:**
- Create: `apps/normal-web/src/avatar3d/assets.ts` (manifest fetch + GLTFLoader with MeshoptDecoder, per-file promise cache, `loadNode(key)` → cloned `Object3D`), `assemble.ts` (config v2 → `Group`: body + slot nodes for the body variant, materials tinted: `skin`, `eyes`, `hair` from config, `cloth_*` from item tint; deterministic order), `hash.ts` (`hashConfig(config)`: canonical key order → FNV-1a hex), `portraits.ts` (singleton hidden `WebGLRenderer` 256×256 with `preserveDrawingBuffer:false` + `readPixels` into a 128×128 canvas → `toBlob('image/webp')` fallback PNG; head-and-shoulders camera; fixed lights; sequential queue; `render(config): Promise<Blob>`; `supported(): boolean`), `portrait-cache.ts` (memory Map + IndexedDB `bp.portraits` store `{hash, blob, lastUsed}` LRU 200; object URL lifecycle), `usePortrait.ts` (`usePortrait(config | null) → { url, status }`), `Portrait.tsx` (`<img>` with initial-letter placeholder; props `config, name, size 'sm'|'md'|'lg'`), `fake-renderer.ts` (test double producing a 1×1 blob per hash), tests for each
- Modify: `src/api.ts` (`AvatarConfigDto` v2), `src/avatar/useAvatars.ts` (unchanged API; DTO v2), `src/screens/TableChrome.tsx` (`makeAvatarFor` → `<Portrait size="sm">`; bots keep the glyph), `src/App.tsx` (lobby avatar link uses `Portrait`), `src/screens/InventoryScreen.tsx` (item tiles use `PartPortrait` — a portrait of the *current config with that item swapped in*, cached by hash; lazy per tile with `IntersectionObserver`), `src/screens/ProfileScreen.tsx` (header uses `Portrait lg` for now; Task 4 swaps in the stage), locales, `src/avatar/parts.tsx`/`Avatar.tsx`/`PartThumb.tsx` deleted with their tests, `e2e/normal.spec.ts` (`data-part` assertions → `data-hash` on the `<img>`)

**Rules:** the `three` import graph lives only under `src/avatar3d/` and is loaded via `React.lazy`/dynamic `import()` from `usePortrait` (the hook itself is light: it imports the renderer module lazily on first use so the entry chunk never includes three). Placeholder shows the initial letter until `status === 'ready'`; `unsupported` keeps the letter permanently and logs one `console.warn`. `invalidate(playerId)` (useAvatars) → new config → new hash → new portrait; old object URL revoked when evicted.

- [ ] **Step 1: Tests** — `hashConfig` stable/ordering-insensitive; `assemble` picks the right body variant and tints (jsdom with a stub loader); `portrait-cache` LRU/eviction/URL revoke with a fake IndexedDB (`fake-indexeddb` devDep); `usePortrait` states with `fake-renderer` (loading → ready; unsupported; same config twice → one render; two components same hash → one render); `Portrait` renders placeholder then `<img data-hash>`; TableChrome/App/Inventory tests updated; footprint test asserts `three` is NOT in the entry chunk (grep the chunk for `THREE.REVISION`/`three` module marker) and the avatar3d chunk ≤ 200 KB gzip.
- [ ] **Step 2: Implement**; delete the SVG parts and their locale keys if any became unused (keep `items.*` names).
- [ ] **Step 3:** `pnpm --filter @bp/normal-web test`, `build`, `typecheck`, `lint`; e2e updated but may be run in Task 5. Commit `feat(normal-web): client-rendered 3D portraits with cache; retire SVG avatar parts`.

---

### Task 4: `AvatarStage` and the wardrobe editor

**Files:**
- Create: `apps/normal-web/src/avatar3d/stage.ts` (scene/camera/lights/renderer for one full-body character; `createStage(canvas)` → `{ setConfig(config), setYaw(rad), resize(), dispose() }`; renders only on change via `requestAnimationFrame` coalescing), `src/avatar3d/AvatarStage.tsx` (`props { config, mode: 'view'|'edit', className?, ariaDescription }`; pointer drag → yaw ±60°, touch, "reset" button, `role="img"` + `aria-label`; falls back to `<Portrait lg>` when `!supported()`), `src/screens/WardrobeScreen.tsx` (+ test; replaces `AvatarScreen.tsx`)
- Modify: `src/App.tsx` (`/avatar` → `WardrobeScreen`), `src/screens/ProfileScreen.tsx` (header: `AvatarStage mode="view"` + "Chỉnh trang phục" link), locales (`wardrobe.*`, slot names, skin/eye tone names, notes), `src/screens/catalog.ts` (slots list)

**Wardrobe behaviour (spec §6):** left `AvatarStage` (edit), right groups: Body (male/female radios — switching keeps items that have the new body's variant, resets the rest to defaults and lists what changed in a `role="status"` note), Skin (8 named swatches), Eyes (6), Hair (owned items + colour presets/free hex), Top / Bottom / Shoes / Hat / Accessory / Jewelry (owned items only, "none" for optional slots; each option shows a `PartPortrait` thumbnail; radiogroups with `fieldset`/`legend`), Title / Badge selects. Save → `PUT` v2 → `invalidate(myId)` → success status; Reset → last saved; `beforeunload` guard + in-app route guard while dirty (`useHashRoute` navigation — confirm modal). Mobile: stage pinned 40 vh, groups scroll; targets ≥ 44 px; no horizontal scroll at 375 px.

- [ ] **Step 1: Tests** (jsdom; `stage.ts` mocked with a fake): body switch keeps compatible items and notes the rest; only owned items listed; optional "none"; hex validation; save calls `setAvatar` with a full v2 and invalidates; dirty guard; a11y roles/names; unsupported WebGL renders the portrait fallback.
- [ ] **Step 2: Implement** (three chunk shared with Task 3's; stage adds ≤ 30 KB gzip).
- [ ] **Step 3:** `pnpm --filter @bp/normal-web test`, `build`, `typecheck`, `lint`. Commit `feat(normal-web): three.js avatar stage and wardrobe editor`.

---

### Task 5: Real-render tests, e2e, budgets, docs

**Files:**
- Modify: `apps/normal-web/test/footprint.test.ts` (three chunk ≤ 200 KB gzip; assets ≤ 6 MB / file ≤ 1.5 MB via manifest; entry unchanged ≤ 500 KB), `apps/normal-web/e2e/normal.spec.ts` + new `e2e/avatar3d.spec.ts` (register → wardrobe: switch to female, pick `clothing_aodai` if owned else change hair colour + skin, save → reload → editor shows saved values; lobby `<img data-hash>` changed; open a Blind room → seat shows a portrait `<img>` with `naturalWidth > 0`; measure time from room join to all seat portraits ready (log; assert ≤ 2 s with one bot); `@mobile`: wardrobe no horizontal scroll, stage visible, save reachable), `docs/normal-web.md` (avatar3d section), `docs/avatar-assets.md` (final), `docs/known-limitations.md` (placeholder pack if used; outfits coverage; no animation), `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §15 + Appendix A, `CHANGELOG.md` (Plan 8 unreleased), README (assets licence line)
- Create: `apps/normal-web/src/avatar3d/render.browser.test.ts`? **Ruling:** no separate Vitest browser mode; real-WebGL checks live in the Playwright e2e (three configs → distinct `data-hash`, non-empty images, per-portrait timing logged).

- [ ] **Step 1:** footprint + e2e; run `pnpm build:normal` then `pnpm --filter @bp/normal-web e2e` (Chromium installed) — all green; screenshots of wardrobe (desktop + 375) and a seated portrait saved under `e2e/screenshots/`.
- [ ] **Step 2:** docs/spec/changelog. `pnpm test && pnpm typecheck && pnpm lint`. Commit `feat(normal-web): 3D avatar e2e, budgets and docs`.

---

## Self-review
- Spec coverage: S1 (T1), S2 (T2), S3+S5 (T3), S4 (T4), S6+S7 (T5). Migration §3.3 in T2; budgets §7 in T3/T5; fallback §5 in T3/T4.
- Consistency: manifest node key format defined once (T1) and asserted in T1 test, consumed by T2 catalog check and T3 loader; `AvatarConfigDto` v2 defined in T3 `api.ts` matching T2 server type; `Portrait`/`usePortrait` from T3 used by T4/T5; `PartPortrait` (T3) used by T4 tiles.
- Placeholders: the sourcing fallback is explicit and flagged; no TBDs.
