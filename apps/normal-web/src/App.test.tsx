import { FakeSocket, fakeSocketFactory } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROUTES, App, websocketUrl } from './App.js'
import { ApiError, type AuthMeDto, type NormalApi } from './api.js'
import { DAILY_NUDGE_KEY } from './daily-nudge.js'
import { resetAvatarCache } from './avatar/useAvatars.js'
import viNormal from './locales/vi/normal.json'
import { LAST_EMAIL_KEY } from './session.js'
import { RECONNECT_PROBE_MS } from './session-gate.js'
import { makeI18n, renderWithI18n } from './test-i18n.js'

/** ui-kit's `game` namespace, quoted rather than imported: the app must not reach into the kit's sources. */
const ROOMS_HEADING = 'Phòng chơi'

const ME: AuthMeDto = { playerId: 'p1', displayName: 'Bình', balance: 123_000 }
const UNAUTHORIZED = new ApiError(401, 'UNAUTHENTICATED', 'a valid session cookie is required')

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    config: vi.fn().mockResolvedValue({ edition: 'normal', wsPath: '/ws', languages: ['vi', 'en'] }),
    authMe: vi.fn().mockResolvedValue(ME),
    login: vi.fn().mockResolvedValue(ME),
    register: vi.fn().mockResolvedValue(ME),
    logout: vi.fn().mockResolvedValue(undefined),
    // The two screens the rail can reach without a click of their own. Left hanging by default: these tests
    // are about the shell and the session, and a screen that never resolves still draws its own heading.
    me: vi.fn(() => new Promise<never>(() => undefined)),
    daily: vi.fn(() => new Promise<never>(() => undefined)),
    // The rig every chibi is drawn on: fetched once for the app's whole lifetime, and irrelevant to every
    // case in this file — none of them ever look at a face.
    avatarCatalog: vi.fn().mockResolvedValue({ frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bases: [], manifestVersion: 1 }),
    catalogItems: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  } as unknown as NormalApi
}

const renderApp = (api: NormalApi = stubApi()) =>
  renderWithI18n(<App api={api} socketFactory={fakeSocketFactory} />, makeI18n('vi'))

const socket = (): FakeSocket => {
  const found = FakeSocket.instances[0]
  if (!found) throw new Error('no socket was opened')
  return found
}

/** Drives the socket the way the Normal server would: open, then `WELCOME` — with no `HELLO` in between. */
async function welcome(): Promise<void> {
  // The gate opens the socket in an effect once the boot probe answers; on a cold first run the i18n instance can
  // still be settling then, so `settled()` may return before that render — wait for the socket itself.
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0))
  await act(async () => {
    socket().open()
  })
  await act(async () => {
    socket().receive({ t: 'WELCOME', playerId: 'p1', displayName: 'Bình', balance: 123_000, serverTime: Date.now() })
  })
}

/** Waits out the boot probe, whichever way it went. */
const settled = () => waitFor(() => expect(screen.queryByText(viNormal.session.checking)).toBeNull())

