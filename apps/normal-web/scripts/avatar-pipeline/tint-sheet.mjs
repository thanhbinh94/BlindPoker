/**
 * The tint review sheet (Plan 13 spec §4.2): one PNG, `docs/avatar-2d-tint-sheet.png`, that lets a person
 * eyeball hair- and eye-colour tinting before it ships — the same reason `sheet.mjs` exists for the plain
 * layer set, and built the same way: nothing here decides what "looks right", it only composes exactly
 * what the client will draw so a wrong picture points at the assets or the maths, not at the sheet.
 *
 * Two kinds of card:
 *
 * - **One per base per (hair colour, eye colour) pair** — three hair colours × three eye colours (§4.2) —
 *   dressed in `casual01` and every one of the base's own layers that carries a hair or eye mask, tinted
 *   with the shared `recolour` (§5.1) at the base's own `meanL`s: the hair `meanL` always comes from the
 *   base's own `L30` mask and the eye `meanL` from its `face_neutral` mask, and every layer of the base is
 *   tinted at those two numbers — never its own — which is what keeps the seam between the body layer and
 *   the face layer invisible (spec §5.2's closing line). A base with no hair/eye masks yet (nothing has
 *   been through `masks` for it) contributes no cards at all, rather than nine cards of nothing tinted.
 * - **One per `items.json` entry whose `asset.tint` is set** — drawn on `f01`, dressed the same way, with
 *   the item itself recoloured by its own `_tintmask` and its own recorded `meanL`. Before Plan 13's Task 5
 *   lands `asset.tint` on any item this list is empty and the sheet is base cards only, which is correct:
 *   there is nothing yet to prove wrong.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FRAME, LAYERS } from './frame.mjs'
import { MASK_FILE_KIND } from './masks.mjs'
import { BASES, baseFile, faceFile, itemFile, parseName } from './manifest.mjs'
import { blankPicture, overPicture, readPicture, renderSvg, resizePicture, writePicture } from './png.mjs'
import { blit } from './sheet.mjs'
import { recolour } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

const GAP = 12
const CAPTION_H = 22
const COLUMNS = 9
const SCALE = 0.5
const BACKDROP = [43, 47, 58, 255] // #2b2f3a

/** Spec §4.2: three hair colours × three eye colours, tried on every masked base. */
export const HAIR_COLOURS = ['#b3261e', '#e8e1cf', '#3f6fd8']
export const EYE_COLOURS = ['#2f9e55', '#d08a1c', '#8b56d6']

/** The base's own hair/eye `meanL`, from its `L30` and `face_neutral` masks — `null` when either is missing. */
function baseTintMeans(manifest, base) {
  const hairMeanL = manifest.files[baseFile(base, LAYERS.body)]?.masks?.hair?.meanL
  const eyeMeanL = manifest.files[faceFile(base, 'neutral')]?.masks?.eyes?.meanL
  if (hairMeanL === undefined || eyeMeanL === undefined) return null
  return { hairMeanL, eyeMeanL }
}

/** One layer's `<kind>mask@1x` as a plain `Uint8Array` of alpha (`recolour`'s mask argument), or `null`. */
async function maskOf(dir, name, kind) {
  const file = join(dir, `${name}_${MASK_FILE_KIND[kind]}mask@1x.png`)
  if (!existsSync(file)) return null
  const pic = await readPicture(file)
  const mask = new Uint8Array(pic.width * pic.height)
  for (let i = 0; i < mask.length; i++) mask[i] = pic.data[i * 4 + 3]
  return mask
}

/** `name`'s own `@1x` picture, hair- and/or eye-tinted in place at the given `meanL`s — `null` if it has no layer on disk. */
async function tintedLayer(dir, manifest, name, tints) {
  const file = join(dir, `${name}@1x.png`)
  if (!existsSync(file)) return null
  const pic = await readPicture(file)
  const masks = manifest.files[name]?.masks
  if (!masks) return pic
  for (const { kind, colour, meanL } of tints) {
    const info = masks[kind]
    if (!info || info.empty) continue
    const mask = await maskOf(dir, name, kind)
    if (mask) recolour(pic.data, mask, colour, meanL)
  }
  return pic
}

