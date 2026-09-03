export type Card = number

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUIT_CHARS = ['c', 'd', 'h', 's'] as const

export const rankOf = (c: Card): number => c % 13
export const suitOf = (c: Card): number => Math.floor(c / 13)
export const makeCard = (rank: number, suit: number): Card => suit * 13 + rank

export function cardToString(c: Card): string {
  return `${RANK_CHARS[rankOf(c)]}${SUIT_CHARS[suitOf(c)]}`
}

export function parseCard(s: string): Card {
  const rank = RANK_CHARS.indexOf(s[0] as (typeof RANK_CHARS)[number])
  const suit = SUIT_CHARS.indexOf(s[1] as (typeof SUIT_CHARS)[number])
  if (s.length !== 2 || rank < 0 || suit < 0) throw new Error(`Invalid card: ${s}`)
  return makeCard(rank, suit)
}

export function parseCards(s: string): Card[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard)
}

export function createDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i)
}
