/**
 * The tint review sheet (Plan 13 spec §4.2): one PNG, `docs/avatar-2d-tint-sheet.png`, that lets a person
 * eyeball hair- and eye-colour tinting before it ships — the same reason `sheet.mjs` exists for the plain
 * layer set, and built the same way: nothing here decides what "looks right", it only composes exactly
 * what the client will draw so a wrong picture points at the assets or the maths, not at the sheet.
 *
 * Two kinds of card, both on the v4 figure since the switch-over (Plan 19 D1; until then a card was a flat base):
 *
 * - **One per gender per (hair colour, eye colour) pair** — three hair colours × three eye colours (§4.2) — the
 *   gender's body in its default hairstyle (the first of its `HAIR_CODES`: the bob, the tousled cut) and `casual01`
 *   (the gender's cut, where there is one), tinted with the shared `recolour` (§5.1) the way the kit tints it
 *   (`layersFor`): the hair on both hairstyle layers at the hairstyle's one `meanL` — the front layer's hair mask, or
 *   the back's when the front has none, as the server's `hairTint` is read — and the eyes on the neutral face at the
 *   neutral face's own eye `meanL`. One number per region, so no seam shows between the hairstyle's two halves. A
 *   gender whose hairstyle or face has no hair or eye mask yet contributes no cards at all, rather than nine cards of
 *   nothing tinted.
 * - **One per `items.json` entry whose `asset.tint` is set** — drawn on body f in the bob and `casual01`, with the item
 *   itself recoloured by its own `_tintmask` and its own recorded `meanL`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FRAME, LAYERS } from './frame.mjs'
import { MASK_FILE_KIND } from './masks.mjs'
import { GENDERS, HAIR_CODES, bodyFaceFile, bodyFile, hairFile, hairGender, itemFile, parseName } from './manifest.mjs'
import { blankPicture, overPicture, readPicture, renderSvg, resizePicture, writePicture } from './png.mjs'
import { blit } from './sheet.mjs'
import { recolour } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

const GAP = 12
const CAPTION_H = 22
const COLUMNS = 9
const SCALE = 0.5
const BACKDROP = [43, 47, 58, 255] // #2b2f3a

/** Spec §4.2: three hair colours × three eye colours, tried on each gender. */
export const HAIR_COLOURS = ['#b3261e', '#e8e1cf', '#3f6fd8']
export const EYE_COLOURS = ['#2f9e55', '#d08a1c', '#8b56d6']

/** A gender's default hairstyle: its first in `HAIR_CODES` — the server's `DEFAULT_HAIR`, the bob and the tousled cut. */
const defaultHair = (gender) => HAIR_CODES.find((code) => hairGender(code) === gender)

/** The outfit a gender wears on a card: `casual01`, the gender's own cut when the manifest lists one. */
function casualOf(manifest, gender) {
  const cut = itemFile('outfit', 'casual01', LAYERS.outfit, gender)
  return manifest.files[cut] ? cut : itemFile('outfit', 'casual01', LAYERS.outfit)
}

/** A v4 figure's own layers, bottom to top: the hairstyle's back, the body, `casual01`, the neutral face, the hairstyle's front. */
function figureOf(manifest, gender, hair) {
  return [
    hairFile(hair, LAYERS.hairBack),
    bodyFile(gender),
    casualOf(manifest, gender),
    bodyFaceFile(gender, 'neutral'),
    hairFile(hair, LAYERS.hairFront),
  ]
}

/** A non-empty mask listed on `name`'s manifest entry, or `undefined`. */
const maskInfo = (manifest, name, kind) => {
  const info = manifest.files[name]?.masks?.[kind]
  return info && !info.empty ? info : undefined
}

/**
 * The hair and eye `meanL`s a gender's cards are tinted at — the hairstyle's (its front layer's hair mask, else its
 * back's: the server's `hairTint`) and the neutral face's eyes (`BodyDef.tint.eyes`) — or `null` when either is missing.
 */
function tintMeans(manifest, gender, hair) {
  const hairMeanL = (maskInfo(manifest, hairFile(hair, LAYERS.hairFront), 'hair') ?? maskInfo(manifest, hairFile(hair, LAYERS.hairBack), 'hair'))?.meanL
  const eyeMeanL = maskInfo(manifest, bodyFaceFile(gender, 'neutral'), 'eyes')?.meanL
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
  for (const { kind, colour, meanL } of tints) {
    if (!maskInfo(manifest, name, kind)) continue
    const mask = await maskOf(dir, name, kind)
    if (mask) recolour(pic.data, mask, colour, meanL)
  }
  return pic
}

/** One gender, one hair/eye pair: its figure (`figureOf`), the hair and the eyes tinted at the gender's `meanL`s. */
async function genderCard(dir, manifest, gender, hair, hairColour, eyeColour, means) {
  const tints = [
    { kind: 'hair', colour: hairColour, meanL: means.hairMeanL },
    { kind: 'eyes', colour: eyeColour, meanL: means.eyeMeanL },
  ]
  const canvas = blankPicture(FRAME.w, FRAME.h)
  for (const name of figureOf(manifest, gender, hair)) {
    if (!manifest.files[name]) continue
    const pic = await tintedLayer(dir, manifest, name, tints)
    if (pic) overPicture(canvas, pic)
  }
  return canvas
}

/** Body f in the bob and `casual01`, with one item recoloured by its own tint mask and `asset.tint`, in layer order. */
async function itemCard(dir, manifest, item) {
  const itemName = item.asset.file
  const ordered = [...figureOf(manifest, 'f', defaultHair('f')), itemName]
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
    const tintInfo = maskInfo(manifest, itemName, 'tint')
    if (tintInfo) {
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
 * Compose the tint review sheet: nine cards per masked gender (§4.2's three × three), then one per tintable item, on
 * a `COLUMNS`-wide grid at `SCALE`, and write it to `out` (or `TINT_SHEET_FILE`, the CLI's default).
 *
 * @param {{ dir: string, manifest: { files: Record<string, any> }, items?: Array<{ id?: string, asset: { file: string, tint?: string } }>, out: string, log?: (message: string) => void }} options
 */
export async function buildTintSheet({ dir, manifest, items = [], out, log = () => {} }) {
  const cards = []
  for (const gender of GENDERS) {
    const hair = defaultHair(gender)
    const means = tintMeans(manifest, gender, hair)
    if (!means) continue
    for (const hairColour of HAIR_COLOURS) {
      for (const eyeColour of EYE_COLOURS) {
        // Hairstyle, then hair colour / eye colour: short enough for a half-size tile (the hairstyle code names the gender).
        cards.push({ caption: `${hair} ${hairColour}/${eyeColour}`, build: () => genderCard(dir, manifest, gender, hair, hairColour, eyeColour, means) })
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
