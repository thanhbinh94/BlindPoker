import {
  GameClientProvider,
  LobbyScreen,
  RoomScreen,
  Toasts,
  useGameClient,
  useHashRoute,
  type SocketFactory,
} from '@bp/ui-kit'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalApi } from './api.js'
import { Portrait } from './avatar3d/Portrait.js'
import { resetPortraitMemory } from './avatar3d/portrait-cache.js'
import a from './avatar/avatar.module.css'
import { resetAvatarCache, useAvatars } from './avatar/useAvatars.js'
import { guardApi } from './guarded-api.js'
import { mapNotifications } from './notifications.js'
import { useLanguagePref } from './prefs.js'
import { AuthScreen, type AuthMode } from './screens/AuthScreen.js'
import { Shell } from './screens/Shell.js'
import { useDailyNudge } from './daily-nudge.js'
import { makeAvatarFor, makeCaptionFor } from './screens/TableChrome.js'
import s from './screens/normal.module.css'
import { clearLastEmail } from './session.js'
import { useSessionGate } from './session-gate.js'

/**
 * `apps/normal-web/package.json`'s version, substituted at build time; the settings screen prints it so a bug
 * report names a build. Vitest applies no `define`, so a test run reads the marker instead of a wrong number.
 */
export const NORMAL_VERSION = typeof __NORMAL_VERSION__ === 'string' ? __NORMAL_VERSION__ : 'dev'

/**
 * The six account screens, split out of the entry bundle.
 *
 * They are the right things to split and the lobby is not: a player reaches the lobby on every visit, these
 * on some visits and several of them never. Between them they carry the stats tables, the ledger, the
 * month's calendar, the achievement list and the wardrobe's thumbnail renderer — none of which the sign-in
 * card or the lobby has any use for. (`Portrait` is not among them: the lobby bar and the seat plates draw
 * faces, so it belongs in the entry chunk and ships there — three.js does not, and reaches the browser
 * only through `usePortrait`'s own dynamic import.) Splitting these six
 * keeps the first paint small on the phone connection this game is mostly played on, and each screen then
 * costs one request, once.
 */
const ProfileScreen = lazy(async () => ({ default: (await import('./screens/ProfileScreen.js')).ProfileScreen }))
const WardrobeScreen = lazy(async () => ({ default: (await import('./screens/WardrobeScreen.js')).WardrobeScreen }))
const InventoryScreen = lazy(async () => ({ default: (await import('./screens/InventoryScreen.js')).InventoryScreen }))
const AchievementsScreen = lazy(async () => ({ default: (await import('./screens/AchievementsScreen.js')).AchievementsScreen }))
const DailyScreen = lazy(async () => ({ default: (await import('./screens/DailyScreen.js')).DailyScreen }))
const SettingsScreen = lazy(async () => ({ default: (await import('./screens/SettingsScreen.js')).SettingsScreen }))

/** The routes served by a lazy chunk rather than by the entry bundle. */
export const ACCOUNT_ROUTES = ['/profile', '/avatar', '/inventory', '/achievements', '/daily', '/settings']

/** Normal is served by the same origin as the socket, so the origin is never configured. */
export function websocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

/** `#/register` opens the register tab; every other route reached while signed out opens sign-in. */
const modeOf = (path: string): AuthMode => (path === '/register' ? 'register' : 'signIn')

export interface AppProps {
  api: NormalApi
  /** Tests pass `fakeSocketFactory`; the browser gets the real `WebSocket`. */
  socketFactory?: SocketFactory
}

/**
 * The whole Normal app: a cookie-session gate in front of the hash routes.
 *
 * The gate (`useSessionGate`) is the only thing here with a rule of its own, and it is shaped by what this
 * edition's session *is*. There is no token to read, so the only way to know whether this browser is signed
 * in is to ask the server: the app boots into `checking`, asks once, and then shows either the lobby or the
 * sign-in card. The socket is opened only when the answer is yes — one that opens without a session is
 * refused at the upgrade anyway, and would just back off forever.
 */
