/**
 * The review sheets: `docs/avatar-2d-sheet.png`, the style gate, and (Plan 19) `docs/avatar-2d-fit-sheet.png`, the
 * hat-and-glasses fit check.
 *
 * Spec §9 makes the first a gate rather than a nicety. Two things about layered art cannot be seen in a
 * directory listing or in any automatic check — whether the pieces belong to the same drawing, and
 * whether an item is still recognisable once it has been shrunk to the 32 px badge on the lobby bar —
 * and both are decided by a person looking at one picture.
 *
 * Plan 19 (spec §5.6) rebuilt the card list for v4: a body per gender, a hairstyle as an item of its own (L20
 * behind the body, L60 in front), skin painted in a tone. The review sheet shows, each block from a new row:
 *
 * - **the v4 grid** — for each gender, each of its hairstyles × two outfits (`casual01`, `dealer01`, the gender's
 *   cut where it exists) × three tones: `skin_porcelain01`'s colour, natural and `skin_deep01`'s colour, read from
 *   `items.json`. A tone whose item is missing is drawn natural and its caption says so. 48 cards; `--hairs` and
 *   `--outfits` narrow this block and nothing else (the style gate uses them);
 * - **every outfit** on both genders (the male cut where one exists), on the gender's default hairstyle — 12;
 * - **every aura and every frame** on body f with the bob, in `casual01` — 14;
 * - **the six expressions** per gender — 12; **the eight bots**; **the portrait** at the three sizes D01 §5 and
 *   spec §3 call for.
 *
 * The fit sheet tries every hat and every face item on each of the eight hairstyles, on the hairstyle's gender, in
 * `casual01` — 96 cards, one row per item, each cut to the portrait crop at @1x so a brim that misses the head
 * shows. A hat's hide rules drop the hair layer they name (R2, R12).
 *
 * Both compose through the same layer order and hide rules the renderer uses, and paint a tone with the shared
 * `recolour` at the body's own skin `meanL`, so a sheet that looks wrong is telling you about the assets or the
 * rules, not about the sheet.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CROP, FRAME, LAYERS } from './frame.mjs'
import { MASK_FILE_KIND } from './masks.mjs'
import {
  BOTS,
  EXPRESSIONS,
  GENDERS,
  HAIR_CODES,
  STAGE_ONE_ITEMS,
  WEARS,
  bodyFaceFile,
  bodyFile,
  botFaceFile,
  botFile,
  hairFile,
  hairGender,
  itemFile,
  parseName,
} from './manifest.mjs'
import { blankPicture, clonePicture, cropPicture, overPicture, readPicture, renderSvg, resizePicture, writePicture } from './png.mjs'
import { ratio, recolour, shade } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

/**
 * @typedef {{ files: Record<string, any> }} SheetManifest
 * @typedef {{
 *   block: string, caption: string[], names: string[], warn?: boolean,
 *   gender?: string, hair?: string, item?: string,
 *   tone?: { gender: string, colour: string }, portrait?: number, crop?: boolean,
 * }} SheetCard
 * @typedef {{ columns: number, tile: { w: number, h: number } }} SheetGrid
 */

const GAP = 12
/** Two caption lines under every card: what it is, then the detail (tone, hairstyle, hide rules). */
const CAPTION_H = 36
const PORTRAIT_SIZES = [192, 40, 32]
const BACKDROP = [26, 30, 36, 255]
const INK = { caption: '#c9d2dc', detail: '#8f9aa6', warn: '#e8b04a' }

/** The review sheet: twelve cards a row (two hairstyles of the v4 grid), each the frame at half size. */
export const SHEET_GRID = { columns: 12, tile: { w: 192, h: 224 } }
/** The fit sheet: one row per item, one column per hairstyle, each the portrait crop at @1x. */
export const FIT_GRID = { columns: HAIR_CODES.length, tile: { w: CROP.size, h: CROP.size } }

/** Spec §5.6's three tones, the outer two read from `items.json` (A3 adds the items; until then they draw natural). */
export const SHEET_TONES = [
  { label: 'porcelain', item: 'skin_porcelain01' },
  { label: 'natural', item: null },
  { label: 'deep', item: 'skin_deep01' },
]
/** The v4 grid's two outfits, unless `--outfits` names others. */
export const GRID_OUTFITS = ['casual01', 'dealer01']

/** The three sizes the portrait is shown at: profile, seat, lobby bar (spec §3). */
const portraitCaption = (size) => `portrait ${size} px`

