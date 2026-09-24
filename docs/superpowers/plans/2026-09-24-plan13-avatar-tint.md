# Plan 13 — Hair colour, eye colour and item colour variants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players recolour their base's hair and eyes and wear colour variants of some items, with no new AI art — every colour is a catalogue item, common colours free.

**Architecture:** The avatar pipeline writes alpha masks next to each base, face and tintable item layer (`<layer>_hairmask`, `_eyemask`, `_tintmask`, @1x/@2x) and records them in the manifest with the mean HSL lightness under each mask. The server catalogue gains two colour slots, `free` items and `asset.tint`; the base registry exposes which layers carry masks. `@bp/ui-kit` recolours a layer on a canvas with one pure function (`recolour.mjs`) that the pipeline's review sheet also imports, caches the result as a blob URL, and falls back to the untinted layer when there is no canvas.

**Tech Stack:** Node 22, pnpm workspaces, sharp (pipeline only), Fastify + Drizzle (server), React 18 + Vite (web, ui-kit), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-avatar-tint-design.md` (read it first; §-numbers below refer to it). Background: `docs/avatar-2d.md`, spike `.superpowers/sdd/plan11-crop/tint-spike.mjs`.

## Global Constraints

- Do not modify any existing layer PNG under `apps/normal-web/public/avatar/`. This plan only **adds** mask files and `masks`/`tintSeed` keys to manifest entries.
- The manifest is written with `writeManifest(manifest, targets)` so `apps/normal-web/public/avatar/avatar-manifest.json` and `apps/normal-server/data/avatar-manifest.json` stay identical.
- Mask file names: `<layer>_hairmask`, `<layer>_eyemask`, `<layer>_tintmask`, each `@1x.png` and `@2x.png`, frame 384×448 at 1x. White RGB, coverage in alpha.
- `recolour.mjs` is dependency-free and DOM-free: plain ES module over `Uint8ClampedArray`/`Uint8Array`/`Buffer`.
- Colour values are `#rrggbb` lowercase hex, validated with `/^#[0-9a-f]{6}$/`.
- `free: true` is valid only on `rarity: "common"` items that are not `isDefault`.
- The config stays `v: 3`. No database migration.
- `pnpm lint` runs with `--max-warnings=0`; `pnpm -r typecheck` must stay clean.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Developer docs in English (`docs/avatar-2d.md`), operator/user-facing notes in Vietnamese (`docs/bug-log.md`).
- Tests: `pnpm --filter <pkg> exec vitest run <file>`; PATH needs `/c/Users/lathanhbinh/AppData/Local/pnpm` in Git Bash.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/ui-kit/src/avatar2d/recolour.mjs` + `recolour.d.mts` + `recolour.test.ts` | 1 | Pure recolour over RGBA + mask |
| `apps/normal-web/scripts/avatar-pipeline/masks.mjs` | 2 | Hair / eye / tint mask cutting, overrides, writing, manifest `masks` |
| `apps/normal-web/test/avatar-masks.test.ts` | 2 | Synthetic-picture tests for masks |
| `apps/normal-web/scripts/avatar-pipeline.mjs` | 2, 3 | `masks`, `tint-sheet` commands; `ingest` hook |
| `apps/normal-web/scripts/avatar-pipeline/extract.mjs` | 2 | call `writeMasks` after an ingest |
| `assets/avatar-src/.gitignore`, `assets/avatar-src/masks/` | 2, 4 | committed hand-drawn overrides |
| `apps/normal-web/scripts/avatar-pipeline/checks.mjs` | 3 | C11 |
| `apps/normal-web/scripts/avatar-pipeline/tint-sheet.mjs` | 3 | review sheet |
| `docs/avatar-2d.md` | 3 | masks, C11, commands |
| `apps/normal-web/public/avatar/*mask*`, manifests, `assets/avatar-src/masks/*`, `docs/avatar-2d-tint-sheet.png` | 4 | real masks (controller task) |
| `apps/normal-server/src/inventory/{slots,items,manifest,bases,avatar,inventory-service,grant-wardrobe}.ts`, `app.ts` | 5 | catalogue, free items, base tint, validation |
| `apps/normal-server/data/items.json`, `apps/normal-web/src/locales/{vi,en}/normal.json` | 5 | 34 new items + names |
| `packages/ui-kit/src/avatar2d/{types,layers,Chibi,tinted}.ts(x)` | 6 | tint refs, hashing, canvas hook |
| `apps/normal-web/src/api.ts`, `src/avatar/chibi.ts`, `src/screens/wardrobe/*` | 7 | DTOs, config → chibi, wardrobe tabs |
| `apps/normal-web/e2e/avatar-tint.spec.ts`, `docs/bug-log.md` | 8 | e2e, rollout notes |

---

### Task 1: Shared recolour function

**Files:**
- Create: `packages/ui-kit/src/avatar2d/recolour.mjs`
- Create: `packages/ui-kit/src/avatar2d/recolour.d.mts`
- Create: `packages/ui-kit/src/avatar2d/recolour.test.ts`
- Modify: `packages/ui-kit/src/avatar2d/index.ts` (add `export * from './recolour.mjs'`)

**Interfaces:**
- Produces: `hexToHsl(hex: string): [number, number, number]` (h 0–360, s 0–1, l 0–1); `meanLightness(pixels: ArrayLike<number>, mask: ArrayLike<number>): number` (mask-weighted mean HSL lightness of RGBA `pixels`, mask one byte per pixel 0–255; 0 when the mask is empty); `recolour(pixels: Uint8ClampedArray | Uint8Array, mask: ArrayLike<number>, colour: string, meanL: number): void` (in place).

- [ ] **Step 1: Write the failing test** — `recolour.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hexToHsl, meanLightness, recolour } from './recolour.mjs'

const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat())

describe('hexToHsl', () => {
  it('reads pure red and a grey', () => {
    expect(hexToHsl('#ff0000')).toEqual([0, 1, 0.5])
    const [, s, l] = hexToHsl('#808080')
    expect(s).toBe(0)
    expect(l).toBeCloseTo(0.502, 2)
  })
})

describe('meanLightness', () => {
  it('weights by the mask and ignores unmasked pixels', () => {
    const pixels = px([0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255])
    expect(meanLightness(pixels, [255, 255, 0])).toBeCloseTo(0.5, 5)
    expect(meanLightness(pixels, [0, 0, 0])).toBe(0)
  })
})

describe('recolour', () => {
  it('leaves unmasked pixels and every alpha untouched', () => {
    const pixels = px([10, 20, 30, 200], [40, 50, 60, 90])
    recolour(pixels, [0, 255], '#00ff00', 0.2)
    expect([...pixels.slice(0, 4)]).toEqual([10, 20, 30, 200])
    expect(pixels[7]).toBe(90)
  })

  it('takes the hue of the colour and moves the mean lightness onto it', () => {
    // two greys around l = 0.3 and 0.5, mean 0.4; target red, l 0.5 → both shift by +0.1
    const pixels = px([77, 77, 77, 255], [128, 128, 128, 255])
    const mask = [255, 255]
    recolour(pixels, mask, '#ff0000', meanLightness(pixels, mask))
    expect(pixels[0]).toBeGreaterThan(pixels[1]! + 50) // red dominates
    expect(pixels[1]).toBe(pixels[2]) // g == b for pure red hue
    expect(meanLightness(pixels, mask)).toBeCloseTo(0.5, 1)
  })

  it('blends by the mask at a soft edge', () => {
    const full = px([100, 100, 100, 255])
    const half = px([100, 100, 100, 255])
    recolour(full, [255], '#0000ff', 0.39)
    recolour(half, [128], '#0000ff', 0.39)
    expect(half[2]).toBeGreaterThan(100)
    expect(half[2]).toBeLessThan(full[2]!)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `pnpm --filter @bp/ui-kit exec vitest run src/avatar2d/recolour.test.ts`

- [ ] **Step 3: Implement** — `recolour.mjs`:

```js
// Pure, DOM-free recolouring shared by the avatar pipeline (Node, tint-sheet) and the browser (ui-kit Chibi).
// Spec 2026-09-24-avatar-tint-design.md §5.1.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hueToChannel(p, q, t) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const k = h / 360
  return [hueToChannel(p, q, k + 1 / 3), hueToChannel(p, q, k), hueToChannel(p, q, k - 1 / 3)].map((v) => Math.round(v * 255))
}

export function hexToHsl(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

export function meanLightness(pixels, mask) {
  let sum = 0, weight = 0
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]
    if (!a) continue
    const o = i * 4
    sum += rgbToHsl(pixels[o], pixels[o + 1], pixels[o + 2])[2] * a
    weight += a
  }
  return weight === 0 ? 0 : sum / weight
}

export function recolour(pixels, mask, colour, meanL) {
  const [hue, sat, lc] = hexToHsl(colour)
  const shift = lc - meanL
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]
    if (!a) continue
    const o = i * 4
    const l = rgbToHsl(pixels[o], pixels[o + 1], pixels[o + 2])[2]
    const [r, g, b] = hslToRgb(hue, sat, clamp01(l + shift))
    const t = a / 255
    pixels[o] = Math.round(pixels[o] * (1 - t) + r * t)
    pixels[o + 1] = Math.round(pixels[o + 1] * (1 - t) + g * t)
    pixels[o + 2] = Math.round(pixels[o + 2] * (1 - t) + b * t)
  }
}
```

`recolour.d.mts`:

```ts
export declare function hexToHsl(hex: string): [number, number, number]
export declare function meanLightness(pixels: ArrayLike<number>, mask: ArrayLike<number>): number
export declare function recolour(pixels: Uint8ClampedArray | Uint8Array, mask: ArrayLike<number>, colour: string, meanL: number): void
```

Add `export * from './recolour.mjs'` to `index.ts`. If `tsc` or eslint refuse `.mjs` imports, add `"allowJs": false` is not needed — the `.d.mts` sits beside it; if eslint lints `.mjs` with TS rules, add the file to the existing JS override in `eslint.config.*` rather than disabling rules.

- [ ] **Step 4: Run the test — expect PASS**; then `pnpm --filter @bp/ui-kit typecheck` and `pnpm lint`.
- [ ] **Step 5: Commit** — `git add packages/ui-kit/src/avatar2d && git commit -m "feat(ui-kit): shared recolour function for avatar tints"` (+ Co-Authored-By line).

---

### Task 2: Mask cutting in the pipeline

**Files:**
- Create: `apps/normal-web/scripts/avatar-pipeline/masks.mjs`
- Create: `apps/normal-web/test/avatar-masks.test.ts`
- Modify: `apps/normal-web/scripts/avatar-pipeline.mjs` (new `masks` command; `--tint-seed` on `ingest` and `masks`)
- Modify: `apps/normal-web/scripts/avatar-pipeline/extract.mjs` (`ingest` calls `writeMasks` for the layers it wrote; see Step 5)
- Modify: `assets/avatar-src/.gitignore` (add `!masks/` and `!masks/*.png`)
- Modify: `apps/normal-web/test/avatar-pipeline.test.ts` only if an existing count assertion breaks (mask files are not manifest entries, so none should)

**Interfaces:**
- Consumes: `readPicture`, `writePicture`, `resizePicture`, `ALPHA_INK` from `png.mjs`; `FACE_LIMIT_Y`, `SKIN_WINDOW`, `FRAME` from `frame.mjs`; `parseName`, `readManifest`, `writeManifest`, `wearOf`, `EXPRESSIONS` from `manifest.mjs`; `meanLightness` from `packages/ui-kit/src/avatar2d/recolour.mjs` (relative import `../../../../packages/ui-kit/src/avatar2d/recolour.mjs`).
- Produces (all masks are `Uint8Array` of `width*height`, values 0–255, at the picture's own size — the pipeline works at @2x):
  - `hairMask(pic, { neverVisible?: Uint8Array | null }): Uint8Array`
  - `eyeMask(pic, hair: Uint8Array): Uint8Array` — also clears the eye pixels out of `hair` in place
  - `tintMask(pic, seed: { x: number, y: number } /* 1x frame coords */, { tolerance?: number }): Uint8Array`
  - `MASK_OVERRIDE_DIR` = `<repo>/assets/avatar-src/masks`
  - `async writeMasks({ dir, manifest, names, log }): Promise<void>` — for each manifest name it can mask, writes the mask files into `dir` and sets `manifest.files[name].masks = { hair?, eyes?, tint? }`, each `{ bytes2x, meanL, empty?: true, override?: true }`. Does not write the manifest; the caller does.
  - `maskTargets(manifest): string[]` — every real base L30/L60 (non-empty), every real base face, every item whose entry has `tintSeed`.

- [ ] **Step 1: Write the failing tests** — `test/avatar-masks.test.ts`. Build one synthetic base at @2x (768×896) with `renderSvg`: transparent background; skin head circle `#e0ac81` centred (384, 330) r 150; dark-brown hair cap `#3a2418` = the circle's top 45 % plus two side locks down to y 520; two eyes: white ellipses `#ffffff` at (320, 350) and (448, 350) rx 34 ry 40, each with an iris circle `#2f7fd6` r 24 and pupil `#101010` r 9; a body rectangle `#e0ac81` x 300–468 y 480–800; a white tank top `#f4f4f4` x 300–468 y 480–600. Assertions:

