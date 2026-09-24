import { fnv1a } from './bot.js'
import type { BaseRef, ChibiConfig, ChibiFrame, ChibiSubject, Expression, LayerRef, TintRef, WearRef } from './types.js'

const ORDER = { aura: 10, hairBack: 20, body: 30, outfit: 40, face: 50, hairFront: 60, faceAcc: 70, head: 80, frame: 90 } as const

/** The hair/eye tints a base layer carries, if any — spec §5.2: a layer file that appears in `base.tint.hair.files`
 * gets `<file>_hairmask` painted with `hairColor` when the player set one, and likewise for eyes, hair first. */
function baseTints(file: string, base: BaseRef, hairColor: string | undefined, eyeColor: string | undefined): TintRef[] | undefined {
  const tints: TintRef[] = []
  const hair = base.tint?.hair
  if (hairColor !== undefined && hair?.files.includes(file) === true) {
    tints.push({ mask: `${file}_hairmask`, colour: hairColor, meanL: hair.meanL })
  }
  const eyes = base.tint?.eyes
  if (eyeColor !== undefined && eyes?.files.includes(file) === true) {
    tints.push({ mask: `${file}_eyemask`, colour: eyeColor, meanL: eyes.meanL })
  }
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
 * The stack of layers to draw for one chibi, bottom to top, with the spec's hide rules already applied
 * (`2026-09-14-avatar-chibi-ai-design.md` §3, `2026-09-08-avatar-chibi-2d-design.md` §3.4):
 *
 * - A `head` item's `hidesHairFront`/`hidesHairBack` drop layers 60/20 — a hood covers the hair, a beret does not.
 * - The `frame` *parameter* (the crop mode, not the layer) governs the outermost two layers: the head-crop avatar
 *   drops the aura (10, it would just bleed off the circular edge) but keeps the frame border (90, drawn for
 *   exactly this picture); the full-body view drops the frame border (90, avatar-only decoration) and keeps aura.
 * - Hair/eye colour tints (`2026-09-24-avatar-tint-design.md` §5.2) land on whichever base layers `base.tint`
 *   says carry that mask — body and hair-front for hair, every face for either — and a worn item's own colour
 *   variant lands on that item's layer. A base/item with no masks, or a subject with no colours set, gets none.
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

  const { base, outfit, head, face, aura, frame: frameItem, hairColor, eyeColor } = subject
  const layers: LayerRef[] = []

  if (aura !== undefined && frame !== 'head') layers.push(layer(ORDER.aura, aura.file, itemTints(aura)))
  if (head?.hidesHairBack !== true) layers.push({ order: ORDER.hairBack, file: base.hairBack })
  layers.push(layer(ORDER.body, base.body, baseTints(base.body, base, hairColor, eyeColor)))
  layers.push(layer(ORDER.outfit, outfit.file, itemTints(outfit)))
  const faceFile = base.faces[expression]
  layers.push(layer(ORDER.face, faceFile, baseTints(faceFile, base, hairColor, eyeColor)))
  if (head?.hidesHairFront !== true) layers.push(layer(ORDER.hairFront, base.hairFront, baseTints(base.hairFront, base, hairColor, eyeColor)))
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

/** A canonical string for a chibi's *configuration* — the set of equipped ids, not the expression or frame — so
 * `Chibi` can key a `data-chibi-hash` off it for testing and for any future keyed-list rendering.
 *
 * Hair colour, eye colour and item tints (spec §5.2) are appended only when at least one is actually set, so a
 * subject with none of the three produces byte-for-byte the same string it did before tints existed — every
 * existing snapshot and e2e hash for a colourless chibi keeps working unchanged. */
function canonicalSubject(subject: ChibiSubject): string {
  if (subject.kind === 'bot') return `bot:${subject.index}`
  const { base, outfit, head, face, aura, frame, hairColor, eyeColor } = subject
  const core = `human:${base.id}:${outfit.id}:${head?.id ?? ''}:${face?.id ?? ''}:${aura?.id ?? ''}:${frame?.id ?? ''}`

  const items = tintableItems(subject)
  const anyItemTint = items.some((item) => item?.tint !== undefined)
  if (hairColor === undefined && eyeColor === undefined && !anyItemTint) return core

  const tintStr = items.map((item) => (item?.tint === undefined ? '' : `${item.tint.colour}@${item.tint.meanL}`)).join(',')
  return `${core}:${hairColor ?? ''}:${eyeColor ?? ''}:${tintStr}`
}

/** A short, stable hash of a chibi's configuration — same subject, same hash, every time. */
export function hashChibi(subject: ChibiSubject): string {
  return fnv1a(canonicalSubject(subject)).toString(16)
}