describe('App — the session gate', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    window.history.replaceState(null, '', '/')
  })

  it('opens no socket and shows nothing but a status line while the boot probe is in flight', () => {
    renderApp(stubApi({ authMe: vi.fn(() => new Promise<AuthMeDto>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.session.checking)
    expect(screen.queryByRole('link', { name: viNormal.auth.signIn })).toBeNull()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('connects with the cookie and shows the lobby once WELCOME lands — and never sends HELLO', async () => {
    const api = stubApi()
    renderApp(api)

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    expect(api.authMe).toHaveBeenCalledTimes(1)
    expect(socket().url).toBe(`ws://${window.location.host}/ws`)

    await welcome()

    // The whole difference from Lite: the server bound the identity at the upgrade, so there is no greeting
    // to send. (The lobby's own `LIST_ROOMS` is the only traffic on a fresh socket.)
    expect(socket().sent.map((m) => (m as { t: string }).t)).not.toContain('HELLO')
    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
  })

  it('shows the sign-in card and opens no socket when the cookie names no session', async () => {
    renderApp(stubApi({ authMe: vi.fn().mockRejectedValue(UNAUTHORIZED) }))

    expect(await screen.findByRole('link', { name: viNormal.auth.signIn })).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(0)
    // A visitor lost nothing, so there is no expiry notice to show them.
    expect(screen.queryByText(viNormal.session.expired)).toBeNull()
  })

  it('opens the register tab on #/register', async () => {
    window.history.replaceState(null, '', '/#/register')
    renderApp(stubApi({ authMe: vi.fn().mockRejectedValue(UNAUTHORIZED) }))

    await waitFor(() => expect(screen.getByRole('link', { name: viNormal.auth.register })).toHaveAttribute('aria-current', 'page'))
  })

  it('registers, connects and lands in the lobby', async () => {
    const api = stubApi({ authMe: vi.fn().mockRejectedValue(UNAUTHORIZED) })
    window.history.replaceState(null, '', '/#/register')
    const user = userEvent.setup()
    renderApp(api)

    await screen.findByRole('link', { name: viNormal.auth.register })
    await user.type(screen.getByLabelText(viNormal.auth.email), 'binh@example.com')
    await user.type(screen.getByLabelText(viNormal.auth.password), 'con-meo-den-1')
    await user.type(screen.getByLabelText(viNormal.auth.displayName), 'Bình')
    await user.click(screen.getByRole('button', { name: viNormal.auth.submitRegister }))

    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()
    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/lobby')
  })

  it('signs out: tells the server, drops the socket, forgets the email and returns to the card', async () => {
    localStorage.setItem(LAST_EMAIL_KEY, 'binh@example.com')
    const api = stubApi()
    window.history.replaceState(null, '', '/#/settings')
    const user = userEvent.setup()
    renderApp(api)
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    // Settings asks first; the app is the only thing that ever tells the server, which is why one click on
    // the confirmation is still exactly one `POST /api/auth/logout`.
    await user.click(await screen.findByRole('button', { name: viNormal.settings.account.signOut }))
    await user.click(await screen.findByRole('button', { name: viNormal.settings.signOut.confirm }))

    expect(api.logout).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('link', { name: viNormal.auth.signIn })).toBeInTheDocument()
    expect(socket().closedWith).not.toBeNull()
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBeNull()
    // A deliberate sign-out is not an expiry: nothing was taken away, so nothing is explained.
    expect(screen.queryByText(viNormal.session.expired)).toBeNull()
  })
})

describe('App — the reconnect probe', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Gets to a live lobby, then drops the socket the way a refused upgrade looks from the browser: an
   * ordinary failed connection, code 1006, no reason. The clock is faked *before* the close, because that
   * is when the probe's timer is scheduled.
   */
  async function reconnecting(api: NormalApi): Promise<void> {
    renderApp(api)
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()
    vi.useFakeTimers()
    await act(async () => {
      socket().serverClose(1006, '')
    })
  }

  /** Runs the clock forward inside `act`, keeping the fake clock so a second window can follow. */
  async function tick(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }

  /** One window, then back to the real clock so `waitFor` can work normally. */
  async function advance(ms: number): Promise<void> {
    await tick(ms)
    vi.useRealTimers()
  }

  it('signs the player out when ten seconds of reconnecting turn out to be a dead session', async () => {
    // The socket carries no token, so a refused upgrade is invisible: only a second probe can tell.
    const authMe = vi.fn().mockResolvedValueOnce(ME).mockRejectedValue(UNAUTHORIZED)
    await reconnecting(stubApi({ authMe }))
    expect(authMe).toHaveBeenCalledTimes(1)

    await advance(RECONNECT_PROBE_MS)

    await waitFor(() => expect(authMe).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('link', { name: viNormal.auth.signIn })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.session.expired)
  })

  it('keeps the session when the probe says the cookie is still good — the network is merely bad', async () => {
    const authMe = vi.fn().mockResolvedValue(ME)
    await reconnecting(stubApi({ authMe }))

    await advance(RECONNECT_PROBE_MS)

    await waitFor(() => expect(authMe).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('link', { name: viNormal.auth.signIn })).toBeNull()
  })

  it('keeps asking, so a session that dies during a long outage is still noticed', async () => {
    // 200 at ten seconds, 401 at twenty: the outage outlived the session. A probe that fired once would
    // have left the player in a live-looking shell that could never recover.
    const authMe = vi.fn().mockResolvedValueOnce(ME).mockResolvedValueOnce(ME).mockRejectedValue(UNAUTHORIZED)
    await reconnecting(stubApi({ authMe }))

    await tick(RECONNECT_PROBE_MS)
    expect(authMe).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('link', { name: viNormal.auth.signIn })).toBeNull()

    await tick(RECONNECT_PROBE_MS)
    expect(authMe).toHaveBeenCalledTimes(3)
    await advance(RECONNECT_PROBE_MS)

    expect(await screen.findByRole('link', { name: viNormal.auth.signIn })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.session.expired)
    // …and it stops once there is no session left to check.
    const settled = authMe.mock.calls.length
    vi.useFakeTimers()
    await tick(RECONNECT_PROBE_MS * 3)
    vi.useRealTimers()
    expect(authMe).toHaveBeenCalledTimes(settled)
  })

  it('does not probe before ten seconds are up', async () => {
    const authMe = vi.fn().mockResolvedValue(ME)
    await reconnecting(stubApi({ authMe }))

    await advance(RECONNECT_PROBE_MS - 1)

    expect(authMe).toHaveBeenCalledTimes(1)
  })
})