/** A gender's default hairstyle: its first in `HAIR_CODES`, the bob and the tousled cut (the server's `DEFAULT_HAIR`). */
const defaultHair = (gender) => HAIR_CODES.find((code) => hairGender(code) === gender)

function layersOf(manifest, names) {
  return names
    .filter((name) => manifest.files[name])
    .map((name) => ({ name, layer: parseName(name)?.layer ?? 0 }))
    .sort((a, b) => a.layer - b.layer)
}

/**
 * The outfit layer a v4 body wears, and how a caption names it: the gender's cut when the manifest lists one
 * (`item_outfit_dealer01_m_L40`, "dealer01_m"), the shared layer otherwise. A gender is a wear letter, so the cut
 * is named by it directly. The sheet is the style gate: it has to show the male body in the trousered cut of a
 * skirted uniform rather than in the skirt nobody will see him in.
 */
function outfitCut(manifest, gender, code) {
  const cut = WEARS.includes(gender) ? itemFile('outfit', code, LAYERS.outfit, gender) : null
  if (cut !== null && manifest.files[cut]) return { name: cut, label: `${code}_${gender}` }
  return { name: itemFile('outfit', code, LAYERS.outfit), label: code }
}

/** A v4 figure: the hairstyle's back layer, the body, the outfit, one face, the hairstyle's front layer, then `extras`. */
function wornBy(manifest, { gender, hair, outfit, expression = 'neutral' }, extras = []) {
  return [
    hairFile(hair, LAYERS.hairBack),
    bodyFile(gender),
    outfitCut(manifest, gender, outfit).name,
    bodyFaceFile(gender, expression),
    hairFile(hair, LAYERS.hairFront),
    ...extras,
  ]
}

/** D01 §4.3 on v4 hair: a worn item's `hidesHairFront` drops the hairstyle's L60, `hidesHairBack` its L20. */
function applyHideRules(manifest, names) {
  const hidden = new Set()
  for (const name of names) {
    const entry = manifest.files[name]
    if (entry?.hidesHairFront) hidden.add(LAYERS.hairFront)
    if (entry?.hidesHairBack) hidden.add(LAYERS.hairBack)
  }
  return names.filter((name) => {
    const parsed = parseName(name)
    return !(parsed?.kind === 'hair' && hidden.has(parsed.layer))
  })
}

/** One card, its layers already through the hide rules — so what a card names is what it draws. */
const card = (manifest, fields) => ({ ...fields, names: applyHideRules(manifest, fields.names) })

/** A tone as the grid draws it: its colour from `items.json`, or natural — and a caption saying which. */
function toneOf(items, { label, item }) {
  if (item === null) return { colour: null, caption: label }
  const colour = items.find((entry) => entry?.id === item)?.colour
  if (typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour)) return { colour: colour.toLowerCase(), caption: `${label} ${colour.toLowerCase()}` }
  return { colour: null, caption: `${label} (no item: natural)`, missing: true }
}

/**
 * `--hairs` / `--outfits`: codes with or without their id prefix (`hair_f_bob01` or `f_bob01`), each one known. An empty
 * list (`--hairs ""`) is refused: it would narrow the grid to nothing and still write a sheet, exit 0 — leave the option
 * out to see all of them.
 */
function narrowTo(given, known, prefix, what) {
  if (given === null || given === undefined) return null
  const codes = given.map((code) => String(code).trim()).filter(Boolean).map((code) => (code.startsWith(prefix) ? code.slice(prefix.length) : code))
  if (codes.length === 0) throw new Error(`--${what === 'hairstyle' ? 'hairs' : 'outfits'} names no ${what} — give one or more of ${known.join(', ')}, or leave the option out for all of them`)
  const unknown = codes.filter((code) => !known.includes(code))
  if (unknown.length) throw new Error(`unknown ${what} ${unknown.join(', ')} — one of ${known.join(', ')}`)
  return [...new Set(codes)]
}

/**
 * Every card of the review sheet, in order, each `{ block, caption: string[], names, … }`. `items` is `items.json`
 * (the tones); `hairs` and `outfits` narrow the v4 grid — `null` for all eight hairstyles and `GRID_OUTFITS`.
 *
 * @param {SheetManifest} manifest
 * @param {{ items?: any[], hairs?: string[] | null, outfits?: string[] | null }} [options]
 * @returns {SheetCard[]}
 */
