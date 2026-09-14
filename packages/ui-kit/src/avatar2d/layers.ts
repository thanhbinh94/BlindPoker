import { fnv1a } from './bot.js'
import type { ChibiFrame, ChibiSubject, Expression, LayerRef } from './types.js'

const ORDER = { aura: 10, hairBack: 20, body: 30, outfit: 40, face: 50, hairFront: 60, faceAcc: 70, head: 80, frame: 90 } as const

/**
 * The stack of layers to draw for one chibi, bottom to top, with the spec's hide rules already applied
 * (`2026-09-14-avatar-chibi-ai-design.md` §3, `2026-09-08-avatar-chibi-2d-design.md` §3.4):
 *
 * - A `head` item's `hidesHairFront`/`hidesHairBack` drop layers 60/20 — a hood covers the hair, a beret does not.
 * - The `frame` *parameter* (the crop mode, not the layer) governs the outermost two layers: the head-crop avatar
 *   drops the aura (10, it would just bleed off the circular edge) but keeps the frame border (90, drawn for
 *   exactly this picture); the full-body view drops the frame border (90, avatar-only decoration) and keeps aura.
 *
 * Bots have no wardrobe at all — just their body (30) and expression face (50).
 */
export function layersFor(subject: ChibiSubject, expression: Expression, frame: ChibiFrame): LayerRef[] {
  if (subject.kind === 'bot') {
    return [
      { order: ORDER.body, file: `bot_${subject.index}_L30` },
      { order: ORDER.face, file: `bot_${subject.index}_face_${expression}_L50` },
    ]
  }

  const { base, outfit, head, face, aura, frame: frameItem } = subject
  const layers: LayerRef[] = []

  if (aura !== undefined && frame !== 'head') layers.push({ order: ORDER.aura, file: aura.file })
  if (head?.hidesHairBack !== true) layers.push({ order: ORDER.hairBack, file: base.hairBack })
  layers.push({ order: ORDER.body, file: base.body })
  layers.push({ order: ORDER.outfit, file: outfit.file })
  layers.push({ order: ORDER.face, file: base.faces[expression] })
  if (head?.hidesHairFront !== true) layers.push({ order: ORDER.hairFront, file: base.hairFront })
  if (face !== undefined) layers.push({ order: ORDER.faceAcc, file: face.file })
  if (head !== undefined) layers.push({ order: ORDER.head, file: head.file })
  if (frameItem !== undefined && frame !== 'full') layers.push({ order: ORDER.frame, file: frameItem.file })

  return layers.sort((a, b) => a.order - b.order)
}

/** A canonical string for a chibi's *configuration* — the set of equipped ids, not the expression or frame — so
 * `Chibi` can key a `data-chibi-hash` off it for testing and for any future keyed-list rendering. */
function canonicalSubject(subject: ChibiSubject): string {
  if (subject.kind === 'bot') return `bot:${subject.index}`
  const { base, outfit, head, face, aura, frame } = subject
  return `human:${base.id}:${outfit.id}:${head?.id ?? ''}:${face?.id ?? ''}:${aura?.id ?? ''}:${frame?.id ?? ''}`
}

/** A short, stable hash of a chibi's configuration — same subject, same hash, every time. */
export function hashChibi(subject: ChibiSubject): string {
  return fnv1a(canonicalSubject(subject)).toString(16)
}