describe('App — the shell', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    window.history.replaceState(null, '', '/')
  })

  it('carries exactly four tabs, which is what fits a 375 px rail', async () => {
    window.history.replaceState(null, '', '/#/daily')
    renderApp()
    await settled()
    await welcome()

    const nav = screen.getByRole('navigation', { name: viNormal.nav.main })
    const tabs = within(nav).getAllByRole('link')
    expect(tabs.map((a) => a.textContent)).toEqual([
      viNormal.nav.lobby,
      viNormal.nav.daily,
      viNormal.nav.profile,
      viNormal.nav.settings,
    ])
    // The label is a <span> inside the link since bug 8 (icon over label on phones), so ask for the link itself.
    expect(within(nav).getByRole('link', { name: new RegExp(`^${viNormal.nav.daily}`) })).toHaveAttribute('aria-current', 'page')
  })

  it('serves the account routes from their own chunk, behind one loading line', async () => {
    window.history.replaceState(null, '', '/#/achievements')
    renderApp(stubApi({ achievements: vi.fn().mockResolvedValue([]) }))
    await settled()
    await welcome()

    // The chunk is fetched on arrival, so the rail is drawn before the screen under it is.
    expect(await screen.findByRole('heading', { name: viNormal.achievements.ui.title })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: viNormal.nav.main })).toBeInTheDocument()
  })

  /** Nothing is a placeholder any more: the last two routes are lazy screens like the other four. */
  it.each([
    ['/daily', viNormal.daily.title],
    ['/settings', viNormal.settings.title],
  ])('routes #%s to its own screen behind the rail', async (path, heading) => {
    expect(ACCOUNT_ROUTES).toContain(path)
    window.history.replaceState(null, '', `/#${path}`)
    renderApp()
    await settled()
    await welcome()

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: viNormal.nav.main })).toBeInTheDocument()
  })

  it('keeps the rail balance on the routes that print none of their own', async () => {
    window.history.replaceState(null, '', '/#/daily')
    const { container } = renderApp()
    await settled()
    await welcome()

    // The narrow-viewport rule that hides the rail's copy keys on this attribute, and only `/profile` earns
    // it: everywhere else the rail is the only place the balance appears at all.
    const rail = container.querySelector('[data-balance-in-page]') as HTMLElement
    expect(rail).toHaveAttribute('data-balance-in-page', 'false')
    expect(within(rail).getByText(/123\.000/)).toBeInTheDocument()
  })

  it('yields the rail balance on /profile, which carries one in its own header', async () => {
    window.history.replaceState(null, '', '/#/profile')
    const pending = vi.fn(() => new Promise<never>(() => undefined))
    const { container } = renderApp(stubApi({ stats: pending, history: pending, ledger: pending }))
    await settled()
    await welcome()

    expect(container.querySelector('[data-balance-in-page]')).toHaveAttribute('data-balance-in-page', 'true')
  })

  it('shows the named achievement toast on /daily, where the login achievements unlock', async () => {
    window.history.replaceState(null, '', '/#/daily')
    renderApp()
    await settled()
    await welcome()
    await screen.findByRole('heading', { name: viNormal.daily.title })

    await act(async () => {
      socket().receive({ t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_7', reward: { points: 5_000 } } })
    })

    // Claiming is what unlocks these, so the slip has to be visible here — not waiting in the state for the
    // next visit to the lobby, where it would fire with no idea what caused it.
    expect(await screen.findByText(new RegExp(viNormal.achievements.login_days_7.name))).toBeInTheDocument()
    expect(screen.queryByText(/login_days_7/)).toBeNull()
  })

  it('names the achievement in the toast, rather than printing the id the server sent', async () => {
    renderApp()
    await settled()
    await welcome()
    await screen.findByRole('heading', { name: ROOMS_HEADING })

    await act(async () => {
      socket().receive({ t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_7', reward: { points: 5_000 } } })
    })

    // The kit owns the sentence and this app owns the name inside it; only the id was ever this app's to supply.
    const slip = await screen.findByText(new RegExp(viNormal.achievements.login_days_7.name))
    expect(slip).toBeInTheDocument()
    expect(screen.queryByText(/login_days_7/)).toBeNull()
  })

  it('shows the balance the boot probe read, rather than a zero, before WELCOME lands', async () => {
    window.history.replaceState(null, '', '/#/daily')
    renderApp()
    await settled()

    expect(await screen.findByText(/123/)).toBeInTheDocument()
  })

  it('hides the rail entirely on the room route', async () => {
    window.history.replaceState(null, '', '/#/room')
    renderApp()
    await settled()
    await welcome()

    expect(screen.queryByRole('navigation', { name: viNormal.nav.main })).toBeNull()
  })
})

describe('App — a session that ends under the player', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    resetAvatarCache()
    window.history.replaceState(null, '', '/')
  })

  it('sends a screen’s 401 back to the sign-in card, with the reason', async () => {
    // The socket stays open — the Normal gateway binds identity once, at the upgrade — so nothing but the
    // REST refusal can notice that the session died. Before `guardApi` this printed "something went wrong"
    // on the profile and left the player in a signed-in-looking shell for good.
    window.history.replaceState(null, '', '/#/profile')
    const pending = vi.fn(() => new Promise<never>(() => undefined))
    renderApp(stubApi({ me: vi.fn().mockRejectedValue(UNAUTHORIZED), stats: pending, history: pending, ledger: pending }))
    await settled()
    await welcome()

    expect(await screen.findByRole('link', { name: viNormal.auth.signIn })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.session.expired)
    expect(socket().closedWith).not.toBeNull()
  })

  it('does not mistake a wrong password for an expiry — BAD_CREDENTIALS is a 401 too', async () => {
    const api = stubApi({
      authMe: vi.fn().mockRejectedValue(UNAUTHORIZED),
      login: vi.fn().mockRejectedValue(new ApiError(401, 'BAD_CREDENTIALS', 'email or password is wrong')),
    })
    window.history.replaceState(null, '', '/#/login')
    const user = userEvent.setup()
    renderApp(api)

    await screen.findByRole('link', { name: viNormal.auth.signIn })
    await user.type(screen.getByLabelText(viNormal.auth.email), 'binh@example.com')
    await user.type(screen.getByLabelText(viNormal.auth.password), 'khong-dung-1')
    await user.click(screen.getByRole('button', { name: viNormal.auth.submitSignIn }))

    // The card blames the form, and only the form: no "your session expired" for a session that never was.
    expect(await screen.findByText(viNormal.auth.errors.BAD_CREDENTIALS)).toBeInTheDocument()
    expect(screen.queryByText(viNormal.session.expired)).toBeNull()
  })

  it('greets the second account on this machine, not the first, before WELCOME lands', async () => {
    // A shared machine: A signs out, B signs in, and the socket has not greeted yet. Everything the bar
    // draws — the name, the points — must already be B's, because the alternative is showing B the
    // stranger's name and balance for as long as the new socket takes to open.
    const other: AuthMeDto = { playerId: 'p2', displayName: 'Lan', balance: 7_000 }
    const api = stubApi({ login: vi.fn().mockResolvedValue(other) })
    window.history.replaceState(null, '', '/#/settings')
    const user = userEvent.setup()
    renderApp(api)
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()

    await user.click(await screen.findByRole('button', { name: viNormal.settings.account.signOut }))
    await user.click(await screen.findByRole('button', { name: viNormal.settings.signOut.confirm }))
    await screen.findByRole('link', { name: viNormal.auth.signIn })

    await user.type(screen.getByLabelText(viNormal.auth.email), 'lan@example.com')
    await user.type(screen.getByLabelText(viNormal.auth.password), 'con-meo-den-1')
    await user.click(screen.getByRole('button', { name: viNormal.auth.submitSignIn }))

    expect(await screen.findByText(other.displayName)).toBeInTheDocument()
    expect(screen.getByText(/7\.000/)).toBeInTheDocument()
    // …and not a trace of the account that just left.
    expect(screen.queryByText(ME.displayName)).toBeNull()
    expect(screen.queryByText(/123\.000/)).toBeNull()
  })

  it('stops asking about the player who signed out, and forgets the face it held', async () => {
    const avatar = { v: 2, body: 'male', skin: '#e0ac81', eyes: '#3b2415', hairColor: '#2b2b2b', hair: 'hair_short', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers' }
    const playerAvatar = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', avatar })
    window.history.replaceState(null, '', '/#/settings')
    const user = userEvent.setup()
    renderApp(stubApi({ playerAvatar }))
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    await welcome()
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('button', { name: viNormal.settings.account.signOut }))
    await user.click(await screen.findByRole('button', { name: viNormal.settings.signOut.confirm }))
    await screen.findByRole('link', { name: viNormal.auth.signIn })

    playerAvatar.mockClear()
    // The avatar effect is deliberately un-keyed — it runs after *every* render — so a re-render of the
    // sign-in card is exactly the moment a still-watched id would ask again. It must not.
    await user.click(screen.getByRole('link', { name: viNormal.auth.register }))
    await screen.findByRole('button', { name: viNormal.auth.submitRegister })
    expect(playerAvatar).not.toHaveBeenCalled()

    // And the entry itself is gone, not merely unwatched: signing back in inside the TTL asks the server
    // again rather than serving the previous session's name and face out of the module-level cache.
    await user.click(screen.getByRole('link', { name: viNormal.auth.signIn }))
    await user.type(screen.getByLabelText(viNormal.auth.email), 'binh@example.com')
    await user.type(screen.getByLabelText(viNormal.auth.password), 'con-meo-den-1')
    await user.click(screen.getByRole('button', { name: viNormal.auth.submitSignIn }))

    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))
  })
})