export function sheetCards(manifest, { items = [], hairs = null, outfits = null } = {}) {
  const hairList = narrowTo(hairs, HAIR_CODES, 'hair_', 'hairstyle') ?? HAIR_CODES
  const outfitList = narrowTo(outfits, STAGE_ONE_ITEMS.outfit, 'outfit_', 'outfit') ?? GRID_OUTFITS
  const tones = SHEET_TONES.map((tone) => toneOf(items ?? [], tone))
  const list = []

  for (const gender of GENDERS) {
    for (const hair of HAIR_CODES.filter((code) => hairGender(code) === gender && hairList.includes(code))) {
      for (const outfit of outfitList) {
        for (const tone of tones) {
          list.push(card(manifest, {
            block: 'grid',
            gender,
            hair,
            caption: [`${hair} · ${outfitCut(manifest, gender, outfit).label}`, tone.caption],
            ...(tone.missing ? { warn: true } : {}),
            names: wornBy(manifest, { gender, hair, outfit }),
            ...(tone.colour ? { tone: { gender, colour: tone.colour } } : {}),
          }))
        }
      }
    }
  }

  for (const code of STAGE_ONE_ITEMS.outfit) {
    for (const gender of GENDERS) {
      const hair = defaultHair(gender)
      list.push(card(manifest, { block: 'outfits', gender, hair, caption: [`${gender} ${outfitCut(manifest, gender, code).label}`, hair], names: wornBy(manifest, { gender, hair, outfit: code }) }))
    }
  }

  const showcase = { gender: 'f', hair: defaultHair('f'), outfit: 'casual01' }
  for (const code of STAGE_ONE_ITEMS.aura) {
    list.push(card(manifest, { block: 'auras', caption: [`aura ${code}`], names: [itemFile('aura', code, LAYERS.aura), ...wornBy(manifest, showcase)] }))
  }
  for (const code of STAGE_ONE_ITEMS.frame) {
    list.push(card(manifest, { block: 'frames', caption: [`frame ${code}`], names: wornBy(manifest, showcase, [itemFile('frame', code, LAYERS.frame)]) }))
  }

  for (const gender of GENDERS) {
    const hair = defaultHair(gender)
    for (const expression of EXPRESSIONS) {
      list.push(card(manifest, { block: 'expressions', gender, hair, caption: [`${gender} ${expression}`, hair], names: wornBy(manifest, { gender, hair, outfit: 'casual01', expression }) }))
    }
  }

  for (const bot of BOTS) list.push(card(manifest, { block: 'bots', caption: [`bot ${bot}`], names: [botFile(bot), botFaceFile(bot, 'neutral')] }))

  const portrait = wornBy(manifest, { ...showcase, outfit: 'tuxedo01', expression: 'happy' }, [itemFile('head', 'tophat01', LAYERS.head), itemFile('frame', 'gold', LAYERS.frame)])
  for (const size of PORTRAIT_SIZES) list.push(card(manifest, { block: 'portraits', caption: [portraitCaption(size)], names: portrait, portrait: size }))
  return list
}

/** What a head item's hide rules drop, for its fit-sheet caption. */
function hidesCaption(entry) {
  const parts = [entry?.hidesHairFront ? 'front' : null, entry?.hidesHairBack ? 'back' : null].filter(Boolean)
  return parts.length ? `hides ${parts.join('+')}` : 'hides none'
}

/**
 * Every card of the fit sheet: each hat in `STAGE_ONE_ITEMS.head` and each face item, on each of the eight
 * hairstyles — on the hairstyle's own gender, in `casual01`, with the hide rules applied to the hair layers.
 * Each card is `{ block, item, hair, gender, caption, names, crop: true }`; `block` is the item, one row each.
 *
 * @param {SheetManifest} manifest
 * @returns {SheetCard[]}
 */
export function fitCards(manifest) {
  const tried = [
    ...STAGE_ONE_ITEMS.head.map((code) => itemFile('head', code, LAYERS.head)),
    ...STAGE_ONE_ITEMS.face.map((code) => itemFile('face', code, LAYERS.faceAcc)),
  ]
  const list = []
  for (const item of tried) {
    const { slot, code } = parseName(item)
    for (const hair of HAIR_CODES) {
      const gender = hairGender(hair)
      list.push(card(manifest, {
        block: item,
        item,
        hair,
        gender,
        caption: [hair, slot === 'head' ? `${code} · ${hidesCaption(manifest.files[item])}` : code],
        names: wornBy(manifest, { gender, hair, outfit: 'casual01' }, [item]),
        crop: true,
      }))
    }
  }
  return list
}

/**
 * Where every card goes: `grid.columns` to a row, and each block from a new row, so a block reads as rows of its
 * own. Returns the canvas size and each card's top-left corner.
 *
 * @param {Array<{ block: string }>} cards
 * @param {SheetGrid} grid
 * @returns {{ width: number, height: number, at: Array<{ left: number, top: number }> }}
 */