```ts
it('cuts the hair cap and locks, not the face', async () => {
  const pic = await syntheticBase()
  const hair = hairMask(pic, { neverVisible: null })
  expect(coverage(hair, capPixels(pic))).toBeGreaterThan(0.9)
  expect(coverage(hair, skinPixels(pic))).toBeLessThan(0.02)
})
it('finds one iris per side and takes it out of the hair', async () => {
  const pic = await syntheticBase(); const hair = hairMask(pic, { neverVisible: null })
  const eyes = eyeMask(pic, hair)
  expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
  expect(blobsPerSide(eyes)).toEqual([1, 1])
  expect(coverage(hair, irisPixels(pic))).toBe(0)
})
it('answers an empty eye mask for closed eyes (lash lines only)', async () => {
  const pic = await syntheticBase({ closedEyes: true }) // eyes drawn as 4 px dark arcs, no white, no iris
  expect(sum(eyeMask(pic, hairMask(pic, { neverVisible: null })))).toBe(0)
})
it('cuts the seeded colour region of an item and nothing else', async () => {
  const pic = await syntheticItem() // red rect #c0392b x 200–400 y 300–500 with a 3 px #401010 outline, blue rect #2c3e70 x 400–560 same rows
  const tint = tintMask(pic, { x: 150, y: 200 }) // 1x coords inside the red rect
  expect(coverage(tint, colourPixels(pic, '#c0392b'))).toBeGreaterThan(0.95)
  expect(coverage(tint, colourPixels(pic, '#2c3e70'))).toBe(0)
})
it('lets a hand-drawn override win and marks it', async () => { /* write a synthetic base layer + manifest into a tmp dir,
  put an override PNG at <tmp>/overrides/<name>_eyemask.png, call writeMasks({ dir, manifest, names: [name], overridesDir }),
  expect manifest.files[name].masks.eyes.override === true and the written @2x mask equal to the override's alpha */ })
it('writes both densities and records meanL for every mask it writes', async () => { /* base L30 + neutral face in tmp dir;
  after writeMasks: files <name>_hairmask@1x/@2x exist, 384×448 and 768×896, masks.hair.meanL in (0,1), masks.hair.bytes2x === size of @2x file */ })
```

