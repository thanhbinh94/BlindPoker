import { FakeSocket, fakeSocketFactory } from '@bp/ui-kit'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import type { LiteApi, MeDto, SessionDto } from './api.js'
import enLite from './locales/en/lite.json'
import viLite from './locales/vi/lite.json'
import { TOKEN_KEY } from './session.js'
import { makeI18n, renderWithI18n } from './test-i18n.js'

/** ui-kit's `game` namespace, quoted rather than imported: the app must not reach into the kit's sources. */
const ROOMS_HEADING = 'Phòng chơi'

const SESSION: SessionDto = { playerId: 'p1', displayName: 'Bình', token: 'tok-new', balance: 10000 }

const ME: MeDto = {
  playerId: 'p1',
  displayName: 'Bình',
  balance: 10000,
  stats: { handsPlayed: 0, handsWon: 0 },
  daily: { allowed: true, alreadyClaimed: false, day: 1, points: 1000, nextDay: 2, nextPoints: 2000, streak: 1, lastClaim: null },
  relief: { eligible: false, reason: 'balance', retryAt: null },
}

function stubApi(overrides: Partial<LiteApi> = {}): LiteApi {
  return {
    config: vi.fn().mockResolvedValue({ edition: 'lite', wsPath: '/ws', languages: ['vi', 'en'] }),
    createSession: vi.fn().mockResolvedValue(SESSION),
    me: vi.fn().mockResolvedValue(ME),
    daily: vi.fn().mockResolvedValue(ME.daily),
    claimDaily: vi.fn(),
    relief: vi.fn(),
    ...overrides,
  } as unknown as LiteApi
}

const renderApp = (api: LiteApi = stubApi()) =>
  renderWithI18n(<App api={api} socketFactory={fakeSocketFactory} version="0.1.0" />, makeI18n('vi'))

const socket = (): FakeSocket => {
  const found = FakeSocket.instances[0]
  if (!found) throw new Error('no socket was opened')
  return found
}

/** Drives the socket the way the server would: open, greet back, and the lobby is live. */
async function welcome(): Promise<void> {
  await act(async () => {
    socket().open()
  })
  await act(async () => {
    socket().receive({ t: 'WELCOME', playerId: 'p1', displayName: 'Bình', balance: 10000, serverTime: Date.now() })
  })
}

/** Every dotted leaf, so a key added to one language alone fails the build. */
function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix === '' ? key : `${prefix}.${key}`))
}

describe('lite locales', () => {
  it('declares every key in both languages', () => {
    expect(leaves(enLite).sort()).toEqual(leaves(viLite).sort())
  })

  it('leaves no value empty', () => {
    for (const bundle of [viLite, enLite]) {
      const flat = JSON.stringify(bundle)
      expect(flat).not.toContain('""')
    }
  })
})

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    window.history.replaceState(null, '', '/')
  })

  it('asks for a display name when the device holds no token, and opens no socket', () => {
    renderApp()

    expect(screen.getByRole('heading', { name: viLite.prompt.title })).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('connects with the stored token and shows the lobby once WELCOME lands', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-stored')
    renderApp()

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    expect(socket().url).toBe(`ws://${window.location.host}/ws`)

    await welcome()

    expect(socket().sent).toContainEqual({ t: 'HELLO', sessionToken: 'tok-stored' })
    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: viLite.prompt.title })).not.toBeInTheDocument()
  })

  it('stores the token the name prompt earns and connects with it', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(viLite.prompt.name), 'Bình')
    await user.click(screen.getByRole('button', { name: viLite.prompt.submit }))

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-new'))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()
    expect(socket().sent).toContainEqual({ t: 'HELLO', sessionToken: 'tok-new' })
  })

  it('routes #/daily to the daily screen behind the shell bar', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-stored')
    window.history.replaceState(null, '', '/#/daily')
    const api = stubApi()
    renderApp(api)
    await welcome()

    expect(await screen.findByRole('heading', { name: viLite.daily.title })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: viLite.nav.main })).toBeInTheDocument()
    await waitFor(() => expect(api.me).toHaveBeenCalledWith('tok-stored'))
  })

  it('routes #/settings to the settings screen', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-stored')
    window.history.replaceState(null, '', '/#/settings')
    renderApp()
    await welcome()

    expect(await screen.findByRole('heading', { name: viLite.settings.title })).toBeInTheDocument()
  })

  it('drops the token and re-prompts when the server refuses the session', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-stale')
    renderApp()
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    await act(async () => {
      socket().serverClose(4001, 'unauthenticated')
    })

    expect(await screen.findByRole('heading', { name: viLite.prompt.title })).toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(viLite.session.expired)
  })

  it('opens the room screen when the connect is answered with the room the player is still in (T5)', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-stored')
    window.history.replaceState(null, '', '/#/lobby')
    renderApp()
    await welcome()
    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()

    await act(async () => {
      socket().receive({
        t: 'ROOM_SNAPSHOT',
        seq: 5,
        room: {
          roomId: 'r1', code: 'ABC234', name: 'Bàn cũ', mode: 'blind',
          config: { name: 'Bàn cũ', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false, hasPassword: false, blind: { holeCards: 3, decisionMode: 'none', fixedWager: 1000, botCount: 0 } },
          playerCount: 1, maxPlayers: 4, status: 'OPEN', hostPlayerId: 'p1', carryOverPot: 0, nextHandAt: null,
          players: [{ playerId: 'p1', displayName: 'Bình', isBot: false, isHost: true, connected: true, seat: null, status: null, sittingOut: false, stack: 0, ready: false }],
        },
        hand: null,
        deadlineAt: null,
      })
    })

    await waitFor(() => expect(window.location.hash).toBe('#/room'))
  })
})
