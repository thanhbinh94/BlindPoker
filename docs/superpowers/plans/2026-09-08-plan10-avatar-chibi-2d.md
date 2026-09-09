# Just a Normal Poker — Plan 10: chibi 2D avatars (replacing the 3D figure)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every seat, bar, wardrobe and profile draws a layered 2D chibi built from one SVG sprite — customisable face and body, wardrobe items from the existing inventory, collectible eye/mouth styles, five saved outfits, expressions driven by the hand — and the 3D pipeline is gone.

**Architecture:** `@bp/ui-kit/src/avatar2d/` owns the sprite (hand-written `<symbol>`s merged by a script into a generated TS module plus a JSON manifest), the pure resolver (config → ordered `<use>` parts + CSS variables), the `Chibi` component, expressions and bots. `apps/normal-server` moves the avatar config to v3 (face + cloth colours), replaces glb `variants` with `sprite` references validated against a copy of the manifest, adds `data/faces.json`, two collectible slots and an outfits table/API. `apps/normal-web` maps API config to the kit's `ChibiConfig`, rewrites the wardrobe and profile, and deletes `avatar3d/`. `apps/lite` gets bot chibis and a name-seeded default chibi.

**Tech Stack:** TypeScript strict ESM (`.js` imports), React 18, Vitest 2, Playwright (e2e), Fastify 5 + Drizzle (PGlite in tests), esbuild bundle, SVG 1.1 `<symbol>`/`<use>`, CSS custom properties, PowerShell-free tooling (Node scripts only).

**Spec:** `docs/superpowers/specs/2026-09-08-avatar-chibi-2d-design.md` (sections cited as §n). Main spec `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §15.

## Global Constraints
- Sprite hosts every drawn part: `viewBox="0 0 256 320"`, head ellipse centre (128,104) radii 84×78, torso y 176–300, shoes y ≥ 272 (§3.1). Stroke width 3, one flat shade tone per colour, no gradients, no embedded raster (§9).
- Layer ids and order are exactly the 16 of §3.2: `hairBack, body, shoes, bottom, top, jewelry, faceBase, faceMarks, nose, mouth, eyes, brows, accessoryUnder, hairFront, hat, accessoryOver`.
- Symbol ids: `<group>/<id>[/<qualifier>]` — items `<slot>/<itemId>[/<part>][/<body>]`, faces `face/<shape>`, `marks/<id>`, `nose/<id>`, `eyes/<style>/<state>`, `mouth/<style>/<state>`, `brows/<style>/<state>`, bodies `body/<body>`, bots `bot/bot_<n>/<part>` (§4).
- Colours only through CSS variables `--skin --hair --eye --c-top --c-bottom --c-shoes --c-hat` with a literal default in every `var()` (§3.3).
- Expressions are exactly `neutral happy sad surprised closed sleep` (§3.4). `prefers-reduced-motion: reduce` disables every animation.
- Sprite budget: generated SVG ≤ 160 KB raw, ≤ 45 KB gzip (§4).
- All 42 existing item ids keep their ids (§5.3). Config v3 reads v1/v2 without a SQL migration (§5.1). Outfits: 5 slots, name ≤ 24 chars (§5.4).
- Product name in user-facing copy is "Just a Normal Poker"; operator docs Vietnamese, developer docs English; `react/jsx-no-literals` means every UI string goes through i18n (vi + en).
- Lint `--max-warnings=0`, `pnpm typecheck`, and `pnpm test` green at every commit; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never `git commit -a`; stage files explicitly.

## Consumed facts (verified 2026-09-08)
```text
ui-kit: src/index.ts re-exports modules; src/table/Seat.tsx draws `.avatar` disc (40 px, data-face) with `avatar ?? initial`, bots via src/table/BotFace.tsx (botFaceIndex FNV-1a); PokerTable prop avatarFor?: (player: RoomPlayerView) => ReactNode; RoomScreen forwards avatarFor/captionFor; playground/main.tsx (vite, LobbyScreen/RoomScreen with mock client); scripts: test/typecheck/playground/build:playground only.
normal-server: src/inventory/{slots.ts (ItemSlot, REQUIRED_SLOTS, OPTIONAL_SLOTS, GEOMETRIC_SLOTS, Body), items.ts (ItemDef{id,slot,rarity,nameKey,assetKey,isDefault,variants?}, loadItemCatalog(path) validates + seed(db) upsert into `items` table columns id/category/rarity/name_key/asset_key/is_default), avatar.ts (AVATAR_CONFIG_VERSION=2, AvatarConfigV2, validateAvatarConfig(input, catalog) → {ok,value}|{ok:false,code}, readAvatarConfig(raw, catalog), applyAvatarConfig(db, inventory, playerId, config), defaultAvatar(catalog), itemIdsOf, SKIN_TONES/EYE_COLORS from data/palettes.json {skin[8], eyes[6]}), inventory-service.ts (grant/missingOf/unownedOfRarity), grant-wardrobe.ts}; data/{items.json (42 items, `variants` glb refs), palettes.json, achievements.json (6 item rewards: hat_crown, title_devoted, jacket_champion, title_hot_hand, ring_royal, badge_veteran)}; http/routes-me.ts (GET /api/me/inventory, PUT /api/me/avatar, GET /api/players/:id/avatar with AVATAR_CACHE), routes-catalog.ts (GET /api/catalog/items, /api/catalog/achievements, /api/config); app.ts SCRIPT_SRC "script-src 'self' 'wasm-unsafe-eval'", IMG_SRC_EXTRA 'blob:'; app.test.ts enumerates routes via @bp/http-kit/testing; drizzle/0000_init.sql, 0001_avatar_v2.sql; scripts/build.mjs ENTRIES main/migrate-cli/grant-wardrobe-cli; data/ shipped as sidecar (packageRoot()).
normal-web: src/avatar3d/* (Portrait, LazyStage, AvatarStage, portrait-cache, hash, assets, assemble, framing, gl-context, description, palettes.test), public/avatar3d/*.glb + manifest.json, scripts/avatar-assets.mjs|avatar-map.json|avatar-shots.mjs, deps three/@types/three/meshoptimizer/@gltf-transform/*; src/avatar/useAvatars.ts (AvatarCache Map<playerId, PlayerAvatarDto|null>, resetAvatarCache), screens/TableChrome.tsx (makeAvatarFor → Portrait size="seat"; makeCaptionFor), App.tsx imports Portrait + resetPortraitMemory (lobby bar face), screens/WardrobeScreen.tsx (536 lines, LazyAvatarStage + PartPortrait, api.inventory/catalogItems/setAvatar), ProfileScreen.tsx (LazyAvatarStage), InventoryScreen.tsx (PartPortrait tiles), api.ts DTOs (AvatarConfigDto v2, ItemDto with variants, PlayerAvatarDto, InventoryDto), test/footprint.test.ts (avatar3d chunk + dist/avatar3d budgets, three marker), test/avatar-assets.test.ts, e2e/avatar3d.spec.ts, locales `items.*` names.
lite: apps/lite/web/src/App.tsx renders <RoomScreen client lang onLeft /> with no avatarFor.
docs: docs/avatar-assets.md, docs/normal-web.md, docs/security.md (CSP), docs/known-limitations.md, docs/test-matrix.md, docs/acceptance-checklist.md (+ tooling/arch/acceptance-links.test.ts citing test names), CHANGELOG.md.
```

## File Structure
```text
packages/ui-kit/
  scripts/avatar-sprite.mjs                       T1  merge sprite sources → generated TS + manifest (+ copy to normal-server/data)
  src/avatar2d/sprite/src/**/*.svg                T1,T2  hand-written symbols (one file per item/face group/bot)
  src/avatar2d/sprite.generated.ts                T1  `export const SPRITE_SVG`, `export const SPRITE_MANIFEST`
  src/avatar2d/sprite.manifest.json               T1  same manifest as JSON (read by the server copy test)
  src/avatar2d/types.ts                           T1  layers, expressions, ChibiConfig, ChibiItem, BotChibi
  src/avatar2d/manifest.ts                        T1  typed access + `hasSymbol`
  src/avatar2d/resolve.ts (+test)                 T1  resolveChibi / partsFor / hashChibi
  src/avatar2d/Chibi.tsx (+test), avatar2d.module.css   T1  the component, frames, blink
  src/avatar2d/AvatarSprite.tsx                   T1  inject once
  src/avatar2d/defaults.ts                        T1  DEFAULT_FACE, DEFAULT_ITEMS (4 required defaults as ChibiItem), defaultChibi(seed)
  src/avatar2d/bot.ts                             T1  botChibi(seed) (keeps botFaceIndex)
  src/avatar2d/expression.ts (+test)              T5  pure expression memory + hook
  src/avatar2d/index.ts                           T1  barrel; src/index.ts re-exports it
  playground/avatar2d.tsx                         T1  #avatar2d page: every item × body × expression, bots
  src/table/Seat.tsx, PokerTable.tsx, RoomScreen.tsx   T5  chibiFor slot replaces avatarFor; BotFace.tsx deleted
apps/normal-server/
  data/sprite.manifest.json                       T1 (copied by the script), validated equal in T3 test
  data/faces.json                                 T2/T3
  data/palettes.json (+hair, +cloth)              T3
  data/items.json (sprite refs, +15 items, +10 face collectibles)   T2 (drawings) / T3 (json)
  src/inventory/slots.ts, items.ts, faces.ts (+test), avatar.ts (+test), sprite-manifest.ts   T3
  src/http/routes-catalog.ts (/api/catalog/faces) T3
  src/db/schema.ts (avatar_outfits), drizzle/0002_outfits.sql, src/inventory/outfits-service.ts (+test), src/http/routes-outfits.ts (+test)   T4
apps/normal-web/
  src/api.ts (v3 DTOs, faces, outfits), src/avatar/chibi.ts (+test)   T6
  src/screens/TableChrome.tsx, App.tsx, WardrobeScreen.tsx (+test), ProfileScreen.tsx, InventoryScreen.tsx   T6
  src/avatar3d/ (deleted), public/avatar3d/ (deleted), scripts/avatar-*.mjs|json (deleted), test/avatar-assets.test.ts (deleted), test/footprint.test.ts (rewritten budgets), e2e/avatar3d.spec.ts → e2e/avatar2d.spec.ts, scripts/avatar-sheet.mjs   T7