Helpers (`coverage(mask, pixelSet)` = share of the set with mask ≥ 128, `blobsPerSide`, `sum`, the SVG builders) live in the test file. `writeMasks` takes an optional `overridesDir` (default `MASK_OVERRIDE_DIR`) so the test does not touch the repository.

- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter @bp/normal-web exec vitest run test/avatar-masks.test.ts`).

- [ ] **Step 3: Implement `masks.mjs`.** Port the spike (`.superpowers/sdd/plan11-crop/tint-spike.mjs`, read it) into functions over a picture `{ data, width, height }`. The algorithm, with the spike's constants (they are @2x values; scale by `pic.width / 768` for any other width):

  1. **Lab per pixel** for pixels with alpha > 200 (sRGB → XYZ D65 → Lab, as in the spike's `lab()`); k-means (12 iterations, deterministic seeding by striding, never `Math.random`).
  2. **Head top and centre:** first row with an opaque pixel; centre = mean x of opaque pixels in the 200 rows below it.
  3. **Hair palette:** k-means k = 4 over opaque pixels in rows top+6 … top+70, columns centre±70.
  4. **Skin palette:** k-means k = 5 over opaque pixels in `SKIN_WINDOW` (scaled to the picture); keep the clusters with L > 30 whose distance to every hair cluster is > 12, the two most populous.
  5. **Hair candidates:** opaque, not in `neverVisible`, chroma (√(a²+b²)) ≤ max hair-cluster chroma + 12, distance to nearest hair cluster < 14 and < 0.8 × distance to nearest skin cluster.
  6. **Grow:** close(candidates, 2); keep the 8-connected components > 200 px that touch the seed patch of step 3; close(3); clear non-opaque.
  7. **Outline swallow:** within dilate(hair, 2), add opaque pixels with L < 28 that are not within dilate(skin, 3) (skin = distance < 16 to a skin cluster) and not in `neverVisible`.
  8. **Light pockets:** components of ¬hair that are opaque, not skin, ≤ 2500 px and whose pixels all have L ≥ 55 become hair (highlights).
  9. **Eyes** (`eyeMask`): region = opaque ∧ ¬hair ∧ ¬skin (distance < 14) in rows top + 0.3·H … top + 0.75·H where H = FACE_LIMIT_Y·scale − top; close(1); per side of the centre line keep the largest component with 150 < size < 12000; fill enclosed pockets (≤ 4000 px, opaque); erode 4 → keep the largest core per side → dilate 5 ∧ blob (drops the brow); span-fill each row between the leftmost and rightmost blob pixel on that side (opaque, ¬hair); final mask = those pixels that are not white (L > 88 ∧ chroma < 10) and have L > 15; per side drop the side if its pixel count < 100 (closed eyes). Clear the mask's pixels out of `hair`.
  10. **Tint** (`tintMask`): seed colour = Lab at the seed (×scale); flood 4-connected over opaque pixels within ΔE < `tolerance` (default 18) of the seed colour; close(2); clear non-opaque.
  11. Output masks are 0/255 (hard); `writeMasks` softens nothing — the @1x copy made by `resizePicture` of the mask picture gives the soft edge.

  `writeMasks({ dir, manifest, names, overridesDir = MASK_OVERRIDE_DIR, log })`:
  - For each name: `parseName(name)`; skip entries that are not `real`, and `empty` entries.
  - Base body (layer 30): `neverVisible` = intersection of (alpha > 200) over every outfit layer this base can wear — for wear `f` every `item_outfit_<code>_L40` in `manifest.files`; for wear `m` the `_m_L40` file where one exists, else the shared one (use `wearOf(base)`); read each @2x. Masks: hair.
  - Base hair front (layer 60, non-empty): hair = the layer's alpha > `ALPHA_INK` (the strand is all hair).
  - Base face: hair (neverVisible null) and eyes; `closed`/`sleep` get an all-zero eye mask.
  - Item with `entry.tintSeed`: tint.
  - Override: if `<overridesDir>/<name>_<kind>mask.png` exists, read it, resize to @2x if it is 1x, use its alpha channel (or luminance when it has no alpha) as the mask; mark `override: true`.
  - For each mask: picture = white RGB + alpha = mask; `writePicture` @2x to `<dir>/<name>_<kind>mask@2x.png`, `resizePicture` to 384×448 and write @1x; entry `{ bytes2x, meanL: meanLightness(layer2x.data, mask) }` rounded to 4 decimals, plus `empty: true` when the mask sums to zero.

- [ ] **Step 4: Run the tests — expect PASS.**

- [ ] **Step 5: Wire the CLI and ingest.**
  - `avatar-pipeline.mjs`: `else if (command === 'masks') { const { dir, targets } = destinations('out'); const manifest = readManifest(resolve(dir, MANIFEST_NAME)); const seed = option('tint-seed'); if (seed) { const target = parseTarget(option('as')); /* must be kind item */ manifest.files[itemFile(target.slot, target.code, SLOT_LAYER[target.slot])].tintSeed = { x, y } } ; const names = positionals().length ? positionals() : maskTargets(manifest); await writeMasks({ dir, manifest, names, log }); await writeManifest(manifest, targets) }` — add `masks` and `tint-sheet` to the unknown-command message.
  - `extract.mjs` `ingest`: after the final `writeManifest`, when not `dryRun`, call `await writeMasks({ dir, manifest, names: layers.map((l) => l.file.name).filter((n) => maskTargets(manifest).includes(n)), log })` then `await writeManifest(manifest, targets)` again. `ingest` accepts `tintSeed` (from `--tint-seed x,y`) and stores it on the item entry before masking.
  - `assets/avatar-src/.gitignore`: add `!masks/` and `!masks/*.png`; create `assets/avatar-src/masks/.gitkeep`.

- [ ] **Step 6: Run** the new test, `test/avatar-pipeline.test.ts`, `test/avatar-registry-verify.test.ts`, `pnpm --filter @bp/normal-web typecheck`, `pnpm lint`. All pass.
- [ ] **Step 7: Commit** — `feat(avatar-pipeline): hair, eye and tint masks`.

---

### Task 3: C11, the tint sheet and the docs

**Files:**
- Modify: `apps/normal-web/scripts/avatar-pipeline/checks.mjs` (C11)
- Create: `apps/normal-web/scripts/avatar-pipeline/tint-sheet.mjs`
- Modify: `apps/normal-web/scripts/avatar-pipeline.mjs` (`tint-sheet` command; `SHEET_FILE` sibling `TINT_SHEET_FILE = docs/avatar-2d-tint-sheet.png` in `manifest.mjs`)
- Modify: `apps/normal-web/test/avatar-masks.test.ts` (C11 cases), `apps/normal-web/test/avatar-pipeline.test.ts` if it asserts `CHECK_IDS` length (10 → 11)
- Modify: `docs/avatar-2d.md` (new section "Tint masks"; C11 row in the checks table; commands)

**Interfaces:**
- Consumes: Task 2's `writeMasks`, mask naming; Task 1's `recolour`, `meanLightness`.
- Produces: `CHECK_IDS` includes `'C11'`; `buildTintSheet({ dir, manifest, items, out, log })` where `items` is the parsed `apps/normal-server/data/items.json` array.

- [ ] **Step 1: Failing tests** (append to `avatar-masks.test.ts`), each on a tmp dir built with Task 2's synthetic base plus `writeMasks`, then `runChecks({ dir, manifest, names })` and the C11 result:
  - clean masks → C11 ok;
  - a hair mask that covers a transparent pixel (write a tampered `_hairmask@2x.png`) → C11 fails "mask outside the layer";
  - a neutral face whose eye mask has one blob (tamper: zero the right half) → fails "neutral face needs two eyes";
  - an L30 hair mask covering 40 % of the frame → fails "hair area";
  - an override (`override: true`) with an out-of-range area → ok (area rules skipped, size/coverage still checked);
  - a layer without `masks` → C11 `n/a`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement C11** in `checks.mjs` exactly per spec §4.3: load the entry's mask files (@2x) in `load()` when `entry.masks` exists; rules: size equals the layer's @2x size; every mask pixel ≥ 128 sits on a layer pixel with alpha > `ALPHA_INK`; hair on L30: 3 %–20 % of the frame area; hair on a face: 0.7–1.3 × the same base's `face_neutral` hair mask area (skip when that is empty); eyes: neutral = exactly two 8-connected blobs, one each side of x = 384 (@2x), each 100–8000 px; other open-eye faces = that or empty; `closed`/`sleep` = empty; tint ≥ 2 % of the layer's alpha area. Overrides skip the area and blob rules. No `masks` → `n/a`.
- [ ] **Step 4: `tint-sheet.mjs`:** one card per base per (hair, eye) pair from hair `['#b3261e', '#e8e1cf', '#3f6fd8']` × eyes `['#2f9e55', '#d08a1c', '#8b56d6']` — composite L20, L30 (hair tinted), `item_outfit_casual01_L40`, `face_neutral` (hair + eyes tinted), L60 (hair tinted) at @1x using `recolour` with the base's L30 hair `meanL` and neutral-face eye `meanL`; then one card per `items.json` entry whose `asset.tint` is set, drawn on f01 with the item tinted by its own `_tintmask` `meanL`. Grid 9 columns at 0.5 scale, dark background `#2b2f3a`, written with sharp to `TINT_SHEET_FILE` (or `--out`). Wire `tint-sheet` in the CLI.
- [ ] **Step 5: Docs** — `docs/avatar-2d.md`: section "Tint masks" (what files exist, the algorithm in 6 lines, overrides in `assets/avatar-src/masks/`, `masks` / `--tint-seed` / `tint-sheet` usage), C11 row in the checks table.
- [ ] **Step 6: Run** the mask tests, pipeline tests, typecheck, lint — PASS.
- [ ] **Step 7: Commit** — `feat(avatar-pipeline): C11 mask checks and the tint review sheet`.

---

### Task 4: Masks on the real art (controller task, not a subagent)

The controller runs this with its own tools, because it needs visual judgment and possibly the ChatGPT loop.

- [ ] **Step 1:** Seeds for the tintable items (1x frame coords, pick a pixel in the region to tint by reading the item's @1x layer; the tee of casual01, the beret body, the beanie knit, the party cone body):
  `node scripts/avatar-pipeline.mjs masks --as item:outfit:casual01 --tint-seed <x>,<y> item_outfit_casual01_L40` and the same for `item:head:beret_red01`, `item:head:beanie01`, `item:head:party_cone01`. Only dealer01 and tet_red01 have `_m` cuts, so each of the four items needs one seed.
- [ ] **Step 2:** `node scripts/avatar-pipeline.mjs masks` (every base and seeded item), then `node scripts/avatar-pipeline.mjs check` — all C1–C11 ok.
- [ ] **Step 3:** For every C11 failure: first tune by hand-drawn override (write the override PNG with a short sharp script into `assets/avatar-src/masks/<name>_<kind>mask.png` — for m03's eyes, ellipses fitted to the iris inside each eye white), rerun `masks <name>` and `check`. Known: m03 eyes need overrides on its open-eye faces.
- [ ] **Step 4:** `node scripts/avatar-pipeline.mjs tint-sheet` after Task 5 has added the variant items (the sheet reads `items.json`) — until then it draws bases only. Read the sheet image; any card whose hair or eyes smear onto skin, or whose item tint bleeds, gets an override. If an override cannot fix it (the art itself mixes the region with its neighbour), put that asset through the Plan 12 registry loop: `avatar-registry.mjs reject <id> --reason tint`, generate in ChatGPT, `collect`/`verify`/`ingest`, then `masks <layer>` again.
- [ ] **Step 5:** Commit masks, overrides, manifests and the sheet — `art: tint masks for every base and the tintable items`.

---

### Task 5: Server — colour slots, free items, tint and base masks

**Files:**
- Modify: `apps/normal-server/src/inventory/slots.ts`, `items.ts`, `manifest.ts`, `bases.ts`, `avatar.ts`, `inventory-service.ts`, `grant-wardrobe.ts`, `apps/normal-server/src/app.ts`
- Modify: `apps/normal-server/data/items.json` (34 items: 13 hair colours, 9 eye colours, 12 item variants)
- Modify: `apps/normal-web/src/locales/vi/normal.json`, `en/normal.json` (`items.<id>` for all 34)
- Tests: `items.test.ts`, `avatar.test.ts`, `inventory-service.test.ts` (or wherever `createInventoryService` is tested), `bases.test.ts`, `manifest` test, `economy-service.test.ts`, `routes-me.test.ts`, `grant-wardrobe` test.

**Interfaces:**
- Consumes: manifest entries' `masks` from Task 4 (`{ hair?, eyes?, tint? }` each `{ bytes2x, meanL, empty?, override? }`).
- Produces:
  - `ItemSlot` += `'hairColor' | 'eyeColor'`; `OPTIONAL_SLOTS` = `['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge']`; `COLOUR_SLOTS = ['hairColor', 'eyeColor'] as const`; `DAILY_DRAW_SLOTS` += both.
  - `ItemDef` += `free?: true`, `colour?: string`; `AssetRef` += `tint?: string`, `tintMeanL?: number`; `ItemCatalog.freeIds(): ReadonlySet<string>`.
  - `AvatarManifestFile` += `masks?: { hair?: MaskInfo; eyes?: MaskInfo; tint?: MaskInfo }`, `MaskInfo = { bytes2x: number; meanL: number; empty?: boolean; override?: boolean }`.
  - `BaseDef` += `tint?: { hair?: { meanL: number; files: string[] }; eyes?: { meanL: number; files: string[] } }`.
  - `AvatarConfigV3` += `hairColor?: string`, `eyeColor?: string`.
  - `createInventoryService(db, aliases?, freeIds?: ReadonlySet<string>)`.

- [ ] **Step 1: Failing tests** (add to the existing test files, following their fixtures):
  - `items.test.ts`: a colour item without `colour` → throws; `colour` on a `head` item → throws; `colour: 'red'` → throws; `free` on a `rare` → throws; `free` + `isDefault` → throws; `asset.tint` on a file whose manifest entry has no `masks.tint` (or `empty`) → throws; a valid variant exposes `asset.tint` and `asset.tintMeanL` equal to the manifest's `meanL`; `freeIds()` lists exactly the free ids; the real catalogue loads.
  - `manifest` test: `masks` parsed; malformed `masks.hair.meanL` (not 0–1) → throws.
  - `bases.test.ts`: with a manifest whose f01 L30 and neutral face carry masks, `tint.hair.files` = the base's layers (body, hairFront if masked, faces) whose `masks.hair` is non-empty, `tint.hair.meanL` = the L30 hair `meanL`, `tint.eyes.files` = faces with non-empty eye masks, `tint.eyes.meanL` = neutral face eye `meanL`; a base without masks has no `tint`.
  - `avatar.test.ts`: `hairColor: 'haircolor_red01'` validates; `hairColor: 'eyecolor_green01'` → `WRONG_CATEGORY`; `hairColor: 'nope'` → `INVALID_ITEM`; `itemIdsOf` includes both colours.
  - inventory service (PGlite): with `freeIds` = {`haircolor_red01`}: `owns` true without a row, `missingOf([... 'haircolor_red01'])` omits it, `list` includes `{ itemId: 'haircolor_red01', source: 'free', acquiredAt: 0 }` after the owned rows, `unownedOfRarity('common', …)` never returns it.
  - `economy-service.test.ts`: the daily draw pool for `rare` includes `haircolor_pink01` and `head_beret_blue01`, and for `common` excludes every free id.
  - `routes-me.test.ts`: `PUT /api/me/avatar` with a free `hairColor` succeeds for a fresh account; with a rare colour not owned → 403 `NOT_OWNED`; `/api/me/inventory` lists free items with `source: "free"`.
  - `grant-wardrobe` test: free items are not granted rows (total counts only non-free items).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
  - `slots.ts` as in Interfaces; `isItemSlot` covers the new slots (it reads `SLOTS`).
  - `items.ts` `parseItem`: after slot/rarity, `const colour = r['colour']`; if slot ∈ `COLOUR_SLOTS` require `typeof colour === 'string' && /^#[0-9a-f]{6}$/.test(colour)` else require `colour === undefined`; `free` must be `undefined` or `true`, and `true` only with `rarity === 'common' && !isDefault`. `parseAsset`: `tint` optional hex; when present require `manifest.files[file].masks?.tint` present and not `empty`, set `asset.tint` and `asset.tintMeanL = masks.tint.meanL`. `freeIds` = `new Set(defs.filter((d) => d.free).map((d) => d.id))`. `seed` unchanged (free/colour are not columns).
  - `manifest.ts` `parseFile`: parse `masks` (object; each of `hair|eyes|tint` optional object with positive `bytes2x`, `meanL` in [0, 1], optional booleans `empty`, `override`).
  - `bases.ts`: after building `layers` and `faces`, derive `tint` from `manifest.files[...]?.masks` as specified; omit keys with no files.
  - `avatar.ts`: `AvatarConfigV3` gains the two keys; the existing `OPTIONAL_SLOTS`/`SLOTS` loops already validate them. Update the module comment ("There is no colour to choose any more" is now false: say colours are items in two slots).
  - `inventory-service.ts`: third parameter `freeIds: ReadonlySet<string> = new Set()`. `owns`: `if (freeIds.has(itemId)) return true`. `missingOf`: filter `wanted` by `!freeIds.has(id)` before querying, and never report a free id. `list`: append, after the owned rows, `{ itemId, source: 'free', acquiredAt: 0 }` for every free id not already owned. `unownedOfRarity`: drop free ids from the result.
  - `app.ts`: `createInventoryService(db, aliases, catalog.freeIds())`; `grant-wardrobe.ts`: `createInventoryService(db, undefined, catalog.freeIds())` and `all` = non-free ids.
  - `items.json`: append the 34 entries exactly as spec §3.2/§3.3 (ids `haircolor_<name>01`, `eyecolor_<name>01` with English names: black, darkbrown, chestnut, blonde, platinum, red, orange, grey, pink, blue, green, purple, lavender; eyes brown, blue, green, grey, amber, black, violet, red, gold; variant ids `outfit_casual_red01`, `outfit_casual_navy01`, `outfit_casual_green01`, `outfit_casual_yellow01`, `head_beret_blue01`, `head_beret_green01`, `head_beret_black01`, `head_beanie_red01`, `head_beanie_grey01`, `head_beanie_mustard01`, `head_party_cone_blue01`, `head_party_cone_green01`), `assetKey` = `<slot>/<id>`, variants copy the original's `asset` plus `tint`.
  - Locales: vi and en names for all 34 (e.g. vi "Tóc đỏ", "Mắt xanh lá", "Áo phông đỏ", "Mũ nồi xanh dương"; en "Red hair", "Green eyes", "Red tee", "Blue beret").
- [ ] **Step 4: Run** `pnpm --filter @bp/normal-server test`, `pnpm --filter @bp/normal-web exec vitest run src/locales`, `pnpm --filter @bp/lite test` (Lite reads `items.json`), typecheck, lint — PASS.
- [ ] **Step 5: Commit** — `feat(normal-server): hair and eye colour slots, free items, item tints`.

---

### Task 6: ui-kit — tinted layers

**Files:**
- Modify: `packages/ui-kit/src/avatar2d/types.ts`, `layers.ts`, `Chibi.tsx`, `index.ts`
- Create: `packages/ui-kit/src/avatar2d/tinted.ts` (hook + cache)
- Tests: `layers.test.ts`, `Chibi.test.tsx`, new `tinted.test.ts`

**Interfaces:**
- Consumes: Task 1 `recolour`.
- Produces:

```ts
export interface MaskSet { meanL: number; files: string[] }
export interface BaseRef { /* existing */ tint?: { hair?: MaskSet; eyes?: MaskSet } }
export interface WearRef extends LayerRef { /* existing */ tint?: { colour: string; meanL: number } }
export interface ChibiConfig { /* existing */ hairColor?: string; eyeColor?: string }
export interface TintRef { mask: string; colour: string; meanL: number }
export interface LayerRef { order: number; file: string; tints?: TintRef[] }
export function useTintedLayer(prefix: string, layer: LayerRef): string | null  // blob URL once ready, null before/without canvas
```

- [ ] **Step 1: Failing tests.**
  - `layers.test.ts`: a human with `hairColor: '#b3261e'`, `base.tint.hair.files` containing body, hairFront and all faces → those layers carry `tints: [{ mask: '<file>_hairmask', colour: '#b3261e', meanL }]`; with `eyeColor` too, the face layer carries hair then eye tint in that order; a face not in `eyes.files` gets no eye tint; a base without `tint` ignores the colours; an item with `tint` gets `{ mask: '<file>_tintmask', … }`; bots never carry tints.
  - `hashChibi`: same subject with different `hairColor`, `eyeColor` or item tint hashes differently; no colours → unchanged hash from today (keep the canonical string identical when all three are absent, so existing snapshot/e2e hashes stay valid).
  - `tinted.test.ts`: in jsdom (no 2D context) `useTintedLayer` returns `null` and never throws; the cache key helper `tintKey(file, density, tints)` differs by colour and density.
  - `Chibi.test.tsx`: a tinted layer renders the plain layer `src` while no tinted URL exists.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
  - `layersFor`: build each base layer as today, then attach tints: for layer files in `base.tint?.hair?.files` when `subject.hairColor` → `{ mask: \`${file}_hairmask\`, colour, meanL: base.tint.hair.meanL }`; for faces in `base.tint?.eyes?.files` when `subject.eyeColor` → eye tint; for worn items with `tint` → tint mask. Omit `tints` when empty.
  - `canonicalSubject`: append `:${hairColor ?? ''}:${eyeColor ?? ''}:${tints of items}` **only when at least one is set**.
  - `tinted.ts`: `useTintedLayer(prefix, layer)` — `useState<string | null>(null)` + `useEffect` keyed by `tintKey`: density = `window.devicePixelRatio > 1 ? 2 : 1`; module cache `Map<string, Promise<string | null>>`, LRU 96 (delete oldest insertion, `URL.revokeObjectURL` on eviction); job: `document.createElement('canvas').getContext('2d')` — if null resolve `null`; load the layer image and every mask image (`new Image()`, `decode()`), draw the layer, `getImageData`; for each tint draw the mask to a second canvas, take its alpha channel into a `Uint8Array`, `recolour(data, maskAlpha, colour, meanL)`; `putImageData`; `canvas.toBlob` → `URL.createObjectURL`. Any error → `null`.
  - `Chibi.tsx`: a small `ChibiLayer` component per layer: `const tinted = useTintedLayer(base, layer)`; when `tinted` is a string render `<img src={tinted}>` without `srcSet`, else today's markup.
- [ ] **Step 4: Run** ui-kit tests, typecheck, lint; `pnpm --filter @bp/lite test` (Lite renders `Chibi`) — PASS.
- [ ] **Step 5: Commit** — `feat(ui-kit): recolour hair, eyes and item tints on canvas`.

---

### Task 7: normal-web — DTOs, chibi mapping, wardrobe

**Files:**
- Modify: `apps/normal-web/src/api.ts`, `src/avatar/chibi.ts`, `src/screens/wardrobe/WardrobeScreen.tsx`, `ItemTab.tsx`, `wardrobe.module.css`, locales (tab names, "Tự nhiên"/"Natural")
- Create: `apps/normal-web/src/screens/wardrobe/ColourTab.tsx`
- Tests: `src/avatar/chibi.test.ts`, `src/screens/wardrobe/WardrobeScreen.test.tsx`

**Interfaces:**
- Consumes: Task 5 DTO fields (`ItemDto.colour`, `free`, `asset.tint`, `asset.tintMeanL`, `BaseDto.tint`, `AvatarConfigDto.hairColor/eyeColor`), Task 6 `ChibiConfig`/`BaseRef`/`WearRef` fields.

- [ ] **Step 1: Failing tests.**
  - `chibi.test.ts`: config with `hairColor: 'haircolor_red01'` (catalogue item with `colour '#b3261e'`, slot hairColor) → `chibi.hairColor === '#b3261e'`; a `hairColor` naming an eye colour item or an unknown id → omitted; `base.tint` copied from `BaseDto.tint`; an item with `asset.tint` → `WearRef.tint = { colour, meanL: tintMeanL }`.
  - `WardrobeScreen.test.tsx`: the "Hair colour"/"Màu tóc" tab lists a "Natural" swatch plus owned and locked colour swatches; clicking an owned swatch updates the preview's `data-chibi-hash` and the save request carries `hairColor`; clicking "Natural" removes the key; in the head tab the beret card shows its colour dots and clicking the blue dot equips `head_beret_blue01`; variants do not appear as their own cards.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Mirror the server types in `api.ts` (slots, `COLOUR_SLOTS`, DTO fields). `chibiFromApi`: resolve `hairColor`/`eyeColor` ids through `items` (slot must match, `colour` must exist); `toBaseRef` copies `tint`; `toWearRef` copies `asset.tint` + `asset.tintMeanL` into `tint`. Wardrobe: add `'hairColor', 'eyeColor'` to `TABS` after `'frame'`; `ColourTab` renders round swatches (`background: colour`, `aria-label` = item name, locked state like `ItemTab`'s), first swatch "Natural"; `ItemTab` groups items sharing `asset.file`: the one without `tint` is the card, the others render as a row of dots under it (owned dot clickable, locked dot disabled with a lock mark); variants are filtered out of the card list.
