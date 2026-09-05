import { FakeSocket, fakeSocketFactory } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROUTES, App, websocketUrl } from './App.js'
import { ApiError, type AuthMeDto, type NormalApi } from './api.js'
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
    expect(within(nav).getByText(viNormal.nav.daily)).toHaveAttribute('aria-current', 'page')
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

describe('websocketUrl', () => {
  it('follows the page it was served from, upgrading to wss over https', () => {
    expect(websocketUrl({ protocol: 'https:', host: 'bind.example' })).toBe('wss://bind.example/ws')
    expect(websocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})
