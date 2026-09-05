import type { ClientNotification } from '@bp/ui-kit'
import { describe, expect, it } from 'vitest'
import viNormal from './locales/vi/normal.json'
import { mapNotifications } from './notifications.js'
import { makeI18n } from './test-i18n.js'

const t = makeI18n('vi').getFixedT(null, 'normal')

const note = (kind: string, payload: unknown, id = 1): ClientNotification => ({ id, kind, payload, at: 0 })

describe('mapNotifications', () => {
  it('replaces the achievement id with the name this edition has for it', () => {
    const [mapped] = mapNotifications([note('ACHIEVEMENT_UNLOCKED', { id: 'login_days_7', reward: { points: 5_000 } })], t)

    expect((mapped?.payload as { id: string }).id).toBe(viNormal.achievements.login_days_7.name)
    // Everything else the server sent survives: the kit reads `amount` off the same payload.
    expect((mapped?.payload as { reward: unknown }).reward).toEqual({ points: 5_000 })
  })

  it('falls back to the id for an achievement this bundle has no name for', () => {
    const [mapped] = mapNotifications([note('ACHIEVEMENT_UNLOCKED', { id: 'shipped_after_this_build' })], t)

    expect((mapped?.payload as { id: string }).id).toBe('shipped_after_this_build')
  })

  it('leaves every other kind exactly as it found it', () => {
    const list = [note('BALANCE_CHANGED', { amount: 500 }, 1), note('ACHIEVEMENT_UNLOCKED', null, 2)]

    expect(mapNotifications(list, t)).toBe(list)
  })

  it('hands back the very same array when there is nothing to rewrite', () => {
    const list = [note('SOMETHING_ELSE', { id: 'login_days_7' })]

    expect(mapNotifications(list, t)).toBe(list)
  })

  it('touches only the achievement rows in a mixed stack', () => {
    const other = note('BALANCE_CHANGED', { amount: 500 }, 1)
    const mapped = mapNotifications([other, note('ACHIEVEMENT_UNLOCKED', { id: 'login_days_7' }, 2)], t)

    expect(mapped[0]).toBe(other)
    expect((mapped[1]?.payload as { id: string }).id).toBe(viNormal.achievements.login_days_7.name)
  })
})