export function sheetLayout(cards, { columns, tile }) {
  const at = []
  let row = -1
  let column = columns
  let block
  for (const each of cards) {
    if (column === columns || each.block !== block) {
      row++
      column = 0
      block = each.block
    }
    at.push({ left: GAP + column * (tile.w + GAP), top: GAP + row * (tile.h + CAPTION_H + GAP) })
    column++
  }
  const rows = Math.max(1, row + 1)
  return { width: columns * (tile.w + GAP) + GAP, height: rows * (tile.h + CAPTION_H + GAP) + GAP, at }
}

/** One layer's `<kind>mask@1x` as a plain alpha array (`recolour`'s mask), or `null` when it is not on disk. */
async function maskAlpha(dir, name, kind) {
  const file = join(dir, `${name}_${MASK_FILE_KIND[kind]}mask@1x.png`)
  if (!existsSync(file)) return null
  const pic = await readPicture(file)
  const alpha = new Uint8Array(pic.width * pic.height)
  for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]
  return alpha
}

/**
 * The @1x layers a sheet reads, each read once: as drawn, or — for a toned card's body and body faces — painted
 * with `recolour` under the layer's own skin mask at the **body's** skin `meanL`, the one number both layers are
 * tinted at so the seam between body and face stays invisible (as `tint-sheet` does for a hairstyle's two layers).
 * Its skin-line mask, when it has one, is then shaded at the same `meanL` (`shade`, 2026-10-05), as the kit does — on
 * an outfit too, whose copy of the hands' outline is the wearer's skin's to shade. The skin an outfit or a front hair
 * picture redrew (its skin mask, 2026-10-05) is painted by `ratio` rather than `recolour`, at the same `meanL`, before
 * the line, as the kit does. A layer with none of these is drawn as it is.
 */
function layerReader(dir, manifest) {
  const cache = new Map()
  const plain = async (name) => {
    if (!cache.has(name)) cache.set(name, readPicture(join(dir, `${name}@1x.png`)))
    return cache.get(name)
  }
  const toned = async (name, tone) => {
    const key = `${name} ${tone.colour} ${tone.gender}` // the gender too: a shared outfit is shaded at either body's meanL
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const picture = await plain(name)
        const meanL = manifest.files[bodyFile(tone.gender)]?.masks?.skin?.meanL
        if (meanL === undefined) return picture
        const skin = manifest.files[name]?.masks?.skin
        const line = manifest.files[name]?.masks?.skinLine
        const skinMask = !skin || skin.empty ? null : await maskAlpha(dir, name, 'skin')
        const lineMask = !line || line.empty ? null : await maskAlpha(dir, name, 'skinLine')
        if (!skinMask && !lineMask) return picture
        const painted = clonePicture(picture)
        const parsed = parseName(name)
        const ownSkin = parsed?.kind === 'body' || parsed?.kind === 'bodyFace'
        if (skinMask) (ownSkin ? recolour : ratio)(painted.data, skinMask, tone.colour, meanL)
        if (lineMask) shade(painted.data, lineMask, tone.colour, meanL)
        return painted
      })())
    }
    return cache.get(key)
  }
  return async (name, tone) => {
    if (!tone) return plain(name)
    const parsed = parseName(name)
    const skinOfBody = (parsed?.kind === 'body' || parsed?.kind === 'bodyFace') && parsed.gender === tone.gender
    // An outfit's copy of the outline and its redrawn skin are the wearer's, whichever body it was cut on; a front
    // hair's redrawn skin is its gender's, the only body it is worn on.
    const masks = manifest.files[name]?.masks
    const outfitSkin = parsed?.kind === 'item' && parsed.slot === 'outfit' && (masks?.skinLine !== undefined || masks?.skin !== undefined)
    const hairSkin = parsed?.kind === 'hair' && parsed.layer === LAYERS.hairFront && masks?.skin !== undefined
    return skinOfBody || outfitSkin || hairSkin ? toned(name, tone) : plain(name)
  }
}

/**
 * One card composed on the full frame at @1x, in layer order, toned when the card has a tone.
 *
 * @param {SheetCard} each
 * @param {{ dir: string, manifest: SheetManifest, read?: (name: string, tone?: SheetCard['tone']) => Promise<{ data: Buffer, width: number, height: number }> }} options
 * @returns {Promise<{ data: Buffer, width: number, height: number }>}
 */
