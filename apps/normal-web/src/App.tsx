import {
  GameClientProvider,
  LobbyScreen,
  RoomScreen,
  useGameClient,
  useHashRoute,
  type SocketFactory,
} from '@bp/ui-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalApi } from './api.js'
import { Avatar } from './avatar/Avatar.js'
import a from './avatar/avatar.module.css'
import { useAvatars } from './avatar/useAvatars.js'
import { useLanguagePref } from './prefs.js'
import { AuthScreen, type AuthMode } from './screens/AuthScreen.js'
import { Placeholder } from './screens/Placeholder.js'
import { Shell } from './screens/Shell.js'
import { makeAvatarFor, makeCaptionFor } from './screens/TableChrome.js'
import s from './screens/normal.module.css'
import { clearLastEmail } from './session.js'
import { useSessionGate } from './session-gate.js'

/** Tracks `apps/normal-web/package.json`; the settings screen (Task 4) prints it so a bug report names a build. */
export const NORMAL_VERSION = '0.1.0'

/** Normal is served by the same origin as the socket, so the origin is never configured. */
export function websocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

/** Every route Tasks 3 and 4 fill in. Anything not listed (and not `/room`) falls through to the lobby. */
export const PLACEHOLDER_ROUTES = ['/profile', '/avatar', '/inventory', '/achievements', '/daily', '/settings']

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

  const disconnect = useCallback(() => clientRef.current.disconnect(), [])
  const gate = useSessionGate({ api, socketStatus: client.state.status, onEnded: disconnect })

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

  // Whose face this app needs: everyone at the table, plus my own for the lobby bar. Bots are filtered out
  // here rather than inside the cache — they have no account, so their id would be a guaranteed 404 apiece.
  // `state.me` only exists after `WELCOME`; the boot probe already knows who I am, so the lobby does not wait.
  const myId = client.state.me?.playerId ?? gate.me?.playerId ?? null
  const seatedIds = client.state.room?.players
  const watched = useMemo(() => {
    const ids = (seatedIds ?? []).filter((p) => !p.isBot).map((p) => p.playerId)
    return myId === null ? ids : [myId, ...ids]
  }, [myId, seatedIds])
  const { avatars } = useAvatars(api, watched)
  const avatarFor = useMemo(() => makeAvatarFor(avatars), [avatars])
  const captionFor = useMemo(() => makeCaptionFor(avatars, t), [avatars, t])
  const myAvatar = myId === null ? null : (avatars.get(myId)?.avatar ?? null)

  const path = route.path

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
  // Until `WELCOME` lands the reducer's balance is 0, but the boot probe already read one — show that rather
  // than a zero the player would read as "my points are gone".
  const balance = state.me === null ? (gate.me?.balance ?? 0) : state.balance

  return (
    <GameClientProvider client={client}>
      <Shell
        path={path}
        bar={!inRoom}
        identity={inLobby ? null : { balance, status: state.status }}
        lang={lang}
        onLanguage={setLang}
      >
        {inRoom ? (
          <RoomScreen client={client} lang={lang} onLeft={() => navigate('/lobby')} avatarFor={avatarFor} captionFor={captionFor} />
        ) : PLACEHOLDER_ROUTES.includes(path) ? (
          // Tasks 3 and 4 replace each of these with the real screen; the routes exist now so the shell, the
          // rail and this gate can be tested end to end. Settings carries the one control a placeholder must
          // not swallow — the way back out of the account.
          <Placeholder
            route={path}
            {...(path === '/settings' ? { action: { label: t('placeholder.signOut'), onClick: onSignedOut } } : {})}
          />
        ) : (
          <LobbyScreen
            client={client}
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
                </a>
                <a className={a.lobbyLink} href="#/profile">
                  {t('nav.profile')}
                </a>
                <a href="#/avatar" aria-label={t('avatar.mine')}>
                  <Avatar config={myAvatar} size="sm" className={a.lobbyAvatar} />
                </a>
              </span>
            }
          />
        )}
      </Shell>
    </GameClientProvider>
  )
}
