/**
 * Which of Normal's avatar PNGs Lite ships (`docs/avatar-2d.md` §8).
 *
 * Lite has no wardrobe and no per-account cosmetics: every human at a Lite table is `defaultChibi`
 * (`packages/ui-kit/src/avatar2d/defaults.ts`), which is a base, a bot face and **the one default
 * outfit**. So the copy is the `base_*` and `bot_*` layers plus that outfit's own files, and nothing
 * else — Lite ships no store to buy another item from.
 *
 * 2026-09-20: "that outfit's own files" is no longer one name. An item may carry a cut per wear
 * (`asset.variants` in `apps/normal-server/data/items.json`), and a base drawn in a cut Lite did not
 * copy renders undressed. The rule is therefore read out of the catalogue rather than written here:
 * **the default outfit's `asset.file` and every variant of it the catalogue lists**. Adding a cut to
 * the default outfit stays what it is meant to be — one line of data — instead of also being a line
 * of build script nobody remembers to change.
 *
 * This lives beside `build.mjs` rather than inside it because `build.mjs` runs its own build the
 * moment it is imported; a rule worth a test has to be importable without one.
 */
import { readFileSync } from 'node:fs'

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
 * Whether one entry of Normal's `public/avatar/` is a file Lite ships, given the layers from above.
 *
 * The match on a layer is `<name>@` rather than the bare name, so `item_outfit_casual01_L40@2x.png` is
 * taken and a longer name that merely starts with it — `item_outfit_casual01_m_L40@2x.png`, which is a
 * *different* layer — is not, unless the catalogue named it too.
 */
export function isLiteAvatarFile(name, layers) {
  if (name.startsWith('base_') || name.startsWith('bot_')) return true
  return layers.some((layer) => name.startsWith(`${layer}@`))
}
