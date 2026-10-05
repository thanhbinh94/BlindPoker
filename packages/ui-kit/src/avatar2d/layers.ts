import { fnv1a } from './bot.js'
import type { BodyRef, ChibiConfig, ChibiFrame, ChibiSubject, Expression, LayerRef, MaskSet, TintRef, WearRef } from './types.js'

const ORDER = { aura: 10, hairBack: 20, body: 30, outfit: 40, face: 50, hairFront: 60, faceAcc: 70, head: 80, frame: 90 } as const

/** One region's paint job on `file`, if it has one: the colour is set and `file` is listed in the region's
 * `MaskSet` — then `<file>_<suffix>` is painted with `colour` at the region's own `meanL` (shaded rather than
 * recoloured for the skin's line art). */
function regionTint(file: string, set: MaskSet | undefined, colour: string | undefined, suffix: 'skinmask' | 'skinlinemask' | 'eyemask' | 'hairmask'): TintRef[] {
  if (colour === undefined || set?.files.includes(file) !== true) return []
  const tint: TintRef = { mask: `${file}_${suffix}`, colour, meanL: set.meanL }
  if (suffix === 'skinlinemask') tint.mode = 'shade'
  return [tint]
}

/** The skin colour's jobs on a body or face layer: its skin, then its line art (2026-10-05). */
function skinTints(file: string, body: BodyRef, colour: string | undefined): TintRef[] {
  return [...regionTint(file, body.tint?.skin, colour, 'skinmask'), ...regionTint(file, body.tint?.skinLine, colour, 'skinlinemask')]
}

/** `tints`, or undefined for none — a layer with nothing to paint carries no `tints` key at all. */
function orNone(tints: TintRef[]): TintRef[] | undefined {
  return tints.length === 0 ? undefined : tints
}

/** A worn item's own colour variant, if any (spec §3.3/§5.2) — its `<file>_tintmask` painted with `item.tint.colour`. */
function itemTints(item: WearRef): TintRef[] | undefined {
  return item.tint === undefined ? undefined : [{ mask: `${item.file}_tintmask`, colour: item.tint.colour, meanL: item.tint.meanL }]
}

function layer(order: number, file: string, tints: TintRef[] | undefined): LayerRef {
  return tints === undefined ? { order, file } : { order, file, tints }
}

/**
 * The stack of layers to draw for one chibi, bottom to top, with the hide rules already applied (avatar v4, spec
 * `2026-10-03-avatar-v4-design.md` §6.3):
 *
 * - L10 aura (full frame only) · L20 the hairstyle's back half · L30 the body · L40 the outfit · L50 the face for
 *   `expression` · L60 the hairstyle's front half · L70 face item · L80 head item · L90 frame (head frame only).
 * - A `head` item's `hidesHairFront`/`hidesHairBack` drop layers 60/20 — a hood covers the hair, a beret does not.
 * - The `frame` *parameter* (the crop mode, not the layer) governs the outermost two layers: the head-crop avatar
 *   drops the aura (10, it would just bleed off the circular edge) but keeps the frame border (90, drawn for
 *   exactly this picture); the full-body view drops the frame border (90, avatar-only decoration) and keeps aura.
 * - Colours land only where a mask says they may: `skinColor` on the body and on each face listed in
 *   `body.tint.skin`, `eyeColor` on each face listed in `body.tint.eyes` (skin first, then eyes, on one face), and
 *   `hairColor` on each hair layer listed in `hair.tint` — each at its own region's `meanL`. `skinColor` also
 *   shades the skin's line art on each layer listed in `body.tint.skinLine`, right after that layer's skin, so a
 *   cream outline does not glow round a darker skin (2026-10-05) — the outfit too, whose picture redrew the hands'
 *   outline, after the outfit's own colour. A worn item's own colour variant lands on that item's layer. A body, hairstyle or item with no masks, or a subject with no colours set, gets none.
 *
 * Bots have no wardrobe at all — just their body (30) and expression face (50), and never carry tints.
 */
