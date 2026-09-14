import type { BotChibi } from './types.js'

/** The eight placeholder bot chibis (`bot_0_*` … `bot_7_*`), until real AI-generated art replaces them. */
export const BOT_FACE_COUNT = 8

/**
 * FNV-1a over UTF-16 code units: cheap, stable across sessions and machines, and good enough to spread eight faces
 * (or two bases) evenly. Kept here — not duplicated — because `botFaceIndex`, `botChibi` and `defaultChibi` all
 * need the exact same hash so a seed keeps the same identity everywhere it is used.
 */
export function fnv1a(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Which of the eight bot faces a seed gets. Unchanged from the old `BotFace.tsx` on purpose: a bot's identity —
 * which face it wears — must not shift under a player who has been at the table for the whole game.
 */
export function botFaceIndex(seed: string): number {
  return fnv1a(seed) % BOT_FACE_COUNT
}

/** A bot's chibi subject: one of the eight `bot_<index>_*` placeholder sets, chosen by `seed`. */
export function botChibi(seed: string): BotChibi {
  return { kind: 'bot', index: botFaceIndex(seed) }
}
