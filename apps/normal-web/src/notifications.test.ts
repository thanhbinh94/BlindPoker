import type { ClientNotification } from '@bp/ui-kit'
import { describe, expect, it } from 'vitest'
import enNormal from './locales/en/normal.json'
import viNormal from './locales/vi/normal.json'
import { mapNotifications } from './notifications.js'
import { makeI18n } from './test-i18n.js'

const t = makeI18n('vi').getFixedT(null, 'normal')

const note = (kind: string, payload: unknown, id = 1): ClientNotification => ({ id, kind, payload, at: 0 })

describe('mapNotifications', () => {
  it('replaces the achievement id with the name this edition has for it', () => {
    const [mapped] = mapNotifications([note('ACHIEVEMENT_UNLOCKED', { id: 'login_days_7', reward: { points: 5_000 } })], t, 'vi')

    expect((mapped?.payload as { id: string }).id).toBe(viNormal.achievements.login_days_7.name)
    // Everything else the server sent survives: the kit reads `amount` off the same payload.
    expect((mapped?.payload as { reward: unknown }).reward).toEqual({ points: 5_000 })
  })

  it('falls back to the id for an achievement this bundle has no name for', () => {
    const [mapped] = mapNotifications([note('ACHIEVEMENT_UNLOCKED', { id: 'shipped_after_this_build' })], t, 'vi')

    expect((mapped?.payload as { id: string }).id).toBe('shipped_after_this_build')
  })

  it('leaves every other kind exactly as it found it', () => {
    const list = [note('BALANCE_CHANGED', { amount: 500 }, 1), note('ACHIEVEMENT_UNLOCKED', null, 2)]

    expect(mapNotifications(list, t, 'vi')).toBe(list)
  })

  it('hands back the very same array when there is nothing to rewrite', () => {
    const list = [note('SOMETHING_ELSE', { id: 'login_days_7' })]

    expect(mapNotifications(list, t, 'vi')).toBe(list)
  })

  it('touches only the achievement rows in a mixed stack', () => {
    const other = note('BALANCE_CHANGED', { amount: 500 }, 1)
    const mapped = mapNotifications([other, note('ACHIEVEMENT_UNLOCKED', { id: 'login_days_7' }, 2)], t, 'vi')

    expect(mapped[0]).toBe(other)
    expect((mapped[1]?.payload as { id: string }).id).toBe(viNormal.achievements.login_days_7.name)
  })
})

describe('mapNotifications — a game master’s notice', () => {
  const reasonOf = (n: ClientNotification | undefined): unknown => (n?.payload as { reason?: unknown }).reason

  it('writes the amount, signed, in front of the reason of a points notice', () => {
    const [mapped] = mapNotifications([note('GM_NOTICE', { action: 'grant_points', amount: 12_000, reason: 'thưởng' })], t, 'vi')

    expect(reasonOf(mapped)).toBe('+12.000 điểm — thưởng')
    // The rest of the payload survives for the kit.
    expect((mapped?.payload as { action: string }).action).toBe('grant_points')
  })

  it('writes a deduction with its minus', () => {
    const [mapped] = mapNotifications([note('GM_NOTICE', { action: 'adjust_points', amount: -3_000, reason: 'nhầm' })], t, 'vi')

    expect(reasonOf(mapped)).toBe('-3.000 điểm — nhầm')
  })

  it('names the item a notice granted, in the language it is rendered in', () => {
    const en = makeI18n('en').getFixedT(null, 'normal')
    const [mapped] = mapNotifications([note('GM_NOTICE', { action: 'grant_item', itemId: 'title_hot_hand', reason: 'prize' })], en, 'en')

    expect(reasonOf(mapped)).toBe(`${enNormal.items.title_hot_hand} — prize`)
  })

  it('leaves a notice with no amount to print, and every other action, as the server wrote it', () => {
    const list = [
      note('GM_NOTICE', { action: 'lock', reason: 'gian lận' }, 1),
      note('GM_NOTICE', { action: 'grant_points', reason: 'không có số' }, 2),
      note('GM_NOTICE', null, 3),
    ]

    expect(mapNotifications(list, t, 'vi')).toEqual(list)
  })

  it('rewrites only the notice in a mixed stack', () => {
    const other = note('BALANCE_CHANGED', { amount: 500 }, 1)
    const mapped = mapNotifications([other, note('GM_NOTICE', { action: 'grant_points', amount: 500, reason: 'x' }, 2)], t, 'vi')

    expect(mapped[0]).toBe(other)
    expect(reasonOf(mapped[1])).toBe('+500 điểm — x')
  })
})
