/**
 * The review sheet: one PNG with every layer in the set worn by both bases, at `docs/avatar-2d-sheet.png`.
 *
 * Spec §9 makes this a gate rather than a nicety. Two things about layered art cannot be seen in a
 * directory listing or in any automatic check — whether the pieces belong to the same drawing, and
 * whether an item is still recognisable once it has been shrunk to the 32 px badge on the lobby bar —
 * and both are decided by a person looking at one picture. This builds that picture: every outfit, hat,
 * face accessory, aura and frame on both bases, the six expressions, and the portrait cut at all three
 * sizes D01 §5 and spec §3 call for.
 *
 * It composes through the same layer order and hide rules the renderer will use, so a sheet that looks
 * wrong is telling you about the assets or the rules, not about the sheet.
 */
import { CROP, FRAME, LAYERS } from './frame.mjs'
import { BASES, BOTS, EXPRESSIONS, STAGE_ONE_ITEMS, baseFile, botFaceFile, botFile, faceFile, itemFile, parseName, wearOf } from './manifest.mjs'
import { blankPicture, cropPicture, overPicture, readPicture, renderSvg, resizePicture, writePicture } from './png.mjs'

const TILE = { w: 192, h: 224 }
const CAPTION_H = 22
const GAP = 12
const COLUMNS = 10
const PORTRAIT_SIZES = [192, 40, 32]
const BACKDROP = [26, 30, 36, 255]

/** The three sizes the portrait is shown at: profile, seat, lobby bar (spec §3). */
const portraitCaption = (size) => `portrait ${size} px`

function layersOf(manifest, names) {
  return names
    .filter((name) => manifest.files[name])
    .map((name) => ({ name, layer: parseName(name)?.layer ?? 0 }))
    .sort((a, b) => a.layer - b.layer)
}

/**
 * The outfit layer a given base actually wears (2026-09-20): its wear's variant when the manifest lists
 * one, the shared default otherwise. The sheet is the style gate, so it has to show m01 in the male cut
 * of a skirted uniform rather than in the skirt nobody will see him in.
 */
function outfitFor(manifest, base, code) {
  const wear = wearOf(base)
  const variant = wear === null ? null : itemFile('outfit', code, LAYERS.outfit, wear)
  return variant !== null && manifest.files[variant] ? variant : itemFile('outfit', code, LAYERS.outfit)
}

/** The base's own five layers, dressed in one outfit and wearing one expression. */
function dressed(manifest, base, outfit, expression, extras = []) {
  return [
    baseFile(base, LAYERS.hairBack),
    baseFile(base, LAYERS.body),
    outfitFor(manifest, base, outfit),
    faceFile(base, expression),
    baseFile(base, LAYERS.hairFront),
    ...extras,
  ]
}

/** D01 §4.3: a hood hides the hair it covers, and the sheet has to show that it does. */
function applyHideRules(manifest, names) {
  const hidden = new Set()
  for (const name of names) {
    const entry = manifest.files[name]
    if (entry?.hidesHairFront) hidden.add(LAYERS.hairFront)
    if (entry?.hidesHairBack) hidden.add(LAYERS.hairBack)
  }
  return names.filter((name) => {
    const parsed = parseName(name)
    return !(parsed?.kind === 'base' && hidden.has(parsed.layer))
  })
}

/** Every card the sheet shows, in the order it shows them. */
function cards(manifest) {
  const list = []
  for (const base of BASES) {
    for (const expression of EXPRESSIONS) list.push({ caption: `${base} ${expression}`, names: dressed(manifest, base, 'casual01', expression) })
    for (const code of STAGE_ONE_ITEMS.outfit) list.push({ caption: `${base} ${code}`, names: dressed(manifest, base, code, 'neutral') })
    for (const code of STAGE_ONE_ITEMS.head) {
      list.push({ caption: `${base} ${code}`, names: applyHideRules(manifest, dressed(manifest, base, 'casual01', 'neutral', [itemFile('head', code, LAYERS.head)])) })
    }
    for (const code of STAGE_ONE_ITEMS.face) list.push({ caption: `${base} ${code}`, names: dressed(manifest, base, 'casual01', 'neutral', [itemFile('face', code, LAYERS.faceAcc)]) })
    for (const code of STAGE_ONE_ITEMS.aura) list.push({ caption: `${base} ${code}`, names: [itemFile('aura', code, LAYERS.aura), ...dressed(manifest, base, 'casual01', 'neutral')] })
    for (const code of STAGE_ONE_ITEMS.frame) list.push({ caption: `${base} ${code}`, names: dressed(manifest, base, 'casual01', 'neutral', [itemFile('frame', code, LAYERS.frame)]) })
  }
  for (const bot of BOTS) list.push({ caption: `bot ${bot}`, names: [botFile(bot), botFaceFile(bot, 'neutral')] })
  const portrait = dressed(manifest, 'f01', 'tuxedo01', 'happy', [itemFile('head', 'tophat01', LAYERS.head), itemFile('frame', 'gold', LAYERS.frame)])
  for (const size of PORTRAIT_SIZES) list.push({ caption: portraitCaption(size), names: portrait, portrait: size })
  return list
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

export async function buildSheet({ dir, manifest, out, log = () => {} }) {
  const cache = new Map()
  const read = async (name) => {
    if (!cache.has(name)) cache.set(name, await readPicture(`${dir}/${name}@1x.png`))
    return cache.get(name)
  }

  const list = cards(manifest)
  const rows = Math.ceil(list.length / COLUMNS)
  const width = COLUMNS * (TILE.w + GAP) + GAP
  const height = rows * (TILE.h + CAPTION_H + GAP) + GAP
  const canvas = blankPicture(width, height)
  for (let p = 0; p < width * height; p++) canvas.data.set(BACKDROP, p * 4)

  const captions = []
  for (const [index, card] of list.entries()) {
    const column = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    const left = GAP + column * (TILE.w + GAP)
    const top = GAP + row * (TILE.h + CAPTION_H + GAP)

    const composed = blankPicture(FRAME.w, FRAME.h)
    for (const layer of layersOf(manifest, card.names)) overPicture(composed, await read(layer.name))

    if (card.portrait) {
      const cut = await resizePicture(cropPicture(composed, CROP.x, CROP.y, CROP.size, CROP.size), card.portrait, card.portrait)
      blit(canvas, cut, left + Math.round((TILE.w - card.portrait) / 2), top + Math.round((TILE.h - card.portrait) / 2))
    } else {
      blit(canvas, await resizePicture(composed, TILE.w, TILE.h), left, top)
    }
    captions.push(`<text x="${left + TILE.w / 2}" y="${top + TILE.h + 15}" text-anchor="middle" font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-size="13" fill="#c9d2dc">${card.caption}</text>`)
  }

  overPicture(canvas, await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${captions.join('')}</svg>`, width, height))
  await writePicture(canvas, out)
  log(`${list.length} cards on a ${width} × ${height} sheet → ${out}`)
  return { width, height, cards: list.length }
}
