import { randomInt } from 'node:crypto'
import type { Rng } from '@bp/core'

/** Cryptographically secure RNG for shuffles and button selection. */
export const cryptoRng: Rng = { int: (maxExclusive) => randomInt(maxExclusive) }
