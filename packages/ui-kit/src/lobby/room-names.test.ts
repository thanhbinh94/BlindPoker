import { describe, expect, it } from 'vitest'
import { SUPPORTED_LANGUAGES, type Language } from '../i18n/index.js'
import { ROOM_NAME_WORDS, randomRoomName } from './room-names.js'

/** The protocol's `name` limit (`validateRoomConfig`: 1–30 characters once trimmed). */
const MAX_NAME = 30

const combinations = (lang: Language): string[] =>
  ROOM_NAME_WORDS[lang].heads.flatMap((head) => ROOM_NAME_WORDS[lang].tails.map((tail) => `${head} ${tail}`))

/** A generator that answers with the given draws in turn, then repeats the last one. */
const draws = (...values: number[]) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]!
}

/** The two draws that make `randomRoomName` pick the `h`th head and the `t`th tail — each in the middle of its word's slice of [0, 1). */
const drawsAt = (lang: Language, h: number, t: number) =>
  draws((h + 0.5) / ROOM_NAME_WORDS[lang].heads.length, (t + 0.5) / ROOM_NAME_WORDS[lang].tails.length)

/** A small seeded generator (mulberry32), so a "many rolls" test is the same run every time. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('the room-name word lists', () => {
  it('are long enough to make a roll worth taking', () => {
    expect(ROOM_NAME_WORDS.vi.heads.length).toBeGreaterThanOrEqual(5)
    expect(ROOM_NAME_WORDS.vi.tails.length).toBeGreaterThanOrEqual(24)
    expect(ROOM_NAME_WORDS.en.heads.length).toBeGreaterThanOrEqual(24)
    expect(ROOM_NAME_WORDS.en.tails.length).toBeGreaterThanOrEqual(4)
  })

  for (const lang of SUPPORTED_LANGUAGES) {
    describe(lang, () => {
      it(`makes every pair fit the protocol's ${MAX_NAME}-character room name`, () => {
        const all = combinations(lang)
        expect(all.length).toBe(ROOM_NAME_WORDS[lang].heads.length * ROOM_NAME_WORDS[lang].tails.length)
        for (const name of all) {
          expect(name.length, name).toBeGreaterThanOrEqual(1)
          expect(name.length, name).toBeLessThanOrEqual(MAX_NAME)
          expect(name, 'no stray space at either end').toBe(name.trim())
        }
      })

      it('has no word twice, and no two pairs that read the same', () => {
        const { heads, tails } = ROOM_NAME_WORDS[lang]
        expect(new Set(heads).size).toBe(heads.length)
        expect(new Set(tails).size).toBe(tails.length)
        expect(new Set(combinations(lang)).size).toBe(combinations(lang).length)
      })

      it('makes no pair that reads as something else', () => {
        // "bàn cầu" is a toilet bowl: no tail may follow "Bàn" in a way that says it, whatever the language of the list.
        for (const name of combinations(lang)) expect(name, name).not.toMatch(/^Bàn Cầu\b/)
      })

      it('keeps to letters: no numbers, no gambling words, and composed (NFC) Vietnamese', () => {
        const gambling = /poker|casino|bet\b|chip|jackpot|cược|cờ bạc|sòng|bài/i
        for (const word of [...ROOM_NAME_WORDS[lang].heads, ...ROOM_NAME_WORDS[lang].tails]) {
          expect(word, word).not.toMatch(/\d/)
          expect(word, word).not.toMatch(gambling)
          expect(word, word).toBe(word.normalize('NFC'))
          expect(word, 'capitalised like a proper name').toMatch(/^\p{Lu}/u)
        }
      })
    })
  }
})

describe('randomRoomName', () => {
  it('draws the head first and the tail second', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const { heads, tails } = ROOM_NAME_WORDS[lang]
      expect(randomRoomName(lang, draws(0, 0))).toBe(`${heads[0]} ${tails[0]}`)
      expect(randomRoomName(lang, draws(0, 0.999))).toBe(`${heads[0]} ${tails[tails.length - 1]}`)
      expect(randomRoomName(lang, draws(0.999, 0))).toBe(`${heads[heads.length - 1]} ${tails[0]}`)
    }
  })

  it('stays inside the lists at both ends of the generator’s range', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const all = new Set(combinations(lang))
      for (const edge of [0, Number.MIN_VALUE, 0.5, 0.9999999999999999, 1]) {
        const name = randomRoomName(lang, () => edge)
        expect(all.has(name), `${lang} at ${edge}: ${name}`).toBe(true)
      }
    }
  })

  it('treats a draw outside [0, 1) as the nearest end: negative, NaN and -Infinity are the first word, 1 and up the last', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const { heads, tails } = ROOM_NAME_WORDS[lang]
      const first = `${heads[0]} ${tails[0]}`
      const last = `${heads[heads.length - 1]} ${tails[tails.length - 1]}`
      for (const low of [-0.5, -1, -Infinity, NaN]) expect(randomRoomName(lang, () => low), `${lang} at ${low}`).toBe(first)
      for (const high of [1, 1.5, 2, Infinity]) expect(randomRoomName(lang, () => high), `${lang} at ${high}`).toBe(last)
    }
  })

  it('uses Math.random when no generator is given, and answers in the language asked for', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const all = new Set(combinations(lang))
      for (let i = 0; i < 50; i++) expect(all.has(randomRoomName(lang))).toBe(true)
    }
    expect(new Set(combinations('vi')).has(randomRoomName('en'))).toBe(false)
  })

  it('reaches every pair: the draw in the middle of a word’s slice of [0, 1) picks that word', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const { heads, tails } = ROOM_NAME_WORDS[lang]
      heads.forEach((head, h) => tails.forEach((tail, t) => expect(randomRoomName(lang, drawsAt(lang, h, t))).toBe(`${head} ${tail}`)))
    }
  })

  describe('with a name to avoid', () => {
    it('never answers with it, whichever pair the generator points at', () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        const all = new Set(combinations(lang))
        const { heads, tails } = ROOM_NAME_WORDS[lang]
        heads.forEach((head, h) =>
          tails.forEach((tail, t) => {
            const next = randomRoomName(lang, drawsAt(lang, h, t), `${head} ${tail}`)
            expect(next, `after ${head} ${tail}`).not.toBe(`${head} ${tail}`)
            expect(all.has(next), next).toBe(true)
          }),
        )
      }
    })

    it('does not loop on a generator that is stuck: it steps to another tail instead', () => {
      const stuck = () => 0
      for (const lang of SUPPORTED_LANGUAGES) {
        const first = randomRoomName(lang, stuck)
        const second = randomRoomName(lang, stuck, first)
        expect(second).not.toBe(first)
        expect(second.slice(0, ROOM_NAME_WORDS[lang].heads[0]!.length)).toBe(ROOM_NAME_WORDS[lang].heads[0])
        expect(randomRoomName(lang, stuck, second)).not.toBe(second)
      }
    })

    it('wraps from the last tail to the first', () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        const { heads, tails } = ROOM_NAME_WORDS[lang]
        const last = `${heads[0]} ${tails[tails.length - 1]}`
        expect(randomRoomName(lang, draws(0, 0.999), last)).toBe(`${heads[0]} ${tails[0]}`)
      }
    })

    it('never repeats itself over a long run of rolls, each taken against the one before', () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        const rng = seeded(20261010)
        let previous = randomRoomName(lang, rng)
        const seen = new Set([previous])
        for (let i = 0; i < 500; i++) {
          const next = randomRoomName(lang, rng, previous)
          expect(next).not.toBe(previous)
          seen.add(next)
          previous = next
        }
        expect(seen.size, 'a long run visits many different names').toBeGreaterThan(50)
      }
    })

    it('treats the name as the player sees it: a trailing space does not hide a repeat', () => {
      const name = randomRoomName('en', draws(0, 0))
      expect(randomRoomName('en', draws(0, 0), `  ${name} `)).not.toBe(name)
    })

    it('leaves a name of the player’s own alone: it is not in the lists, so the draw stands', () => {
      expect(randomRoomName('vi', draws(0, 0), 'Quán Nhà Tôi')).toBe(randomRoomName('vi', draws(0, 0)))
      expect(randomRoomName('vi', draws(0, 0), '')).toBe(randomRoomName('vi', draws(0, 0)))
    })
  })
})
