export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
}

/** Deterministic mulberry32 generator for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be a positive integer')
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      return Math.floor(r * maxExclusive)
    },
  }
}
