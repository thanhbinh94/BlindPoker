import { CHAOS_CARDS_SPEC, HAND_CATEGORY_KEYS, HandCategory, parseCard } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { cardLabel, createI18n, detectLanguage, errorLabel, formatCompactPoints, formatPoints, handLabel, setLanguage } from './index.js'
import en from './locales/en/game.json'
import enCommon from './locales/en/common.json'
import vi from './locales/vi/game.json'
import viCommon from './locales/vi/common.json'

const flatten = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('locale resources', () => {
  it('en and vi have exactly the same keys in both namespaces', () => {
    expect(flatten(en).sort()).toEqual(flatten(vi).sort())
    expect(flatten(enCommon).sort()).toEqual(flatten(viCommon).sort())
  })
  it('cover every hand category, error code and action kind', () => {
    const keys = new Set(flatten(vi))
    for (const k of HAND_CATEGORY_KEYS) expect(keys.has(k)).toBe(true)
    for (const k of ['fold', 'check', 'call', 'bet', 'raise', 'allIn', 'play']) expect(keys.has(`actions.${k}`)).toBe(true)
    const common = new Set(flatten(viCommon))
    for (const code of ['NOT_YOUR_TURN', 'STALE_STATE', 'ROOM_FULL', 'SERVER_SHUTDOWN', 'INTERNAL']) expect(common.has(`errors.${code}`)).toBe(true)
  })
  it('has no empty strings', () => {
    for (const res of [en, vi, enCommon, viCommon]) for (const v of Object.values(flattenValues(res))) expect(String(v).trim()).not.toBe('')
  })
  // Spec §26: the balance is points, not money. A dong sign — or the abbreviation "đ" standing in as a unit — turns
  // a play-money score into a currency figure, which is exactly what this product must never imply.
  it('never states an amount in currency', () => {
    for (const res of [en, vi, enCommon, viCommon]) {
      for (const [key, value] of Object.entries(flattenValues(res))) {
        const text = String(value)
        expect(text.trim(), key).not.toBe('đ')
        expect(text, key).not.toMatch(/[₫]|VND/)
      }
    }
    expect(viCommon.units.pointsShort).toBe('điểm')
    expect(enCommon.units.pointsShort).toBe('pts')
  })
})

