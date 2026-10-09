import type { Language } from '../i18n/index.js'

/**
 * The words a room name is made of: a head and a tail, joined by a space ("Góc Phố Cổ", "Lotus Lounge"). Each language
 * builds its names its own way — Vietnamese puts a kind of gathering before a place or a mood, English an adjective or a
 * place before a kind of room — so the two lists are not translations of each other. Capitalised like proper names, the
 * way a host would write one; no numbers, and nothing that says gambling.
 *
 * The longest pair must fit the protocol's room name, 1–30 characters (`validateRoomConfig`); `room-names.test.ts` walks
 * every pair in both languages, so a word added here that breaks the limit fails there, not in a host's dialog.
 */
export const ROOM_NAME_WORDS: Readonly<Record<Language, { readonly heads: readonly string[]; readonly tails: readonly string[] }>> = {
  vi: {
    heads: ['Bàn', 'Chiếu', 'Góc', 'Hội', 'Tiệc'],
    tails: [
      'Hoa Mai',
      'Gió Mùa',
      'Trăng Rằm',
      'Phố Cổ',
      'Sóng Biển',
      'Mưa Rào',
      'Hồ Gươm',
      'Cầu Rồng',
      'Đà Lạt Sương',
      'Hạ Long',
      'Mây Trắng',
      'Lúa Chín',
      'Sen Hồng',
      'Tre Xanh',
      'Cánh Diều',
      'Sao Khuya',
      'Đèn Lồng',
      'Nắng Hè',
      'Thu Vàng',
      'Sài Gòn Đêm',
      'Cà Phê Sữa',
      'Bến Nhà Rồng',
      'Mũi Né',
      'Phú Quốc',
      'Hoa Sữa',
      'Rặng Dừa',
      'Chợ Nổi',
      'Nón Lá',
      'Cầu Vồng',
      'Đồi Chè',
    ],
  },
  en: {
    heads: [
      'Lotus',
      'Midnight',
      'Harbour',
      'Golden Hour',
      'Monsoon',
      'Lantern',
      'Jade',
      'Saigon',
      'Mekong',
      'Bamboo',
      'Dragon Bridge',
      'Full Moon',
      'Paper Kite',
      'Autumn',
      'Sea Breeze',
      'Old Quarter',
      'Highland',
      'Sunrise',
      'Velvet',
      'Ivory',
      'Copper',
      'Maple',
      'Pearl',
      'Rice Field',
    ],
    tails: ['Table', 'Room', 'Hall', 'Lounge'],
  },
}

/**
 * A random room name for the create-room dialog to open with, and for its 🎲 to roll again. `rng` is `Math.random` unless a
 * test hands in its own: the head is drawn first and the tail second, each from `[0, 1)`.
 *
 * Pass the name now in the field as `avoid` and the answer is never that name (compared as the player sees it, trimmed),
 * so a roll always shows something new. A repeat is not drawn again — a generator that is stuck, as a test's stub is, would
 * never leave it — but the tail steps to the next one along (the first after the last), which cannot repeat since no two
 * pairs read the same. A name of the player's own is not in the lists, so it never costs the draw anything.
 */
export function randomRoomName(lang: Language, rng: () => number = Math.random, avoid?: string): string {
  const { heads, tails } = ROOM_NAME_WORDS[lang]
  // `Math.random` stays below 1, but a stub need not: the last word, not a missing one.
  const draw = (words: readonly string[]): number => Math.min(words.length - 1, Math.floor(rng() * words.length))
  const head = heads[draw(heads)]!
  let tail = draw(tails)
  const taken = avoid?.trim()
  if (`${head} ${tails[tail]!}` === taken) tail = (tail + 1) % tails.length
  return `${head} ${tails[tail]!}`
}