apps/lite/web/src/App.tsx                         T5 (nothing to pass: kit defaults)
docs/avatar-2d.md (new), docs/avatar-assets.md (deleted), docs/normal-web.md, docs/security.md, docs/known-limitations.md, docs/test-matrix.md, docs/acceptance-checklist.md, CHANGELOG.md, spec §15 note   T7
```

---

### Task 1: Chibi rig, sprite tooling, `Chibi` component, five items, one bot, playground — the style gate

**Files:**
- Create: `packages/ui-kit/scripts/avatar-sprite.mjs`, `packages/ui-kit/src/avatar2d/{types.ts,manifest.ts,resolve.ts,resolve.test.ts,Chibi.tsx,Chibi.test.tsx,avatar2d.module.css,AvatarSprite.tsx,defaults.ts,bot.ts,index.ts,sprite.test.ts}`, `packages/ui-kit/src/avatar2d/sprite/src/{body/male.svg,body/female.svg,face/shape_round.svg,eyes/eyes_basic_1.svg,eyes/_shared.svg,mouth/mouth_smile_soft.svg,brows/brows_soft.svg,nose/nose_dot.svg,hair/hair_short.svg,top/top_tee.svg,bottom/bottom_jeans.svg,shoes/shoes_sneakers.svg,accessory/accessory_conical_hat.svg,bot/bot_0.svg}`, `packages/ui-kit/playground/avatar2d.tsx`
- Modify: `packages/ui-kit/package.json` (scripts `sprite`, `sprite:check`; `pretest` runs `sprite:check`), `packages/ui-kit/src/index.ts`, `packages/ui-kit/playground/main.tsx` (route `#avatar2d`), `.gitattributes`/`.gitignore` untouched (generated files ARE committed)
- Test: as listed; the gate is the playground page reviewed by the user.

**Interfaces (produced, used by every later task):**
```ts
// types.ts
export type ChibiLayer = 'hairBack' | 'body' | 'shoes' | 'bottom' | 'top' | 'jewelry' | 'faceBase' | 'faceMarks' | 'nose' | 'mouth' | 'eyes' | 'brows' | 'accessoryUnder' | 'hairFront' | 'hat' | 'accessoryOver'
export const CHIBI_LAYERS: readonly ChibiLayer[]   // in that order
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'
export const EXPRESSIONS: readonly Expression[]
export type ChibiBody = 'male' | 'female'
export type ChibiFrame = 'head' | 'full' | 'part'
export interface ChibiPart { layer: ChibiLayer; symbol: string }
export interface ChibiItem { id: string; slot: 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'jewelry'; parts: ChibiPart[]; bodies: 'any' | ChibiBody[]; colorable: boolean }
export interface ChibiFace { shape: string; eyeStyle: string; brows: string; nose: string; mouth: string; blush?: string; marks?: string }
export interface ChibiConfig { kind: 'human'; body: ChibiBody; skin: string; hairColor: string; eyeColor: string; face: ChibiFace; colors?: Partial<Record<'top' | 'bottom' | 'shoes' | 'hat', string>>; items: Partial<Record<ChibiItem['slot'], ChibiItem>> }
export interface BotChibi { kind: 'bot'; index: number }   // 0..7
export type ChibiSubject = ChibiConfig | BotChibi
// manifest.ts
export interface SymbolInfo { layer: ChibiLayer | 'none'; viewBox: string }
export const MANIFEST: Readonly<Record<string, SymbolInfo>>
export function hasSymbol(id: string): boolean
// resolve.ts
export interface ResolvedChibi { hash: string; subject: ChibiSubject; vars: Record<string, string>; static: ChibiPart[]; eyeStyle: string; mouthStyle: string; browStyle: string }
export function resolveChibi(subject: ChibiSubject): ResolvedChibi
export function partsFor(resolved: ResolvedChibi, expression: Expression, blink?: boolean): ChibiPart[]   // ordered by CHIBI_LAYERS
export function hashChibi(subject: ChibiSubject): string
// Chibi.tsx
export interface ChibiProps { subject: ChibiSubject; expression?: Expression; frame?: ChibiFrame; size?: number; label?: string; className?: string; animate?: boolean; bounce?: boolean }
export function Chibi(props: ChibiProps): JSX.Element   // <svg data-chibi-hash data-expression data-frame>
export function ChibiPartPreview(props: { item: ChibiItem; body: ChibiBody; size?: number; className?: string }): JSX.Element
// AvatarSprite.tsx
export function AvatarSprite(): JSX.Element   // idempotent, id "bp-avatar-sprite"
// defaults.ts
export const DEFAULT_FACE: ChibiFace
export const DEFAULT_ITEMS: Record<'hair' | 'top' | 'bottom' | 'shoes', ChibiItem>
export function defaultChibi(seed: string): ChibiConfig
// bot.ts
export function botFaceIndex(seed: string): number   // moved from table/BotFace.tsx, unchanged
export function botChibi(seed: string): BotChibi
```

**Sprite source contract.** Each `sprite/src/**/*.svg` file is a bare `<svg xmlns="http://www.w3.org/2000/svg">` holding one or more `<symbol id="…" data-layer="…" viewBox="x y w h">…</symbol>`. `data-layer` is a `ChibiLayer`, or `none` for helper symbols (`_shared`). `viewBox` is the tight box of that part in rig coordinates (used for part previews). Fills use `var(--skin, #e0ac81)`, `var(--hair, #2b2b2b)`, `var(--eye, #3b2415)`, `var(--c-top, #f2f2f2)` etc. Strokes `#1a1f2e` width 3, `stroke-linejoin="round"`. Shade = a second path of the same shape in `rgba(0,0,0,.14)` clipped to the left third. Nothing else: no `<style>`, no `<image>`, no `<filter>`, no scripts, no ids other than the symbol's.

**Face state ids.** Eyes: `eyes/<style>/<state>` with `state ∈ open surprised` for every style, and `eyes/_shared/<state>` for `closed happy sad sleep` (drawn once, reused by every style). Mouth: `mouth/<style>/<state>` with `state ∈ neutral happy`, plus `mouth/_shared/<state>` for `sad surprised closed sleep`. Brows: `brows/<style>/<state>` with `state ∈ neutral`, plus `brows/_shared/<state>` for `happy sad surprised`. Bots: `eyes/bot_<n>/{open,surprised}`, `mouth/bot/{neutral,happy}` and the same `_shared` fallbacks; `bot/bot_<n>/body` (layer body), `bot/bot_<n>/face` (faceBase). `partsFor` picks: eyes = blink or expression∈{closed,sleep} ? `eyes/_shared/<closed|sleep>` : expression∈{happy,sad} ? `eyes/_shared/<expr>` : `eyes/<style>/<open|surprised>`; mouth = expression∈{neutral,happy} ? `mouth/<style>/<expr>` : `mouth/_shared/<expr>`; brows = expression==='neutral' ? `brows/<style>/neutral` : `brows/_shared/<happy|sad|surprised|neutral>` (closed/sleep → neutral). Every pick is checked with `hasSymbol`; a missing one falls back to `eyes_basic_1` / `mouth_smile_soft` / `brows_soft` of the same state, and if that is missing too `resolveChibi` throws `Error('sprite: missing symbol <id>')` — a test catches it, a user never sees it.

- [ ] **Step 1: The merge script.** Create `packages/ui-kit/scripts/avatar-sprite.mjs`:

```js
#!/usr/bin/env node
/**
 * Merges every `src/avatar2d/sprite/src/**\/*.svg` into one sprite:
 *   src/avatar2d/sprite.generated.ts   `SPRITE_SVG` (string) + `SPRITE_MANIFEST` (object)
 *   src/avatar2d/sprite.manifest.json  the same manifest, for tooling
 *   ../../apps/normal-server/data/sprite.manifest.json   the server's copy (its catalogue validates against it)
 * `--check` rewrites nothing and exits 1 if any output is stale.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = resolve(ROOT, 'src/avatar2d/sprite/src')
const OUT_TS = resolve(ROOT, 'src/avatar2d/sprite.generated.ts')
const OUT_JSON = resolve(ROOT, 'src/avatar2d/sprite.manifest.json')
const OUT_SERVER = resolve(ROOT, '../../apps/normal-server/data/sprite.manifest.json')
const LAYERS = ['hairBack', 'body', 'shoes', 'bottom', 'top', 'jewelry', 'faceBase', 'faceMarks', 'nose', 'mouth', 'eyes', 'brows', 'accessoryUnder', 'hairFront', 'hat', 'accessoryOver', 'none']
const MAX_RAW = 160 * 1024

const check = process.argv.includes('--check')
const die = (msg) => { console.error(`[sprite] ${msg}`); process.exit(1) }

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.svg')) out.push(p)
  }
  return out
}

const symbols = []
const manifest = {}
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  if (/<(style|image|script|filter|foreignObject)\b/.test(text)) die(`${relative(ROOT, file)}: forbidden element (style/image/script/filter/foreignObject)`)
  const re = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g
  let m
  let count = 0
  while ((m = re.exec(text)) !== null) {
    count += 1
    const attrs = m[1]
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1]
    const layer = /\bdata-layer="([^"]+)"/.exec(attrs)?.[1]
    const viewBox = /\bviewBox="([^"]+)"/.exec(attrs)?.[1]
    if (!id || !layer || !viewBox) die(`${relative(ROOT, file)}: every <symbol> needs id, data-layer and viewBox (offending: ${attrs.trim()})`)
    if (!LAYERS.includes(layer)) die(`${relative(ROOT, file)}: ${id} has unknown layer ${layer}`)
    if (manifest[id]) die(`${relative(ROOT, file)}: duplicate symbol id ${id}`)
    if (/\bid="/.test(m[2])) die(`${relative(ROOT, file)}: ${id} contains a nested id — symbols must be self-contained`)
    manifest[id] = { layer, viewBox }
    symbols.push(`<symbol id="${id}" viewBox="${viewBox}">${m[2].trim()}</symbol>`)
  }
  if (count === 0) die(`${relative(ROOT, file)}: no <symbol>`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${symbols.join('')}</svg>`
if (Buffer.byteLength(svg) > MAX_RAW) die(`sprite is ${Buffer.byteLength(svg)} bytes raw, over the ${MAX_RAW} budget (§4)`)
const sha = createHash('sha256').update(svg).digest('hex').slice(0, 16)
const manifestJson = JSON.stringify({ sha256: sha, symbols: manifest }, null, 2) + '\n'
const ts = `// Generated by scripts/avatar-sprite.mjs — do not edit. Sources: src/avatar2d/sprite/src/**.\n` +
  `/* eslint-disable */\n` +
  `export const SPRITE_SHA = ${JSON.stringify(sha)}\n` +
  `export const SPRITE_SVG = ${JSON.stringify(svg)}\n` +
  `export const SPRITE_MANIFEST = ${JSON.stringify(manifest)} as const\n`

const outputs = [[OUT_TS, ts], [OUT_JSON, manifestJson], [OUT_SERVER, manifestJson]]
let stale = false
for (const [path, content] of outputs) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current === content) continue
  stale = true
  if (check) console.error(`[sprite] stale: ${relative(ROOT, path)}`)
  else writeFileSync(path, content)
}
if (check && stale) die('run `pnpm --filter @bp/ui-kit sprite`')
console.log(`[sprite] ${symbols.length} symbols, ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB raw, sha ${sha}${check ? ' (check ok)' : ''}`)
```

