import type { RoomPlayerView } from '@bp/core'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, PlayerAvatarDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n } from '../test-i18n.js'
import { makeAvatarFor, makeCaptionFor, type AvatarCache } from './TableChrome.js'

const CONFIG: AvatarConfigDto = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#2b2b2b',
}

const player = (patch: Partial<RoomPlayerView> & Pick<RoomPlayerView, 'playerId'>): RoomPlayerView => ({
  displayName: patch.playerId,
  isBot: false,
  isHost: false,
  connected: true,
  seat: 0,
  status: null,
  stack: 1000,
  ready: false,
  ...patch,
})

const entry = (playerId: string, avatar: Partial<AvatarConfigDto>): PlayerAvatarDto => ({
  playerId,
  displayName: playerId,
  avatar: { ...CONFIG, ...avatar },
})

const t = makeI18n('vi').getFixedT(null, 'normal')

const draw = (node: ReturnType<ReturnType<typeof makeCaptionFor>>): HTMLElement => render(<>{node}</>).container

describe('makeAvatarFor', () => {
  it('gives a bot a mark of its own, and never looks one up', () => {
    const avatars: AvatarCache = new Map()
    const get = vi.spyOn(avatars, 'get')

    const { container } = render(<>{makeAvatarFor(avatars)(player({ playerId: 'bot-1', isBot: true }))}</>)

    expect(container.querySelector('svg')).toHaveAttribute('data-avatar', 'bot')
    expect(get).not.toHaveBeenCalled()
  })

  it('draws the equipped avatar for a human the cache knows', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { hair: 'hair_bun', hairColor: '#d9a441' })]])

    const { container } = render(<>{makeAvatarFor(avatars)(player({ playerId: 'a' }))}</>)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('data-avatar', 'config')
    expect(svg).toHaveAttribute('data-size', 'sm')
    expect(svg?.style.getPropertyValue('--avatar-hair')).toBe('#d9a441')
  })

  it('draws the silhouette while an avatar has not arrived, and when there is none', () => {
    const avatars: AvatarCache = new Map([['gone', null]])
    const avatarFor = makeAvatarFor(avatars)

    for (const id of ['gone', 'pending']) {
      const { container } = render(<>{avatarFor(player({ playerId: id }))}</>)
      expect(container.querySelector('svg'), id).toHaveAttribute('data-avatar', 'none')
    }
  })
})

describe('makeCaptionFor', () => {
  it('says nothing when neither a title nor a badge is equipped', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', {})]])

    expect(makeCaptionFor(avatars, t)(player({ playerId: 'a' }))).toBeNull()
  })

  it('says nothing for a player the cache does not know, and nothing for a bot', () => {
    const captionFor = makeCaptionFor(new Map([['bot-1', entry('bot-1', { title: 'title_hot_hand' })]]), t)

    expect(captionFor(player({ playerId: 'stranger' }))).toBeNull()
    expect(captionFor(player({ playerId: 'bot-1', isBot: true }))).toBeNull()
  })

  it('prints the equipped title in the reading language', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { title: 'title_hot_hand' })]])

    expect(draw(makeCaptionFor(avatars, t)(player({ playerId: 'a' })))).toHaveTextContent(viNormal.items.title_hot_hand)
  })

  it('prints a badge as a glyph announced by name, and colours it by rarity', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { badge: 'badge_veteran' })]])

    const container = draw(makeCaptionFor(avatars, t)(player({ playerId: 'a' })))
    const glyph = container.querySelector('[data-rarity]')

    // `title` alone is mouse-only, and a bare span has no role for it to become a name on.
    expect(glyph).toHaveAttribute('role', 'img')
    expect(glyph).toHaveAttribute('aria-label', viNormal.items.badge_veteran)
    expect(glyph).toHaveAttribute('title', viNormal.items.badge_veteran)
    expect(glyph).toHaveAttribute('data-rarity', 'epic')
    expect(glyph?.textContent).not.toBe('')
  })

  it('shows both when both are equipped', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { title: 'title_rookie', badge: 'badge_gold' })]])

    const container = draw(makeCaptionFor(avatars, t)(player({ playerId: 'a' })))

    expect(container).toHaveTextContent(viNormal.items.title_rookie)
    expect(container.querySelector('[data-rarity]')).toHaveAttribute('data-rarity', 'rare')
  })

  it('still marks a badge id this bundle has no glyph for, without naming it wrongly', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { badge: 'badge_from_the_future' })]])

    const container = draw(makeCaptionFor(avatars, t)(player({ playerId: 'a' })))
    const glyph = container.querySelector('[data-rarity]')

    expect(glyph).not.toBeNull()
    // No words for it, so it is decoration rather than an image with a raw i18n key for a name.
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(glyph).not.toHaveAttribute('aria-label')
  })

  it('drops a title this bundle has no words for, rather than printing its i18n key', () => {
    // The server may publish an item before the bundle that names it; `items.title_from_the_future` under a
    // player's name is worse than no title at all.
    const avatars: AvatarCache = new Map([['a', entry('a', { title: 'title_from_the_future' })]])

    expect(makeCaptionFor(avatars, t)(player({ playerId: 'a' }))).toBeNull()
  })

  it('keeps the badge when only the title is unknown', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', { title: 'title_from_the_future', badge: 'badge_gold' })]])

    const container = draw(makeCaptionFor(avatars, t)(player({ playerId: 'a' })))

    expect(container.textContent).not.toContain('items.')
    expect(container.querySelector('[data-rarity]')).toHaveAttribute('aria-label', viNormal.items.badge_gold)
  })
})