describe('App — back into the room the server still holds (T5)', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
  })

  const ROOM = {
    roomId: 'r1', code: 'ABC234', name: 'Bàn cũ', mode: 'holdem' as const,
    config: { name: 'Bàn cũ', mode: 'holdem' as const, maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, hasPassword: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } },
    playerCount: 1, maxPlayers: 4, status: 'OPEN' as const, hostPlayerId: 'p1', carryOverPot: 0, nextHandAt: null,
    players: [{ playerId: 'p1', displayName: 'Bình', isBot: false, isHost: true, connected: true, seat: null, status: null, sittingOut: false, stack: 0, ready: false }],
  }

  it.each(['/#/lobby', '/#/daily'])('opens the room screen from %s when the connect is answered with a room', async (start) => {
    window.history.replaceState(null, '', start)
    renderApp()
    await settled()
    await welcome()
    expect(window.location.hash).toBe(start.slice(1))

    await act(async () => {
      socket().receive({ t: 'ROOM_SNAPSHOT', seq: 5, room: ROOM, hand: null, deadlineAt: null })
    })

    await waitFor(() => expect(window.location.hash).toBe('#/room'))
    expect(await screen.findByRole('button', { name: /Rời phòng/ })).toBeInTheDocument()
  })

  it('stays in the lobby when the server holds no room for the player', async () => {
    window.history.replaceState(null, '', '/#/lobby')
    renderApp()
    await settled()
    await welcome()
    await act(async () => {
      socket().receive({ t: 'ERROR', code: 'NOT_IN_ROOM', message: 'not in a room' })
    })

    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/lobby')
  })
})