Add to `packages/ui-kit/package.json` scripts: `"sprite": "node scripts/avatar-sprite.mjs"`, `"sprite:check": "node scripts/avatar-sprite.mjs --check"`, and `"pretest": "node scripts/avatar-sprite.mjs --check"`. Add `packages/ui-kit/src/avatar2d/sprite.generated.ts` to the ESLint ignore list in the root `eslint.config.js` (find the existing `ignores` array and add `'packages/ui-kit/src/avatar2d/sprite.generated.ts'`).

- [ ] **Step 2: Types and manifest access.** `types.ts` exactly as in Interfaces (with `CHIBI_LAYERS` and `EXPRESSIONS` arrays). `manifest.ts`:

```ts
import type { ChibiLayer } from './types.js'
import { SPRITE_MANIFEST } from './sprite.generated.js'

export interface SymbolInfo { layer: ChibiLayer | 'none'; viewBox: string }
export const MANIFEST: Readonly<Record<string, SymbolInfo>> = SPRITE_MANIFEST as unknown as Readonly<Record<string, SymbolInfo>>
export const hasSymbol = (id: string): boolean => Object.prototype.hasOwnProperty.call(MANIFEST, id)
export function symbolInfo(id: string): SymbolInfo {
  const info = MANIFEST[id]
  if (info === undefined) throw new Error(`sprite: missing symbol ${id}`)
  return info
}
```

- [ ] **Step 3: Failing resolver test.** `resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { botChibi } from './bot.js'
import { DEFAULT_ITEMS, defaultChibi } from './defaults.js'
import { hasSymbol } from './manifest.js'
import { hashChibi, partsFor, resolveChibi } from './resolve.js'
import { CHIBI_LAYERS, EXPRESSIONS, type ChibiConfig } from './types.js'

const layerIndex = (layer: string) => CHIBI_LAYERS.indexOf(layer as never)

describe('resolveChibi', () => {
  it('orders every part by layer, for every expression, and every symbol exists', () => {
    const resolved = resolveChibi(defaultChibi('Ann'))
    for (const expression of EXPRESSIONS) {
      const parts = partsFor(resolved, expression)
      const order = parts.map((p) => layerIndex(p.layer))
      expect(order).toEqual([...order].sort((a, b) => a - b))
      for (const p of parts) expect(hasSymbol(p.symbol), p.symbol).toBe(true)
      expect(parts.some((p) => p.layer === 'eyes')).toBe(true)
      expect(parts.some((p) => p.layer === 'mouth')).toBe(true)
      expect(parts.some((p) => p.layer === 'body')).toBe(true)
    }
  })

  it('swaps only eyes, mouth and brows between expressions, and closes the eyes on a blink', () => {
    const resolved = resolveChibi(defaultChibi('Ann'))
    const neutral = partsFor(resolved, 'neutral')
    const happy = partsFor(resolved, 'happy')
    const differing = neutral.filter((p, i) => p.symbol !== happy[i]?.symbol).map((p) => p.layer)
    expect(new Set(differing)).toEqual(new Set(['eyes', 'mouth', 'brows']))
    expect(partsFor(resolved, 'neutral', true).find((p) => p.layer === 'eyes')?.symbol).toBe('eyes/_shared/closed')
  })

  it('binds the colours to css variables and honours a cloth colour only on a colorable item', () => {
    const cfg: ChibiConfig = { ...defaultChibi('Ann'), skin: '#c98d62', hairColor: '#d9a441', eyeColor: '#33608c', colors: { top: '#c95c5c', bottom: '#111111' } }
    cfg.items.bottom = { ...DEFAULT_ITEMS.bottom, colorable: false }
    const { vars } = resolveChibi(cfg)
    expect(vars).toMatchObject({ '--skin': '#c98d62', '--hair': '#d9a441', '--eye': '#33608c', '--c-top': '#c95c5c' })
    expect(vars['--c-bottom']).toBeUndefined()
  })

  it('picks the body variant of an item that has one, and the shared piece of one that has none', () => {
    const female = resolveChibi({ ...defaultChibi('Ann'), body: 'female' })
    expect(female.static.find((p) => p.layer === 'body')?.symbol).toBe('body/female')
    expect(female.static.find((p) => p.layer === 'top')?.symbol).toBe('top/top_tee/female')
    expect(female.static.find((p) => p.layer === 'hairFront')?.symbol).toBe('hair/hair_short/front')
  })

  it('hashes the same configuration to the same string and a different one differently', () => {
    expect(hashChibi(defaultChibi('Ann'))).toBe(hashChibi(defaultChibi('Ann')))
    expect(hashChibi(defaultChibi('Ann'))).not.toBe(hashChibi({ ...defaultChibi('Ann'), skin: '#452b1e' }))
    expect(hashChibi(botChibi('bot:r:0'))).toMatch(/^[0-9a-f]{8,}$/)
  })

  it('draws a bot from its own body and face, with the shared expression pieces', () => {
    const bot = resolveChibi(botChibi('bot:ABC234:0'))
    const parts = partsFor(bot, 'happy')
    expect(parts.find((p) => p.layer === 'body')?.symbol).toMatch(/^bot\/bot_\d\/body$/)
    expect(parts.find((p) => p.layer === 'faceBase')?.symbol).toMatch(/^bot\/bot_\d\/face$/)
    expect(parts.some((p) => p.layer === 'hairFront' || p.layer === 'top')).toBe(false)
  })
})
```

- [ ] **Step 4: Run it** — `pnpm --filter @bp/ui-kit exec vitest run src/avatar2d/resolve.test.ts` → FAIL (modules missing).

- [ ] **Step 5: Implement `defaults.ts`, `bot.ts`, `resolve.ts`.**

