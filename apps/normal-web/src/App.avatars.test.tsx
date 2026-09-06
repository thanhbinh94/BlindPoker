import type { RoomPlayerView, RoomView } from '@bp/core'
import { FakeSocket, fakeSocketFactory } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import type { AuthMeDto, AvatarConfigDto, NormalApi } from './api.js'
import { fakeRenderer } from './avatar3d/fake-renderer.js'
import { hashConfig } from './avatar3d/hash.js'
import { resetPortraitMemory } from './avatar3d/portrait-cache.js'
import { setPortraitRendererForTests } from './avatar3d/usePortrait.js'
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

const ME: AuthMeDto = { playerId: 'p1', displayName: 'Bình', balance: 123_000 }

const AVATAR: AvatarConfigDto = {
  v: 2,
  body: 'female',
  skin: '#efc9a4',
  eyes: '#6b4a2f',
  hairColor: '#d9a441',
  hair: 'hair_bun',
  top: 'clothing_aodai',
  bottom: 'bottom_skirt',
  shoes: 'shoes_sandals',
  title: 'title_hot_hand',
  badge: 'badge_gold',
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    config: vi.fn().mockResolvedValue({ edition: 'normal', wsPath: '/ws', languages: ['vi', 'en'] }),
    authMe: vi.fn().mockResolvedValue(ME),
    logout: vi.fn().mockResolvedValue(undefined),
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
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
    window.history.replaceState(null, '', '/')
  })

  it('hangs Daily, Profile and my own face on the lobby bar', async () => {
    const playerAvatar = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', avatar: AVATAR })
    renderApp(stubApi({ playerAvatar }))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    const mine = await screen.findByRole('link', { name: viNormal.avatar.mine })
    const corner = mine.closest('span')
    expect(corner).not.toBeNull()
    expect(within(corner as HTMLElement).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#/daily',
      '#/profile',
      '#/avatar',
    ])
    // The boot probe named me before `WELCOME` did, so the face is fetched once and rendered from the
    // config — `data-hash` is that config's identity, and the only thing an image can be asserted on.
    await waitFor(() => expect(mine.querySelector('img')).toHaveAttribute('data-hash', hashConfig(AVATAR)))
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
})
