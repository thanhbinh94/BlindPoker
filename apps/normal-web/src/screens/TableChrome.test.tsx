import type { RoomPlayerView } from '@bp/core'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, BaseDto, ItemDto, PlayerAvatarDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n } from '../test-i18n.js'
import { makeCaptionFor, makeChibiFor, type AvatarCache } from './TableChrome.js'

const FACES = {
  neutral: 'base_f01_face_neutral_L50',
  happy: 'base_f01_face_happy_L50',
  sad: 'base_f01_face_sad_L50',
  surprised: 'base_f01_face_surprised_L50',
  closed: 'base_f01_face_closed_L50',
  sleep: 'base_f01_face_sleep_L50',
}

const BASE_F01: BaseDto = {
  id: 'f01',
  nameKey: 'bases.f01',
  wear: 'f',
  layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
  faces: FACES,
}
const bases = new Map([['f01', BASE_F01]])

const OUTFIT: ItemDto = {
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  nameKey: 'items.outfit_casual01',
  assetKey: 'outfit/outfit_casual01',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
}
const items = new Map([[OUTFIT.id, OUTFIT]])

const CONFIG: AvatarConfigDto = { v: 3, base: 'f01', outfit: 'outfit_casual01' }

const player = (patch: Partial<RoomPlayerView> & Pick<RoomPlayerView, 'playerId'>): RoomPlayerView => ({
  displayName: patch.playerId,
  isBot: false,
  isHost: false,
  connected: true,
  seat: 0,
  status: null,
  sittingOut: false,
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

describe('makeChibiFor', () => {
  it("leaves a bot to the kit's own face, and never looks one up", () => {
    const avatars: AvatarCache = new Map()
    const get = vi.spyOn(avatars, 'get')

    expect(makeChibiFor(avatars, items, bases)(player({ playerId: 'bot-1', isBot: true }))).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('builds a ChibiConfig for a human the cache knows', () => {
    const avatars: AvatarCache = new Map([['a', entry('a', {})]])

    const chibi = makeChibiFor(avatars, items, bases)(player({ playerId: 'a' }))

    expect(chibi).toEqual({
      kind: 'human',
      base: expect.objectContaining({ id: 'f01' }),
      outfit: expect.objectContaining({ id: 'outfit_casual01' }),
    })
  })

  it('answers null while an avatar has not arrived, and when there is none', () => {
    const avatars: AvatarCache = new Map([['gone', null]])
    const chibiFor = makeChibiFor(avatars, items, bases)

    expect(chibiFor(player({ playerId: 'gone' }))).toBeNull()
    expect(chibiFor(player({ playerId: 'pending' }))).toBeNull()
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