export function App({ api, socketFactory }: AppProps) {
  const { t } = useTranslation('normal')
  const { lang, setLang } = useLanguagePref()
  const { route, navigate } = useHashRoute()

  const url = useMemo(() => websocketUrl(), [])
  // `token: null` on purpose, and this is the edition's whole authentication story on the socket: with no
  // token there is no `HELLO`, the server authenticates the upgrade from the cookie, and `WELCOME` is the
  // first thing that arrives.
  const client = useGameClient({ url, token: null, autoConnect: false, ...(socketFactory === undefined ? {} : { socketFactory }) })
  // `useGameClient` hands back a fresh object every render; the callbacks below only ever want the latest one.
  const clientRef = useRef(client)
  clientRef.current = client

  // Everything a session leaves behind, dropped in one place — however the session ended (a sign-out, an
  // expiry, a 401 from a screen). The socket first, then the state it filled: the reducer outlives the
  // session, so without the reset the next player on this machine is greeted with the previous one's name
  // and points. The avatar cache is module-level for the same reason and forgets the same way, and so are
  // the rendered portraits — the face of the account that just signed out is exactly what should not sit
  // behind the sign-in card, and every one of its object URLs is a blob held open until it is revoked.
  const endSession = useCallback(() => {
    clientRef.current.disconnect()
    clientRef.current.reset()
    resetAvatarCache()
    resetPortraitMemory()
  }, [])
  const gate = useSessionGate({ api, socketStatus: client.state.status, onEnded: endSession })

  // The api every signed-in screen gets: the same one, with "the session is gone" handled once (see
  // `guarded-api.ts`). The gate itself and the sign-in card keep the raw `api` — the boot probe's 401 is an
  // ordinary "no session yet", and the card's is a wrong password.
  //
  // Keyed on the account as well as on the callback: the wrapper signs the player out at most once, so the
  // next session needs a wrapper of its own to be able to do it again.
  const gateId = gate.me?.playerId ?? null
  const { onUnauthenticated } = gate
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `gateId` is a deliberate cache-buster, not a read value: `guardApi` fires `onUnauthenticated` at most once per wrapper, so a new session must get a new wrapper or its first 401 would be swallowed.
  const guarded = useMemo(() => guardApi(api, onUnauthenticated), [api, onUnauthenticated, gateId])

  // The socket follows the gate, and only the gate: one effect, whether the session arrived from the boot
  // probe or from the sign-in card. `autoConnect` is off precisely so this stays the only place it opens.
  const { signedIn } = gate
  useEffect(() => {
    if (signedIn) clientRef.current.connect()
  }, [signedIn])

  const onSignedIn = useCallback(
    (account: Parameters<typeof gate.signIn>[0]) => {
      gate.signIn(account)
      navigate('/lobby')
    },
    [gate, navigate],
  )

  const onSignedOut = useCallback(() => {
    // The server is told first; whether it answers or not, this browser is done with the session. A failed
    // logout leaves a cookie the next 401 will clear, which is better than refusing to sign the player out.
    void api.logout().catch(() => undefined)
    clearLastEmail()
    gate.signOut()
    navigate('/')
  }, [api, gate, navigate])

  const onMode = useCallback((mode: AuthMode) => navigate(mode === 'register' ? '/register' : '/login'), [navigate])

  // Who I am, and the order matters: the *gate* is the current session, the socket is whoever the last
  // `WELCOME` named. They agree for all but a moment — the moment being a sign-out followed by a sign-in in
  // the same tab, where the socket's answer is the account that just left.
  const myId = gate.me?.playerId ?? client.state.me?.playerId ?? null

  // Whose face this app needs: everyone at the table, plus my own for the lobby bar. Bots are filtered out
  // here rather than inside the cache — they have no account, so their id would be a guaranteed 404 apiece.
  // Signed out there is nobody to draw: an id left in this list would go on being re-fetched behind the
  // sign-in card, once per TTL, every one of them a 401.
  const seatedIds = client.state.room?.players
  const watched = useMemo(() => {
    if (!gate.signedIn || myId === null) return []
    const ids = (seatedIds ?? []).filter((p) => !p.isBot).map((p) => p.playerId)
    return [myId, ...ids]
  }, [gate.signedIn, myId, seatedIds])
  const { avatars } = useAvatars(guarded, watched)
  const avatarFor = useMemo(() => makeAvatarFor(avatars), [avatars])
  const captionFor = useMemo(() => makeCaptionFor(avatars, t), [avatars, t])
  const myAvatar = myId === null ? null : (avatars.get(myId)?.avatar ?? null)

  // `ACHIEVEMENT_UNLOCKED` arrives naming an achievement *id*, and the kit's toast interpolates it verbatim
  // because achievement names live in this app's namespace, not the kit's. The lobby and the room each render
  // their own `Toasts` out of `client.state`, so the translation is done once here — on the list the client
  // hands them — rather than twice, on two screens this app does not own.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` is a deliberate cache-buster: `t` is bound to the i18n instance and can keep its identity across a language switch, so without it a toast already on screen would stay in the language it was raised in.
  const notifications = useMemo(() => mapNotifications(client.state.notifications, t), [client.state.notifications, t, lang])

  // The socket's identity is usable only while it agrees with the gate's. It disagrees for exactly one
  // window — a sign-out followed by a sign-in in the same tab, until the new socket's `WELCOME` — and in that
  // window it is the *previous* account, so the lobby bar would greet the new player by the old player's name
  // with the old player's points. Where the two disagree the gate wins, and the balance is the one the boot
  // probe or the sign-in response read.
  const socketMe = client.state.me
  const gateMe = gate.me
  const sameAccount = gateMe !== null && socketMe !== null && socketMe.playerId === gateMe.playerId
  const viewMe = useMemo(
    () => (sameAccount ? socketMe : gateMe === null ? null : { playerId: gateMe.playerId, displayName: gateMe.displayName }),
    [sameAccount, socketMe, gateMe],
  )
  // Until `WELCOME` lands the reducer's balance is 0, but the gate already read one — show that rather than a
  // zero the player would read as "my points are gone".
  const balance = sameAccount ? client.state.balance : (gateMe?.balance ?? 0)

  const viewClient = useMemo(() => {
    const live = client.state
    if (notifications === live.notifications && viewMe === live.me && balance === live.balance) return client
    return { ...client, state: { ...live, notifications, me: viewMe, balance } }
  }, [client, notifications, viewMe, balance])

  const path = route.path

  // Today's reward, as a reminder rather than a claim: a sign-in that lands on the lobby with a reward waiting
  // opens `/daily` once a day, and the rail's tab carries a dot while the reward is still there.
  const { ready: dailyReady } = useDailyNudge({ api: guarded, playerId: gate.signedIn ? gateId : null, path, navigate })

  if (gate.state === 'checking') {
    return (
      <p className={s.booting} role="status">
        {t('session.checking')}
      </p>
    )
  }

  if (!gate.signedIn) {
    return (
      <AuthScreen
        api={api}
        mode={modeOf(path)}
        onMode={onMode}
        onSignedIn={onSignedIn}
        message={gate.expired ? t('session.expired') : null}
      />
    )
  }

  const inRoom = path === '/room' || path.startsWith('/room/')
  const inLobby = path === '/' || path === '/lobby' || path === '/login' || path === '/register'
  const { state } = client

  return (
    <GameClientProvider client={viewClient}>
      <Shell
        path={path}
        bar={!inRoom}
        identity={inLobby ? null : { balance, status: state.status }}
        dailyReady={dailyReady}
        lang={lang}
        onLanguage={setLang}
      >
        {inRoom ? (
          <RoomScreen client={viewClient} lang={lang} onLeft={() => navigate('/lobby')} avatarFor={avatarFor} captionFor={captionFor} />
        ) : ACCOUNT_ROUTES.includes(path) ? (
          <>
          {/* One fallback for all six: the chunk is a single request on a page the rail has already drawn, so
              what the player waits for is a line under the rail, not a blank screen with a spinner in the middle. */}
          <Suspense
            fallback={
              <p className={s.booting} role="status">
                {t('screens.loading')}
              </p>
            }
          >
            {path === '/profile' ? (
              <ProfileScreen api={guarded} lang={lang} balance={balance} onRenamed={gate.renamed} />
            ) : path === '/avatar' ? (
              <WardrobeScreen api={guarded} playerId={myId} />
            ) : path === '/inventory' ? (
              <InventoryScreen api={guarded} lang={lang} />
            ) : path === '/daily' ? (
              <DailyScreen api={guarded} lang={lang} />
            ) : path === '/settings' ? (
              <SettingsScreen api={guarded} lang={lang} onLanguage={setLang} onSignedOut={onSignedOut} version={NORMAL_VERSION} />
            ) : (
              <AchievementsScreen api={guarded} lang={lang} />
            )}
          </Suspense>
          {/* The lobby and the room bring their own stack; these six have none, and `/daily` is precisely
              where the login-day achievements unlock. Without this the slip would sit undelivered in the state
              until the player wandered back to the lobby, and then fire there, out of context. It sits outside
              the `Suspense` so a frame that lands while the chunk is still in flight is not swallowed. */}
          <Toasts
            error={state.lastError}
            notifications={notifications}
            onClearError={viewClient.clearError}
            onDismiss={viewClient.dismissNotification}
            lang={lang}
          />
          </>
        ) : (
          <LobbyScreen
            client={viewClient}
            lang={lang}
            onLanguage={setLang}
            onEnteredRoom={() => navigate('/room')}
            // The lobby hides the shell's rail behind the kit's own `PlayerBar`, so the two routes a player
            // reaches most from here — today's reward and their own profile — are re-hung on that bar, with
            // the face they built as the way into it.
            extraNav={
              <span className={a.lobbyNav}>
                <a className={a.lobbyLink} href="#/daily">
                  {t('nav.daily')}
                  {dailyReady ? (
                    <span className={a.navDot}>
                      <span className="visually-hidden">{t('nav.dailyReady')}</span>
                    </span>
                  ) : null}
                </a>
                <a className={a.lobbyLink} href="#/profile">
                  {t('nav.profile')}
                </a>
                <a href="#/avatar" aria-label={t('avatar.mine')}>
                  <Portrait config={myAvatar} name={gate.me?.displayName} size="sm" className={a.lobbyAvatar} />
                </a>
              </span>
            }
          />
        )}
      </Shell>
    </GameClientProvider>
  )
}