```ts
// defaults.ts
import type { ChibiConfig, ChibiFace, ChibiItem } from './types.js'
export const DEFAULT_FACE: ChibiFace = { shape: 'shape_round', eyeStyle: 'eyes_basic_1', brows: 'brows_soft', nose: 'nose_dot', mouth: 'mouth_smile_soft' }
/** The four required-slot defaults, mirrored from apps/normal-server/data/items.json (isDefault: true). */
export const DEFAULT_ITEMS: Record<'hair' | 'top' | 'bottom' | 'shoes', ChibiItem> = {
  hair: { id: 'hair_short', slot: 'hair', parts: [{ layer: 'hairFront', symbol: 'hair/hair_short/front' }], bodies: 'any', colorable: false },
  top: { id: 'top_tee', slot: 'top', parts: [{ layer: 'top', symbol: 'top/top_tee' }], bodies: ['male', 'female'], colorable: true },
  bottom: { id: 'bottom_jeans', slot: 'bottom', parts: [{ layer: 'bottom', symbol: 'bottom/bottom_jeans' }], bodies: ['male', 'female'], colorable: true },
  shoes: { id: 'shoes_sneakers', slot: 'shoes', parts: [{ layer: 'shoes', symbol: 'shoes/shoes_sneakers' }], bodies: 'any', colorable: true },
}
const SKINS = ['#f7dcc3', '#efc9a4', '#e0ac81', '#c98d62', '#a9714b', '#8a563a', '#66402c', '#452b1e']
const HAIRS = ['#2b2b2b', '#5a3a1e', '#a0632a', '#d9a441', '#c9302c', '#3f938a', '#7b3fbf', '#e8e4d8']
const EYES = ['#3b2415', '#6b4a2f', '#8c6239', '#2f5d50', '#33608c', '#5b5b66']
export function fnv1a(seed: string): number { let h = 0x811c9dc5; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h }
/** A stable, name-seeded human: what Lite draws for everyone and Normal draws before a config has arrived. */
export function defaultChibi(seed: string): ChibiConfig {
  const h = fnv1a(seed)
  return { kind: 'human', body: h & 1 ? 'female' : 'male', skin: SKINS[(h >>> 1) % SKINS.length]!, hairColor: HAIRS[(h >>> 4) % HAIRS.length]!, eyeColor: EYES[(h >>> 7) % EYES.length]!, face: { ...DEFAULT_FACE }, items: { ...DEFAULT_ITEMS } }
}
```
(`hair_short` is the visible default in the sprite; `items.json`'s `hair_none` stays the catalogue default for `isDefault` purposes — note this in `docs/avatar-2d.md`: `hair_none` draws nothing.)

```ts
// bot.ts
import { fnv1a } from './defaults.js'
import type { BotChibi } from './types.js'
export const BOT_COUNT = 8
export const botFaceIndex = (seed: string): number => fnv1a(seed) % BOT_COUNT
export const botChibi = (seed: string): BotChibi => ({ kind: 'bot', index: botFaceIndex(seed) })
```

```ts
// resolve.ts
import { hasSymbol } from './manifest.js'
import { CHIBI_LAYERS, type ChibiItem, type ChibiPart, type ChibiSubject, type Expression } from './types.js'

export interface ResolvedChibi { hash: string; subject: ChibiSubject; vars: Record<string, string>; static: ChibiPart[]; eyeStyle: string; mouthStyle: string; browStyle: string }
const FALLBACK = { eyes: 'eyes_basic_1', mouth: 'mouth_smile_soft', brows: 'brows_soft' }
const need = (id: string): string => { if (!hasSymbol(id)) throw new Error(`sprite: missing symbol ${id}`); return id }
const firstOf = (candidates: string[]): string => { for (const c of candidates) if (hasSymbol(c)) return c; throw new Error(`sprite: missing symbol ${candidates[0]}`) }

function itemParts(item: ChibiItem, body: 'male' | 'female'): ChibiPart[] {
  const suffix = item.bodies === 'any' ? '' : `/${body}`
  return item.parts.map((p) => ({ layer: p.layer, symbol: need(p.symbol + suffix) }))
}

export function hashChibi(subject: ChibiSubject): string {
  const canonical = subject.kind === 'bot' ? `bot:${subject.index}` : JSON.stringify({ b: subject.body, s: subject.skin, h: subject.hairColor, e: subject.eyeColor, f: subject.face, c: subject.colors ?? {}, i: Object.fromEntries(Object.entries(subject.items).map(([k, v]) => [k, v?.id])) })
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < canonical.length; i++) { const c = canonical.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x2c1b3c6d) >>> 0 }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export function resolveChibi(subject: ChibiSubject): ResolvedChibi {
  if (subject.kind === 'bot') {
    const n = subject.index
    return { hash: hashChibi(subject), subject, vars: {}, static: [{ layer: 'body', symbol: need(`bot/bot_${n}/body`) }, { layer: 'faceBase', symbol: need(`bot/bot_${n}/face`) }], eyeStyle: `bot_${n}`, mouthStyle: 'bot', browStyle: 'bot' }
  }
  const vars: Record<string, string> = { '--skin': subject.skin, '--hair': subject.hairColor, '--eye': subject.eyeColor }
  for (const slot of ['top', 'bottom', 'shoes', 'hat'] as const) {
    const colour = subject.colors?.[slot]
    if (colour !== undefined && subject.items[slot]?.colorable === true) vars[`--c-${slot}`] = colour
  }
  const statics: ChibiPart[] = [{ layer: 'body', symbol: need(`body/${subject.body}`) }, { layer: 'faceBase', symbol: need(`face/${subject.face.shape}`) }, { layer: 'nose', symbol: need(`nose/${subject.face.nose}`) }]
  if (subject.face.blush) statics.push({ layer: 'faceMarks', symbol: need(`marks/${subject.face.blush}`) })
  if (subject.face.marks) statics.push({ layer: 'faceMarks', symbol: need(`marks/${subject.face.marks}`) })
  for (const item of Object.values(subject.items)) if (item) statics.push(...itemParts(item, subject.body))
  return { hash: hashChibi(subject), subject, vars, static: statics, eyeStyle: subject.face.eyeStyle, mouthStyle: subject.face.mouth, browStyle: subject.face.brows }
}

export function partsFor(resolved: ResolvedChibi, expression: Expression, blink = false): ChibiPart[] {
  const eyes = blink || expression === 'closed' || expression === 'sleep' ? `eyes/_shared/${expression === 'sleep' ? 'sleep' : 'closed'}`
    : expression === 'happy' || expression === 'sad' ? `eyes/_shared/${expression}`
    : firstOf([`eyes/${resolved.eyeStyle}/${expression === 'surprised' ? 'surprised' : 'open'}`, `eyes/${FALLBACK.eyes}/${expression === 'surprised' ? 'surprised' : 'open'}`])
  const mouth = expression === 'neutral' || expression === 'happy' ? firstOf([`mouth/${resolved.mouthStyle}/${expression}`, `mouth/${FALLBACK.mouth}/${expression}`]) : `mouth/_shared/${expression}`
  const brows = expression === 'neutral' || expression === 'closed' || expression === 'sleep' ? firstOf([`brows/${resolved.browStyle}/neutral`, `brows/${FALLBACK.brows}/neutral`]) : `brows/_shared/${expression}`
  const parts: ChibiPart[] = [...resolved.static, { layer: 'eyes', symbol: need(eyes) }, { layer: 'mouth', symbol: need(mouth) }]
  if (resolved.subject.kind === 'human') parts.push({ layer: 'brows', symbol: need(brows) })
  return parts.sort((a, b) => CHIBI_LAYERS.indexOf(a.layer) - CHIBI_LAYERS.indexOf(b.layer))
}
```

- [ ] **Step 6: Draw the rig and the five items.** Follow the sprite contract. Exact geometry to start from (tune by eye in the playground, keep the anchors):
  - `body/male.svg` (`data-layer="body"`, viewBox `40 168 176 152`): torso `rect x=88 y=176 w=80 h=96 rx=22`; arms `ellipse cx=76 cy=214 rx=14 ry=36` and `cx=180`; legs `rect x=98 y=248 w=26 h=48 rx=12` and `x=132`; hands `circle r=12` at (76,252)/(180,252); all `fill="var(--skin,#e0ac81)"`, stroke `#1a1f2e` 3. `body/female.svg`: torso `x=92 w=72`, waist curve via path, arms `rx=12`.
  - `face/shape_round.svg` (`faceBase`, viewBox `40 20 176 168`): `ellipse cx=128 cy=104 rx=84 ry=78 fill="var(--skin,#e0ac81)"` + shade path on the left third + ears `circle r=12` at (46,110)/(210,110).
  - `eyes/eyes_basic_1.svg`: `eyes/eyes_basic_1/open` (`eyes`, viewBox `78 84 100 44`): whites `ellipse cx=104 cy=108 rx=16 ry=19` / `cx=152`, iris `circle r=9 fill="var(--eye,#3b2415)"`, pupil `r=4 #0b1020`, highlight `r=2.5 #fff`; `/surprised`: `ry=24`, iris `r=7`. `eyes/_shared.svg`: `closed` two arcs `path d="M88 110 q16 -10 32 0"` stroke 3; `happy` two upward arcs; `sad` arcs tilted outwards; `sleep` = closed + text-free "z" drawn as two small paths near (176,72).
  - `mouth/mouth_smile_soft.svg`: `/neutral` small arc `M114 142 q14 10 28 0`; `/happy` wide open smile path with `#8b2f3a` fill. `mouth/_shared.svg`: `sad` inverted arc, `surprised` `ellipse cx=128 cy=146 rx=10 ry=13 fill=#8b2f3a`, `closed` short line, `sleep` small `ellipse rx=6 ry=4`.
  - `brows/brows_soft.svg`: `/neutral` two gentle arcs above eyes at y≈82; `brows/_shared.svg`: `happy` raised, `sad` inner ends up, `surprised` high arcs.
  - `nose/nose_dot.svg` (`nose`): `circle cx=128 cy=126 r=3 fill=rgba(0,0,0,.25)`.
  - `hair/hair_short.svg`: `hair/hair_short/front` (`hairFront`, viewBox `40 20 176 96`): cap path over the top of the head ending at y≈84 with a fringe notch, `fill="var(--hair,#2b2b2b)"`.
  - `top/top_tee.svg`: `top/top_tee/male` and `/female` (`top`, viewBox `56 168 144 110`): T shape covering the torso and upper arms, `fill="var(--c-top,#f2f2f2)"`, collar line.
  - `bottom/bottom_jeans.svg`: `/male`, `/female` (`bottom`, viewBox `88 240 80 48`): two trouser tubes over the legs down to y=288, `fill="var(--c-bottom,#3b5b8c)"`, seam lines.
  - `shoes/shoes_sneakers.svg` (`shoes`, viewBox `86 276 84 40`): two rounded shoes at y 284–308, `fill="var(--c-shoes,#f5f5f5)"`, sole `#1a1f2e`.
  - `accessory/accessory_conical_hat.svg`: `accessory/accessory_conical_hat` (`hat`, viewBox `30 8 196 96`) — a wide flat cone over the head, `#e8d9a8` with straw lines.
  - `bot/bot_0.svg`: `bot/bot_0/body` (`body`): boxy torso `#26314f` with teal `#3f938a` trims; `bot/bot_0/face` (`faceBase`): rounded square head `#26314f` stroke teal, antenna; `eyes/bot_0/open` two teal `circle r=6`, `/surprised` `r=9`; `mouth/bot/neutral` `rect w=16 h=3 rx=1.5`, `/happy` short arc.
  Run `pnpm --filter @bp/ui-kit sprite`; commit the generated files.

- [ ] **Step 7: Sprite invariants test.** `sprite.test.ts`:

```ts
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FACE, DEFAULT_ITEMS } from './defaults.js'
import { MANIFEST } from './manifest.js'
import { SPRITE_SVG } from './sprite.generated.js'
import { CHIBI_LAYERS } from './types.js'

describe('the sprite', () => {
  it('stays inside its budget', () => {
    expect(Buffer.byteLength(SPRITE_SVG)).toBeLessThanOrEqual(160 * 1024)
    expect(gzipSync(SPRITE_SVG).byteLength).toBeLessThanOrEqual(45 * 1024)
  })
  it('names a known layer on every symbol and carries every shared expression piece', () => {
    for (const [id, info] of Object.entries(MANIFEST)) expect([...CHIBI_LAYERS, 'none'], id).toContain(info.layer)
    for (const s of ['closed', 'happy', 'sad', 'sleep']) expect(MANIFEST[`eyes/_shared/${s}`]).toBeDefined()
    for (const s of ['sad', 'surprised', 'closed', 'sleep']) expect(MANIFEST[`mouth/_shared/${s}`]).toBeDefined()
    for (const s of ['happy', 'sad', 'surprised']) expect(MANIFEST[`brows/_shared/${s}`]).toBeDefined()
  })
  it('holds the default face and the four default items for both bodies', () => {
    expect(MANIFEST[`face/${DEFAULT_FACE.shape}`]).toBeDefined()
    expect(MANIFEST[`eyes/${DEFAULT_FACE.eyeStyle}/open`]).toBeDefined()
    expect(MANIFEST[`mouth/${DEFAULT_FACE.mouth}/neutral`]).toBeDefined()
    for (const item of Object.values(DEFAULT_ITEMS)) for (const p of item.parts) {
      if (item.bodies === 'any') expect(MANIFEST[p.symbol], p.symbol).toBeDefined()
      else for (const b of item.bodies) expect(MANIFEST[`${p.symbol}/${b}`], `${p.symbol}/${b}`).toBeDefined()
    }
  })
  it('uses colours only through the seven variables', () => {
    const vars = new Set([...SPRITE_SVG.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]))
    for (const v of vars) expect(['--skin', '--hair', '--eye', '--c-top', '--c-bottom', '--c-shoes', '--c-hat']).toContain(v)
  })
})
```
Run → PASS after Step 6 (fix drawings until it does).

- [ ] **Step 8: The component.** `Chibi.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { cx } from '../primitives/cx.js'
import { symbolInfo } from './manifest.js'
import { partsFor, resolveChibi } from './resolve.js'
import type { ChibiBody, ChibiFrame, ChibiItem, ChibiSubject, Expression } from './types.js'
import s from './avatar2d.module.css'

const FRAMES: Record<ChibiFrame, string> = { full: '0 0 256 320', head: '36 20 184 184', part: '0 0 256 320' }

/** Blink: closed for 120 ms every 3–6 s. Off under reduced motion and when `animate` is false. */
function useBlink(enabled: boolean): boolean {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!enabled || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    let open: ReturnType<typeof setTimeout> | null = null
    let shut: ReturnType<typeof setTimeout> | null = null
    const schedule = (): void => {
      shut = setTimeout(() => { setClosed(true); open = setTimeout(() => { setClosed(false); schedule() }, 120) }, 3000 + Math.random() * 3000)
    }
    schedule()
    return () => { if (shut) clearTimeout(shut); if (open) clearTimeout(open) }
  }, [enabled])
  return closed
}

export interface ChibiProps { subject: ChibiSubject; expression?: Expression; frame?: ChibiFrame; size?: number; label?: string; className?: string; animate?: boolean; bounce?: boolean }

export function Chibi({ subject, expression = 'neutral', frame = 'full', size, label, className, animate = true, bounce = false }: ChibiProps) {
  const resolved = useMemo(() => resolveChibi(subject), [subject])
  const blink = useBlink(animate && expression !== 'closed' && expression !== 'sleep')
  const parts = useMemo(() => partsFor(resolved, expression, blink), [resolved, expression, blink])
  const naming = label === undefined ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label }
  const box = FRAMES[frame]
  const ratio = frame === 'head' ? 1 : 320 / 256
  return (
    <svg
      className={cx(s.chibi, bounce && s.bounce, className)}
      viewBox={box}
      width={size}
      height={size === undefined ? undefined : Math.round(size * ratio)}
      style={resolved.vars as React.CSSProperties}
      data-chibi-hash={resolved.hash}
      data-expression={expression}
      data-frame={frame}
      {...naming}
    >
      {parts.map((p) => <use key={`${p.layer}:${p.symbol}`} href={`#${p.symbol}`} data-layer={p.layer} />)}
    </svg>
  )
}

