import type { ConnectionStatus } from '@bp/ui-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type AuthMeDto, type NormalApi } from './api.js'

/**
 * Where the boot probe has got to.
 *
 * `checking` is not a cosmetic loading state: rendering the sign-in card while `GET /api/auth/me` is still in
 * flight would flash a login form at a player who is already signed in, on every single reload.
 */
export type SessionState = 'checking' | 'anonymous' | 'signedIn'

/**
 * How long a socket may sit in `reconnecting` before the app suspects the session rather than the network.
 *
 * The rule this implements (Plan 6 ruling): the Normal socket carries **no token**. The server binds the
 * identity from the session cookie at the upgrade, so a dead session is not a close code — it is an HTTP 401
 * on the handshake, which the browser reports as an ordinary failed connection and `createConnection` answers
 * with backoff. That is indistinguishable from an unplugged cable unless somebody asks. So after ten seconds
 * of uninterrupted reconnecting the app asks: `GET /api/auth/me`. A 401 means the session is gone and the
 * player is signed out; anything else means the network is merely bad and the socket should keep trying.
 */
export const RECONNECT_PROBE_MS = 10_000

export interface SessionGate {
  state: SessionState
  /** True exactly when `state === 'signedIn'`; the socket and the shell key off this. */
  signedIn: boolean
  /** The account the cookie names, once one is known. */
  me: AuthMeDto | null
  /** True when the last thing that happened was a session ending under the player rather than a sign-out. */
  expired: boolean
  /** The sign-in card's success path: the cookie is already set, this is only who it turned out to be. */
  signIn: (me: AuthMeDto) => void
  /** A deliberate sign-out. The caller is expected to have told the server first. */
  signOut: () => void
  /** Any screen's 401. The single place a session ends against the player's wishes. */
  onUnauthenticated: () => void
}

export interface SessionGateOptions {
  api: NormalApi
  /** The live socket status; the reconnect probe watches it. */
  socketStatus: ConnectionStatus
  /** Called whenever a session ends, so the app can drop its socket. */
  onEnded: () => void
}

/**
 * The Normal session, as a hook.
 *
 * This edition has no token to read, so "am I signed in?" is not a question the browser can answer on its
 * own — it is one request. The gate boots into `checking`, asks `GET /api/auth/me` once, and from then on
 * holds the answer until something says otherwise: a screen's 401, a sign-out, or the reconnect probe above.
 */
export function useSessionGate({ api, socketStatus, onEnded }: SessionGateOptions): SessionGate {
  const [state, setState] = useState<SessionState>('checking')
  const [me, setMe] = useState<AuthMeDto | null>(null)
  const [expired, setExpired] = useState(false)

  // `onEnded` is a fresh closure every render; the effects below want the latest one without re-running.
  const endedRef = useRef(onEnded)
  endedRef.current = onEnded
  // The same trick for `api`, and here it is load-bearing rather than tidy: keying the boot probe on the
  // object's identity would send a caller who builds it inside their own render into an endless loop —
  // probe, set state, re-render, new object, probe again.
  const apiRef = useRef(api)
  apiRef.current = api

  const end = useCallback((wasExpected: boolean) => {
    endedRef.current()
    setMe(null)
    setState('anonymous')
    setExpired(!wasExpected)
  }, [])

  const onUnauthenticated = useCallback(() => end(false), [end])
  const signOut = useCallback(() => end(true), [end])

  const signIn = useCallback((account: AuthMeDto) => {
    setMe(account)
    setExpired(false)
    setState('signedIn')
  }, [])

  // The boot probe. One request, and the answer decides which half of the app renders at all.
  useEffect(() => {
    let live = true
    void apiRef.current
      .authMe()
      .then((account) => {
        if (!live) return
        setMe(account)
        setState('signedIn')
      })
      .catch(() => {
        // A 401 is the ordinary answer for a visitor and says nothing worth showing; any other failure (the
        // server is down) also lands on the sign-in card, because there is nothing else to show. Neither is
        // an *expiry*: nothing was lost, so the card carries no notice.
        if (live) setState('anonymous')
      })
    return () => {
      live = false
    }
  }, [])

  const signedIn = state === 'signedIn'

  // The reconnect probe. Armed when the socket starts reconnecting, disarmed the moment it stops — and it
  // keeps asking for as long as that lasts, because a session can die *during* an outage: the first probe
  // may well answer 200 and the second, a network-outage later, a 401. Asking once would leave the app in a
  // live-looking shell that can never recover.
  //
  // The next probe is scheduled in `.finally` rather than by an interval, so a slow answer delays the
  // following question instead of stacking a second one behind it. The effect is keyed on the status alone,
  // so a socket that opens and drops repeatedly never accumulates ten seconds — which is right: something is
  // answering the handshake, so the session is not the suspect.
  useEffect(() => {
    if (!signedIn || socketStatus !== 'reconnecting') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const arm = (): void => {
      timer = setTimeout(() => {
        void apiRef.current
          .authMe()
          .catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.unauthenticated) onUnauthenticated()
          })
          .finally(() => {
            if (!stopped) arm()
          })
      }, RECONNECT_PROBE_MS)
    }
    arm()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [signedIn, socketStatus, onUnauthenticated])

  return { state, signedIn, me, expired, signIn, signOut, onUnauthenticated }
}
