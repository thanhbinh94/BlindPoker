import type { ClientMessage, PlayerAction, RoomConfig } from '@bp/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { createConnection, type AckOrError, type SocketFactory } from './connection.js'
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
  setReady(ready: boolean): Promise<AckOrError>
  startGame(): Promise<AckOrError>
  kick(playerId: string): Promise<AckOrError>
  act(action: PlayerAction): Promise<AckOrError>
  resync(): void
  clearError(): void
  dismissNotification(id: number): void
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
      setReady: (ready) => request({ t: 'READY', ready }),
      startGame: () => request({ t: 'START_GAME' }),
      kick: (playerId) => request({ t: 'KICK', playerId }),
      // `reqId` is a placeholder: `connection.request` always overwrites it with the id it correlates on.
      act: (action) => request({ t: 'ACTION', reqId: '', baseSeq: stateRef.current.seq, action }),
      resync: () => void connection.send({ t: 'RESYNC' }),
      clearError: () => dispatch({ type: 'clearError' }),
      dismissNotification: (id) => dispatch({ type: 'dismissNotification', id }),
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