/** One item on a neutral mannequin, cropped to the item's own box — the wardrobe and inventory tiles. */
export function ChibiPartPreview({ item, body, size = 64, className }: { item: ChibiItem; body: ChibiBody; size?: number; className?: string }) {
  const suffix = item.bodies === 'any' ? '' : `/${body}`
  const boxes = item.parts.map((p) => symbolInfo(p.symbol + suffix).viewBox.split(' ').map(Number))
  const x = Math.min(...boxes.map((b) => b[0]!)), y = Math.min(...boxes.map((b) => b[1]!))
  const x2 = Math.max(...boxes.map((b) => b[0]! + b[2]!)), y2 = Math.max(...boxes.map((b) => b[1]! + b[3]!))
  const pad = 8
  return (
    <svg className={cx(s.part, className)} viewBox={`${x - pad} ${y - pad} ${x2 - x + 2 * pad} ${y2 - y + 2 * pad}`} width={size} height={size} aria-hidden="true" data-item={item.id}>
      <use href={`#body/${body}`} className={s.mannequin} />
      <use href="#face/shape_round" className={s.mannequin} />
      {item.parts.map((p) => <use key={p.symbol} href={`#${p.symbol}${suffix}`} />)}
    </svg>
  )
}
```
`avatar2d.module.css`: `.chibi { display:block; overflow:visible }`, `.bounce { animation: bounce .5s ease-out }`, `@keyframes bounce { 30% { transform: translateY(-6%) } }`, `.part { display:block }`, `.mannequin { opacity:.28; filter: grayscale(1) }`, and `@media (prefers-reduced-motion: reduce) { .bounce { animation: none } }`.

`AvatarSprite.tsx`:
```tsx
import { useLayoutEffect } from 'react'
import { SPRITE_SVG } from './sprite.generated.js'
export const SPRITE_ELEMENT_ID = 'bp-avatar-sprite'
/** Puts the sprite in the document once; every <Chibi> on the page uses it by id. Safe to mount twice. */
export function AvatarSprite(): null {
  useLayoutEffect(() => {
    if (document.getElementById(SPRITE_ELEMENT_ID)) return
    const host = document.createElement('div')
    host.id = SPRITE_ELEMENT_ID
    host.innerHTML = SPRITE_SVG
    document.body.prepend(host)
  }, [])
  return null
}
```
`Chibi.test.tsx`: renders `<Chibi subject={defaultChibi('Ann')} size={40} frame="head" />` and asserts `data-chibi-hash` equals `hashChibi(...)`, `viewBox` is `36 20 184 184`, one `<use>` per layer present, `data-expression`; `expression="closed"` uses `#eyes/_shared/closed`; `label` gives `role="img"`; `ChibiPartPreview` for `DEFAULT_ITEMS.top` has `data-item="top_tee"` and a `use` ending in `/male`; `AvatarSprite` mounted twice leaves one `#bp-avatar-sprite`. Run → PASS.

- [ ] **Step 9: Barrel and playground.** `avatar2d/index.ts` exports types, `MANIFEST/hasSymbol`, `resolveChibi/partsFor/hashChibi`, `Chibi/ChibiPartPreview`, `AvatarSprite`, `DEFAULT_FACE/DEFAULT_ITEMS/defaultChibi`, `botFaceIndex/botChibi/BOT_COUNT`, `SPRITE_SHA`. Add `export * from './avatar2d/index.js'` to `src/index.ts`. Playground: `playground/avatar2d.tsx` renders `<AvatarSprite/>` then a grid: for each body × each item in `DEFAULT_ITEMS` plus the conical hat, `<Chibi frame="full" size={128}>`; a row of the six expressions at 96 px; heads at 40/32/24 px; the bot; a `ChibiPartPreview` strip. Wire in `playground/main.tsx`: when `location.hash === '#avatar2d'` render that page instead of the lobby/room (keep the existing behaviour otherwise). Run `pnpm --filter @bp/ui-kit playground`, open `http://localhost:5175/#avatar2d` in the Browser pane, screenshot to `docs/avatar-2d-sheet.png` (overwritten in T7 by the script).

- [ ] **Step 10:** `pnpm --filter @bp/ui-kit test`, `pnpm lint`, `pnpm typecheck`. Commit: `feat(ui-kit): chibi 2D rig, sprite tooling and Chibi component (five items, one bot)`.

**Gate:** the controller shows the user the playground screenshot and waits for "duyệt" before dispatching Task 2. Style feedback becomes edits to the five files, re-run of `sprite`, re-review.

---

### Task 2: The whole sprite — every item, the free face parts, the collectibles, eight bots, six expressions

**Files:**
- Create: sprite sources under `packages/ui-kit/src/avatar2d/sprite/src/` for every id listed below; `packages/ui-kit/src/avatar2d/catalog-fixture.ts` (the client-side mirror of the catalogue used by tests and the playground)
- Modify: `packages/ui-kit/playground/avatar2d.tsx` (iterate the fixture), `packages/ui-kit/src/avatar2d/sprite.test.ts` (every fixture item and every face id present, for both bodies where declared)
- Test: `sprite.test.ts`, `resolve.test.ts` (extend: every fixture item resolves on both bodies for every expression)

**Interfaces:**
- Produces `CATALOG_FIXTURE: readonly ChibiItem[]` (57 wardrobe items) and `FACE_FIXTURE: { shapes: string[]; eyes: string[]; brows: string[]; noses: string[]; mouths: string[]; marks: string[]; collectibleEyes: string[]; collectibleMouths: string[] }` — Task 3 copies these ids into `items.json`/`faces.json` and a test in Task 3 asserts the server data and this fixture agree.

**What to draw** (symbol ids; layer in parentheses; `[m/f]` = two body variants, otherwise one shared piece):
- Bodies: `body/male`, `body/female` (done in T1).
- Face shapes (`faceBase`): `face/shape_round` (T1), `face/shape_oval`, `face/shape_square`, `face/shape_heart`, `face/shape_long`.
- Marks (`faceMarks`): `marks/blush_soft`, `marks/blush_strong`, `marks/freckles`, `marks/mole_left`, `marks/mole_right`.
- Noses (`nose`): `nose/nose_dot` (T1), `nose/nose_small`, `nose/nose_button`, `nose/nose_line`, `nose/nose_none` (empty group, still a symbol).
- Basic eyes (`eyes`, states `open`+`surprised`): `eyes_basic_1` (T1) … `eyes_basic_5` (round, almond, droopy-kind, wide-sparkle, narrow-cool). Collectible eyes (same two states): `eyes_star` (star irises), `eyes_money` (¥ shapes drawn as paths, no text), `eyes_heart`, `eyes_sleepy_cool` (half-lidded), `eyes_wink` (one closed).
- Basic mouths (`mouth`, states `neutral`+`happy`): `mouth_smile_soft` (T1), `mouth_line`, `mouth_small`, `mouth_wide`, `mouth_pout`. Collectible: `mouth_cat` (ω), `mouth_fang`, `mouth_tongue`, `mouth_grin_gold` (a gold tooth `#d9a441`), `mouth_lollipop` (stick + disc `#c95c5c`).
- Brows (`brows`, state `neutral`): `brows_soft` (T1), `brows_straight`, `brows_arched`, `brows_thick`, `brows_thin`.
- Hair: `hair_none` (empty symbol `hair/hair_none/front`), `hair_short` (T1), `hair_curly` (front only, cloud silhouette), `hair_ponytail` (`/back` tail on the right + `/front`), `hair_long` (`/back` down to y≈230 + `/front`), `hair_bun` (`/back` bun above the head + `/front`), `hair_mohawk` (front only, tall centre strip).
- Tops [m/f]: `top_tee` (T1), `clothing_hoodie` (hood behind neck as part of the top), `clothing_polo`, `clothing_aodai` (long tunic to y≈290, fixed colours `#c95c5c`/`#f2e6c8`, `colorable:false`), `clothing_suit` (jacket + lapels, fixed `#1f2433`), `clothing_kimono` (fixed `#7b3fbf`, obi `#d9a441`), `jacket_champion` (gold jacket `#d9a441` with red trim, fixed), new `top_hoodie_zip`, `top_dress_summer` (dress to y≈270, covers bottom; colorable), `top_tuxedo` (fixed).
- Bottoms [m/f]: `bottom_jeans` (T1), `bottom_shorts`, `bottom_trousers`, `bottom_skirt`, new `bottom_pleated`.
- Shoes: `shoes_sneakers` (T1), `shoes_sandals`, `shoes_boots` (to y≈270), new `shoes_heels`, `shoes_loafers`.
- Hats (`hat`): `hat_crown` (gold, fixed), new `hat_beanie` (colorable, `clip` = simply drawn over the hair), `hat_cap`, `hat_beret`, `hat_party` (cone with pompom).
- Accessories: `accessory_headband` (`accessoryUnder`), `accessory_conical_hat` (`hat`, T1), `accessory_glasses` (`accessoryOver`), `accessory_mask` (`accessoryOver`), `accessory_sunglasses` (`accessoryOver`), new `accessory_eyepatch` (`accessoryOver`), `accessory_monocle` (`accessoryOver`).
- Jewelry (`jewelry`): `jewelry_stud` (two dots at the ears), `jewelry_ring` (on the right hand), `jewelry_chain`, `jewelry_pendant`, `ring_royal` (gold ring with red stone), new `jewelry_hoops`.
- Titles/badges: no drawing (text beside the name, unchanged).
- Bots: `bot_0` (T1) … `bot_7`: heads round/square/hex/dome × two, hues `#3f938a #d9a441 #c95c5c #7b6fd6 #5aa564 #4f8fd9 #e07b39 #d46aa3`, eyes `eyes/bot_<n>/{open,surprised}`; mouth `mouth/bot/{neutral,happy}` drawn once (T1).

- [ ] **Step 1: Write the fixture first** (`catalog-fixture.ts`) with every item id, slot, parts, bodies and `colorable` exactly as `items.json` will declare them (T3 copies from here). Extend `sprite.test.ts` with:
```ts
it('holds every fixture item for every body it declares, and every face id', () => {
  for (const item of CATALOG_FIXTURE) for (const p of item.parts) {
    const bodies = item.bodies === 'any' ? [''] : item.bodies.map((b) => `/${b}`)
    for (const b of bodies) expect(MANIFEST[p.symbol + b], `${item.id} ${p.symbol}${b}`).toBeDefined()
  }
  for (const id of FACE_FIXTURE.shapes) expect(MANIFEST[`face/${id}`]).toBeDefined()
  for (const id of [...FACE_FIXTURE.eyes, ...FACE_FIXTURE.collectibleEyes]) for (const st of ['open', 'surprised']) expect(MANIFEST[`eyes/${id}/${st}`], `${id}/${st}`).toBeDefined()
  for (const id of [...FACE_FIXTURE.mouths, ...FACE_FIXTURE.collectibleMouths]) for (const st of ['neutral', 'happy']) expect(MANIFEST[`mouth/${id}/${st}`], `${id}/${st}`).toBeDefined()
  for (const id of FACE_FIXTURE.brows) expect(MANIFEST[`brows/${id}/neutral`]).toBeDefined()
  for (const id of FACE_FIXTURE.noses) expect(MANIFEST[`nose/${id}`]).toBeDefined()
  for (const id of FACE_FIXTURE.marks) expect(MANIFEST[`marks/${id}`]).toBeDefined()
  for (let n = 0; n < BOT_COUNT; n++) for (const p of ['body', 'face']) expect(MANIFEST[`bot/bot_${n}/${p}`]).toBeDefined()
})
```
and extend `resolve.test.ts` to resolve every fixture item on both bodies for every expression without throwing. Run → FAIL (symbols missing).

