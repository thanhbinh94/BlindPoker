import { fnv1a } from './bot.js'
import type { BodyRef, ChibiConfig, Expression, Gender, HairRef } from './types.js'

const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/**
 * The hairstyle each gender starts with — the same pair as the server's `DEFAULT_HAIR`
 * (`apps/normal-server/src/inventory/slots.ts`). `apps/normal-web/src/avatar/kit-defaults.test.ts` holds both
 * against `items.json`, so the two cannot drift apart unnoticed.
 */
export const DEFAULT_HAIR: Readonly<Record<Gender, string>> = { f: 'hair_f_bob01', m: 'hair_m_tousled01' }

/**
 * The layer `outfit_casual01` draws on each body: its `asset.variants[g]` where the catalogue has a cut for that
 * gender, else its `asset.file`. Both are the shared file today; a male cut added to the catalogue is a change here
 * too (R14 — `kit-defaults.test.ts` fails until it is made).
 */
export const DEFAULT_OUTFIT_FILE: Readonly<Record<Gender, string>> = { f: 'item_outfit_casual01_L40', m: 'item_outfit_casual01_L40' }

/** A hairstyle by the naming rule: `hair_<code>` draws `item_hair_<code>_L20` behind the body and `_L60` in front of
 * the face. No `tint` — a default chibi is drawn in the hairstyle's own colour. */
export function hairRefOf(itemId: string): HairRef {
  return { id: itemId, back: `item_${itemId}_L20`, front: `item_${itemId}_L60` }
}

/** A body by the naming rule: `body_<g>_L30` and `body_<g>_face_<expression>_L50`, with no `tint`. */
function bodyRefOf(gender: Gender): BodyRef {
  const faces = {} as Record<Expression, string>
  for (const expression of EXPRESSIONS) faces[expression] = `body_${gender}_face_${expression}_L50`
  return { gender, body: `body_${gender}_L30`, faces }
}

/**
 * A brand-new human chibi (spec `2026-10-03-avatar-v4-design.md` §6.4): no wardrobe and no colours — the body's
 * own skin and eyes, its gender's default hairstyle in its natural colour, and the one outfit every player starts
 * in. `seed` picks the gender by the parity of its FNV-1a hash — even gets `f`, odd gets `m` — so the same player
 * id always lands on the same figure without a lookup anywhere. This is the whole of a Lite player's look, and a
 * Normal seat's before its avatar has loaded.
 */
export function defaultChibi(seed: string): ChibiConfig {
  const gender: Gender = fnv1a(seed) % 2 === 0 ? 'f' : 'm'
  return {
    kind: 'human',
    body: bodyRefOf(gender),
    hair: hairRefOf(DEFAULT_HAIR[gender]),
    outfit: { id: 'outfit_casual01', order: 40, file: DEFAULT_OUTFIT_FILE[gender] },
  }
}
