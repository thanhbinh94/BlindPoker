import { HAND_CATEGORY_KEYS, HandCategory, parseCard } from '@bp/core'
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