- [ ] **Step 4: Run** web tests, typecheck, lint — PASS.
- [ ] **Step 5: Commit** — `feat(normal-web): hair and eye colour tabs, item colour dots`.

---

### Task 8: End to end, rollout notes

**Files:**
- Create: `apps/normal-web/e2e/avatar-tint.spec.ts`
- Modify: `docs/bug-log.md` (CR1 row: Plan 13 summary), `apps/normal-web/test/footprint.test.ts` comment only if the budget note needs the mask bytes

- [ ] **Step 1:** e2e (copy the sign-up/wardrobe helpers the existing avatar spec uses): register, open the wardrobe, pick "Hair colour" → red; the preview chibi's `data-chibi-hash` changes and within 5 s the preview contains an `img[src^="blob:"]`; save; open a table (or the profile) and assert the same hash on the player's own chibi.
- [ ] **Step 2:** `pnpm build:normal && pnpm --filter @bp/normal-web e2e` — all pass (5 existing + 1 new).
- [ ] **Step 3:** Full gate: `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `node scripts/avatar-pipeline.mjs check` (in `apps/normal-web`), `pnpm build:lite`.
- [ ] **Step 4:** `docs/bug-log.md` CR1: Plan 13 done — what shipped, the rollout steps (`grant-wardrobe-cli neon.test@example.com` for rare colours and variants, rebuild web), overrides used.
- [ ] **Step 5: Commit** — `test(e2e): hair colour end to end; log Plan 13`.