describe('App — a rename (T7)', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
  })

  const STATS = Object.fromEntries(
    [
      'handsPlayedHoldem', 'handsWonHoldem', 'handsPlayedBlind', 'handsWonBlind', 'botHands', 'currentWinStreak', 'bestWinStreak',
      'currentLoseStreak', 'bestLoseStreak', 'bestHandRank', 'biggestWin', 'roomsJoined', 'gamesCompleted', 'totalLoginDays',
      'loginStreak', 'bestLoginStreak',
    ].map((key) => [key, 0]),
  )

  it('shows the new name in the lobby bar as soon as the server accepts it, with no reload', async () => {
    window.history.replaceState(null, '', '/#/profile')
    const rename = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Minh Sài Gòn' })
    const user = userEvent.setup()
    renderApp(
      stubApi({
        me: vi.fn().mockResolvedValue({
          playerId: 'p1', displayName: 'Bình', email: 'binh@example.com', balance: 123_000,
          avatar: { v: 3, base: 'f01', outfit: 'avatar_default' }, createdAt: 0, lastLoginAt: 0,
        }),
        stats: vi.fn().mockResolvedValue(STATS),
        history: vi.fn().mockResolvedValue([]),
        ledger: vi.fn().mockResolvedValue({ entries: [], nextBefore: null }),
        rename,
      }),
    )
    await settled()
    await welcome()

    const box = await screen.findByLabelText(viNormal.profile.rename.label)
    await user.clear(box)
    await user.type(box, 'Minh Sài Gòn')
    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith('Minh Sài Gòn'))
    expect(await screen.findByText(viNormal.profile.rename.saved)).toBeInTheDocument()

    act(() => {
      window.location.hash = '#/lobby'
    })
    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
    // The socket still says "Bình" — it was named at the upgrade — but the app no longer reads it back as is.
    expect(await screen.findByText('Minh Sài Gòn')).toBeInTheDocument()
    expect(screen.queryByText('Bình')).toBeNull()
  })
})