- [ ] **Step 2: Draw**, in this order, running `pnpm --filter @bp/ui-kit sprite && pnpm --filter @bp/ui-kit exec vitest run src/avatar2d` after each group and eyeballing the playground: faces (shapes, marks, noses), eyes, mouths, brows, hair, tops, bottoms, shoes, hats, accessories, jewelry, bots. Keep every file under 6 KB; reuse shapes by copying paths, never by `<use>` inside a symbol.

- [ ] **Step 3: Contact sheet.** Update the playground page to iterate `CATALOG_FIXTURE` (both bodies, grouped by slot), the face groups, the six expressions on three bodies, and the eight bots. Screenshot the whole page to `docs/avatar-2d-sheet.png` (temporary; T7 automates).

- [ ] **Step 4:** `pnpm --filter @bp/ui-kit test`, `pnpm lint`, `pnpm typecheck`, budget check passes. Commit: `feat(ui-kit): the full chibi sprite — 57 wardrobe items, 30 face parts, 10 collectibles, 8 bots`.

---

### Task 3: Server — config v3, faces, collectible slots, sprite catalogue, palettes

**Files:**
- Create: `apps/normal-server/src/inventory/faces.ts`, `faces.test.ts`, `sprite-manifest.ts`, `sprite-manifest.test.ts`, `apps/normal-server/data/faces.json`
- Modify: `apps/normal-server/src/inventory/slots.ts`, `items.ts` (+`items.test.ts`), `avatar.ts` (+`avatar.test.ts`, `avatar-migrate.ts` + test), `apps/normal-server/data/items.json`, `data/palettes.json`, `src/http/routes-catalog.ts` (+test), `src/http/routes-me.ts` (validate signature), `src/app.ts` (wire faces), `src/app.test.ts` (public route list), `src/inventory/grant-wardrobe.ts` (unchanged behaviour — collectibles are catalogue items, granted too), `src/economy/*` daily random pick (the exclusion test: collectibles allowed), `src/achievements` (no change unless a new reward is added: add `achievements.json` entries `face_collector_5` → nothing; **decision:** no new achievements in this plan; collectibles arrive through daily random draws by rarity — 6 common, 3 rare, 1 epic (`mouth_grin_gold`)).
- Test: listed.

**Interfaces:**
```ts
// slots.ts
export type ItemSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'jewelry' | 'eyeStyle' | 'mouth' | 'title' | 'badge'
export const OPTIONAL_SLOTS = ['hat', 'accessory', 'jewelry', 'eyeStyle', 'mouth', 'title', 'badge'] as const
export const DRAWN_SLOTS: readonly ItemSlot[]   // all but title/badge (rename of GEOMETRIC_SLOTS; keep isGeometricSlot as alias)
// items.ts
export type SpriteLayer = 'hairBack' | 'body' | 'shoes' | 'bottom' | 'top' | 'jewelry' | 'faceBase' | 'faceMarks' | 'nose' | 'mouth' | 'eyes' | 'brows' | 'accessoryUnder' | 'hairFront' | 'hat' | 'accessoryOver'
export interface SpriteRef { parts: { layer: SpriteLayer; symbol: string }[]; bodies: 'any' | Body[]; colorable: boolean }
export interface ItemDef { id; slot; rarity; nameKey; assetKey; isDefault; sprite?: SpriteRef }   // `variants` removed
export function loadItemCatalog(path?: string, manifest?: SpriteManifest): ItemCatalog
// sprite-manifest.ts
export interface SpriteManifest { sha256: string; symbols: Record<string, { layer: string; viewBox: string }> }
export function loadSpriteManifest(path?: string): SpriteManifest   // data/sprite.manifest.json
// faces.ts
export interface FaceCatalog { shapes: string[]; eyes: string[]; brows: string[]; noses: string[]; mouths: string[]; marks: string[]; has(group: keyof Omit<FaceCatalog,'has'>, id: string): boolean }
export function loadFaceCatalog(path?: string, manifest?: SpriteManifest): FaceCatalog   // data/faces.json, every id must exist in the manifest
// avatar.ts
export const AVATAR_CONFIG_VERSION = 3
export interface AvatarConfigV3 { v: 3; body; skin; eyeColor; hairColor; face: { shape; eyeStyle; brows; nose; mouth; blush?; marks? }; colors?: { top?; bottom?; shoes?; hat? }; hair; top; bottom; shoes; hat?; accessory?; jewelry?; eyeStyleItem?; mouthItem?; title?; badge? }
export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'INVALID_COLOR' | 'MISSING_LAYER' | 'INVALID_FACE' | 'NOT_COLORABLE'
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog, faces: FaceCatalog): AvatarValidation
export function readAvatarConfig(raw: unknown, catalog: ItemCatalog, faces: FaceCatalog): AvatarConfigV3   // v1/v2/v3 in, v3 out
export function defaultAvatar(catalog: ItemCatalog): AvatarConfigV3
export function itemIdsOf(config: AvatarConfigV3): string[]   // includes eyeStyleItem/mouthItem
```
**Design note on collectible faces.** `face.eyeStyle` / `face.mouth` hold the *symbol style id* (`eyes_star`); ownership is expressed by the item with the same id in slot `eyeStyle` / `mouth`. Validation: if `face.eyeStyle` is in `faces.eyes` it is free; else it must be a catalogue item of slot `eyeStyle` with `id === face.eyeStyle`, and the player must own it (`applyAvatarConfig` → `missingOf` over `itemIdsOf`, which appends such ids). The DTO exposes only `face.eyeStyle`; `eyeStyleItem`/`mouthItem` are not stored — drop them from the interface above: `itemIdsOf` derives them (`faces.has('eyes', id) ? [] : [id]`). Pass `faces` to `itemIdsOf(config, faces)`.

- [ ] **Step 1: Manifest + faces loaders with tests.** `sprite-manifest.test.ts`: loads `data/sprite.manifest.json`, asserts it deep-equals `packages/ui-kit/src/avatar2d/sprite.manifest.json` (read relative to the repo root; skip with a warning when the ui-kit file is absent, i.e. inside the image). `faces.test.ts`: `loadFaceCatalog` returns the six groups; throws naming the id when a face id has no symbol (use a temp JSON); `has('eyes','eyes_basic_1') === true`, `has('eyes','eyes_star') === false`. Write `data/faces.json` exactly as spec §5.2. Implement both loaders (`packageRoot()` for default paths, same `fail(path, msg)` style as `items.ts`).

