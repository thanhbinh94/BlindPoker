import { fnv1a } from './bot.js'
import type { BaseRef, ChibiConfig, Expression } from './types.js'

const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/** Builds a `BaseRef` from a base id by the T1 naming convention: `base_<id>_L20|L30|L60` and
 * `base_<id>_face_<expression>_L50`. The id is any string the server's registry defines (2026-09-17):
 * this is a naming rule, and it has never needed to know which figures exist. */
function makeBase(id: string): BaseRef {
  const faces = {} as Record<Expression, string>
  for (const expression of EXPRESSIONS) faces[expression] = `base_${id}_face_${expression}_L50`
  return { id, hairBack: `base_${id}_L20`, body: `base_${id}_L30`, hairFront: `base_${id}_L60`, faces }
}

const BASE_F01 = makeBase('f01')
const BASE_M01 = makeBase('m01')

const DEFAULT_OUTFIT = { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' } as const

/**
 * A brand-new human chibi: no wardrobe, just a base body and the one outfit every player starts in. `seed` picks
 * the base by parity of its FNV-1a hash — even gets `f01`, odd gets `m01` — so the same player id always lands on
 * the same base without a lookup anywhere.
 */
export function defaultChibi(seed: string): ChibiConfig {
  const base = fnv1a(seed) % 2 === 0 ? BASE_F01 : BASE_M01
  return { kind: 'human', base, outfit: { ...DEFAULT_OUTFIT } }
}
