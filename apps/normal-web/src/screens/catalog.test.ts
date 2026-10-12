import { describe, expect, it } from 'vitest'
import type { AchievementDefDto, ItemDto } from '../api.js'
import enNormal from '../locales/en/normal.json'
import viNormal from '../locales/vi/normal.json'
import { makeI18n } from '../test-i18n.js'
import { hintFor } from './catalog.js'

const vi = makeI18n('vi').getFixedT(null, 'normal')
const en = makeI18n('en').getFixedT(null, 'normal')

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

// What the server's data holds: the six epics a daily draw can never hand out, a common and a rare it can, and the
// day-28 pair (`DAILY_FIXED_ITEM_IDS`).
const UNDRAWABLE_EPICS = [
  item({ id: 'head_tophat01', slot: 'head', rarity: 'epic' }),
  item({ id: 'face_eyepatch01', slot: 'face', rarity: 'epic' }),
  item({ id: 'aura_lightning01', slot: 'aura', rarity: 'epic' }),
  item({ id: 'frame_gold', slot: 'frame', rarity: 'epic' }),
  item({ id: 'haircolor_lavender01', slot: 'hairColor', rarity: 'epic', colour: '#b57edc' }),
  item({ id: 'eyecolor_gold01', slot: 'eyeColor', rarity: 'epic', colour: '#d4af37' }),
]
const COMMON_HAT = item({ id: 'head_cap_red01', slot: 'head', rarity: 'common' })
const RARE_COLOUR = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#2a5fd6' })
const BADGE_MONTHLY = item({ id: 'badge_monthly', slot: 'badge', rarity: 'rare' })
const TITLE_DEVOTED = item({ id: 'title_devoted', slot: 'title', rarity: 'rare' })
const OUTFIT = item({ id: 'outfit_champion01', slot: 'outfit', rarity: 'epic' })

const ACHIEVEMENTS: readonly AchievementDefDto[] = [
  { id: 'login_days_100', category: 'login', metric: 'totalLoginDays', threshold: 100, reward: { itemId: 'head_crown_gold01' } },
  { id: 'login_streak_28', category: 'login', metric: 'bestLoginStreak', threshold: 28, reward: { itemId: 'title_devoted' } },
  { id: 'login_days_7', category: 'login', metric: 'totalLoginDays', threshold: 7, reward: { points: 5000 } },
]

describe('hintFor', () => {
  it.each(UNDRAWABLE_EPICS.map((i) => [i.id, i] as const))('does not promise %s from the daily draw, which never draws an epic', (_id, epic) => {
    expect(hintFor(epic, ACHIEVEMENTS, vi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(epic, ACHIEVEMENTS, en)).toBe(enNormal.wardrobe.hint.unavailable)
  })

  it('names the day-28 check-in as the way to the month badge', () => {
    expect(hintFor(BADGE_MONTHLY, ACHIEVEMENTS, vi)).toBe('Quà điểm danh ngày 28')
    expect(hintFor(BADGE_MONTHLY, ACHIEVEMENTS, en)).toBe('The day-28 check-in gift')
    expect(viNormal.wardrobe.hint.dailyFixed).toBe('Quà điểm danh ngày 28')
    expect(enNormal.wardrobe.hint.dailyFixed).toBe('The day-28 check-in gift')
  })

  it('names the day-28 gift for the month badge even when no achievement list has loaded', () => {
    expect(hintFor(BADGE_MONTHLY, [], vi)).toBe(viNormal.wardrobe.hint.dailyFixed)
  })

  it('keeps naming the achievement for the day-28 title, which a 28-day streak also earns', () => {
    expect(hintFor(TITLE_DEVOTED, ACHIEVEMENTS, vi)).toBe(viNormal.achievements.login_streak_28.name)
    // …and without the achievement list the title is still the day-28 gift, not "no way to earn this".
    expect(hintFor(TITLE_DEVOTED, [], vi)).toBe(viNormal.wardrobe.hint.dailyFixed)
  })

  it('still calls a common in a draw slot a gift of the daily draw', () => {
    expect(hintFor(COMMON_HAT, ACHIEVEMENTS, vi)).toBe(viNormal.wardrobe.hint.daily.common)
    expect(hintFor(COMMON_HAT, ACHIEVEMENTS, en)).toBe(enNormal.wardrobe.hint.daily.common)
  })

  it('still calls a rare in a draw slot a gift of the daily draw', () => {
    expect(hintFor(RARE_COLOUR, ACHIEVEMENTS, vi)).toBe(viNormal.wardrobe.hint.daily.rare)
  })

  it('names the achievement that rewards the item, even for an epic in a draw slot', () => {
    const crown = item({ id: 'head_crown_gold01', slot: 'head', rarity: 'epic' })

    expect(hintFor(crown, ACHIEVEMENTS, vi)).toBe(viNormal.achievements.login_days_100.name)
    expect(hintFor(crown, ACHIEVEMENTS, en)).toBe(enNormal.achievements.login_days_100.name)
  })

  it('says "no way to earn this" for what nothing hands out: an outfit, or an item outside the draw slots', () => {
    expect(hintFor(OUTFIT, [], vi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(item({ id: 'title_rookie', slot: 'title', rarity: 'common' }), ACHIEVEMENTS, vi)).toBe(viNormal.wardrobe.hint.unavailable)
  })
})