- [ ] **Step 2: Catalogue.** Tests in `items.test.ts`: a temp catalogue with `sprite.parts[0].symbol` missing from the manifest fails naming the item; an item with `bodies: ['male','female']` whose `/female` symbol is missing fails; `variants` present → fail (`variants is gone; use sprite`); slot `eyeStyle` item must have parts on layer `eyes`... (keep simple: parts' `layer` must equal the manifest layer of the symbol, else fail). Rewrite `data/items.json`: every existing id keeps `id/slot/rarity/nameKey/assetKey/isDefault`, `variants` → `sprite` copied from `CATALOG_FIXTURE` (T2); add the 15 new items and 10 collectibles (`eyes_*` slot `eyeStyle`, `mouth_*` slot `mouth`; rarities: commons `eyes_wink, eyes_sleepy_cool, mouth_cat, mouth_tongue, top_hoodie_zip, bottom_pleated, shoes_loafers, hat_beanie, hat_cap, jewelry_hoops`; rares `eyes_star, eyes_heart, mouth_fang, mouth_lollipop, top_dress_summer, shoes_heels, hat_beret, hat_party, accessory_eyepatch, accessory_monocle, title_dealer`; epics `eyes_money, mouth_grin_gold, top_tuxedo, badge_founder`). `badge_founder`/`title_dealer` join the achievement-reserved exclusion? No — they are plain rares/epics drawable by daily; **but** §13.2 forbids random draws of `title`/`badge` categories anyway, so they are unreachable until a future achievement names them: add `title_dealer` as the reward of a **new** achievement `holdem_hands_1000` (metric `holdem_hands`, threshold 1000, category `volume`) and `badge_founder` as the reward of `login_days_365`; extend `data/achievements.json` (34 rows) and its test count. `loadItemCatalog(path, manifest = loadSpriteManifest())`.

- [ ] **Step 3: Config v3.** `avatar.test.ts` additions: v2 reads up to v3 with `DEFAULT_FACE` and `eyeColor = eyes`; v1 still reads (through v2); `face.eyeStyle: 'eyes_star'` without owning → `applyAvatarConfig` throws `ServiceError('ITEM_NOT_OWNED')` naming `eyes_star`; owning → accepted; `face.shape: 'nope'` → `INVALID_FACE`; `colors.top` on `clothing_aodai` → `NOT_COLORABLE`; `colors.top: '#zz'` → `INVALID_COLOR`; `colors.top` must be in `PALETTES.cloth`. Implement: `PALETTES.hair` (8) and `PALETTES.cloth` (12: `#f2f2f2 #1f2433 #c95c5c #d9a441 #3f938a #33608c #7b3fbf #5aa564 #e07b39 #d46aa3 #8a563a #3b5b8c`) in `palettes.json`; `hairColor` keeps free hex (unchanged). `readAvatarConfig` chain: `migrateV1toV2` (exists) → `migrateV2toV3`.

- [ ] **Step 4: Routes.** `routes-catalog.ts`: `GET /api/catalog/faces` → `{ shapes, eyes, brows, noses, mouths, marks, palettes: { skin, eyes, hair, cloth } }` (public, like items). `routes-me.ts`: pass `deps.faces` into `validateAvatarConfig`; `GET /api/me/inventory` and `/api/players/:id/avatar` return v3. `app.ts`: `const faces = loadFaceCatalog(undefined, manifest)` beside the catalogue; add to `deps`. `app.test.ts` public-route enumeration: add `/api/catalog/faces`. `routes-catalog.test.ts`: the faces route lists `eyes_basic_1` and not `eyes_star`.

- [ ] **Step 5:** Economy daily test: a random common draw may return `eyes_wink` (add to the exclusion test's allowed set). `grant-wardrobe.test.ts`: total is now 67 (`catalog.all().length` — the test reads it, no literal). `pnpm --filter @bp/normal-server test`, `pnpm lint`, `pnpm typecheck`. Commit: `feat(normal-server): avatar config v3 with faces, collectible eye and mouth styles, and a sprite catalogue`.

---

### Task 4: Server — outfits

**Files:**
- Create: `apps/normal-server/drizzle/0002_outfits.sql`, `src/inventory/outfits-service.ts`, `outfits-service.test.ts`, `src/http/routes-outfits.ts`, `routes-outfits.test.ts`
- Modify: `src/db/schema.ts`, `src/http/routes.ts` (register), `src/app.ts` (wire), `src/app.test.ts` (authed routes list), `docs/normal-server.md` (module map)

**Interfaces:**
```ts
// schema.ts
export const avatarOutfits = pgTable('avatar_outfits', { playerId: uuid fk cascade, slot: smallint notNull, name: varchar(24) notNull, config: jsonb notNull, updatedAt: timestamp tz notNull defaultNow }, (t) => [primaryKey({ columns: [t.playerId, t.slot] }), check('avatar_outfits_slot_range', sql`${t.slot} BETWEEN 1 AND 5`)])
// outfits-service.ts
export interface OutfitView { slot: number; name: string; config: AvatarConfigV3; updatedAt: number }
export interface OutfitsService {
  list(playerId: string): Promise<(OutfitView | null)[]>            // length 5, index = slot-1
  save(playerId: string, slot: number, name: string, config: AvatarConfigV3): Promise<OutfitView>   // validates ownership via inventory.missingOf → ServiceError('ITEM_NOT_OWNED')
  remove(playerId: string, slot: number): Promise<boolean>
  apply(playerId: string, slot: number): Promise<AvatarView>         // re-checks ownership, then applyAvatarConfig; ServiceError('NOT_FOUND') when empty
}
export function createOutfitsService(db: AppDb, inventory: InventoryService, catalog: ItemCatalog, faces: FaceCatalog): OutfitsService
// routes-outfits.ts (all `authed`)
GET    /api/me/outfits                → { outfits: (OutfitView|null)[] }
PUT    /api/me/outfits/:slot          body { name: string; config: AvatarConfigDto } → OutfitView   (400 INVALID_SLOT | INVALID_NAME (empty or > 24) | avatar codes; 403 ITEM_NOT_OWNED)
DELETE /api/me/outfits/:slot          → { removed: boolean }
POST   /api/me/outfits/:slot/apply    → { config: AvatarConfigDto }   (404 NOT_FOUND)
```

- [ ] **Step 1:** Migration `0002_outfits.sql` (hand-written like `0001`, plus `drizzle/meta` journal entry the way `0001` was added — copy its pattern) and schema. `schema.test.ts`: slot 6 fails the check; cascade on player delete.
- [ ] **Step 2:** `outfits-service.test.ts` (PGlite): list returns five nulls; save slot 2 → list has it at index 1; name trimmed and ≤ 24 else `ServiceError('INVALID_NAME')`; save with an unowned `hat_crown` → `ITEM_NOT_OWNED`; apply writes `players.avatar_config` and returns the view; apply on an empty slot → `NOT_FOUND`; remove → true then false.
- [ ] **Step 3:** Implement service and routes; register in `routes.ts`; `routes-outfits.test.ts` via `inject` (401 without cookie, 400 on slot 0, round-trip). Update the authed route list in `app.test.ts`.
- [ ] **Step 4:** `pnpm --filter @bp/normal-server test`, lint, typecheck. Commit: `feat(normal-server): five saved outfits per player`.

---

### Task 5: ui-kit — expressions from the hand, seats draw chibis, Lite gets them for free

**Files:**
- Create: `packages/ui-kit/src/avatar2d/expression.ts`, `expression.test.ts`
- Modify: `packages/ui-kit/src/table/Seat.tsx`, `PokerTable.tsx` (+test), `src/screens/RoomScreen.tsx` (+test), `src/screens/LobbyScreen.tsx` (mount `<AvatarSprite/>`), `src/index.ts`; delete `src/table/BotFace.tsx` + `BotFace.test.tsx` (`botFaceIndex` now from `avatar2d/bot.ts`); `apps/lite/web/src/App.tsx` (mount `<AvatarSprite/>` once at the root)
- Test: listed; `apps/normal-web/src/screens/TableChrome.test.tsx` will be updated in T6.

**Interfaces:**
```ts
// expression.ts
export interface ExpressionMemory { until: Record<number, { expression: Expression; until: number }> }   // per seat, timed overrides
export const emptyExpressionMemory: ExpressionMemory
/** Pure: folds the latest state into the memory (timed overrides start here) and returns the new memory. */
export function rememberExpressions(memory: ExpressionMemory, prev: ClientState | null, next: ClientState, now: number): ExpressionMemory
/** Pure: the expression a seat shows right now. */
export function expressionOf(memory: ExpressionMemory, seat: number, next: ClientState, now: number): Expression
/** Hook: keeps the memory, re-renders when a timed override expires. */
export function useTableExpressions(state: ClientState, serverNow: () => number): (seat: number) => Expression
// PokerTable / RoomScreen props
chibiFor?: (player: RoomPlayerView) => ChibiSubject | null   // replaces avatarFor; null → kit draws defaultChibi(displayName); bots always botChibi(playerId)
```
Rules (§3.4): `happy` 4000 ms when `hand.result.payouts` gains an entry for the seat (transition into `COMPLETE` with payout > 0); `sad` 3000 ms when the hand completes with a showdown that includes the seat and no payout; `surprised` 2000 ms when the seat's `allIn` turns true, and for **every** seat when any seat goes all-in; `closed` while `seat.folded`; `sleep` while `player.sittingOut`, `!player.connected`, or `room.status === 'OPEN' && hand === null && idle > 60000` (idle measured from the last `HAND_COMPLETE`/room entry — keep `memory.quietSince`). Priority: sleep > closed > timed override > neutral. `bounce` prop is passed to `Chibi` when `hand.actingSeat === seat && seat === hand.mySeat`.

- [ ] **Step 1:** `expression.test.ts` builds `ClientState`s with the existing `test-fixtures.ts` (`makeState`, `makeHand`, `makeSeat`, `makePlayer`) and asserts each rule and the priority order, plus expiry (`now + 4001` → neutral). Run → FAIL.
- [ ] **Step 2:** Implement; `useTableExpressions` uses `useRef` for memory, `useEffect` on `state` to fold, and a `setTimeout` to the nearest `until` to re-render.
- [ ] **Step 3:** `Seat.tsx`: replace the `avatar ?? initial` / `BotFace` content with `<Chibi subject={subject} expression={expression} frame="head" size={disc} bounce={bounce} />` where `subject` is the prop `chibi: ChibiSubject` (PokerTable computes: bot → `botChibi(playerId)`, human → `chibiFor?.(player) ?? defaultChibi(displayName)`); keep `data-face` (`bot` | `app` | `default`) for tests. The disc size stays CSS (`--seat-disc`); pass `size={undefined}` and let the svg fill (`.avatar > *` already 100 %). `PokerTable.test.tsx`: bot seat has `svg[data-chibi-hash]` with `data-face="bot"`; a human with no `chibiFor` gets `data-face="default"` and a hash equal to `hashChibi(defaultChibi('Ann'))`; `chibiFor` returning a config yields `data-face="app"`. `RoomScreen.test.tsx`: passes `chibiFor` through; the `LobbyScreen`/`RoomScreen` render `<AvatarSprite/>` (assert `#bp-avatar-sprite` exists after render).
- [ ] **Step 4:** Lite: `apps/lite/web/src/App.tsx` mounts `<AvatarSprite/>` at the root (the kit screens also mount it; both are idempotent). `apps/lite` unit tests still green; Lite e2e updated in T7.
- [ ] **Step 5:** `pnpm --filter @bp/ui-kit test`, `pnpm --filter @bp/lite test`, lint, typecheck. Commit: `feat(ui-kit): seats draw chibis with expressions driven by the hand; bots and Lite included`.

---

### Task 6: Normal web — DTOs, table, lobby bar, wardrobe, profile, inventory tiles

**Files:**
- Create: `apps/normal-web/src/avatar/chibi.ts`, `chibi.test.ts`, `src/screens/wardrobe/{WardrobeScreen.tsx,FaceTab.tsx,BodyTab.tsx,ItemTab.tsx,OutfitBar.tsx,wardrobe.module.css}` (+ tests `WardrobeScreen.test.tsx`, `OutfitBar.test.tsx`)
- Modify: `src/api.ts` (+`api.test.ts`), `src/screens/TableChrome.tsx` (+test), `src/App.tsx` (+`App.avatars.test.tsx`), `src/screens/ProfileScreen.tsx` (+test), `src/screens/InventoryScreen.tsx` (+test), `src/screens/catalog.ts` (slots, rarity tones; add `eyeStyle`/`mouth`), `src/locales/{vi,en}/normal.json` (item names for the 25 new ids, wardrobe copy, outfit copy, face group names), `src/catalog-i18n.ts`; delete `src/screens/WardrobeScreen.tsx` (moved)
- Test: listed.

**Interfaces:**
```ts
// api.ts
export interface AvatarFaceDto { shape: string; eyeStyle: string; brows: string; nose: string; mouth: string; blush?: string; marks?: string }
export interface AvatarConfigDto { v: 3; body: 'male' | 'female'; skin: string; eyeColor: string; hairColor: string; face: AvatarFaceDto; colors?: { top?: string; bottom?: string; shoes?: string; hat?: string }; hair: string; top: string; bottom: string; shoes: string; hat?: string; accessory?: string; jewelry?: string; title?: string; badge?: string }
export interface SpriteRefDto { parts: { layer: string; symbol: string }[]; bodies: 'any' | ('male' | 'female')[]; colorable: boolean }
export interface ItemDto { id; slot; rarity; nameKey; assetKey; isDefault; sprite?: SpriteRefDto }
export interface FacesDto { shapes: string[]; eyes: string[]; brows: string[]; noses: string[]; mouths: string[]; marks: string[]; palettes: { skin: string[]; eyes: string[]; hair: string[]; cloth: string[] } }
export interface OutfitDto { slot: number; name: string; config: AvatarConfigDto; updatedAt: number }
NormalApi += faces(): Promise<FacesDto>; outfits(): Promise<{ outfits: (OutfitDto | null)[] }>; saveOutfit(slot, name, config): Promise<OutfitDto>; deleteOutfit(slot): Promise<{ removed: boolean }>; applyOutfit(slot): Promise<{ config: AvatarConfigDto }>
// avatar/chibi.ts
export function chibiFromApi(config: AvatarConfigDto, items: ReadonlyMap<string, ItemDto>): ChibiConfig   // unknown item id → that slot omitted (never throws)
export function itemFromApi(item: ItemDto): ChibiItem | null   // null for title/badge/eyeStyle/mouth (not worn as ChibiItem)
```

- [ ] **Step 1: api + chibi mapper** with tests (`chibi.test.ts`: maps the four required slots and optional ones, drops unknown ids, carries colours, face passes through; `api.test.ts`: the five new calls hit the right paths/methods).
- [ ] **Step 2: Table and bar.** `TableChrome.makeChibiFor(avatars, items)` returns `(player) => player.isBot ? null : (avatars.get(player.playerId)?.avatar ? chibiFromApi(...) : null)` (the kit draws bots and defaults). `App.tsx`: lobby-bar link uses `<Chibi subject={myChibi ?? defaultChibi(name)} frame="head" size={32} label={t('avatar.mine')} />`; remove `Portrait`/`resetPortraitMemory` imports (the cache reset stays for `resetAvatarCache`). The `useAvatars` hook needs the item map: load `api.catalogItems()` once in `App` (`useAsync`), pass to `makeChibiFor`. Update `App.avatars.test.tsx` and `TableChrome.test.tsx` (bot → null; human → `ChibiConfig` with `items.top.id`).
- [ ] **Step 3: Wardrobe.** Layout per §6.3. `WardrobeScreen` loads `me`, `inventory`, `catalogItems`, `faces`, `outfits` (five `useAsync`), keeps a draft `AvatarConfigDto`, renders `<Chibi subject={chibiFromApi(draft, items)} frame="full" size={220} expression={preview} />` with an expression picker (six buttons `aria-pressed`), tabs (`role="tablist"`): Body (`BodyTab`: body toggle, skin swatches, hair colour swatches + hex input as today, eye colour), Face (`FaceTab`: six groups of `button aria-pressed` with a mini `Chibi` head preview per option; collectible eye/mouth styles listed after the free ones, locked when not owned with the hint text), one `ItemTab` per wardrobe slot (tiles = `ChibiPartPreview`, rarity `Badge`, locked state + hint from `catalog.ts`'s `hintFor(item, achievements)`: achievement name if an achievement rewards it, else `wardrobe.hint.daily.<rarity>`, else `wardrobe.hint.unavailable`), colour strip when the equipped item is colorable; Title & Badge tab as today. `OutfitBar`: five slots; each shows name + `<Chibi frame="head" size={40}>` or an empty dashed slot; buttons Apply / Save here (opens a `Modal` with a name field, default "Bộ N") / Rename / Delete; apply calls `api.applyOutfit`, then reloads `me` and the draft. Save wardrobe button → `api.setAvatar(draft)`; status line as today. Tests: tabs switch; locked tile is `aria-disabled` and cannot equip; colour strip appears only for colorable; save sends v3 payload; outfit save/apply calls with the right slot; "Bộ 1" default name.
- [ ] **Step 4: Profile and inventory.** `ProfileScreen`: replace `LazyAvatarStage` with `<div className={s.stage} data-title={config.title ?? ''}><Chibi subject frame="full" size={200} animate /></div>` — the backdrop is CSS keyed on `data-title` (five titles → five gradient/glow variants in `normal.module.css`), idle sway via `@keyframes sway 3s` on the container, a `mousemove` parallax handler translating ±6 px (disabled under reduced motion). `InventoryScreen`: tiles use `ChibiPartPreview` (wardrobe items) or a `Chibi` head with that eye/mouth style (collectibles), titles/badges as text. Tests updated.
- [ ] **Step 5: i18n.** Add `items.<id>` (vi/en) for the 25 new ids; `wardrobe.tabs.*`, `wardrobe.face.*` group names, `wardrobe.hint.*`, `wardrobe.expression.*`, `outfits.*` (title, empty, apply, save, rename, delete, defaultName "Bộ {{n}}" / "Outfit {{n}}", nameLabel). The existing i18n completeness test (both locales same keys) must pass.
- [ ] **Step 6:** `pnpm --filter @bp/normal-web test`, lint, typecheck. Commit: `feat(normal-web): chibi table, lobby bar, wardrobe with faces and outfits, profile stage`.

---

### Task 7: Remove the 3D pipeline, CSP, footprint, e2e, docs, contact sheet, deploy

**Files:**
- Delete: `apps/normal-web/src/avatar3d/` (all), `apps/normal-web/public/avatar3d/`, `apps/normal-web/scripts/avatar-assets.mjs`, `avatar-map.json`, `avatar-shots.mjs`, `apps/normal-web/test/avatar-assets.test.ts`, `apps/normal-web/e2e/avatar3d.spec.ts`, `assets/avatar-src/` (whole dir incl. README), `docs/avatar-assets.md`
- Create: `apps/normal-web/e2e/avatar2d.spec.ts`, `apps/normal-web/scripts/avatar-sheet.mjs`, `docs/avatar-2d.md`, `docs/avatar-2d-sheet.png`
- Modify: `apps/normal-web/package.json` (remove `three`, `@types/three`, `meshoptimizer`, `@gltf-transform/*`, scripts `avatar:*`; add `avatar:sheet`), `pnpm-lock.yaml` (via `pnpm install`), `apps/normal-web/test/footprint.test.ts` (drop avatar3d chunk/asset budgets and the three marker; add: sprite is not in the entry chunk twice — i.e. `SPRITE_SVG` appears once in `dist/assets/*.js`; total gzip budget unchanged), `apps/normal-server/src/app.ts` (`SCRIPT_SRC = "script-src 'self'"`, remove `IMG_SRC_EXTRA` blob), `app.test.ts` CSP assertions, `docs/security.md` (CSP paragraph), `docs/normal-web.md`, `docs/known-limitations.md` (remove 3D notes; add "no character rotation; one view"), `docs/test-matrix.md`, `docs/acceptance-checklist.md` (rows citing avatar3d tests → cite the new tests; `tooling/arch/acceptance-links.test.ts` must pass), `CHANGELOG.md`, main spec §15 (one paragraph: "Since Plan 10 the figure is a 2D chibi — see the 2026-09-08 spec"), `docs/superpowers/specs/2026-09-05-avatar-3d-design.md` (top line: "Đã thay thế bởi 2026-09-08-avatar-chibi-2d-design.md"), `apps/lite/e2e/lite.spec.ts` (seat shows `svg[data-chibi-hash]`), `.gitignore` (drop avatar-src zip rules if any)

- [ ] **Step 1: Delete and unwire.** Remove the files; `pnpm install` to update the lockfile; fix every import (`grep -rn "avatar3d\|Portrait\|PartPortrait\|LazyAvatarStage\|resetPortraitMemory" apps/normal-web/src` must be empty). `pnpm --filter @bp/normal-web typecheck`.
- [ ] **Step 2: CSP.** `app.test.ts`: header equals `default-src 'self'; script-src 'self'; ...` (read the exact current string and drop the two tokens). `docs/security.md` paragraph rewritten.
- [ ] **Step 3: Footprint.** Rewrite `footprint.test.ts` budgets: entry ≤ current + sprite (measure; set the ceiling 20 % above the measured value and log it), remove the avatar3d `describe`, add `it('ships the sprite once', …)` counting occurrences of `SPRITE_SHA`'s value across `dist/assets/*.js` === 1.
- [ ] **Step 4: Contact sheet script.** `scripts/avatar-sheet.mjs`: starts the ui-kit playground build (`pnpm --filter @bp/ui-kit build:playground`), serves `playground/dist` on a free port with `node:http`, opens Playwright Chromium at `#avatar2d`, `page.screenshot({ fullPage: true, path: 'docs/avatar-2d-sheet.png' })`. Script `"avatar:sheet": "node scripts/avatar-sheet.mjs"` in `apps/normal-web/package.json` (Playwright is already a devDependency there). Run it; commit the PNG.
- [ ] **Step 5: e2e.** `avatar2d.spec.ts` (desktop + mobile projects, same helpers as `normal.spec.ts`): register → lobby bar has `svg[data-chibi-hash]` → wardrobe: Hat tab, equip `accessory_conical_hat` (owned? no — the fresh account owns only defaults; so equip a free face change instead: Face tab → `eyes_basic_3`, Body → skin swatch 5, Top colour → third cloth swatch), save → lobby bar hash changes → create a Blind room with 2 bots, sit → my seat `svg[data-chibi-hash]` equals the bar's hash and contains `use[href="#eyes/eyes_basic_3/open"]`; bots' seats have `use[href^="#bot/bot_"]`; outfit: save slot 1 named "Đi làm", change eyes to `eyes_basic_1`, save wardrobe, apply slot 1 → bar hash returns to the earlier value; a locked tile (`hat_crown`) is `aria-disabled` and clicking it does not change the preview hash. Lite e2e: after sitting, `svg[data-chibi-hash]` in my seat. Run both suites.
- [ ] **Step 6: Docs.** `docs/avatar-2d.md` (rig, layers, symbol ids, how to add an item: draw → `pnpm --filter @bp/ui-kit sprite` → fixture → `items.json` → i18n → sheet), update the others listed; CHANGELOG entry; checklist rows 40.x/66.x citing new test names (`footprint.test.ts → ships the sprite once`, `sprite.test.ts → stays inside its budget`, `avatar2d.spec.ts`), and `tooling/arch/acceptance-links.test.ts` green.
- [ ] **Step 7: Deploy to the test host.** `pnpm build:normal`; `node apps/normal-server/dist/grant-wardrobe-cli.js neon.test@example.com` with `DATABASE_URL` from `deploy/normal-windows/.env` (expect 25 granted); `deploy/normal-windows/stop.ps1` + `run.ps1 -NoMigrate` (**note:** `0002_outfits.sql` must run: run `run.ps1` **without** `-NoMigrate` this once); open `http://localhost:8080`, hard-reload, screenshot the table with bots and the wardrobe for the user.
- [ ] **Step 8:** Full `pnpm test`, `pnpm lint`, `pnpm typecheck`, both e2e suites. Commit: `chore(normal-web): retire the 3D avatar pipeline; docs, CSP and budgets follow the chibi`.

---

## Self-review
- **Spec coverage:** §3.1–3.3 → T1 (rig, layers, colours), §3.4 → T1 (parts/states) + T5 (triggers), §3.5 → T1/T2, §3.6 → T1 `defaultChibi` + T5 Lite, §4 → T1 script/test, §5.1–5.3 → T3, §5.4 → T4, §6.1 → T1/T5, §6.2 → T6/T7, §6.3 → T6, §6.4 → T5, §7 → each task's tests + T7 e2e/sheet, §8 → task order (gate after T1), §9 risks → T1 gate + sprite budget test, D6 → T7 Step 7, D7 → no task (nothing to build).
- **Placeholders:** the drawings themselves are the craft the tests bound (every id listed, every geometry anchored); no TBDs remain.
- **Type consistency:** `ChibiSubject`/`ChibiConfig`/`ChibiItem`/`Expression`/`ChibiFrame` (T1) are the names used in T5/T6; `chibiFor` replaces `avatarFor` in T5 and is what T6's `makeChibiFor` produces; server `SpriteRef` mirrors the client `ChibiItem.parts/bodies/colorable`; `AvatarConfigDto` v3 (T6) matches `AvatarConfigV3` (T3) field for field; `FacesDto` matches `/api/catalog/faces` (T3).
