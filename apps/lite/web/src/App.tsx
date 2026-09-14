import { AvatarAssets, GameClientProvider, LobbyScreen, RoomScreen, useGameClient, useHashRoute, type SocketFactory } from '@bp/ui-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LiteApi, SessionDto } from './api.js'
import { useLanguagePref } from './prefs.js'
import { DailyScreen } from './screens/DailyScreen.js'
import { NamePrompt } from './screens/NamePrompt.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
import { Shell } from './screens/Shell.js'
import { clearToken, loadToken, saveToken } from './session.js'

/** Tracks `apps/lite/package.json`; shown on the settings page so a bug report can name a build. */
export const LITE_VERSION = '0.1.0'

/** Lite is served by the same process as the socket, so the origin is never configured — it is wherever this page came from. */
export function websocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

export interface AppProps {
  api: LiteApi
  /** Tests pass `fakeSocketFactory`; the browser gets the real `WebSocket`. */
  socketFactory?: SocketFactory
  version?: string
}

/**
 * The whole Lite app: a session gate in front of four hash routes.
 *
 * The gate is the only thing here with a rule of its own. No token means the name prompt and no socket at all
 * — a socket that opens with nothing to say is just noise on the server. Once a token exists the client
 * connects, and it stays connected across every route change, because the room the player is sitting in must
 * survive a trip to the daily screen.
 */
export function App({ api, socketFactory, version = LITE_VERSION }: AppProps) {
  const { t } = useTranslation('lite')
  const { lang, setLang } = useLanguagePref()
  const { route, navigate } = useHashRoute()
  const [token, setToken] = useState<string | null>(loadToken)
  const [expired, setExpired] = useState(false)

  const url = useMemo(() => websocketUrl(), [])
  const client = useGameClient({ url, token, autoConnect: false, ...(socketFactory === undefined ? {} : { socketFactory }) })
  // `useGameClient` hands back a fresh object every render; the effects below only ever want the latest one.
  const clientRef = useRef(client)
  clientRef.current = client

  useEffect(() => {
    if (token !== null) clientRef.current.connect()
  }, [token])

  // A refused token is terminal (docs/ui-kit.md, "Authentication is terminal"): the socket will not try again,
  // so the app throws the token away and asks for a name rather than showing a lobby that can never fill.
  const closeReason = client.state.closeReason
  useEffect(() => {
    if (closeReason !== 'unauthenticated') return
    clearToken()
    clientRef.current.disconnect()
    setToken(null)
    setExpired(true)
  }, [closeReason])

  const onSession = useCallback(
    (session: SessionDto) => {
      saveToken(session.token)
      setExpired(false)
      setToken(session.token)
      navigate('/lobby')
    },
    [navigate],
  )

  const onSignedOut = useCallback(() => {
    clientRef.current.disconnect()
    setExpired(false)
    setToken(null)
    navigate('/')
  }, [navigate])

  if (token === null) {
    return <NamePrompt api={api} onSession={onSession} message={expired ? t('session.expired') : null} />
  }

  const path = route.path
  const inRoom = path === '/room' || path.startsWith('/room/')
  const inLobby = path === '/' || path === '/lobby'
  const { state } = client

  return (
    // Lite packs its own `base_*`/`bot_*` PNGs next to the app shell rather than serving `/avatar/` from a
    // server root the way Normal does — see `apps/lite/scripts/build.mjs`.
    <AvatarAssets base="./avatar/">
      <GameClientProvider client={client}>
        <Shell
          path={path}
          bar={!inRoom}
          identity={inLobby ? null : { balance: state.balance, status: state.status }}
          lang={lang}
          onLanguage={setLang}
        >
          {inRoom ? (
            <RoomScreen client={client} lang={lang} onLeft={() => navigate('/lobby')} />
          ) : path === '/daily' ? (
            <DailyScreen api={api} token={token} lang={lang} />
          ) : path === '/settings' ? (
            <SettingsScreen me={state.me} balance={state.balance} onSignedOut={onSignedOut} version={version} />
          ) : (
            <LobbyScreen client={client} lang={lang} onLanguage={setLang} onEnteredRoom={() => navigate('/room')} />
          )}
        </Shell>
      </GameClientProvider>
    </AvatarAssets>
  )
}