export function layersFor(subject: ChibiSubject, expression: Expression, frame: ChibiFrame): LayerRef[] {
  if (subject.kind === 'bot') {
    return [
      { order: ORDER.body, file: `bot_${subject.index}_L30` },
      { order: ORDER.face, file: `bot_${subject.index}_face_${expression}_L50` },
    ]
  }

  const { body, hair, outfit, head, face, aura, frame: frameItem, hairColor, eyeColor, skinColor } = subject
  const eyes = body.tint?.eyes
  const layers: LayerRef[] = []

  if (aura !== undefined && frame !== 'head') layers.push(layer(ORDER.aura, aura.file, itemTints(aura)))
  if (head?.hidesHairBack !== true) layers.push(layer(ORDER.hairBack, hair.back, orNone(regionTint(hair.back, hair.tint, hairColor, 'hairmask'))))
  layers.push(layer(ORDER.body, body.body, orNone(skinTints(body.body, body, skinColor))))
  layers.push(layer(ORDER.outfit, outfit.file, orNone([...(itemTints(outfit) ?? []), ...regionTint(outfit.file, body.tint?.skinLine, skinColor, 'skinlinemask')])))
  const faceFile = body.faces[expression]
  layers.push(layer(ORDER.face, faceFile, orNone([...skinTints(faceFile, body, skinColor), ...regionTint(faceFile, eyes, eyeColor, 'eyemask')])))
  if (head?.hidesHairFront !== true) layers.push(layer(ORDER.hairFront, hair.front, orNone(regionTint(hair.front, hair.tint, hairColor, 'hairmask'))))
  if (face !== undefined) layers.push(layer(ORDER.faceAcc, face.file, itemTints(face)))
  if (head !== undefined) layers.push(layer(ORDER.head, head.file, itemTints(head)))
  if (frameItem !== undefined && frame !== 'full') layers.push(layer(ORDER.frame, frameItem.file, itemTints(frameItem)))

  return layers.sort((a, b) => a.order - b.order)
}

/** The items whose own colour variant (spec §3.3) can appear on a human subject, in the fixed order
 * `canonicalSubject` folds them into the hash — same order every time, so the string stays deterministic. */
function tintableItems(subject: ChibiConfig): (WearRef | undefined)[] {
  return [subject.outfit, subject.head, subject.face, subject.aura, subject.frame]
}

/** A canonical string for a chibi's *configuration* — the gender, the hairstyle and the equipped ids, not the
 * expression or frame — so `Chibi` can key a `data-chibi-hash` off it for testing and for any future keyed-list
 * rendering:
 *
 * `human4:<gender>:<hair id>:<outfit>:<head>:<face>:<aura>:<frame>`, followed by
 * `:<hairColor>:<eyeColor>:<skinColor>:<item tints>` only when at least one colour or item tint is set, so a
 * colourless chibi's string stays short. The `human4` prefix keeps every v4 hash apart from any v3 (`human:`) one
 * still cached somewhere. */
function canonicalSubject(subject: ChibiSubject): string {
  if (subject.kind === 'bot') return `bot:${subject.index}`
  const { body, hair, outfit, head, face, aura, frame, hairColor, eyeColor, skinColor } = subject
  const core = `human4:${body.gender}:${hair.id}:${outfit.id}:${head?.id ?? ''}:${face?.id ?? ''}:${aura?.id ?? ''}:${frame?.id ?? ''}`

  const items = tintableItems(subject)
  const anyItemTint = items.some((item) => item?.tint !== undefined)
  if (hairColor === undefined && eyeColor === undefined && skinColor === undefined && !anyItemTint) return core

  const tintStr = items.map((item) => (item?.tint === undefined ? '' : `${item.tint.colour}@${item.tint.meanL}`)).join(',')
  return `${core}:${hairColor ?? ''}:${eyeColor ?? ''}:${skinColor ?? ''}:${tintStr}`
}

/** A short, stable hash of a chibi's configuration — same subject, same hash, every time. */
export function hashChibi(subject: ChibiSubject): string {
  return fnv1a(canonicalSubject(subject)).toString(16)
}
