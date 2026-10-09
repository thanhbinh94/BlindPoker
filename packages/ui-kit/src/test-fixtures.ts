import { parseCards, type RoomPlayerView, type RoomSummary, type RoomView } from '@bp/core'
import { initialClientState, type ClientHand, type ClientSeat, type ClientState } from './client/types.js'

/**
 * Fixtures shared by the component tests. Kept out of `src/index.ts` on purpose: this is scaffolding for the suite,
 * not part of the package's public surface.
 */

export const makePlayer = (patch: Partial<RoomPlayerView> & Pick<RoomPlayerView, 'playerId'>): RoomPlayerView => ({
  displayName: patch.playerId,
  isBot: false,
  isHost: false,
  connected: true,
  seat: null,
  status: null,
  sittingOut: false,
  stack: 0,
  ready: false,
  ...patch,
})

/** A four-seat hold'em room at 100/200 with Ann (host, seat 0) and a disconnected Bob (seat 2). */
export const holdemRoom: RoomView = {
  roomId: 'r',
  code: 'ABC234',
  name: 'T',
  mode: 'holdem',
  config: {
    name: 'T',
    mode: 'holdem',
    maxPlayers: 4,
    isPrivate: false,
    turnTimerSec: 30,
    autoStart: false,
    hasPassword: false,
    holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
  },
  playerCount: 2,
  maxPlayers: 4,
  status: 'IN_GAME',
  hostPlayerId: 'a',
  carryOverPot: 0,
  nextHandAt: null,
  players: [
    makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 19800, ready: true }),
    makePlayer({ playerId: 'b', displayName: 'Bob', connected: false, seat: 2, status: 'DISCONNECTED', stack: 19900, ready: true }),
  ],
}

export const makeRoom = (patch: Partial<RoomView> = {}): RoomView => ({ ...holdemRoom, ...patch })

export const makeSeat = (patch: Partial<ClientSeat> & Pick<ClientSeat, 'seat' | 'playerId'>): ClientSeat => ({
  displayName: patch.playerId,
  isBot: false,
  stack: 20000,
  betThisStreet: 0,
  folded: false,
  allIn: false,
  cardCount: 2,
  holeCards: null,
  hasDecided: false,
  decision: null,
  lastAction: null,
  timedOut: false,
  ...patch,
})

/** Flop betting in `holdemRoom`, seen from Ann's seat: her cards up, Bob's down, Bob to act. */
export const holdemHand: ClientHand = {
  handId: 'h',
  mode: 'holdem',
  phase: 'BETTING',
  community: parseCards('Ah Kd 2c'),
  pot: 300,
  carryOverIn: 0,
  button: 0,
  actingSeat: 2,
  mySeat: 0,
  legal: null,
  result: null,
  potPulse: 1,
  restored: true,
  dealtAt: null,
  boardAt: null,
  showdownAt: null,
  seats: [
    makeSeat({ seat: 0, playerId: 'a', displayName: 'Ann', stack: 19800, holeCards: parseCards('Qs Qd') }),
    makeSeat({ seat: 2, playerId: 'b', displayName: 'Bob', stack: 19900 }),
  ],
}

export const makeHand = (patch: Partial<ClientHand> = {}): ClientHand => ({ ...holdemHand, ...patch })

/** A live, welcomed session: the handshake is over, so `roomStale` is false unless a test says otherwise. */
export const makeState = (patch: Partial<ClientState> = {}): ClientState => ({
  ...initialClientState,
  status: 'open',
  me: { playerId: 'me', displayName: 'Mai' },
  balance: 100_000,
  roomStale: false,
  ...patch,
})

/** Lobby tickets: one open hold'em room and one private blind room. */
export const lobbyRooms: RoomSummary[] = [
  {
    roomId: 'r1',
    code: 'ABC234',
    name: 'Đêm Sài Gòn',
    mode: 'holdem',
    config: {
      name: 'Đêm Sài Gòn',
      mode: 'holdem',
      maxPlayers: 6,
      isPrivate: false,
      turnTimerSec: 30,
      autoStart: false,
      hasPassword: false,
      holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
    },
    playerCount: 3,
    maxPlayers: 6,
    status: 'OPEN',
  },
  {
    roomId: 'r2',
    code: 'XYZ789',
    name: 'Chiếu Bạc',
    mode: 'blind',
    config: {
      name: 'Chiếu Bạc',
      mode: 'blind',
      maxPlayers: 4,
      isPrivate: true,
      turnTimerSec: 15,
      autoStart: true,
      hasPassword: true,
      blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, botCount: 1 },
    },
    playerCount: 2,
    maxPlayers: 4,
    status: 'OPEN',
  },
]
