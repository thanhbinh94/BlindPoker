import type { ClientMessage, PlayerAction, RoomConfig } from '@bp/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { createConnection, type AckOrError, type SocketFactory } from './connection.js'
import { resolvePreAction, type PreActionKind } from './preaction.js'
import { initialClientState, reduceClient } from './reducer.js'
import type { ClientState } from './types.js'

export interface GameClientApi {
  state: ClientState
  connect(): void
  disconnect(): void
  listRooms(): void
  createRoom(config: RoomConfig): Promise<AckOrError>
  joinRoom(args: { roomId?: string; code?: string; password?: string }): Promise<AckOrError>
  leaveRoom(): Promise<AckOrError>
  sitDown(seat: number, buyIn?: number): Promise<AckOrError>
  standUp(): Promise<AckOrError>
  /** Keep the seat, sit out from the next hand on; the hand already dealt is played out. */
  sitOut(): Promise<AckOrError>
  /** Take the seat back from the next hand on; too short a stack keeps it `SITTING_OUT`. */
  sitIn(): Promise<AckOrError>
  setReady(ready: boolean): Promise<AckOrError>
  startGame(): Promise<AckOrError>
  kick(playerId: string): Promise<AckOrError>
  act(action: PlayerAction): Promise<AckOrError>
  /**
   * Tick (or clear, with `null`) what to do when the turn comes: the hook sends the matching legal action the
   * moment the server says it is this seat's turn, exactly as if the player had pressed the button then. Only
   * kinds the server lists are ever sent; a tick nothing legal matches simply lapses.
   */
  setPreAction(kind: PreActionKind | null): void
  /** Blind Poker: answer every play-or-fold decision with "play" until the seat is left. */
  setAutoPlay(on: boolean): void
  resync(): void
  clearError(): void
  dismissNotification(id: number): void
  /**
   * Throw the whole client state away, back to its initial value.
   *
   * For a session ending: the reducer lives as long as the component that owns the hook, so after a sign-out
   * `me`, `balance`, `room` and the notification stack are still the previous account's until a new
   * `WELCOME` replaces them. Call it beside `disconnect()`, never on a live socket — nothing re-requests the
   * state, so a reset connection would sit blank until the server next says something.
   */
  reset(): void
  /** Local clock corrected by the `WELCOME` offset — compare deadlines against this, never against `Date.now()`. */
  serverNow(): number
}

export interface UseGameClientOptions {
  url: string
  token?: string | null
  autoConnect?: boolean
  socketFactory?: SocketFactory
}

