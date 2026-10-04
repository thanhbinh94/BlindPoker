/**
 * Which of Normal's avatar PNGs Lite ships (`docs/avatar-2d.md` §8, spec `2026-10-03-avatar-v4-design.md` §6.4).
 *
 * Lite has no wardrobe and no per-account cosmetics: every human at a Lite table is `defaultChibi`
 * (`packages/ui-kit/src/avatar2d/defaults.ts`) and every bot is `botChibi`. So the exe ships **exactly the files those
 * two draw, at both densities, and nothing else** — no mask (Lite never recolours), no old `base_*`, and no other item,
 * since Lite ships no store to buy one from:
 *
 * - `body_<g>_L30` and `body_<g>_face_<expr>_L50` — the two v4 bodies and their six faces each;
 * - `bot_<n>_L30` and `bot_<n>_face_<expr>_L50` — the eight bots;
 * - both layers (`_L20` behind, `_L60` in front) of each gender's default hairstyle;
 * - the default outfit and every cut of it.
 *
 * The bodies and the bots are a pattern (`DRAWN`); the hairs and the outfit are *read out of the catalogue*
 * (`apps/normal-server/data/items.json`) rather than written here. 2026-09-20: an item may carry a cut per wear
 * (`asset.variants`), and a body drawn in a cut Lite did not copy renders undressed. v4: a hairstyle is two layers
 * (`asset.back` and `asset.file`), and a figure missing either renders bald. Adding a cut to the default outfit stays
 * what it is meant to be — one line of data — instead of also being a line of build script nobody remembers to change.
 *
 * This lives beside `build.mjs` rather than inside it because `build.mjs` runs its own build the
 * moment it is imported; a rule worth a test has to be importable without one.
 */
import { readFileSync } from 'node:fs'

/**
 * The default hairstyle of each gender, by item id: the kit's `DEFAULT_HAIR` (`packages/ui-kit/src/avatar2d/defaults.ts`)
 * and the server's (`apps/normal-server/src/inventory/slots.ts`) — the same pair. `avatar-files.test.ts` pins the names,
 * and the Lite e2e is the runtime check: every layer of a seat must decode, so a drift between this list and the kit
 * shows up as a bald figure there.
 */
export const LITE_DEFAULT_HAIRS = ['hair_f_bob01', 'hair_m_tousled01']

/**
 * The manifest names (no density suffix) of the default outfit's layers, in a stable order: the shared
 * file first, then its variants by wear.
 *
 * Throws rather than guessing: a catalogue with no default outfit is a Lite build whose every player
 * renders in their underwear, and the build should stop instead of shipping that.
 *
 * @param {unknown} catalogue the parsed `items.json`
 * @returns {string[]}
 */
export function defaultOutfitLayers(catalogue) {
  if (!Array.isArray(catalogue)) throw new Error('the item catalogue is not a JSON array')
  const outfits = catalogue.filter((item) => item?.slot === 'outfit' && item?.isDefault === true)
  if (outfits.length !== 1) throw new Error(`the item catalogue has ${outfits.length} default outfits — it must have exactly one`)
  const asset = outfits[0].asset
  if (!asset || typeof asset.file !== 'string' || asset.file === '') throw new Error(`the default outfit ${outfits[0].id} has no asset file`)
  const variants = asset.variants ?? {}
  return [asset.file, ...Object.keys(variants).sort().map((wear) => variants[wear])]
}

/** `defaultOutfitLayers` over the catalogue at `path`. */
export function readDefaultOutfitLayers(path) {
  return defaultOutfitLayers(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * The manifest names (no density suffix) of both layers of each default hairstyle, in `LITE_DEFAULT_HAIRS` order: the
 * back half (`asset.back`, L20) and then the front (`asset.file`, L60), hair by hair. A hairstyle is drawn on both sides
 * of the body, so one half without the other is a bald or half-headed figure, never a smaller build.
 *
 * Throws rather than guessing, like `defaultOutfitLayers`: a default hair that is missing from the catalogue, is not a
 * `hairStyle`, or lacks a layer is a Lite build whose humans would be drawn without it, and the build should stop.
 *
 * @param {unknown} catalogue the parsed `items.json`
 * @returns {string[]}
 */
export function defaultHairLayers(catalogue) {
  if (!Array.isArray(catalogue)) throw new Error('the item catalogue is not a JSON array')
  return LITE_DEFAULT_HAIRS.flatMap((id) => {
    const item = catalogue.find((entry) => entry?.id === id)
    if (!item) throw new Error(`the default hair ${id} is not in the item catalogue`)
    if (item.slot !== 'hairStyle') throw new Error(`the default hair ${id} is not a hairStyle (its slot is ${String(item.slot)})`)
    const { file, back } = item.asset ?? {}
    if (typeof file !== 'string' || file === '') throw new Error(`the default hair ${id} has no front layer (asset.file)`)
    if (typeof back !== 'string' || back === '') throw new Error(`the default hair ${id} has no back layer (asset.back)`)
    return [back, file]
  })
}

/** `defaultHairLayers` over the catalogue at `path`. */
export function readDefaultHairLayers(path) {
  return defaultHairLayers(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * The bodies, their faces, and the bots, at both densities — the whole name, so `body_f_L30_skinmask@2x.png` (a mask),
 * `base_f01_L30@1x.png` (an old base) and `bot_1_L30_extra@1x.png` are not it. Bots and bodies have no catalogue row, and
 * their names are pinned by the pipeline (`bodyFile`, `bodyFaceFile`, `bot_<n>`), so a pattern is the whole rule.
 */
const DRAWN = /^(?:body_[fm]_(?:L30|face_[a-z]+_L50)|bot_\d+_(?:L30|face_[a-z]+_L50))@[12]x\.png$/

/**
 * Whether one entry of Normal's `public/avatar/` is a file Lite ships, given the layers from above (the default outfit's
 * and the default hairs', concatenated).
 *
 * The match on a layer is `<name>@1x.png` / `<name>@2x.png` as a whole, so `item_outfit_casual01_L40@2x.png` is taken
 * and a longer name that merely starts with it — `item_outfit_casual01_m_L40@2x.png`, which is a *different* layer, or
 * `item_hair_f_bob01_L60_hairmask@2x.png`, which is a mask — is not, unless the catalogue named it too.
 */
export function isLiteAvatarFile(name, layers) {
  return DRAWN.test(name) || layers.some((layer) => name === `${layer}@1x.png` || name === `${layer}@2x.png`)
}
