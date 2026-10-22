import {
  AvatarAssets,
  Chibi,
  defaultChibi,
  GameClientProvider,
  LobbyScreen,
  RoomScreen,
  Toasts,
  useGameClient,
  useHashRoute,
  useRoomReturn,
  type ClientNotification,
  type SocketFactory,
} from '@bp/ui-kit'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarCatalogDto, ItemDto, NormalApi } from './api.js'
import a from './avatar/avatar.module.css'
import { chibiFromApi } from './avatar/chibi.js'
import { resetAvatarCache, useAvatars } from './avatar/useAvatars.js'
import { guardApi } from './guarded-api.js'
import { gmNoticeAction, mapNotifications, ROLE_ACTIONS } from './notifications.js'
import { useLanguagePref } from './prefs.js'
import { AuthScreen, type AuthMode } from './screens/AuthScreen.js'
import { Shell } from './screens/Shell.js'
import { UpdateBoundary } from './screens/UpdateBoundary.js'
import { useDailyNudge } from './daily-nudge.js'
import { makeCaptionFor, makeChibiFor, makeRankFor } from './screens/TableChrome.js'
import s from './screens/normal.module.css'
import { clearLastEmail } from './session.js'
import { useSessionGate } from './session-gate.js'
import { lazyScreen } from './stale-chunk.js'
import { useAsync } from './screens/useAsync.js'

/** `/avatar/<file>@1x.png` / `@2x.png` — the PNG layers this build served alongside the bundle. */
const AVATAR_ASSET_BASE = '/avatar/'

const NO_ITEMS: ItemDto[] = []

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
 * month's calendar and the achievement list — none of which the sign-in card or the lobby has any use for.
 * (`Chibi` is not among them: the lobby bar and the seat plates draw faces, so it belongs in the entry
 * chunk and ships there.) Splitting these six keeps the first paint small on the phone connection this game
 * is mostly played on, and each screen then costs one request, once.
 */
const ProfileScreen = lazyScreen(async () => ({ default: (await import('./screens/ProfileScreen.js')).ProfileScreen }))
const WardrobeScreen = lazyScreen(async () => ({ default: (await import('./screens/wardrobe/WardrobeScreen.js')).WardrobeScreen }))
const AchievementsScreen = lazyScreen(async () => ({ default: (await import('./screens/AchievementsScreen.js')).AchievementsScreen }))
const DailyScreen = lazyScreen(async () => ({ default: (await import('./screens/DailyScreen.js')).DailyScreen }))
const SettingsScreen = lazyScreen(async () => ({ default: (await import('./screens/SettingsScreen.js')).SettingsScreen }))
const GmScreen = lazyScreen(async () => ({ default: (await import('./screens/gm/GmScreen.js')).GmScreen }))
const ShopScreen = lazyScreen(async () => ({ default: (await import('./screens/shop/ShopScreen.js')).ShopScreen }))

/** The routes served by a lazy chunk rather than by the entry bundle. */
export const ACCOUNT_ROUTES = ['/profile', '/avatar', '/achievements', '/daily', '/settings', '/gm', '/shop']

/**
 * The inventory's old route. The inventory folded into the wardrobe (review 2026-09-29, No5), but a bookmark, a
 * shared link or the browser's history can still name it: everything in `App` reads `/avatar` in its place, and
 * the address bar is swapped for it in place (the effect in `App`).
 */
const INVENTORY_ROUTE = '/inventory'

/** Normal is served by the same origin as the socket, so the origin is never configured. */
export function websocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

/** `#/register` opens the register tab; every other route reached while signed out opens sign-in. */
const modeOf = (path: string): AuthMode => (path === '/register' ? 'register' : 'signIn')