describe('App — the daily reminder', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeSocket.reset()
    window.history.replaceState(null, '', '/')
  })

  const status = (claimable: boolean) => ({ claimable, day: 3, streak: 2, reward: 7000, item: null, nextResetAt: 1_800_000_000_000, calendar: [] })
  /** `/daily` itself asks for the same status and hangs on it; only the reminder's answer matters here. */
  const apiWith = (claimable: boolean) => stubApi({ daily: vi.fn().mockResolvedValue(status(claimable)) })

  it('opens the reward page once a day when a session lands on the lobby with a reward waiting', async () => {
    const api = apiWith(true)
    renderApp(api)
    await settled()
    await welcome()

    await waitFor(() => expect(window.location.hash).toBe('#/daily'))
    expect(await screen.findByRole('heading', { name: viNormal.daily.title })).toBeInTheDocument()
    expect(localStorage.getItem(DAILY_NUDGE_KEY)).toBe(String(status(true).nextResetAt))
    // The tab says so too, in words a screen reader can carry.
    const nav = screen.getByRole('navigation', { name: viNormal.nav.main })
    expect(within(nav).getByText(viNormal.nav.dailyReady)).toBeInTheDocument()
  })

  it('does not drag the player back once this day has been shown, but keeps the dot until the claim', async () => {
    localStorage.setItem(DAILY_NUDGE_KEY, String(status(true).nextResetAt))
    renderApp(apiWith(true))
    await settled()
    await welcome()

    expect(await screen.findByRole('heading', { name: ROOMS_HEADING })).toBeInTheDocument()
    expect(window.location.hash).not.toBe('#/daily')
    // The rail's Daily tab carries the dot on the lobby too — the lobby's own bar no longer repeats the link
    // (layout audit U2), so there is exactly one.
    expect(await screen.findAllByText(viNormal.nav.dailyReady)).toHaveLength(1)
  })

  it('leaves a deep link alone and shows no dot when today is already claimed', async () => {
    window.history.replaceState(null, '', '/#/achievements')
    renderApp(stubApi({ daily: vi.fn().mockResolvedValue(status(false)), achievements: vi.fn().mockResolvedValue([]) }))
    await settled()
    await welcome()

    expect(await screen.findByRole('heading', { name: viNormal.achievements.ui.title })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/achievements')
    expect(screen.queryByText(viNormal.nav.dailyReady)).toBeNull()
  })

  /** A day that is claimable until the claim lands, and taken after it — the server's own answer either side. */
  const claimingApi = (claim: NormalApi['claimDaily']) => {
    let taken = false
    return stubApi({
      daily: vi.fn(async () => status(!taken)),
      claimDaily: vi.fn(async () => {
        taken = true
        return claim()
      }),
    })
  }

  it('drops the dot the moment the claim lands, while the player is still on the reward page (T1)', async () => {
    const receipt = { claimed: true, day: 3, points: 7000, item: null, items: [], fallbackPoints: 0, balance: 130_000, streak: 3 }
    const user = userEvent.setup()
    renderApp(claimingApi(vi.fn().mockResolvedValue(receipt)))
    await settled()
    await welcome()
    await waitFor(() => expect(window.location.hash).toBe('#/daily'))
    const nav = screen.getByRole('navigation', { name: viNormal.nav.main })
    expect(await within(nav).findByText(viNormal.nav.dailyReady)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: viNormal.daily.claim }))

    await waitFor(() => expect(within(nav).queryByText(viNormal.nav.dailyReady)).toBeNull())
    expect(window.location.hash, 'nobody had to leave the page for it').toBe('#/daily')
  })

  it('drops the dot too when the claim is refused as already taken in another tab', async () => {
    const user = userEvent.setup()
    renderApp(claimingApi(vi.fn().mockRejectedValue(new ApiError(409, 'ALREADY_CLAIMED', 'already claimed today'))))
    await settled()
    await welcome()
    await waitFor(() => expect(window.location.hash).toBe('#/daily'))
    const nav = screen.getByRole('navigation', { name: viNormal.nav.main })
    expect(await within(nav).findByText(viNormal.nav.dailyReady)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: viNormal.daily.claim }))

    expect(await screen.findByText(viNormal.daily.errors.ALREADY_CLAIMED)).toBeInTheDocument()
    expect(within(nav).queryByText(viNormal.nav.dailyReady)).toBeNull()
  })

  it('keeps a deep link even with a reward waiting, and only marks the tab', async () => {
    window.history.replaceState(null, '', '/#/settings')
    renderApp(apiWith(true))
    await settled()
    await welcome()

    expect(await screen.findByRole('heading', { name: viNormal.settings.title })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/settings')
    expect(await screen.findByText(viNormal.nav.dailyReady)).toBeInTheDocument()
    expect(localStorage.getItem(DAILY_NUDGE_KEY)).toBeNull()
  })
})

describe('websocketUrl', () => {
  it('follows the page it was served from, upgrading to wss over https', () => {
    expect(websocketUrl({ protocol: 'https:', host: 'bind.example' })).toBe('wss://bind.example/ws')
    expect(websocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})