// Plan 37: every card the catalogue can deal has a name and a one-line description in both languages, and no id shows.
describe('chaos card copy', () => {
  const cards = (res: typeof vi) => res.chaos.cards as Record<string, { name: string; desc: string }>

  it('names and describes every card of the catalogue in vi and en, and nothing else', () => {
    const ids = CHAOS_CARDS_SPEC.map((c) => c.id).sort()
    expect(ids).toHaveLength(47)
    for (const [lang, res] of [['vi', vi], ['en', en]] as const) {
      expect(Object.keys(cards(res)).sort(), lang).toEqual(ids)
      for (const id of ids) {
        const { name, desc } = cards(res)[id]!
        expect(name.trim(), `${lang} ${id} name`).not.toBe('')
        expect(desc.trim(), `${lang} ${id} desc`).not.toBe('')
        expect(desc, `${lang} ${id} desc is one line`).not.toMatch(/\n/)
        expect(`${name} ${desc}`, `${lang} ${id} shows no id`).not.toMatch(/\b[sgd]_[a-z0-9_]+\b/)
      }
    }
  })

  it('gives every card a name of its own within a language', () => {
    for (const res of [vi, en]) {
      const names = Object.values(cards(res)).map((c) => c.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('names the three tiers, the daily cap, and the stable terms', () => {
    expect(vi.chaos.tier).toEqual({ silver: 'Bạc', gold: 'Vàng', diamond: 'Kim cương' })
    expect(en.chaos.tier).toEqual({ silver: 'Silver', gold: 'Gold', diamond: 'Diamond' })
    expect(vi.chaos.capped).toBe('Đã chạm trần thẻ hôm nay')
    expect(vi.labels.chaosMode).toBe('Hỗn loạn')
    expect(vi.create.chaos).toBe('Poker hỗn loạn')
    expect(vi.create.chaosCycle).toBe('Chu kỳ thẻ')
    expect(vi.chaos.used).toBe('Thẻ đã dùng')
  })

  // The icon's tooltip counts hands: "1 hand left" in English, and the same plain "còn N ván" in Vietnamese at any count.
  it('counts the hands a card has left in the right plural', () => {
    const en = createI18n({ language: 'en', storage: null })
    expect([0, 1, 2, 10].map((count) => en.t('game:chaos.handsLeft', { count }))).toEqual(['0 hands left', '1 hand left', '2 hands left', '10 hands left'])
    const vn = createI18n({ language: 'vi', storage: null })
    expect([1, 2].map((count) => vn.t('game:chaos.handsLeft', { count }))).toEqual(['còn 1 ván', 'còn 2 ván'])
  })

  it('has the chaos table strings the room draws: the blindfold, the peek, the Bạo kích shout, the banner', () => {
    expect(vi.chaos.blindfolded).toBe('Bị che mắt')
    expect(vi.chaos.peek).toBe('Nhìn trộm')
    expect(vi.chaos.critShout).toBe('Bạo kích ×{{multiplier}}!')
    expect(vi.chaos.draft.picked).toBe('Đã chọn — chờ người chơi khác')
    expect(vi.chaos.banner.use).toContain('{{card}}')
    expect(en.chaos.banner.useOn).toContain('{{targets}}')
  })

  it('labels the chaos error codes in both languages', () => {
    for (const res of [viCommon, enCommon]) {
      expect(res.errors.CHAOS_UNAVAILABLE.trim()).not.toBe('')
      expect(res.errors.CHAOS_NO_OFFER.trim()).not.toBe('')
      expect(res.errors.CHAOS_CANNOT_USE.trim()).not.toBe('')
    }
  })
})

function flattenValues(o: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (typeof v === 'object' && v !== null) Object.assign(out, flattenValues(v)); else out[k] = v
  return out
}

describe('detectLanguage', () => {
  it('prefers storage, then navigator, then vi', () => {
    const s = new MemoryStorage()
    expect(detectLanguage(s, 'en-US')).toBe('en')
    expect(detectLanguage(s, 'vi-VN')).toBe('vi')
    expect(detectLanguage(s, 'fr')).toBe('en')
    expect(detectLanguage(s, undefined)).toBe('vi')
    s.setItem('bp.lang', 'en')
    expect(detectLanguage(s, 'vi-VN')).toBe('en')
    s.setItem('bp.lang', 'xx')
    expect(detectLanguage(s, 'vi-VN')).toBe('vi')
  })
})

describe('createI18n', () => {
  it('translates in vi by default and switches at runtime, persisting the choice', async () => {
    const s = new MemoryStorage()
    const i18n = createI18n({ storage: s, navigatorLanguage: undefined })
    expect(i18n.language).toBe('vi')
    expect(i18n.t('game:actions.fold')).toBe('Bỏ bài')
    await setLanguage(i18n, 'en', s)
    expect(i18n.t('game:actions.fold')).toBe('Fold')
    expect(s.getItem('bp.lang')).toBe('en')
  })
  it('labels cards, hands and errors', () => {
    const i18n = createI18n({ language: 'en', storage: null })
    expect(cardLabel(parseCard('As'), i18n.t)).toBe('Ace of spades')
    expect(handLabel(HandCategory.FULL_HOUSE, i18n.t)).toBe('Full house')
    expect(errorLabel('ROOM_FULL', i18n.t)).toMatch(/full/i)
    expect(errorLabel('NOPE' as never, i18n.t)).toBe(i18n.t('common:errors.INTERNAL'))
    const vi = createI18n({ language: 'vi', storage: null })
    expect(cardLabel(parseCard('As'), vi.t)).toBe('Át bích')
    expect(handLabel(HandCategory.STRAIGHT, vi.t)).toBe('Sảnh')
  })
})

describe('formatting', () => {
  it('formats points per language', () => {
    expect(formatPoints(12500, 'vi')).toBe('12.500')
    expect(formatPoints(12500, 'en')).toBe('12,500')
    expect(formatCompactPoints(12500, 'en')).toBe('12.5K')
    expect(formatCompactPoints(12500, 'vi')).toBe('12,5K')
    expect(formatCompactPoints(1_200_000, 'en')).toBe('1.2M')
    expect(formatCompactPoints(999, 'en')).toBe('999')
  })
})
