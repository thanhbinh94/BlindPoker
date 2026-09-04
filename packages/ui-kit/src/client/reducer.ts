import type { GameEvent, HandView, LegalActions, RoomEvent, RoomView, ServerMessage } from '@bp/core'
import type { ClientAction, ClientHand, ClientHandResult, ClientSeat, ClientState } from './types.js'

export { initialClientState } from './types.js'

const NO_RESULT: ClientHandResult = { payouts: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null }

const withHand = (state: ClientState, hand: ClientHand, patch: Partial<ClientHand>): ClientState => ({ ...state, hand: { ...hand, ...patch } })

const mapSeat = (hand: ClientHand, seat: number, fn: (s: ClientSeat) => ClientSeat): ClientSeat[] =>
  hand.seats.map((s) => (s.seat === seat ? fn(s) : s))

/** Applies `stacks` to the room roster too: between hands the room view is the only source of a seat's chips. */
function roomWithStacks(room: RoomView | null, stacks: Map<number, number>): RoomView | null {
  if (!room) return null
  return { ...room, players: room.players.map((p) => (p.seat !== null && stacks.has(p.seat) ? { ...p, stack: stacks.get(p.seat)! } : p)) }
}

export function handFromView(view: HandView, room: RoomView): ClientHand {
  return {
    handId: view.handId,
    mode: view.mode,
    phase: view.phase,
    community: view.community.slice(),
    pot: view.pot,
    carryOverIn: view.carryOverIn,
    button: view.button,
    actingSeat: view.actingSeat,
    mySeat: view.mySeat,
    legal: view.legal,
    potPulse: 0,
    seats: view.seats.map((sv) => ({
      seat: sv.seat,
      playerId: sv.playerId,
      displayName: room.players.find((p) => p.playerId === sv.playerId)?.displayName ?? sv.playerId,
      isBot: sv.isBot,
      stack: sv.stack,
      betThisStreet: sv.betThisStreet,
      folded: sv.folded,
      allIn: sv.allIn,
      cardCount: sv.cardCount,
      holeCards: sv.holeCards ? sv.holeCards.slice() : null,
      hasDecided: sv.hasDecided,
      decision: sv.decision,
      lastAction: null,
      timedOut: false,
    })),
    result: view.result ? { ...NO_RESULT, payouts: view.result.payouts, fee: view.result.fee, showdown: view.result.showdown, carryOverOut: view.result.carryOverOut, uncalledReturned: view.result.uncalledReturned } : null,
  }
}

function startHand(state: ClientState, event: Extract<GameEvent, { type: 'HAND_STARTED' }>): ClientState {
  const room = state.room
  if (!room) return state
  const seated = state.me ? room.players.find((p) => p.playerId === state.me!.playerId)?.seat ?? null : null
  const mySeat = seated !== null && event.seats.includes(seated) ? seated : null
  const phase = event.mode === 'holdem' ? 'BETTING' : room.config.blind?.decisionMode === 'playOrFold' ? 'DECISION' : 'REVEAL'
  const seats: ClientSeat[] = event.seats.map((seat) => {
    const p = room.players.find((x) => x.seat === seat)
    return {
      seat, playerId: p?.playerId ?? '', displayName: p?.displayName ?? '', isBot: p?.isBot ?? false, stack: p?.stack ?? 0,
      betThisStreet: 0, folded: false, allIn: false, cardCount: 0, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false,
    }
  })
  const hand: ClientHand = {
    handId: event.handId, mode: event.mode, phase, community: [], pot: event.carryOverIn, carryOverIn: event.carryOverIn,
    button: event.button, actingSeat: null, seats, mySeat, legal: null, result: null, potPulse: 0,
  }
  return { ...state, hand, deadlineAt: null }
}

/**
 * A new betting round resets every seat's street bet. The engine only does that when Hold'em betting actually
 * resumes — during a run-out (at most one seat can still act) and in Blind mode it keeps the standing wagers, so the
 * client must reproduce that condition rather than clearing on every `COMMUNITY_REVEALED`.
 */