/**
 * Renders nothing and moves the address bar: the route a signed-in account is not allowed to see (`#/gm` for a
 * player) hands over to one it is. It is a component rather than a call during render because navigating is a side
 * effect.
 *
 * It *replaces* the history entry instead of pushing one, as the `/inventory` swap in `App` does: with a push, "Back"
 * from the lobby would land on `#/gm`, which redirects again, and the player could never go back past it.
 * `location.replace` fires `hashchange`, so the router reads the new route like any other.
 */
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(`#${to}`)
  }, [to])
  return null
}

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
  // and points. The avatar cache is module-level for the same reason and forgets the same way — the face of
  // the account that just signed out is exactly what should not sit behind the sign-in card.
  const endSession = useCallback(() => {
    clientRef.current.disconnect()
    clientRef.current.reset()
    resetAvatarCache()
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
  const captionFor = useMemo(() => makeCaptionFor(avatars, t), [avatars, t])
  const rankFor = useMemo(() => makeRankFor(avatars), [avatars])
  const myAvatar = myId === null ? null : (avatars.get(myId)?.avatar ?? null)

  // The rig every chibi is drawn on: fetched once, for the app's whole lifetime, from the two public
  // catalogue routes — a chibi is never anyone's secret, so this needs no session and never re-fetches on
  // sign-in or sign-out. A load that has not landed yet (or failed) answers empty maps, and every chibi
  // built from them is `null` until it has: the table and the bar fall back to the same initial or default
  // chibi they would show for an id they have not heard back about yet.
  const catalog = useAsync<[AvatarCatalogDto, ItemDto[]]>(
    useCallback(
      () => Promise.all([api.avatarCatalog(), api.catalogItems().then((answer) => answer.items)]),
      [api],
    ),
  )
  const items = useMemo(() => new Map((catalog.data?.[1] ?? NO_ITEMS).map((item) => [item.id, item])), [catalog.data])
  const bodies = useMemo(() => new Map((catalog.data?.[0].bodies ?? []).map((body) => [body.gender, body])), [catalog.data])
  const chibiFor = useMemo(() => makeChibiFor(avatars, items, bodies), [avatars, items, bodies])
  const myChibi = useMemo(() => (myAvatar === null ? null : chibiFromApi(myAvatar, items, bodies)), [myAvatar, items, bodies])

  // `ACHIEVEMENT_UNLOCKED` arrives naming an achievement *id*, and the kit's toast interpolates it verbatim
  // because achievement names live in this app's namespace, not the kit's. The lobby and the room each render
  // their own `Toasts` out of `client.state`, so the translation is done once here — on the list the client
  // hands them — rather than twice, on two screens this app does not own. A game master's notice is rewritten here for the
  // same reason: the amount and the item name are this app's words. `lang` is a real input now (the amount is formatted in it),
  // and `t` can keep its identity across a language switch, so it is also what re-renders a toast already on screen.
  const notifications = useMemo(() => mapNotifications(client.state.notifications, t, lang), [client.state.notifications, t, lang])

  // A promotion or a demotion changes the role under a live session: the gate asks the server again, so the Settings
  // row that links the console and the `#/gm` route follow at once instead of at the next reload. Each notice is handled
  // once, by object — the reducer reuses ids after a dismissal, but never a notification object. A reopened check-in is
  // counted the same way, and the daily page reads its status again when the count moves (Plan 26, Ruling 11).
  const rawNotifications = client.state.notifications
  const { refresh: refreshGate } = gate
  const roleNoticesSeen = useRef(new WeakSet<ClientNotification>())
  const [checkinResets, setCheckinResets] = useState(0)
  useEffect(() => {
    let changed = false
    let resets = 0
    for (const n of rawNotifications) {
      if (roleNoticesSeen.current.has(n)) continue
      roleNoticesSeen.current.add(n)
      const action = gmNoticeAction(n)
      if (action !== null && ROLE_ACTIONS.has(action)) changed = true
      if (action === 'reset_checkin') resets += 1
    }
    if (changed) refreshGate()
    if (resets > 0) setCheckinResets((count) => count + resets)
  }, [rawNotifications, refreshGate])

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

  // The old inventory link is the wardrobe: the rail, the route list, the boundary's key and the daily reminder
  // all read `path`, so none of them has to know the inventory ever existed.
  const path = route.path === INVENTORY_ROUTE ? '/avatar' : route.path
  // And the address bar follows, replacing the entry rather than adding one ("Back" would land on `#/inventory` and be
  // sent forward again). `location.replace` fires `hashchange`, so the route reads `/avatar` from then on.
  const routePath = route.path
  useEffect(() => {
    if (routePath === INVENTORY_ROUTE) window.location.replace('#/avatar')
  }, [routePath])

  // Today's reward, as a reminder rather than a claim: a sign-in that lands on the lobby with a reward waiting
  // opens `/daily` once a day, and the rail's tab carries a dot while the reward is still there.
  const { ready: dailyReady } = useDailyNudge({ api: guarded, playerId: gate.signedIn ? gateId : null, path, navigate })

  // Still in a room when the socket came up (a reload, a tab reopened after a drop): that room is where the player
  // is, whichever screen they landed on — the lobby cannot take them anywhere else until they leave it.
  const toRoom = useCallback(() => navigate('/room'), [navigate])
  useRoomReturn(client.state, toRoom)

  // A rename the server accepted: the gate (the rail) and the socket's identity (the lobby bar) both take the
  // new name now, not at the next reload (finding T7 of the 2026-09-28 run).
  const { renamed: gateRenamed } = gate
  const onRenamed = useCallback(
    (displayName: string) => {
      gateRenamed(displayName)
      clientRef.current.renamed(displayName)
    },
    [gateRenamed],
  )

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
    <AvatarAssets base={AVATAR_ASSET_BASE}>
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
            <RoomScreen client={viewClient} lang={lang} onLeft={() => navigate('/lobby')} chibiFor={chibiFor} captionFor={captionFor} rankFor={rankFor} />
          ) : ACCOUNT_ROUTES.includes(path) ? (
            <>
              {/* One fallback for all six: the chunk is a single request on a page the rail has already drawn, so
                  what the player waits for is a line under the rail, not a blank screen with a spinner in the middle. */}
              {/* Bug 4: a chunk that vanished in a deploy reloads the page once (`lazyScreen`); if that does not help,
                  the boundary says a new version is out instead of leaving the page blank. */}
              <UpdateBoundary key={path}>
              <Suspense
                fallback={
                  <p className={s.booting} role="status">
                    {t('screens.loading')}
                  </p>
                }
              >
                {path === '/profile' ? (
                  <ProfileScreen api={guarded} lang={lang} balance={balance} onRenamed={onRenamed} />
                ) : path === '/avatar' ? (
                  // `#/avatar?item=<id>`: the shop's "Mặc" on an owned card opens the wardrobe with that item picked.
                  <WardrobeScreen api={guarded} playerId={myId} initialItem={route.query.get('item')} />
                ) : path === '/shop' ? (
                  <ShopScreen api={guarded} lang={lang} balance={balance} playerId={myId} />
                ) : path === '/daily' ? (
                  <DailyScreen api={guarded} lang={lang} checkinResets={checkinResets} />
                ) : path === '/settings' ? (
                  <SettingsScreen
                    api={guarded}
                    lang={lang}
                    onLanguage={setLang}
                    onSignedOut={onSignedOut}
                    version={NORMAL_VERSION}
                    role={gate.me?.role ?? 'player'}
                  />
                ) : path === '/gm' ? (
                  // The route is a convenience and the server is the lock: a player who types the address is sent to the lobby
                  // before the console's chunk is ever asked for, and a GM demoted since the page loaded is sent there on their
                  // next 403 (`onForbidden`, which replaces the history entry like `Redirect` does, so Back is not trapped).
                  gate.me?.role === 'gm' ? (
                    <GmScreen api={guarded} lang={lang} onForbidden={() => window.location.replace('#/lobby')} />
                  ) : (
                    <Redirect to="/lobby" />
                  )
                ) : (
                  <AchievementsScreen api={guarded} lang={lang} />
                )}
              </Suspense>
              </UpdateBoundary>
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
              onEnteredRoom={() => navigate('/room')}
              // The face the player built, as the way into the wardrobe. Daily, Profile and the language switch
              // are the rail's, which is on screen above the lobby too (layout audit U2).
              avatar={
                <a className={a.lobbyAvatarLink} href="#/avatar" aria-label={t('avatar.mine')}>
                  <Chibi subject={myChibi ?? defaultChibi(gate.me?.displayName ?? '')} frame="head" size={36} className={a.lobbyAvatar} />
                </a>
              }
              rank={myId === null ? null : (avatars.get(myId)?.rank ?? null)}
              // The wardrobe and the shop, by name, under the bar (Plan 27, P20): the rail holds four tabs and no more.
              header={
                <nav className={a.lobbyLinks} aria-label={t('shop.lobbyLinks')}>
                  <a className={a.lobbyLink} href="#/avatar">
                    {t('wardrobe.title')}
                  </a>
                  <a className={a.lobbyLink} href="#/shop">
                    {t('shop.title')}
                  </a>
                </nav>
              }
            />
          )}
        </Shell>
      </GameClientProvider>
    </AvatarAssets>
  )
}