/** The one place the UI owns a socket: a reconnecting connection feeding the protocol reducer. */
export function useGameClient(opts: UseGameClientOptions): GameClientApi {
  const [state, dispatch] = useReducer(reduceClient, initialClientState)
  const stateRef = useRef(state)
  stateRef.current = state

  const connection = useMemo(
    () =>
      createConnection({
        url: opts.url,
        token: opts.token ?? null,
        ...(opts.socketFactory ? { socketFactory: opts.socketFactory } : {}),
        onMessage: (msg) => dispatch({ type: 'server', msg, now: Date.now() }),
        onStatus: (status, reason) => dispatch(reason === undefined ? { type: 'status', status } : { type: 'status', status, reason }),
      }),
    // Deliberately not keyed on the token: it is pushed through `setToken` below so refreshing it never tears
    // down a live socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keying on `opts.token` would rebuild the connection, and with it drop a live socket, every time the session token is refreshed; the effect below pushes the new token into the existing connection instead.
    [opts.url, opts.socketFactory],
  )

  useEffect(() => {
    connection.setToken(opts.token ?? null)
  }, [connection, opts.token])

  useEffect(() => {
    if (opts.autoConnect !== false) connection.connect()
    return () => connection.disconnect()
  }, [connection, opts.autoConnect])

  useEffect(() => {
    if (state.resyncNeeded && state.status === 'open' && connection.send({ t: 'RESYNC' })) dispatch({ type: 'resyncSent' })
  }, [state.resyncNeeded, state.status, connection])

  const request = useCallback((msg: ClientMessage) => connection.request(msg), [connection])

  // The tick fires here, not in the reducer: a reducer cannot send. `legal` is a fresh object on every turn frame,
  // so its identity is the "have I answered this turn yet" key — one send per turn, however often React re-runs
  // the effect around it (a re-render, StrictMode's double invoke) and whatever the reducer does after.
  const answered = useRef<object | null>(null)
  const legal = state.hand?.legal ?? null
  const preAction = state.preAction
  const autoPlay = state.autoPlay
  useEffect(() => {
    const hand = stateRef.current.hand
    if (hand === null || legal === null || legal.seat !== hand.mySeat || answered.current === legal) return
    const ticked = preAction !== null && preAction.handId === hand.handId ? preAction.kind : null
    const action = legal.kinds.includes('play')
      ? autoPlay ? { kind: 'play' as const } : null
      : ticked === null ? null : resolvePreAction(ticked, legal)
    if (action === null) {
      // Nothing the tick meant is legal here: let it lapse so the tray shows the real choice.
      if (ticked !== null) dispatch({ type: 'preAction', kind: null })
      return
    }
    answered.current = legal
    dispatch({ type: 'preAction', kind: null })
    // A refusal arrives through the reducer as `lastError` like any other; the one thing to swallow is the
    // rejection a socket closing mid-request produces, which has no one to report to and nothing to undo.
    request({ t: 'ACTION', reqId: '', baseSeq: stateRef.current.seq, action }).catch(() => undefined)
  }, [legal, preAction, autoPlay, request])

  return useMemo<GameClientApi>(
    () => ({
      state,
      connect: () => connection.connect(),
      disconnect: () => connection.disconnect(),
      listRooms: () => void connection.send({ t: 'LIST_ROOMS' }),
      createRoom: (config) => request({ t: 'CREATE_ROOM', config }),
      joinRoom: (args) => request({ t: 'JOIN_ROOM', ...args }),
      leaveRoom: async () => {
        const r = await request({ t: 'LEAVE_ROOM' })
        if (r.t === 'ACK') dispatch({ type: 'leftRoom' })
        return r
      },
      sitDown: (seat, buyIn) => request(buyIn === undefined ? { t: 'SIT_DOWN', seat } : { t: 'SIT_DOWN', seat, buyIn }),
      standUp: () => request({ t: 'STAND_UP' }),
      sitOut: () => request({ t: 'SIT_OUT' }),
      sitIn: () => request({ t: 'SIT_IN' }),
      setReady: (ready) => request({ t: 'READY', ready }),
      startGame: () => request({ t: 'START_GAME' }),
      kick: (playerId) => request({ t: 'KICK', playerId }),
      // `reqId` is a placeholder: `connection.request` always overwrites it with the id it correlates on.
      act: (action) => request({ t: 'ACTION', reqId: '', baseSeq: stateRef.current.seq, action }),
      setPreAction: (kind) => dispatch({ type: 'preAction', kind }),
      setAutoPlay: (on) => dispatch({ type: 'autoPlay', on }),
      resync: () => void connection.send({ t: 'RESYNC' }),
      clearError: () => dispatch({ type: 'clearError' }),
      dismissNotification: (id) => dispatch({ type: 'dismissNotification', id }),
      reset: () => dispatch({ type: 'reset' }),
      serverNow: () => Date.now() + stateRef.current.serverTimeOffset,
    }),
    [state, connection, request],
  )
}

export const GameClientContext = createContext<GameClientApi | null>(null)

export function GameClientProvider(props: { client: GameClientApi; children: ReactNode }): JSX.Element {
  return <GameClientContext.Provider value={props.client}>{props.children}</GameClientContext.Provider>
}

export function useGameClientContext(): GameClientApi {
  const client = useContext(GameClientContext)
  if (!client) throw new Error('useGameClientContext must be used inside a <GameClientProvider>')
  return client
}
