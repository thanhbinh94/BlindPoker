import { describe, expect, it } from 'vitest'
import type { AchievementDefDto, DailyGiftNoticeDto, ItemDto } from '../api.js'
import enNormal from '../locales/en/normal.json'
import viNormal from '../locales/vi/normal.json'
import { makeI18n } from '../test-i18n.js'
import { hintFor, type HintSources } from './catalog.js'

const tVi = makeI18n('vi').getFixedT(null, 'normal')
const tEn = makeI18n('en').getFixedT(null, 'normal')

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

// What the server's data holds: the six epics a daily draw can never hand out, a common and a rare it can, and the
// day-28 pair.
const UNDRAWABLE_EPICS = [
  item({ id: 'head_tophat01', slot: 'head', rarity: 'epic' }),
  item({ id: 'face_eyepatch01', slot: 'face', rarity: 'epic' }),
  item({ id: 'aura_lightning01', slot: 'aura', rarity: 'epic' }),
  item({ id: 'frame_gold', slot: 'frame', rarity: 'epic' }),
  item({ id: 'haircolor_lavender01', slot: 'hairColor', rarity: 'epic', colour: '#c7b8f0' }),
  item({ id: 'eyecolor_gold01', slot: 'eyeColor', rarity: 'epic', colour: '#e0b23a' }),
]
const COMMON_HAT = item({ id: 'head_beanie01', slot: 'head', rarity: 'common' })
const RARE_COLOUR = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#3f6fd8' })
const BADGE_MONTHLY = item({ id: 'badge_monthly', slot: 'badge', rarity: 'rare' })
const TITLE_DEVOTED = item({ id: 'title_devoted', slot: 'title', rarity: 'rare' })
const OUTFIT = item({ id: 'outfit_tuxedo01', slot: 'outfit', rarity: 'epic' })

const ACHIEVEMENTS: readonly AchievementDefDto[] = [
  { id: 'login_days_100', category: 'login', metric: 'totalLoginDays', threshold: 100, reward: { itemId: 'head_crown_gold01' } },
  { id: 'login_streak_28', category: 'login', metric: 'bestLoginStreak', threshold: 28, reward: { itemId: 'title_devoted' } },
  { id: 'login_days_7', category: 'login', metric: 'totalLoginDays', threshold: 7, reward: { points: 5000 } },
]

/** What `GET /api/catalog/items` says the check-in names from October 2026 on: the pair every month, the top hat in November. */
const GIFTS: readonly DailyGiftNoticeDto[] = [
  { itemId: 'badge_monthly', day: 28, month: null },
  { itemId: 'title_devoted', day: 28, month: null },
  { itemId: 'head_tophat01', day: 28, month: '2026-11' },
]
const sources = (achievements: readonly AchievementDefDto[], gifts: readonly DailyGiftNoticeDto[] = GIFTS): HintSources => ({ achievements, gifts })
const HEAD_TOPHAT = UNDRAWABLE_EPICS[0]!

describe('hintFor', () => {
  it.each(UNDRAWABLE_EPICS.map((i) => [i.id, i] as const))('does not promise %s from the daily draw, which never draws an epic', (_id, epic) => {
    // Named by no schedule (or by a month gone by, which the server reports the same way: by not listing it).
    expect(hintFor(epic, sources(ACHIEVEMENTS, []), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(epic, sources(ACHIEVEMENTS, []), tEn)).toBe(enNormal.wardrobe.hint.unavailable)
  })

  it('names the day-28 check-in as the way to the month badge', () => {
    expect(hintFor(BADGE_MONTHLY, sources(ACHIEVEMENTS), tVi)).toBe('Quà điểm danh ngày 28')
    expect(hintFor(BADGE_MONTHLY, sources(ACHIEVEMENTS), tEn)).toBe('The day-28 check-in gift')
  })

  it('names the month of a scheduled epic, as the server gives it', () => {
    expect(hintFor(HEAD_TOPHAT, sources([]), tVi)).toBe('Quà điểm danh ngày 28 tháng 11/2026')
    expect(hintFor(HEAD_TOPHAT, sources([]), tEn)).toBe('The day-28 check-in gift of 11/2026')
  })

  it('says "no way to earn this" for an epic whose month has passed, which the server no longer lists', () => {
    const afterNovember = GIFTS.filter((g) => g.itemId !== 'head_tophat01')
    expect(hintFor(HEAD_TOPHAT, sources([], afterNovember), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
  })

  it('names the day-28 gift for the month badge even when no achievement list has loaded', () => {
    expect(hintFor(BADGE_MONTHLY, sources([]), tVi)).toBe('Quà điểm danh ngày 28')
  })

  it('keeps naming the achievement for the day-28 title, which a 28-day streak also earns', () => {
    expect(hintFor(TITLE_DEVOTED, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.achievements.login_streak_28.name)
    // …and without the achievement list the title is still the day-28 gift, not "no way to earn this".
    expect(hintFor(TITLE_DEVOTED, sources([]), tVi)).toBe('Quà điểm danh ngày 28')
  })

  it('still calls a common in a draw slot a gift of the daily draw', () => {
    expect(hintFor(COMMON_HAT, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.daily.common)
    expect(hintFor(COMMON_HAT, sources(ACHIEVEMENTS), tEn)).toBe(enNormal.wardrobe.hint.daily.common)
  })

  it('still calls a rare in a draw slot a gift of the daily draw', () => {
    expect(hintFor(RARE_COLOUR, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.daily.rare)
  })

  it('names the achievement that rewards the item, even for an epic in a draw slot', () => {
    const crown = item({ id: 'head_crown_gold01', slot: 'head', rarity: 'epic' })

    expect(hintFor(crown, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.achievements.login_days_100.name)
    expect(hintFor(crown, sources(ACHIEVEMENTS), tEn)).toBe(enNormal.achievements.login_days_100.name)
  })

  it('says "no way to earn this" for what nothing hands out: an outfit, or an item outside the draw slots', () => {
    expect(hintFor(OUTFIT, sources([]), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(item({ id: 'title_rookie', slot: 'title', rarity: 'common' }), sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
  })
})