const bettingResumes = (hand: ClientHand): boolean => hand.mode === 'holdem' && hand.seats.filter((s) => !s.folded && !s.allIn).length >= 2

function settle(state: ClientState, hand: ClientHand, event: Extract<GameEvent, { type: 'SETTLEMENT' }>): ClientState {
  const stacks = new Map(event.stacks.map((s) => [s.seat, s.stack]))
  const uncalled = event.uncalledReturned
  const seats = hand.seats.map((s) => {
    const stack = stacks.get(s.seat)
    const mine = uncalled?.seat === s.seat
    if (stack === undefined && !mine) return s
    return {
      ...s,
      stack: stack ?? s.stack,
      // An uncalled bet is handed back before the pots are computed: it leaves the seat with chips again.
      allIn: mine ? false : s.allIn,
      betThisStreet: mine ? Math.max(0, s.betThisStreet - uncalled.amount) : s.betThisStreet,
    }
  })
  return {
    ...state,
    room: roomWithStacks(state.room, stacks),
    deadlineAt: null,
    hand: {
      ...hand, seats, phase: 'COMPLETE', legal: null, actingSeat: null,
      // The engine subtracts the returned bet from the pot without a further `POT_UPDATED`.
      pot: hand.pot - (uncalled?.amount ?? 0),
      result: { payouts: event.payouts, fee: event.fee, showdown: hand.result?.showdown ?? null, carryOverOut: event.carryOverOut, uncalledReturned: uncalled, cancelled: false, reason: null },
    },
  }
}

function cancel(state: ClientState, hand: ClientHand, event: Extract<GameEvent, { type: 'HAND_CANCELLED' }>): ClientState {
  const refunds = new Map(event.refunds.map((r) => [r.seat, r.amount]))
  // A cancelled hand gives every committed chip back and clears the street bets, all-in flags and the pot.
  const seats = hand.seats.map((s) => ({ ...s, stack: s.stack + (refunds.get(s.seat) ?? 0), betThisStreet: 0, allIn: false }))
  return {
    ...state,
    room: roomWithStacks(state.room, new Map(seats.map((s) => [s.seat, s.stack]))),
    deadlineAt: null,
    hand: {
      ...hand, seats, pot: 0, phase: 'COMPLETE', legal: null, actingSeat: null,
      result: { ...NO_RESULT, carryOverOut: event.carryOverOut, showdown: hand.result?.showdown ?? null, cancelled: true, reason: event.reason },
    },
  }
}

