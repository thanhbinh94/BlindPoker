import type { GameEvent, HandView, HeldCardView, LegalActions, RoomEvent, RoomView, ServerMessage } from '@bp/core'
import { initialChaos, initialClientState } from './types.js'
import type { ClientAction, ClientChaos, ClientHand, ClientHandResult, ClientSeat, ClientState } from './types.js'

export { initialClientState }

const NO_RESULT: ClientHandResult = { payouts: [], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null }

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
    // A snapshot is no arrival: the cards are already on the table and nothing was seen being dealt, so no stamps either.
    restored: true,
    dealtAt: null,
    boardAt: null,
    showdownAt: null,
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
      // The view always carries the flag (true on a plain table); only a squeeze room lets the client keep it.
      ...(room.config.blind?.squeeze === true ? { revealed: sv.revealed } : {}),
    })),
    result: view.result ? { ...NO_RESULT, payouts: view.result.payouts, pots: view.result.pots, fee: view.result.fee, showdown: view.result.showdown, carryOverOut: view.result.carryOverOut, uncalledReturned: view.result.uncalledReturned } : null,
  }
}

function startHand(state: ClientState, event: Extract<GameEvent, { type: 'HAND_STARTED' }>): ClientState {
  const room = state.room
  if (!room) return state
  const seated = state.me ? room.players.find((p) => p.playerId === state.me!.playerId)?.seat ?? null : null
  const mySeat = seated !== null && event.seats.includes(seated) ? seated : null
  const squeeze = event.mode === 'blind' && room.config.blind?.squeeze === true
  const phase: ClientHand['phase'] = event.mode === 'holdem' ? 'BETTING' : room.config.blind?.decisionMode === 'playOrFold' ? 'DECISION' : squeeze ? 'SQUEEZE' : 'REVEAL'
  const seats: ClientSeat[] = event.seats.map((seat) => {
    const p = room.players.find((x) => x.seat === seat)
    return {
      seat, playerId: p?.playerId ?? '', displayName: p?.displayName ?? '', isBot: p?.isBot ?? false, stack: p?.stack ?? 0,
      betThisStreet: 0, folded: false, allIn: false, cardCount: 0, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false,
      // A bot's cards are turned from the deal (the engine's `revealed`); a person's wait for them to do it.
      ...(squeeze ? { revealed: p?.isBot ?? false } : {}),
    }
  })
  const hand: ClientHand = {
    handId: event.handId, mode: event.mode, phase, community: [], pot: event.carryOverIn, carryOverIn: event.carryOverIn,
    button: event.button, actingSeat: null, seats, mySeat, legal: null, result: null, potPulse: 0,
    restored: false, dealtAt: null, boardAt: null, showdownAt: null,
  }
  // A new hand closes whatever the last one left: a draft that every seat finished at once is over, and the banner,
  // the credits and the peek were that hand's. The seats' cards stay.
  // The result wait (and its "Bỏ qua" count) is over with the deal. The bonus hand stays: it belongs to the player.
  return { ...state, hand, deadlineAt: null, preAction: null, resultSkips: null, chaos: { ...state.chaos, draft: null, applied: [], credits: [], awarded: [], peek: null, reverse: false, blindfolded: null } }
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
  // The public summary is what the result line shows; a hand that never sent one falls back to what this viewer saw fire.
  const chaosUsed = hand.result?.chaosUsed ?? (state.chaos.applied.length > 0 ? state.chaos.applied.map((a) => ({ seat: a.seat, cardId: a.cardId, outcome: a.outcome, targets: a.targets })) : undefined)
  const seats = hand.seats.map((s) => {
    const stack = stacks.get(s.seat)
    const mine = uncalled?.seat === s.seat
    // Kept for the reveal hold: the plate shows the stack as it stood before the pots were paid, until the result is out
    // (`PokerTable`). An uncalled bet handed back is not the result — the bet chip and the pot drop at once — so it counts.
    const stackBeforeResult = s.stack + (mine ? uncalled.amount : 0)
    if (stack === undefined && !mine) return { ...s, stackBeforeResult }
    return {
      ...s,
      stackBeforeResult,
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
      result: { payouts: event.payouts, pots: event.pots, fee: event.fee, showdown: hand.result?.showdown ?? null, carryOverOut: event.carryOverOut, uncalledReturned: uncalled, cancelled: false, reason: null, ...(chaosUsed ? { chaosUsed } : {}) },
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

/**
 * Whether this frame ends the spot a pre-action was ticked for. A tick means "when my turn comes in *this* spot":
 * a new street, my own action (by hand or by the tick itself), and the end of the hand all close it; a tick that
 * outlived them would fire into a bet the player never saw.
 */
function closesPreAction(hand: ClientHand, event: GameEvent): boolean {
  switch (event.type) {
    case 'PLAYER_ACTED':
      return event.seat === hand.mySeat
    case 'COMMUNITY_REVEALED':
      return bettingResumes(hand)
    case 'SETTLEMENT':
    case 'HAND_CANCELLED':
    case 'HAND_COMPLETE':
      return true
    default:
      return false
  }
}

function applyGameEvent(state: ClientState, event: GameEvent & { deadlineAt?: number }, now: number): ClientState {
  if (event.type === 'HAND_STARTED') return startHand(state, event)
  const hand = state.hand
  if (!hand) return state
  const next = applyHandEvent(state, hand, event, now)
  return state.preAction !== null && (state.preAction.handId !== hand.handId || closesPreAction(hand, event)) ? { ...next, preAction: null } : next
}

/** `now` is the client clock at the frame's arrival; it only ever goes into the hand's arrival stamps. */
function applyHandEvent(state: ClientState, hand: ClientHand, event: GameEvent & { deadlineAt?: number }, now: number): ClientState {
  switch (event.type) {
    case 'BLINDS_POSTED': {
      const posted = new Map<number, number>()
      for (const p of event.posts) posted.set(p.seat, (posted.get(p.seat) ?? 0) + p.amount)
      return withHand(state, hand, {
        seats: hand.seats.map((s) => {
          const amount = posted.get(s.seat)
          if (amount === undefined) return s
          // A post that takes the whole stack leaves the seat all in (plan 27 D2: a short Blind ante), as the engine has it.
          const stack = s.stack - amount
          return { ...s, stack, betThisStreet: s.betThisStreet + amount, allIn: s.allIn || stack <= 0 }
        }),
      })
    }
    case 'CARDS_DEALT':
      return withHand(state, hand, {
        dealtAt: hand.dealtAt ?? now,
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
      const seat = mine === null ? undefined : hand.seats.find((s) => s.seat === mine)
      // A seat the ante emptied is played for it (plan 27 D1) and never asked; a short one plays what it has left,
      // as `blindLegalActions` says: min(stack, wager), which the button reads as "Tất tay N".
      const undecided = mine !== null && seat !== undefined && event.seats.includes(mine) && !seat.hasDecided && !seat.allIn
      const wager = state.room?.config.blind?.fixedWager ?? 0
      const legal: LegalActions | null = undecided
        ? { seat: mine, kinds: ['play', 'fold'], callAmount: Math.min(seat.stack, wager), minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
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
    case 'SQUEEZE_PHASE':
      return { ...state, deadlineAt: event.deadlineAt ?? null, hand: { ...hand, phase: 'SQUEEZE', actingSeat: null, legal: null } }
    case 'PLAYER_REVEALED':
      return withHand(state, hand, { seats: mapSeat(hand, event.seat, (s) => ({ ...s, revealed: true })) })
    case 'SQUEEZE_ENDED':
      return { ...state, deadlineAt: null, hand: { ...hand, phase: 'REVEAL' } }
    case 'COMMUNITY_REVEALED':
      return withHand(state, hand, {
        community: event.community.slice(), phase: 'REVEAL', actingSeat: null, boardAt: now,
        seats: bettingResumes(hand) ? hand.seats.map((s) => (s.betThisStreet === 0 ? s : { ...s, betThisStreet: 0 })) : hand.seats,
      })
    case 'POT_UPDATED':
      return withHand(state, hand, { pot: event.pot, potPulse: hand.potPulse + 1 })
    case 'SHOWDOWN': {
      const shown = new Map(event.hands.map((h) => [h.seat, h.cards]))
      return withHand(state, hand, {
        showdownAt: now,
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
    case 'HAND_STARTED':
      return state
    // Poker hỗn loạn: the table reads the cards that acted from `state.chaos`. A card that re-deals the board
    // (redealBoard, the storm) carries the new board: it lands like a street, so the cards come out of the deck again.
    case 'CHAOS_APPLIED': {
      const { type: _type, ...applied } = event
      const reverse = state.chaos.reverse || (event.effect === 'reverseRank' && event.outcome === 'applied')
      const chaos = { ...state.chaos, applied: [...state.chaos.applied, applied], reverse }
      const board = event.community === undefined ? hand : { ...hand, community: event.community.slice(), boardAt: now }
      return { ...state, hand: board, chaos }
    }
    // `filterEvent` blanks another seat's peek to `cards: []` rather than dropping it: only my own seat's is mine to keep.
    case 'CHAOS_PEEK':
      if (event.seat !== hand.mySeat) return state
      return { ...state, chaos: { ...state.chaos, peek: { seat: event.seat, cards: event.cards.slice() } } }
    case 'CHAOS_SUMMARY':
      return withHand(state, hand, { result: { ...(hand.result ?? NO_RESULT), chaosUsed: event.used.map((u) => ({ seat: u.seat, cardId: u.cardId, outcome: u.outcome, targets: u.targets })) } })
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
      return patch(event.playerId, (p) => ({ ...p, seat: event.seat, stack: event.stack, status: 'SEATED', ready: false, sittingOut: false }))
    case 'PLAYER_STOOD':
      return patch(event.playerId, (p) => ({ ...p, seat: null, stack: 0, status: null, sittingOut: false }))
    case 'PLAYER_READY':
      return patch(event.playerId, (p) => ({ ...p, ready: event.ready, status: event.ready ? 'READY' : 'SEATED' }))
    // The flag lands on the seat straight away — including mid-hand, where the server still plays the player
    // out of the *current* hand — so the tray's toggle answers the click that caused it. It rides on its own
    // field, which a later snapshot reproduces, rather than on `status`.
    // The *status* yields to the more urgent facts about a seat, exactly as `Room.playerView` ranks them
    // (`packages/server-kit/src/room/room.ts`, spec §11.3): a seat that is offline keeps saying so, and a seat
    // that still holds cards keeps reading `IN_HAND`. Overwriting `IN_HAND` here would paint the muted
    // "sitting out" pill on a seat the table is still waiting on, and the next snapshot would take it away
    // again. Outside a hand there is nothing to outrank, so the status moves both ways as before.
    case 'PLAYER_SIT_OUT':
      return patch(event.playerId, (p) =>
        p.seat === null ? p : {
          ...p,
          sittingOut: event.sittingOut,
          status: !p.connected || p.status === 'IN_HAND' ? p.status : event.sittingOut ? 'SITTING_OUT' : p.ready ? 'READY' : 'SEATED',
        },
      )
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
    // Poker hỗn loạn: these live in `ClientState.chaos` (`applyChaosRoomEvent`), not in the roster.
    // A credit raises the seat's stack (absolute, from the server): between hands the roster is what the next deal reads.
    case 'CHAOS_CREDIT':
      return { ...room, players: room.players.map((p) => (p.seat === event.seat ? { ...p, stack: event.stack } : p)) }
    case 'CHAOS_DRAFT':
    case 'CHAOS_PICKED':
    case 'CHAOS_STATE':
    case 'CHAOS_AWARDED':
    case 'RESULT_SKIPS': // the count lives in `ClientState.resultSkips`
      return room
  }
}

/** The chaos half of a room event. `mySeat` is the viewer's seat before the event (null when it has none). */
function applyChaosRoomEvent(chaos: ClientChaos, event: RoomEvent, mySeat: number | null, seatOf: (playerId: string) => number | null): ClientChaos {
  switch (event.type) {
    case 'CHAOS_DRAFT': {
      const open = chaos.draft
      // The offer may have beaten the draft frame here (they travel on different paths): same draft, keep it.
      if (open && open.tier === event.tier && open.deadlineAt === event.deadlineAt) return chaos
      return { ...chaos, draft: { tier: event.tier, deadlineAt: event.deadlineAt, totalMs: event.draftMs, offer: null, picked: false } }
    }
    case 'CHAOS_PICKED':
      return chaos.draft && event.seat === mySeat ? { ...chaos, draft: { ...chaos.draft, picked: true } } : chaos
    // Sent after a draft and after each hand: a draft is over by then.
    case 'CHAOS_STATE':
      return { ...chaos, draft: null, seats: Object.fromEntries(event.seats.map((s) => [s.seat, { cards: s.cards, points: s.points, bonusCount: s.bonusCount }])) }
    case 'CHAOS_CREDIT': {
      const { type: _type, stack: _stack, ...credit } = event
      return { ...chaos, credits: [...chaos.credits, credit] }
    }
    case 'CHAOS_AWARDED':
      return { ...chaos, awarded: [...chaos.awarded, { seat: event.seat, cardIds: event.cardIds }] }
    // `PLAYER_SAT` carries no `chaos` field: a new seat starts with nothing, and says so until `CHAOS_STATE`.
    case 'PLAYER_SAT':
      return { ...chaos, seats: { ...chaos.seats, [event.seat]: chaos.seats[event.seat] ?? { cards: [], points: 0, bonusCount: 0 } } }
    case 'PLAYER_STOOD':
      return dropSeat(chaos, event.seat)
    case 'PLAYER_LEFT': {
      const seat = seatOf(event.playerId)
      return seat === null ? chaos : dropSeat(chaos, seat)
    }
    default:
      return chaos
  }
}

function dropSeat(chaos: ClientChaos, seat: number): ClientChaos {
  if (!(seat in chaos.seats)) return chaos
  const { [seat]: _gone, ...seats } = chaos.seats
  return { ...chaos, seats }
}

/** The seats' chaos cards as a snapshot's roster carries them; a chaos table gives every seated player an entry. */
function chaosFromSnapshot(room: RoomView, draft: ClientChaos['draft'], hand: HandView | null, bonus: ClientChaos['bonus'] | undefined): ClientChaos {
  const table = room.config.blind?.chaosCycle !== undefined
  const seats: ClientChaos['seats'] = {}
  for (const p of room.players) {
    if (p.seat !== null && (p.chaos || table)) seats[p.seat] = { cards: p.chaos?.cards ?? [], points: p.chaos?.points ?? 0, bonusCount: p.chaos?.bonusCount ?? 0 }
  }
  // The hand view carries what the event stream had built up: the viewer's peek, the reversed ranking and a blindfold.
  const view = hand?.chaos
  const mine = hand?.mySeat ?? null
  const peek = view !== undefined && view.peek.length > 0 && mine !== null ? { seat: mine, cards: view.peek.slice() } : null
  return { ...initialChaos, seats, draft, peek, reverse: view?.reverse ?? false, blindfolded: view === undefined ? null : view.blindfolded, bonus: bonus ?? initialChaos.bonus }
}

/** `NOTIFICATION { kind: 'CHAOS_BONUS' }`: this player's bonus hand and the armed card. Anything malformed is ignored. */
function applyChaosBonus(chaos: ClientChaos, payload: unknown): ClientChaos {
  const p = payload as { cards?: unknown; armed?: unknown } | null
  if (!p || !Array.isArray(p.cards)) return chaos
  let armed: ClientChaos['bonus']['armed'] = null
  if (p.armed !== null && p.armed !== undefined) {
    const a = p.armed as { uid?: unknown; cardId?: unknown; hand?: unknown }
    if (typeof a.uid !== 'number' || typeof a.cardId !== 'string' || (a.hand !== 'this' && a.hand !== 'next')) return chaos
    armed = { uid: a.uid, cardId: a.cardId, hand: a.hand }
  }
  return { ...chaos, bonus: { cards: p.cards as HeldCardView[], armed } }
}

/**
 * The "Bỏ qua" count after a room event. `RESULT_SKIPS` sets it (my own press is kept while the count stays above zero; a
 * wait that starts afresh has nobody's); a draft, or a status that names no next hand, ends the wait.
 */
function skipsAfter(skips: ClientState['resultSkips'], event: RoomEvent): ClientState['resultSkips'] {
  switch (event.type) {
    case 'RESULT_SKIPS':
      return { skipped: event.skipped, total: event.total, mine: skips !== null && skips.mine && event.skipped > 0 }
    case 'CHAOS_DRAFT':
      return null
    case 'ROOM_STATUS':
      return event.nextHandAt === null ? null : skips
    default:
      return skips
  }
}

/** The "Bỏ qua" count a snapshot carried, or `null` when no result wait runs. */
const skipsFromSnapshot = (s: Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>['resultSkips']): ClientState['resultSkips'] =>
  s === undefined ? null : { skipped: s.skipped, total: s.total, mine: s.mine === true }

/** The server's default draft window (`DEFAULT_CHAOS_CONFIG.draftMs`), for a draft whose length a frame did not carry. */
const DEFAULT_DRAFT_MS = 15_000

const draftFromSnapshot = (d: NonNullable<Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>['chaos']>['draft']): ClientChaos['draft'] =>
  d === null ? null : { tier: d.tier, deadlineAt: d.deadlineAt, totalMs: d.draftMs, offer: d.offer, picked: d.picked }

/** `NOTIFICATION { kind: 'CHAOS_OFFER' }`: this player's three cards. Anything malformed is ignored. */
function applyChaosOffer(chaos: ClientChaos, payload: unknown): ClientChaos {
  const p = payload as { offerId?: unknown; tier?: unknown; cardIds?: unknown; deadlineAt?: unknown; draftMs?: unknown } | null
  if (!p || typeof p.offerId !== 'string' || typeof p.deadlineAt !== 'number' || (p.tier !== 'silver' && p.tier !== 'gold' && p.tier !== 'diamond')) return chaos
  if (!Array.isArray(p.cardIds) || !p.cardIds.every((c) => typeof c === 'string')) return chaos
  const offer = { offerId: p.offerId, cardIds: p.cardIds as string[] }
  const open = chaos.draft
  const same = open !== null && open.tier === p.tier && open.deadlineAt === p.deadlineAt
  const picked = same && open.offer?.offerId === offer.offerId ? open.picked : false
  // The window's length rides on the offer too (it may beat the draft frame here); without it, the draft frame's, else the default.
  const totalMs = typeof p.draftMs === 'number' && p.draftMs > 0 ? p.draftMs : same ? open.totalMs : DEFAULT_DRAFT_MS
  return { ...chaos, draft: { tier: p.tier, deadlineAt: p.deadlineAt, totalMs, offer, picked } }
}

/**
 * A slip nobody dismissed must not pile up forever: a long session, or a server that gets chatty, would otherwise
 * grow the list without bound and stack toasts off the top of the screen. Five is what fits.
 */
const MAX_NOTIFICATIONS = 5

/** Ids are derived from the live list, so they are unique among *undismissed* notifications — enough to key a toast. */
const notify = (state: ClientState, kind: string, payload: unknown, at: number): ClientState => {
  const next = [...state.notifications, { id: state.notifications.reduce((m, n) => Math.max(m, n.id), 0) + 1, kind, payload, at }]
  return { ...state, notifications: next.length > MAX_NOTIFICATIONS ? next.slice(next.length - MAX_NOTIFICATIONS) : next }
}

/** A backwards `seq` inside a room means we lost or reordered frames: apply anyway, but ask for a fresh snapshot. */
const gap = (state: ClientState, seq: number): boolean => state.room !== null && seq <= state.seq

/**
 * A frame that lands on nothing: a hand event with no hand, or a `HAND_STARTED` with no room to seat it in. The
 * server would not send one unless the client's view had already fallen behind, so take the `seq` and ask for a
 * snapshot rather than silently dropping the frame.
 */
const orphan = (state: ClientState, type: GameEvent['type']): boolean =>
  type === 'HAND_STARTED' ? state.room === null : state.hand === null

function applyServerMessage(state: ClientState, msg: ServerMessage, now: number): ClientState {
  switch (msg.t) {
    // `WELCOME` says who you are; per docs/server-kit.md "Reconnecting and frame order" a `ROOM_SNAPSHOT` follows
    // only if the server still has you in a room. The room we are holding is therefore unconfirmed until the
    // answer to the `RESYNC` the hook is about to send arrives — keep it on screen, but mark it stale.
    case 'WELCOME':
      return {
        ...state,
        me: { playerId: msg.playerId, displayName: msg.displayName },
        balance: msg.balance,
        serverTimeOffset: msg.serverTime - now,
        replaced: false,
        roomStale: true,
        resyncNeeded: true,
      }
    case 'ROOM_LIST':
      return { ...state, lobby: msg.rooms }
    case 'ROOM_SNAPSHOT':
      // A snapshot is a fresh view of the hand, possibly a different spot from the one the tick was made in.
      // One that lands while the room is unconfirmed is the server's answer to a (re)connect: still in a room.
      return {
        ...state,
        room: msg.room,
        roomStale: false,
        roomReturns: state.roomStale ? state.roomReturns + 1 : state.roomReturns,
        hand: msg.hand ? handFromView(msg.hand, msg.room) : null,
        chaos: chaosFromSnapshot(msg.room, draftFromSnapshot(msg.chaos?.draft ?? null), msg.hand, msg.chaos?.bonus),
        resultSkips: skipsFromSnapshot(msg.resultSkips),
        seq: msg.seq,
        deadlineAt: msg.deadlineAt,
        resyncNeeded: false,
        preAction: null,
      }
    case 'BALANCE':
      return { ...state, balance: msg.balance }
    case 'NOTIFICATION':
      // The offer is a draft's business and the bonus hand is the player's own: neither is a slip to dismiss.
      if (msg.kind === 'CHAOS_OFFER') return { ...state, chaos: applyChaosOffer(state.chaos, msg.payload) }
      if (msg.kind === 'CHAOS_BONUS') return { ...state, chaos: applyChaosBonus(state.chaos, msg.payload) }
      return notify(state, msg.kind, msg.payload, now)
    case 'ERROR': {
      // The other answer the reconnect probe can get: the server has no room for us. That is news to the state,
      // not to the player — silence it while the room was unconfirmed, or when there was no room to lose.
      if (msg.code === 'NOT_IN_ROOM') {
        const expected = state.roomStale || state.room === null
        return {
          ...state,
          room: null,
          roomStale: false,
          hand: null,
          chaos: initialChaos, resultSkips: null,
          seq: 0,
          deadlineAt: null,
          preAction: null,
          autoPlay: false,
          lastError: expected ? state.lastError : { code: msg.code, message: msg.message, reqId: msg.reqId ?? null, at: now },
        }
      }
      const needsResync = msg.code === 'STALE_STATE' || (msg.code === 'INTERNAL' && msg.message.toLowerCase().includes('resync'))
      return { ...state, lastError: { code: msg.code, message: msg.message, reqId: msg.reqId ?? null, at: now }, resyncNeeded: state.resyncNeeded || needsResync }
    }
    case 'SESSION_REPLACED':
      return { ...state, replaced: true }
    case 'GAME_EVENT': {
      const next = applyGameEvent(state, msg.event, now)
      return { ...next, seq: msg.seq, resyncNeeded: next.resyncNeeded || orphan(state, msg.event.type) || gap(state, msg.seq) }
    }
    case 'ROOM_EVENT': {
      const resyncNeeded = state.resyncNeeded || state.room === null || gap(state, msg.seq)
      if (msg.event.type === 'ROOM_CLOSED') {
        return { ...notify(state, 'ROOM_CLOSED', { reason: msg.event.reason }, now), room: null, hand: null, chaos: initialChaos, resultSkips: null, seq: msg.seq, resyncNeeded, preAction: null, autoPlay: false }
      }
      const event = msg.event
      // Standing, leaving or sitting out ends the seat's standing preferences with it.
      const mine = state.me !== null && 'playerId' in event && event.playerId === state.me.playerId
      // The server has taken *me* off the list — a leave, a kick, or a Leave pressed mid-hand that only took effect
      // when the hand ended. The room is gone for this client exactly as after a leave it asked for: the room screen
      // hands over to the app (`onLeft`). A kick also brings its own KICKED notification; that stays a toast only.
      if (mine && event.type === 'PLAYER_LEFT') {
        return { ...state, room: null, hand: null, chaos: initialChaos, resultSkips: null, seq: msg.seq, deadlineAt: null, preAction: null, autoPlay: false }
      }
      const myPlayer = state.me !== null ? state.room?.players.find((p) => p.playerId === state.me!.playerId) : undefined
      const stopsAutoPlay = mine && (event.type === 'PLAYER_STOOD' || (event.type === 'PLAYER_SIT_OUT' && event.sittingOut))
      // A card credit lands after the hand settled; the finished hand is still on the table, so its plate shows the raise too.
      const credited = event.type === 'CHAOS_CREDIT' && state.hand !== null && state.hand.seats.some((x) => x.seat === event.seat)
      return {
        ...state,
        hand: credited ? { ...state.hand!, seats: mapSeat(state.hand!, event.seat, (x) => ({ ...x, stack: event.stack })) } : state.hand,
        room: state.room ? applyRoomEvent(state.room, event) : null,
        chaos: applyChaosRoomEvent(state.chaos, event, myPlayer?.seat ?? null, (id) => state.room?.players.find((p) => p.playerId === id)?.seat ?? null),
        resultSkips: skipsAfter(state.resultSkips, event),
        seq: msg.seq,
        resyncNeeded,
        autoPlay: stopsAutoPlay ? false : state.autoPlay,
        preAction: mine && event.type === 'PLAYER_STOOD' ? null : state.preAction,
      }
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
      return { ...state, room: null, hand: null, chaos: initialChaos, resultSkips: null, preAction: null, autoPlay: false }
    case 'preAction':
      // A tick needs a hand to belong to; outside one there is nothing it could mean.
      return { ...state, preAction: action.kind === null || state.hand === null ? null : { kind: action.kind, handId: state.hand.handId } }
    case 'autoPlay':
      return { ...state, autoPlay: action.on }
    case 'chaosPicked': {
      const draft = state.chaos.draft
      return draft?.offer?.offerId === action.offerId ? { ...state, chaos: { ...state.chaos, draft: { ...draft, picked: true } } } : state
    }
    case 'resultSkipped':
      return state.resultSkips === null || state.resultSkips.mine ? state : { ...state, resultSkips: { ...state.resultSkips, mine: true } }
    case 'renamed':
      // Only `me`. The room the player is in (if any) seated them under the name they entered it with, for
      // everyone at the table, and keeps it; the server hands the new name to the player's live connection
      // (`Gateway.renameIdentity`), so the next room they create or join uses it — the app's rename notice
      // says exactly that.
      return state.me === null ? state : { ...state, me: { ...state.me, displayName: action.displayName } }
    case 'reset':
      return initialClientState
  }
}