export async function composeCard(each, { dir, manifest, read = layerReader(dir, manifest) }) {
  const composed = blankPicture(FRAME.w, FRAME.h)
  for (const layer of layersOf(manifest, each.names)) overPicture(composed, await read(layer.name, each.tone))
  return composed
}

/** Alpha-over one picture onto another at an offset, clipping what falls outside. Shared with `tint-sheet.mjs`. */
export function blit(canvas, picture, left, top) {
  for (let y = 0; y < picture.height; y++) {
    const dy = y + top
    if (dy < 0 || dy >= canvas.height) continue
    for (let x = 0; x < picture.width; x++) {
      const dx = x + left
      if (dx < 0 || dx >= canvas.width) continue
      const source = (y * picture.width + x) * 4
      const sa = picture.data[source + 3] / 255
      if (sa === 0) continue
      const at = (dy * canvas.width + dx) * 4
      const da = canvas.data[at + 3] / 255
      const out = sa + da * (1 - sa)
      for (let c = 0; c < 3; c++) canvas.data[at + c] = Math.round((picture.data[source + c] * sa + canvas.data[at + c] * da * (1 - sa)) / out)
      canvas.data[at + 3] = Math.round(out * 255)
    }
  }
}

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Lay `cards` out on `grid`, compose each, caption it, and write the sheet to `out`. */
async function writeSheet(cards, grid, { dir, manifest, read, out }) {
  const { width, height, at } = sheetLayout(cards, grid)
  const { tile } = grid
  const canvas = blankPicture(width, height)
  for (let p = 0; p < width * height; p++) canvas.data.set(BACKDROP, p * 4)

  const captions = []
  for (const [index, each] of cards.entries()) {
    const { left, top } = at[index]
    const composed = await composeCard(each, { dir, manifest, read })
    if (each.portrait) {
      const cut = await resizePicture(cropPicture(composed, CROP.x, CROP.y, CROP.size, CROP.size), each.portrait, each.portrait)
      blit(canvas, cut, left + Math.round((tile.w - each.portrait) / 2), top + Math.round((tile.h - each.portrait) / 2))
    } else if (each.crop) {
      // The fit sheet's tile is the portrait crop at @1x (`FIT_GRID`): the cut is already the tile's size.
      blit(canvas, cropPicture(composed, CROP.x, CROP.y, CROP.size, CROP.size), left, top)
    } else {
      blit(canvas, await resizePicture(composed, tile.w, tile.h), left, top)
    }
    const [first, ...rest] = each.caption
    const x = left + tile.w / 2
    const text = (y, size, fill, line) =>
      `<text x="${x}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-size="${size}" fill="${fill}">${escapeXml(line)}</text>`
    captions.push(text(top + tile.h + 15, 13, INK.caption, first))
    for (const [line, detail] of rest.entries()) captions.push(text(top + tile.h + 30 + line * 14, 12, each.warn ? INK.warn : INK.detail, detail))
  }

  overPicture(canvas, await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${captions.join('')}</svg>`, width, height))
  await writePicture(canvas, out)
  return { width, height, cards: cards.length }
}

/**
 * Write the review sheet to `out` and, when `fitOut` is given, the fit sheet to it. `items` is `items.json` (the
 * tones); `hairs` / `outfits` narrow the v4 grid only.
 *
 * @param {{ dir: string, manifest: SheetManifest, items?: any[], hairs?: string[] | null, outfits?: string[] | null, out: string, fitOut?: string | null, log?: (message: string) => void }} options
 */
export async function buildSheet({ dir, manifest, items = [], hairs = null, outfits = null, out, fitOut = null, log = () => {} }) {
  const read = layerReader(dir, manifest)
  const cards = sheetCards(manifest, { items, hairs, outfits })
  const sheet = await writeSheet(cards, SHEET_GRID, { dir, manifest, read, out })
  log(`${sheet.cards} cards on a ${sheet.width} × ${sheet.height} sheet → ${out}`)
  const missing = SHEET_TONES.filter((tone) => tone.item !== null && toneOf(items ?? [], tone).missing).map((tone) => tone.item)
  if (missing.length) log(`no ${missing.join(' or ')} in items.json: ${missing.length === 1 ? 'its tone is' : 'their tones are'} drawn natural, and the captions say so`)
  if (!fitOut) return { ...sheet, fit: null }
  const fit = await writeSheet(fitCards(manifest), FIT_GRID, { dir, manifest, read, out: fitOut })
  log(`${fit.cards} cards on a ${fit.width} × ${fit.height} fit sheet → ${fitOut}`)
  return { ...sheet, fit }
}
