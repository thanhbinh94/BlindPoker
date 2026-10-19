import type { RoomPlayerView, RoomView } from '@bp/core'
import { FakeSocket, fakeSocketFactory, hashChibi } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import type { AuthMeDto, AvatarCatalogDto, AvatarConfigDto, BodyDto, ItemDto, NormalApi } from './api.js'
import { resetAvatarCache } from './avatar/useAvatars.js'
import viNormal from './locales/vi/normal.json'
import { makeI18n, renderWithI18n } from './test-i18n.js'

/**
 * The wiring, from the app's own outside: whose avatar gets fetched, and where it is hung.
 *
 * It lives beside `App.test.tsx` rather than in it because the two ask different questions of the same
 * component — that file is about the session gate and the shell, this one about cosmetics — and because
 * every case here stops at the lobby, so none of it depends on how the sign-in card is spelled.
 */

const ME: AuthMeDto = { playerId: 'p1', displayName: 'Bình', balance: 123_000, role: 'player' }

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const facesOf = (g: 'f' | 'm'): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`]))

const BODY_F: BodyDto = { gender: 'f', body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' }
const BODY_M: BodyDto = { gender: 'm', body: 'body_m_L30', faces: facesOf('m'), naturalEyeColour: '#cc924c' }

const HAIR_M_TOUSLED: ItemDto = {
  id: 'hair_m_tousled01',
  slot: 'hairStyle',
  rarity: 'common',
  nameKey: 'items.hair_m_tousled01',
  assetKey: 'hairStyle/hair_m_tousled01',
  isDefault: false,
  free: true,
  gender: 'm',
  asset: { layer: 60, file: 'item_hair_m_tousled01_L60', back: 'item_hair_m_tousled01_L20', fitsAvatarCrop: true },
}

const OUTFIT_CASUAL: ItemDto = {
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  nameKey: 'items.outfit_casual01',
  assetKey: 'outfit/outfit_casual01',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
}
const OUTFIT_DEALER: ItemDto = {
  id: 'outfit_dealer01',
  slot: 'outfit',
  rarity: 'rare',
  nameKey: 'items.outfit_dealer01',
  assetKey: 'outfit/outfit_dealer01',
  isDefault: false,
  asset: { layer: 40, file: 'item_outfit_dealer01_L40', fitsAvatarCrop: false },
}

const CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bodies: [BODY_F, BODY_M], manifestVersion: 1 }
const ITEMS = { items: [HAIR_M_TOUSLED, OUTFIT_CASUAL, OUTFIT_DEALER] }

const AVATAR: AvatarConfigDto = { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_dealer01', title: 'title_hot_hand', badge: 'badge_gold' }

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    config: vi.fn().mockResolvedValue({ edition: 'normal', wsPath: '/ws', languages: ['vi', 'en'] }),
    authMe: vi.fn().mockResolvedValue(ME),
    logout: vi.fn().mockResolvedValue(undefined),
    // The daily reminder asks once per sign-in; left hanging, it neither redirects nor draws its dot here.
    daily: vi.fn(() => new Promise<never>(() => undefined)),
    avatarCatalog: vi.fn().mockResolvedValue(CATALOG),
    catalogItems: vi.fn().mockResolvedValue(ITEMS),
    ...overrides,
  } as unknown as NormalApi
}

const renderApp = (api: NormalApi): ReturnType<typeof renderWithI18n> =>
  renderWithI18n(<App api={api} socketFactory={fakeSocketFactory} />, makeI18n('vi'))

const socket = (): FakeSocket => {
  const found = FakeSocket.instances[0]
  if (!found) throw new Error('no socket was opened')
  return found
}

/** Open, then `WELCOME` — the Normal handshake, with no `HELLO` in between. */
async function welcome(): Promise<void> {
  await act(async () => {
    socket().open()
  })
  await act(async () => {
    socket().receive({ t: 'WELCOME', playerId: 'p1', displayName: 'Bình', balance: 123_000, serverTime: Date.now() })
  })
}

const seated = (playerId: string, isBot = false): RoomPlayerView => ({
  playerId,
  displayName: playerId,
  isBot,
  isHost: playerId === 'p1',
  connected: true,
  seat: 0,
  status: 'SEATED',
  sittingOut: false,
  stack: 20_000,
  ready: false,
})

const ROOM: RoomView = {
  roomId: 'r1',
  code: 'ABCDEF',
  name: 'Bàn 1',
  mode: 'holdem',
  config: { name: 'Bàn 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 20, autoStart: false },
  playerCount: 3,
  maxPlayers: 6,
  status: 'OPEN',
  hostPlayerId: 'p1',
  players: [seated('p1'), seated('p2'), seated('bot-1', true)],
  carryOverPot: 0,
  nextHandAt: null,
}

describe('App — avatars on the bar and at the table', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    resetAvatarCache()
    window.history.replaceState(null, '', '/')
  })

  it('puts my own face on the lobby bar, as the way into the wardrobe', async () => {
    const playerAvatar = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', avatar: AVATAR })
    renderApp(stubApi({ playerAvatar }))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    const mine = await screen.findByRole('link', { name: viNormal.avatar.mine })
    expect(mine).toHaveAttribute('href', '#/avatar')
    // Daily and Profile are the rail's; the lobby's bar no longer repeats them (layout audit U2).
    const bar = mine.closest('header')
    expect(bar).not.toBeNull()
    expect(within(bar as HTMLElement).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#/avatar'])
    // The boot probe named me before `WELCOME` did, so the face is fetched once and rendered from the
    // config — `data-chibi-hash` is that config's identity, and the only thing a Chibi can be asserted on.
    const expectedHash = hashChibi({
      kind: 'human',
      body: { gender: 'm', body: 'body_m_L30', faces: BODY_M.faces as never },
      hair: { id: 'hair_m_tousled01', back: 'item_hair_m_tousled01_L20', front: 'item_hair_m_tousled01_L60' },
      outfit: { id: 'outfit_dealer01', order: 40, file: 'item_outfit_dealer01_L40' },
    })
    await waitFor(() => expect(mine.querySelector('[data-chibi-hash]')).toHaveAttribute('data-chibi-hash', expectedHash))
    expect(playerAvatar.mock.calls.map(([id]) => id)).toEqual(['p1'])
  })

  it('fetches an avatar for every human at the table and never for a bot', async () => {
    const playerAvatar = vi.fn().mockImplementation((id: string) => Promise.resolve({ playerId: id, displayName: id, avatar: AVATAR }))
    renderApp(stubApi({ playerAvatar }))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    await act(async () => {
      socket().receive({ t: 'ROOM_SNAPSHOT', seq: 1, room: ROOM, hand: null, deadlineAt: null })
    })

    await waitFor(() => expect(playerAvatar.mock.calls.map(([id]) => id)).toContain('p2'))
    // A bot has no account: asking for one would be a 404 per bot, per table, forever.
    expect([...new Set(playerAvatar.mock.calls.map(([id]) => id))].sort()).toEqual(['p1', 'p2'])
  })

  it('falls back to the default chibi on the bar before the catalogue or the avatar has arrived', async () => {
    const playerAvatar = vi.fn(() => new Promise<never>(() => undefined))
    renderApp(stubApi({ playerAvatar, avatarCatalog: vi.fn(() => new Promise<never>(() => undefined)) }))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    const mine = await screen.findByRole('link', { name: viNormal.avatar.mine })
    expect(mine.querySelector('[data-chibi-hash]')).not.toBeNull()
  })
})