/** One base, one hair/eye pair: `L20`, `L30`, `casual01`, `face_neutral`, `L60` — the base's own layer stack. */
async function baseCard(dir, manifest, base, hairColour, eyeColour, means) {
  const names = [
    baseFile(base, LAYERS.hairBack),
    baseFile(base, LAYERS.body),
    itemFile('outfit', 'casual01', LAYERS.outfit),
    faceFile(base, 'neutral'),
    baseFile(base, LAYERS.hairFront),
  ]
  const tints = [
    { kind: 'hair', colour: hairColour, meanL: means.hairMeanL },
    { kind: 'eyes', colour: eyeColour, meanL: means.eyeMeanL },
  ]
  const canvas = blankPicture(FRAME.w, FRAME.h)
  for (const name of names) {
    if (!manifest.files[name]) continue
    const pic = await tintedLayer(dir, manifest, name, tints)
    if (pic) overPicture(canvas, pic)
  }
  return canvas
}

/** `f01`, dressed, with one item recoloured by its own tint mask and `asset.tint`, in the item's own layer order. */
async function itemCard(dir, manifest, item) {
  const base = 'f01'
  const itemName = item.asset.file
  const dressed = [
    baseFile(base, LAYERS.hairBack),
    baseFile(base, LAYERS.body),
    itemFile('outfit', 'casual01', LAYERS.outfit),
    faceFile(base, 'neutral'),
    baseFile(base, LAYERS.hairFront),
  ]
  const ordered = [...dressed, itemName]
    .filter((name) => manifest.files[name] && existsSync(join(dir, `${name}@1x.png`)))
    .map((name) => ({ name, layer: parseName(name)?.layer ?? 0 }))
    .sort((a, b) => a.layer - b.layer)

  const canvas = blankPicture(FRAME.w, FRAME.h)
  for (const { name } of ordered) {
    if (name !== itemName) {
      overPicture(canvas, await readPicture(join(dir, `${name}@1x.png`)))
      continue
    }
    const pic = await readPicture(join(dir, `${itemName}@1x.png`))
    const tintInfo = manifest.files[itemName]?.masks?.tint
    if (tintInfo && !tintInfo.empty) {
      const mask = await maskOf(dir, itemName, 'tint')
      if (mask) recolour(pic.data, mask, item.asset.tint, tintInfo.meanL)
    }
    overPicture(canvas, pic)
  }
  return canvas
}

/** Every `items.json` entry with a colour to try. */
const tintableItems = (items) => (items ?? []).filter((item) => item?.asset?.tint)

/**
 * Compose the tint review sheet: nine cards per masked base (§4.2's three × three), then one per tintable
 * item, on a `COLUMNS`-wide grid at `SCALE`, and write it to `out` (or `TINT_SHEET_FILE`, the CLI's default).
 *
 * @param {{ dir: string, manifest: { files: Record<string, any> }, items?: Array<{ id?: string, asset: { file: string, tint?: string } }>, out: string, log?: (message: string) => void }} options
 */
export async function buildTintSheet({ dir, manifest, items = [], out, log = () => {} }) {
  const cards = []
  for (const base of BASES) {
    const means = baseTintMeans(manifest, base)
    if (!means) continue
    for (const hair of HAIR_COLOURS) {
      for (const eye of EYE_COLOURS) {
        cards.push({ caption: `${base} hair ${hair} eyes ${eye}`, build: () => baseCard(dir, manifest, base, hair, eye, means) })
      }
    }
  }
  for (const item of tintableItems(items)) {
    cards.push({ caption: `${item.id ?? item.asset.file}`, build: () => itemCard(dir, manifest, item) })
  }

  const tileW = Math.round(FRAME.w * SCALE)
  const tileH = Math.round(FRAME.h * SCALE)
  const rows = Math.max(1, Math.ceil(cards.length / COLUMNS))
  const width = COLUMNS * (tileW + GAP) + GAP
  const height = rows * (tileH + CAPTION_H + GAP) + GAP
  const canvas = blankPicture(width, height)
  for (let p = 0; p < width * height; p++) canvas.data.set(BACKDROP, p * 4)

  const captions = []
  for (const [index, card] of cards.entries()) {
    const column = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    const left = GAP + column * (tileW + GAP)
    const top = GAP + row * (tileH + CAPTION_H + GAP)
    const resized = await resizePicture(await card.build(), tileW, tileH)
    blit(canvas, resized, left, top)
    captions.push(`<text x="${left + tileW / 2}" y="${top + tileH + 15}" text-anchor="middle" font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-size="10" fill="#c9d2dc">${card.caption}</text>`)
  }

  overPicture(canvas, await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${captions.join('')}</svg>`, width, height))
  await writePicture(canvas, out)
  log(`${cards.length} cards on a ${width} × ${height} sheet → ${out}`)
  return { width, height, cards: cards.length }
}