function applyGameEvent(state: ClientState, event: GameEvent & { deadlineAt?: number }): ClientState {
  if (event.type === 'HAND_STARTED') return startHand(state, event)
  const hand = state.hand
  if (!hand) return state
  switch (event.type) {
    case 'BLINDS_POSTED': {
      const posted = new Map<number, number>()
      for (const p of event.posts) posted.set(p.seat, (posted.get(p.seat) ?? 0) + p.amount)
      return withHand(state, hand, {
        seats: hand.seats.map((s) => {
          const amount = posted.get(s.seat)
          return amount === undefined ? s : { ...s, stack: s.stack - amount, betThisStreet: s.betThisStreet + amount }
        }),
      })
    }
    case 'CARDS_DEALT':
      return withHand(state, hand, {
        seats: mapSeat(hand, event.seat, (s) => ({ ...s, cardCount: event.cardCount, holeCards: event.cards.length > 0 ? event.cards.slice() : s.holeCards })),
      })
    case 'TURN_CHANGED':
      return { ...state, deadlineAt: event.deadlineAt ?? null, hand: { ...hand, phase: 'BETTING', actingSeat: event.seat, legal: event.seat === hand.mySeat ? event.legal : null } }
    case 'PLAYER_ACTED': {
      const onTurn = hand.actingSeat === event.seat
      const seats = mapSeat(hand, event.seat, (s) => ({
        ...s, stack: event.stack, allIn: event.allIn, folded: s.folded || event.action.kind === 'fold',
        betThisStreet: s.betThisStreet + event.amount, lastAction: event.action, timedOut: event.timedOut,
      }))
      return {
        ...state,
        deadlineAt: onTurn ? null : state.deadlineAt,
        hand: { ...hand, seats, actingSeat: onTurn ? null : hand.actingSeat, legal: event.seat === hand.mySeat ? null : hand.legal },
      }
    }
    case 'DECISION_PHASE': {
      const mine = hand.mySeat
      const undecided = mine !== null && event.seats.includes(mine) && !hand.seats.find((s) => s.seat === mine)?.hasDecided
      const legal: LegalActions | null = undecided
        ? { seat: mine, kinds: ['play', 'fold'], callAmount: state.room?.config.blind?.fixedWager ?? 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
        : null
      return { ...state, deadlineAt: event.deadlineAt ?? null, hand: { ...hand, phase: 'DECISION', actingSeat: null, legal } }
    }
    case 'DECISION_MADE':
      return withHand(state, hand, {
        seats: mapSeat(hand, event.seat, (s) => ({ ...s, hasDecided: true })),
        legal: event.seat === hand.mySeat ? null : hand.legal,
      })
    case 'DECISIONS_REVEALED': {
      const decided = new Map(event.decisions.map((d) => [d.seat, d.decision]))
      return withHand(state, hand, {
        phase: 'REVEAL',
        seats: hand.seats.map((s) => {
          const d = decided.get(s.seat)
          return d === undefined ? s : { ...s, decision: d, hasDecided: true, folded: s.folded || d === 'fold' }
        }),
      })
    }
    case 'COMMUNITY_REVEALED':
      return withHand(state, hand, {
        community: event.community.slice(), phase: 'REVEAL', actingSeat: null,
        seats: bettingResumes(hand) ? hand.seats.map((s) => (s.betThisStreet === 0 ? s : { ...s, betThisStreet: 0 })) : hand.seats,
      })
    case 'POT_UPDATED':
      return withHand(state, hand, { pot: event.pot, potPulse: hand.potPulse + 1 })
    case 'SHOWDOWN': {
      const shown = new Map(event.hands.map((h) => [h.seat, h.cards]))
      return withHand(state, hand, {
        seats: hand.seats.map((s) => (shown.has(s.seat) ? { ...s, holeCards: shown.get(s.seat)!.slice() } : s)),
        result: { ...(hand.result ?? NO_RESULT), showdown: event.hands.slice() },
      })
    }
    case 'SETTLEMENT':
      return settle(state, hand, event)
    case 'HAND_CANCELLED':
      return cancel(state, hand, event)
    case 'HAND_COMPLETE':
      return { ...state, deadlineAt: null, hand: { ...hand, phase: 'COMPLETE', legal: null, actingSeat: null } }
  }
}

function applyRoomEvent(room: RoomView, event: RoomEvent): RoomView {
  const patch = (playerId: string, fn: (p: RoomView['players'][number]) => RoomView['players'][number]): RoomView => ({
    ...room,
    players: room.players.map((p) => (p.playerId === playerId ? fn(p) : p)),
  })
  switch (event.type) {
    case 'PLAYER_JOINED': {
      const known = room.players.some((p) => p.playerId === event.player.playerId)
      const players = known ? room.players.map((p) => (p.playerId === event.player.playerId ? event.player : p)) : [...room.players, event.player]
      return { ...room, players, playerCount: players.length }
    }
    case 'PLAYER_LEFT': {
      const players = room.players.filter((p) => p.playerId !== event.playerId)
      return { ...room, players, playerCount: players.length }
    }
    case 'PLAYER_SAT':
      return patch(event.playerId, (p) => ({ ...p, seat: event.seat, stack: event.stack, status: 'SEATED', ready: false }))
    case 'PLAYER_STOOD':
      return patch(event.playerId, (p) => ({ ...p, seat: null, stack: 0, status: null }))
    case 'PLAYER_READY':
      return patch(event.playerId, (p) => ({ ...p, ready: event.ready, status: event.ready ? 'READY' : 'SEATED' }))
    case 'HOST_CHANGED':
      return { ...room, hostPlayerId: event.hostPlayerId, players: room.players.map((p) => ({ ...p, isHost: p.playerId === event.hostPlayerId })) }
    case 'PLAYER_DISCONNECTED':
      return patch(event.playerId, (p) => ({ ...p, connected: false, status: p.seat === null ? null : 'DISCONNECTED' }))
    case 'PLAYER_RECONNECTED':
      return patch(event.playerId, (p) => ({ ...p, connected: true, status: p.seat === null ? null : 'SEATED' }))
    case 'ROOM_STATUS':
      return { ...room, status: event.status, nextHandAt: event.nextHandAt, playerCount: room.players.length }
    case 'ROOM_CLOSED':
      return room
  }
}

/** Ids are derived from the live list, so they are unique among *undismissed* notifications — enough to key a toast. */
const notify = (state: ClientState, kind: string, payload: unknown, at: number): ClientState => ({
  ...state,
  notifications: [...state.notifications, { id: state.notifications.reduce((m, n) => Math.max(m, n.id), 0) + 1, kind, payload, at }],
})

/** A backwards `seq` inside a room means we lost or reordered frames: apply anyway, but ask for a fresh snapshot. */
const gap = (state: ClientState, seq: number): boolean => state.room !== null && seq <= state.seq

function applyServerMessage(state: ClientState, msg: ServerMessage, now: number): ClientState {
  switch (msg.t) {
    case 'WELCOME':
      return { ...state, me: { playerId: msg.playerId, displayName: msg.displayName }, balance: msg.balance, serverTimeOffset: msg.serverTime - now, replaced: false }
    case 'ROOM_LIST':
      return { ...state, lobby: msg.rooms }
    case 'ROOM_SNAPSHOT':
      return { ...state, room: msg.room, hand: msg.hand ? handFromView(msg.hand, msg.room) : null, seq: msg.seq, deadlineAt: msg.deadlineAt, resyncNeeded: false }
    case 'BALANCE':
      return { ...state, balance: msg.balance }
    case 'NOTIFICATION':
      return notify(state, msg.kind, msg.payload, now)
    case 'ERROR': {
      const needsResync = msg.code === 'STALE_STATE' || (msg.code === 'INTERNAL' && msg.message.toLowerCase().includes('resync'))
      return { ...state, lastError: { code: msg.code, message: msg.message, reqId: msg.reqId ?? null, at: now }, resyncNeeded: state.resyncNeeded || needsResync }
    }
    case 'SESSION_REPLACED':
      return { ...state, replaced: true }
    case 'GAME_EVENT': {
      const next = applyGameEvent(state, msg.event)
      return { ...next, seq: msg.seq, resyncNeeded: next.resyncNeeded || gap(state, msg.seq) }
    }
    case 'ROOM_EVENT': {
      const resyncNeeded = state.resyncNeeded || gap(state, msg.seq)
      if (msg.event.type === 'ROOM_CLOSED') {
        return { ...notify(state, 'ROOM_CLOSED', { reason: msg.event.reason }, now), room: null, hand: null, seq: msg.seq, resyncNeeded }
      }
      return { ...state, room: state.room ? applyRoomEvent(state.room, msg.event) : null, seq: msg.seq, resyncNeeded }
    }
    default:
      return state
  }
}

export function reduceClient(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status, closeReason: action.reason ?? null }
    case 'server':
      return applyServerMessage(state, action.msg, action.now)
    case 'clearError':
      return { ...state, lastError: null }
    case 'dismissNotification':
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) }
    case 'resyncSent':
      return { ...state, resyncNeeded: false }
    case 'leftRoom':
      return { ...state, room: null, hand: null }
  }
}
