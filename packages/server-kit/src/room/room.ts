import {
  ECONOMY, EngineError, blindBuyInCap, blindTableLimit, engineErrorToErrorCode, filterEvent, nextButton, playerView, roomConfigToRuleset,
  type GameEvent, type PlayerAction, type PlayerIdentity, type RoomConfig, type RoomEvent, type RoomPlayerView,
  type RoomSummary, type RoomView, type Ruleset, type SeatStatus, type ServerMessage,
} from '@bp/core'
import type { TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import { InsufficientBalanceError, type BalanceEntry, type HandSummary, type SettlementMeta } from '../repositories.js'
import { HandRunner } from './hand-runner.js'
import { ChaosTable } from './room-chaos.js'
import { RoomError, type AdminRoomSummary, type RoomDeps, type RoomPlayer } from './types.js'

export interface RoomInit {
  roomId: string
  code: string
  config: RoomConfig
  host: PlayerIdentity
  deps: RoomDeps
}

/**
 * A carried pot whose release was written and not acknowledged — it may have landed. Held apart from `carryOverPot`
 * (which the next hand's `carryOverOut` overwrites) until a retry of the very same batch, under the same key, settles
 * it. `recipients` are everyone the release was for, told their balance once it is settled.
 */
export interface PendingRelease {
  key: string
  pot: number
  entries: BalanceEntry[]
  meta: SettlementMeta
  recipients: string[]
}

type Snapshot = Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>

export class Room {
  readonly roomId: string
  readonly code: string
  readonly config: RoomConfig
  readonly rules: Ruleset
  hostPlayerId: string
  status: 'OPEN' | 'IN_GAME' | 'CLOSED' = 'OPEN'
  readonly players = new Map<string, RoomPlayer>()
  seq = 0
  carryOverPot = 0
  /** Still the room's until it is settled: the room's view and the money invariant count it beside `carryOverPot`. */
  pendingRelease: PendingRelease | null = null
  button: number | null = null
  nextHandAt: number | null = null
  deadlineAt: number | null = null
  onClosed: ((room: Room, reason: string) => void) | null = null
  onChanged: ((room: Room) => void) | null = null
  /**
   * Fires whenever the room's membership changes (host and bots included), so a `RoomManager` can
   * keep an O(1) player → room index instead of scanning every room on every lookup. Assigned after
   * construction, so the players seated by the constructor are seeded by the manager itself.
   */
  onMembership: ((playerId: string, joined: boolean) => void) | null = null

  /** When the room was made (ms, the injected clock); the GM screen lists it. */
  readonly createdAt: number
  private readonly deps: RoomDeps
  private runner: HandRunner | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private nextHandTimer: TimerHandle | null = null
  private closeTimer: TimerHandle | null = null
  /**
   * Set first thing by `close()` and `shutdown()`, whose cancelled hand can remove a last human who pressed Leave
   * mid-hand: that removal must neither start a second close (`onClosed` would fire twice) nor arm the empty-room
   * timer. Not `summary().closing`, which is the lobby's "counting down to closing" (`closeTimer`).
   */
  private closing = false
  private carryOverReleaseTimer: TimerHandle | null = null
  // No claimants on a carried pot any more (Plan 27): a seat reaches 0 only by playing a hand, and a played hand is never carried over.
  private readonly playerTimers = new Map<string, TimerHandle>()
  private turnStartSeq = 0
  /**
   * Everyone who has ever been in this room — the host (and the bots) from the start, every joiner after. A
   * player's `ROOM_JOINED` is said once per room (the host's by `RoomManager.create`, everyone else's by their
   * first `join`): "rooms joined" counts rooms, so walking out and back in must not count again, or a player could
   * farm "Mười phòng"/"Trăm phòng" by pressing Leave and rejoining.
   */
  private readonly everJoined = new Set<string>()
  /** Poker hỗn loạn (Plan 37): the draft, the plans and the card credits of a chaos table; `null` on every other table. */
  private readonly chaos: ChaosTable | null = null
  /** Chaos tables (BP-39): who pressed "Bỏ qua" in this result wait. Emptied when a wait starts. */
  private readonly resultSkips = new Set<string>()
  /** The last `RESULT_SKIPS` said in this wait, so a recount that changes nothing says nothing. */
  private resultTally: { skipped: number; total: number } | null = null

  constructor(init: RoomInit) {
    this.roomId = init.roomId
    this.code = init.code
    this.config = init.config
    this.deps = init.deps
    this.createdAt = init.deps.clock.now()
    this.rules = roomConfigToRuleset(init.config)
    this.hostPlayerId = init.host.playerId
    const rules = this.rules
    if (rules.mode === 'blind' && rules.chaosCycle !== undefined) {
      if (!init.deps.chaos) throw new RoomError('CHAOS_UNAVAILABLE', 'this server has no chaos cards')
      this.chaos = new ChaosTable(init.deps.chaos, {
        roomId: this.roomId, rules, deps: this.deps, players: this.players,
        broadcast: (event) => this.broadcastRoomEvent(event),
        pushBalance: (playerId) => this.pushBalance(playerId),
        enqueue: (fn) => void this.enqueue(fn),
        onDraftEnd: () => this.endDraft(),
      })
    }
    this.addPlayer(init.host)
    const blind = init.config.blind
    if (init.config.mode === 'blind' && blind !== undefined) {
      for (let i = 0; i < blind.botCount; i++) {
        const bot = this.addPlayer({ playerId: `bot:${init.roomId}:${i}`, displayName: `Bot ${i + 1}`, isBot: true })
        bot.seat = init.config.maxPlayers - 1 - i
        // A virtual table limit, like everyone else's, topped back up in `startHand` (spec 2026-09-29 §4.7).
        bot.stack = blindTableLimit(blind)
        bot.ready = true
      }
    }
  }

  // ---------- queue ----------

  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  // ---------- reads ----------

  get humanCount(): number {
    return this.humans().length
  }

  /** Bots hold real seats, so they take capacity away from humans (spec §11.2). */
  get seatedBotCount(): number {
    return this.seated().filter((p) => p.identity.isBot).length
  }

  /** How many more humans the room can hold: seats minus the ones bots occupy. */
  get humanCapacity(): number {
    return this.config.maxPlayers - this.seatedBotCount
  }

  get handActive(): boolean {
    return this.runner !== null && !this.runner.isComplete
  }

  /** Hands started at a chaos table (its cycle counter); 0 on any other table. */
  get tableHands(): number {
    return this.chaos?.tableHands ?? 0
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId)
  }

  summary(): RoomSummary {
    const { password, ...rest } = this.config
    return {
      roomId: this.roomId,
      code: this.code,
      name: this.config.name,
      mode: this.config.mode,
      config: { ...rest, hasPassword: password !== undefined },
      playerCount: this.humanCount + this.seatedBotCount,
      maxPlayers: this.config.maxPlayers,
      status: this.status === 'IN_GAME' ? 'IN_GAME' : 'OPEN',
      closing: this.closeTimer !== null,
    }
  }

  view(): RoomView {
    return {
      ...this.summary(),
      hostPlayerId: this.hostPlayerId,
      players: [...this.players.values()].map((p) => this.playerView(p)),
      carryOverPot: this.carryOverPot + (this.pendingRelease?.pot ?? 0),
      nextHandAt: this.nextHandAt,
    }
  }

  snapshot(viewerId: string | null): Snapshot {
    const viewer = viewerId === null ? undefined : this.players.get(viewerId)
    const seat = viewer?.seat ?? null
    const hand = this.runner && !this.runner.isComplete ? playerView(this.runner.state, seat) : null
    const snapshot: Snapshot = { t: 'ROOM_SNAPSHOT', seq: this.seq, room: this.view(), hand, deadlineAt: hand ? this.deadlineAt : null }
    if (this.chaos) snapshot.chaos = this.chaos.snapshotFor(viewer === undefined ? null : viewerId)
    // The "Bỏ qua" tally of a running result wait, or a reconnect and a late joiner would lose the count (BP-39).
    if (this.resultTally && this.inResultWait()) {
      snapshot.resultSkips = { ...this.resultTally, mine: viewerId !== null && this.resultSkips.has(viewerId) }
    }
    return snapshot
  }

  // ---------- membership ----------

  /**
   * Returns the snapshot as it stood *inside* the queue slot that admitted the player, so the
   * caller cannot send a view that a later mutation has already moved past. Everything after it
   * arrives as an event with a higher `seq`.
   */
  join(identity: PlayerIdentity, password?: string): Promise<Snapshot> {
    return this.enqueue(() => {
      this.assertOpen()
      const existing = this.players.get(identity.playerId)
      if (existing) {
        if (!existing.leaveAfterHand) throw new RoomError('ALREADY_IN_ROOM')
        existing.leaveAfterHand = false // rejoined before the hand ended
        existing.standAfterHand = false
        return this.snapshot(identity.playerId)
      }
      if (this.config.password !== undefined && password !== this.config.password) throw new RoomError('WRONG_PASSWORD')
      if (this.humanCount >= this.humanCapacity) throw new RoomError('ROOM_FULL')
      const first = !this.everJoined.has(identity.playerId)
      const p = this.addPlayer(identity)
      this.cancelClose()
      this.broadcastRoomEvent({ type: 'PLAYER_JOINED', player: this.playerView(p) }, identity.playerId)
      if (first) this.deps.onDomainEvent?.({ type: 'ROOM_JOINED', roomId: this.roomId, playerId: identity.playerId })
      this.changed()
      return this.snapshot(identity.playerId)
    })
  }

  /** Re-reads a player's balance and pushes `BALANCE`. Queued, so it lands after anything already in the room's queue. */
  refreshBalance(playerId: string): Promise<void> {
    return this.enqueue(() => this.pushBalance(playerId))
  }

  leave(playerId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (this.inCurrentHand(p)) {
        p.leaveAfterHand = true
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat!)
        return
      }
      return this.loggingMoney('leave failed', p, () => this.removePlayer(p, 'left')).then(() => this.recountResultSkips())
    })
  }

  /**
   * The host asks someone to leave — a person or a bot, by the same rule: never a seat that holds cards in the
   * hand being played, so between hands only.
   *
   * A bot goes the way a person does (`removePlayer`): its seat empties, it stops holding capacity a person
   * could use, and the room says `PLAYER_LEFT`. There is nobody to notify and nothing to pay out — a bot has no
   * account, and `standUpNow` writes no ledger row for one.
   */
  kick(hostId: string, targetId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      if (hostId !== this.hostPlayerId) throw new RoomError('NOT_HOST')
      const target = this.mustPlayer(targetId)
      if (targetId === hostId) throw new RoomError('ILLEGAL_ACTION', 'cannot kick this player')
      if (this.inCurrentHand(target)) throw new RoomError('GAME_IN_PROGRESS', 'player is in the current hand')
      if (!target.identity.isBot) this.deps.outbox.send(targetId, { t: 'NOTIFICATION', kind: 'KICKED', payload: { roomId: this.roomId } })
      return this.loggingMoney('kick failed', target, async () => {
        try {
          await this.removePlayer(target, 'kicked')
        } catch (err) {
          // The player has been told KICKED, so a write that failed (and may have landed) must not leave them behind
          // as a spectator: the end of the next hand retries the whole removal, under the same keys, not just the
          // cash-out. A rejoin calls it off, as it calls off a Leave pressed mid-hand.
          target.leaveAfterHand = true
          target.standAfterHand = true
          throw err
        }
      }).then(() => this.recountResultSkips())
    })
  }

  /**
   * A GM's removal (Plan 25). Unlike `kick`, nobody is "the host" here: the host can be removed (the room passes to
   * the next player, as when a host leaves), and a player inside the current hand is not refused — they fold now and
   * leave when the hand ends, exactly as if they had pressed Leave (spec §7.10, §8.8), so their stack goes home
   * through the same cash-out. Bots are not players of this kind.
   */
  adminKick(targetId: string): Promise<'now' | 'after_hand'> {
    return this.enqueue<'now' | 'after_hand'>(async () => {
      this.assertOpen()
      const target = this.mustPlayer(targetId)
      if (target.identity.isBot) throw new RoomError('ILLEGAL_ACTION', 'cannot remove a bot this way')
      this.deps.outbox.send(targetId, { t: 'NOTIFICATION', kind: 'KICKED', payload: { roomId: this.roomId } })
      if (this.inCurrentHand(target)) {
        target.leaveAfterHand = true
        target.standAfterHand = true
        this.runner!.markAutoFold(target.seat!)
        return 'after_hand'
      }
      await this.loggingMoney('admin kick failed', target, async () => {
        try {
          await this.removePlayer(target, 'kicked_by_gm')
        } catch (err) {
          // As in `kick`: the player has been told KICKED, so a failed write must not leave them behind as a
          // spectator; the end of the next hand retries the removal.
          target.leaveAfterHand = true
          target.standAfterHand = true
          throw err
        }
      })
      await this.recountResultSkips()
      return 'now'
    })
  }

  /** The room as the GM screen lists it (Plan 25): everything `summary()` hides from the lobby, no cards. */
  adminSummary(): AdminRoomSummary {
    const host = this.players.get(this.hostPlayerId)
    return {
      roomId: this.roomId,
      code: this.code,
      name: this.config.name,
      mode: this.config.mode,
      status: this.status === 'IN_GAME' ? 'IN_GAME' : 'OPEN',
      isPrivate: this.config.isPrivate,
      hasPassword: this.config.password !== undefined,
      players: this.humanCount + this.seatedBotCount,
      maxPlayers: this.config.maxPlayers,
      hostPlayerId: this.hostPlayerId,
      hostDisplayName: host?.identity.displayName ?? '',
      carryOverPot: this.carryOverPot + (this.pendingRelease?.pot ?? 0),
      handInProgress: this.handActive,
      createdAt: this.createdAt,
      members: [...this.players.values()].map((p) => ({
        playerId: p.identity.playerId,
        displayName: p.identity.displayName,
        isBot: p.identity.isBot,
        seat: p.seat,
        stack: p.stack,
        connected: p.connected,
      })),
    }
  }

  // ---------- seats ----------

  sitDown(playerId: string, seat: number, buyIn?: number): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.config.maxPlayers) throw new RoomError('ILLEGAL_ACTION', 'seat out of range')
      if (p.seat !== null) throw new RoomError('ILLEGAL_ACTION', 'already seated')
      if (this.seatPlayer(seat)) throw new RoomError('SEAT_TAKEN')
      // A buy-in already on its way back (a removal that failed half-way through its refund) is finished first: it
      // can no longer pay for a seat.
      if (p.pendingBuyIn?.refunding) await this.loggingMoney('buy-in refund failed', p, () => this.refundPendingBuyIn(p))
      // A buy-in that was written and not acknowledged is replayed — the same key, the same amount — before anything is
      // checked: if it landed, the balance left may no longer cover a fresh one, and must not have to.
      let pending = p.pendingBuyIn
      if (pending === undefined) {
        // Both modes bring a table stack out of the balance (spec 2026-09-29): Hold'em the buy-in the player chose, Blind
        // the table limit — or the whole balance when that is less, as long as it covers one wager (plan 27 D2: the
        // play goes all in for whatever the ante leaves).
        let amount: number
        if (this.rules.mode === 'holdem') {
          const bb = this.rules.bigBlind
          const min = (this.config.holdem?.minBuyInBB ?? 0) * bb
          const max = (this.config.holdem?.maxBuyInBB ?? 0) * bb
          if (buyIn === undefined || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) throw new RoomError('INVALID_AMOUNT', `buy-in must be ${min}–${max}`)
          amount = buyIn
        } else {
          const balance = await this.deps.repos.balances.get(playerId)
          if (balance < this.rules.fixedWager) throw new RoomError('INSUFFICIENT_BALANCE')
          // A chaos table has no limit (BP-39, spec 2026-10-27 §3.7): the whole balance comes to the table.
          amount = Math.min(balance, blindBuyInCap(this.rules) ?? balance)
        }
        pending = { sitId: newId(), amount }
        p.pendingBuyIn = pending
      }
      const { sitId, amount } = pending
      try {
        // Landed now, or by the attempt that was not acknowledged (`applied: false`): either way it is paid, once.
        await this.deps.repos.balances.apply([{ playerId, delta: -amount, reason: 'buy_in', refId: this.roomId }], undefined, { key: this.buyInKey(sitId) })
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          p.pendingBuyIn = undefined // refused, so its key was never claimed: nothing landed
          throw new RoomError('INSUFFICIENT_BALANCE')
        }
        this.deps.log.error('buy-in failed', { roomId: this.roomId, playerId, amount, key: this.buyInKey(sitId), err: String(err) })
        // It may have landed: the bar is re-read now rather than left showing points the ledger no longer holds until
        // the next Sit (which replays it, and pushes again once seated) or the refund on the way out.
        await this.pushBalance(playerId)
        throw err
      }
      if (this.seatPlayer(seat)) {
        // lost the race while awaiting: refund (unreachable while `sitDown` runs on the room's queue)
        pending.refunding = true
        await this.refundPendingBuyIn(p)
        throw new RoomError('SEAT_TAKEN')
      }
      p.pendingBuyIn = undefined
      p.sitId = sitId
      p.stack = amount
      p.seat = seat
      p.ready = false
      p.sittingOut = false
      p.sitOutRequested = false
      p.handsSatOut = 0
      p.consecutiveTimeouts = 0
      this.broadcastRoomEvent({ type: 'PLAYER_SAT', playerId, seat, stack: p.stack })
      this.changed()
      // The balance just moved to the table: the player's own bar must say so now, not at the next stand-up.
      await this.pushBalance(playerId)
      await this.recountResultSkips() // one more voter in a result wait
    })
  }

  standUp(playerId: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (this.inCurrentHand(p)) {
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat)
        return
      }
      await this.loggingMoney('stand-up failed', p, () => this.standUpNow(p))
      await this.recountResultSkips()
    })
  }

  /**
   * Keep the seat but skip the next hands (spec §11.3). The *current* hand is played out — a player who
   * folds their way off the table is doing something else — so this only moves the flag the next
   * `startHand` reads. `SIT_IN` clears the request, but a stack below the minimum to play keeps the seat
   * `SITTING_OUT` under the existing short-stack rule.
   *
   * The skip counter is reset only by a *change* of the request. Zeroing it on every `SIT_OUT` would let a
   * client re-arm the five-hand auto-stand once a hand and park on a seat it never plays (spec §11.3).
   */
  sitOut(playerId: string, out: boolean): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (p.sitOutRequested !== out) p.handsSatOut = 0
      p.sitOutRequested = out
      // A seat whose cash-out is pending stays out whatever is asked: its stack may already be home.
      this.setSittingOut(p, out || p.cashOutPending || p.stack < this.requiredStack())
      // Sitting back in can be the move that completes the table, so it gets the same look autoStart
      // takes when someone readies up — otherwise the room waits for a ready toggle it does not need.
      // In a chaos result wait it is one voter more or less (only one of the two can apply: autoStart needs OPEN).
      return out ? this.recountResultSkips() : (this.maybeAutoStart() ?? this.recountResultSkips())
    })
  }

  setReady(playerId: string, ready: boolean): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (this.status !== 'OPEN') throw new RoomError('GAME_IN_PROGRESS')
      p.ready = ready
      this.broadcastRoomEvent({ type: 'PLAYER_READY', playerId, ready })
      return ready ? this.maybeAutoStart() : undefined
    })
  }

  startGame(playerId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      if (playerId !== this.hostPlayerId) throw new RoomError('NOT_HOST')
      if (this.status !== 'OPEN') throw new RoomError('GAME_IN_PROGRESS')
      if (this.readySeats().length < 2) throw new RoomError('NOT_ENOUGH_PLAYERS', 'need at least 2 ready players')
      // Bots are always ready, so two ready seats can be two bots: a hand needs a human in it (§8.5), and a
      // Start that quietly does nothing reads as a broken button, so the refusal is spelled out here.
      if (!this.readySeats().some((p) => !p.identity.isBot)) throw new RoomError('NOT_ENOUGH_PLAYERS', 'need at least one ready player who is not a bot')
      return this.startHand().then((started) => {
        if (!started) throw new RoomError('NOT_ENOUGH_PLAYERS', 'nobody at the table can play this hand')
      })
    })
  }

  // ---------- gameplay ----------

  action(playerId: string, action: PlayerAction, baseSeq: number): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!this.runner || this.runner.isComplete) throw new RoomError('NOT_IN_HAND', 'no hand in progress')
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (!this.runner.state.players.some((hp) => hp.seat === p.seat)) throw new RoomError('NOT_IN_HAND')
      if (baseSeq < this.turnStartSeq) throw new RoomError('STALE_STATE', `turn changed at seq ${this.turnStartSeq}`)
      try {
        this.runner.submit({ type: 'ACTION', seat: p.seat, action })
      } catch (err) {
        if (err instanceof EngineError) throw new RoomError(engineErrorToErrorCode(err.code), err.message)
        throw err
      }
    })
  }

  /**
   * Squeeze mode: the player has turned every one of its cards (spec 2026-10-08 §5.2). Nothing when there is no
   * squeeze round to turn them in — a submit would re-arm the hand's timers, so it is not sent at all. Nothing either,
   * for a seated player, when no hand is running: a REVEAL sent as the last card opened can land after the hand is over
   * (a slow link, a decision taken within the card's last animation), and it must not come back as an error the client
   * shows. A player with no seat is still refused, as is a seat that was not dealt into the hand that is running.
   */
  reveal(playerId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (p.seat === null) throw new RoomError('NOT_SEATED')
      if (!this.runner || this.runner.isComplete) return
      if (!this.runner.state.players.some((hp) => hp.seat === p.seat)) throw new RoomError('NOT_IN_HAND')
      const { phase } = this.runner.state
      const squeezing = phase === 'SQUEEZE' || (phase === 'DECISION' && this.rules.mode === 'blind' && this.rules.squeeze === true)
      if (!squeezing) return
      try {
        this.runner.submit({ type: 'REVEALED', seat: p.seat })
      } catch (err) {
        if (err instanceof EngineError) throw new RoomError(engineErrorToErrorCode(err.code), err.message)
        throw err
      }
    })
  }

  /**
   * Poker hỗn loạn: the player takes one card of the offer it was sent in the open draft (spec §3.2). The last pick the
   * draft waited for ends it and deals the hand. `CHAOS_NO_OFFER` for an offer that is not open to this player.
   */
  pickChaos(playerId: string, offerId: string, cardId: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      this.mustPlayer(playerId)
      if (!this.chaos) throw new RoomError('CHAOS_NO_OFFER')
      if (this.chaos.pick(playerId, offerId, cardId)) await this.endDraft()
    })
  }

  /**
   * Poker hỗn loạn (BP-39): the player plays bonus card `uid` from its bonus hand — between hands (during the interval,
   * a draft, or before the first deal: it fires in the next hand it is dealt into), or during the play/fold choice of the
   * hand it is dealt into (a one-shot reveal card fires at this hand's reveal, any other in the next hand). Everything else
   * is `CHAOS_CANNOT_USE`: no chaos table, no seat, a hand past its choice (squeeze, reveal) or one the seat is not in, a
   * "Hoàn toàn may rủi" hand (it has no choice), a seat frozen this hand, a card not in the hand, a second card pressed.
   */
  useChaosBonus(playerId: string, uid: number): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!this.chaos || p.seat === null || p.identity.isBot) throw new RoomError('CHAOS_CANNOT_USE', 'no seat at a chaos table')
      // The runner's state is the live object (`HandRunner.state`): a card played into this hand joins its plan in place.
      const live = this.runner && !this.runner.isComplete ? this.runner.state : null
      if (live && (live.phase !== 'DECISION' || !live.players.some((hp) => hp.seat === p.seat))) throw new RoomError('CHAOS_CANNOT_USE', 'not during this hand')
      this.chaos.useBonus(p, uid, live)
    })
  }

  /**
   * Poker hỗn loạn (BP-39, spec 2026-10-27 §3.3): the player presses "Bỏ qua" on a hand's result. Counted only in the
   * result wait of a chaos table, and only from a voter (`resultVoters`); anything else — a draft, a hand in play, a
   * waiting room, a plain table, a spectator, a seat sitting out, a second press — is ignored without an error. When
   * every voter has pressed it, the next hand starts now.
   */
  skipResult(playerId: string): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!this.inResultWait() || !this.resultVoters().includes(p) || this.resultSkips.has(playerId)) return
      this.resultSkips.add(playerId)
      return this.recountResultSkips()
    })
  }

  // ---------- connection lifecycle ----------

  onDisconnect(playerId: string): Promise<void> {
    return this.enqueue(() => {
      const p = this.players.get(playerId)
      if (!p || !p.connected) return
      p.connected = false
      const deadline = this.deps.clock.now() + this.deps.options.reconnectWindowMs
      p.disconnectDeadline = deadline
      this.broadcastRoomEvent({ type: 'PLAYER_DISCONNECTED', playerId, deadline }, playerId)
      this.setPlayerTimer(playerId, this.deps.options.reconnectWindowMs, () => this.onReconnectExpired(playerId))
      return this.recountResultSkips() // a voter gone may be the one the others waited for
    })
  }

  onReconnect(playerId: string): Promise<void> {
    return this.enqueue(() => {
      const p = this.players.get(playerId)
      if (!p || p.connected) return
      p.connected = true
      p.disconnectDeadline = null
      this.clearPlayerTimer(playerId)
      this.broadcastRoomEvent({ type: 'PLAYER_RECONNECTED', playerId }, playerId)
      return this.recountResultSkips()
    })
  }

  private async onReconnectExpired(playerId: string): Promise<void> {
    const p = this.players.get(playerId)
    if (!p || p.connected) return
    if (p.seat !== null) {
      if (this.inCurrentHand(p)) {
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat)
      } else {
        // This runs from a timer, where a rejection would vanish without a word and skip the grace timer below. A
        // cash-out that cannot write keeps the seat but takes it out of the deal (`standAfterHand`, and the frozen
        // `cashOutPending`): the stand-up is retried when the next hand ends, and the removal below tries again at the latest.
        try {
          await this.standUpNow(p)
        } catch (err) {
          p.standAfterHand = true
          this.deps.log.error('reconnect-expiry stand-up failed', { roomId: this.roomId, playerId, stack: p.stack, key: this.pendingKeyOf(p), err: String(err) })
        }
      }
    }
    this.setPlayerTimer(playerId, this.deps.options.spectatorGraceMs, async () => {
      const still = this.players.get(playerId)
      if (!still || still.connected) return
      if (this.inCurrentHand(still)) {
        still.leaveAfterHand = true
        return
      }
      try {
        await this.removePlayer(still, 'timeout')
      } catch (err) {
        // Same reason: logged, and left to the end of the next hand to retry.
        still.leaveAfterHand = true
        this.deps.log.error('spectator-grace removal failed', { roomId: this.roomId, playerId, stack: still.stack, key: this.pendingKeyOf(still), err: String(err) })
      }
    })
  }

  // ---------- shutdown / close ----------

  shutdown(reason: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.status === 'CLOSED') return
      this.closing = true
      await this.wrapUp(reason)
      for (const p of this.humans()) {
        // One player's ledger failure must not strand everyone after them, nor keep the room from closing (and the
        // server from closing its sockets): their stack (or the buy-in owed back) and the key of the write are logged for
        // an operator to reconcile, and the room goes on. A buy-in still pending (written, never acknowledged, no seat)
        // goes back — so the line names a settlement, which is a cash-out or that refund.
        try {
          await this.standUpNow(p)
          await this.refundPendingBuyIn(p)
        } catch (err) {
          this.deps.log.error('shutdown settlement failed', {
            roomId: this.roomId,
            playerId: p.identity.playerId,
            stack: p.stack,
            ...(p.pendingBuyIn === undefined ? {} : { buyIn: p.pendingBuyIn.amount }),
            key: this.pendingKeyOf(p),
            err: String(err),
          })
        }
      }
      this.status = 'CLOSED'
      await this.closeStep(reason, 'announce', () => this.broadcastRoomEvent({ type: 'ROOM_CLOSED', reason }))
      await this.closeStep(reason, 'onClosed', () => this.onClosed?.(this, reason))
    })
  }

  private async close(reason: string): Promise<void> {
    if (this.status === 'CLOSED' || this.closing) return
    this.closing = true
    await this.wrapUp(reason)
    this.status = 'CLOSED'
    await this.closeStep(reason, 'onClosed', () => this.onClosed?.(this, reason))
  }

  /**
   * What `close()` and `shutdown()` both do before the room is marked closed. The hand on the table is ended — cancelled
   * if it is still running, and settled either way: a hand whose last move is in but whose settlement is still queued
   * behind this close is settled here, so its stacks are the ones cashed out and its carried pot is the one released
   * (the queued `onHandComplete` then finds no runner and returns). Then every timer stops and the carried pot goes back.
   * Each step is guarded, like everything after it: a room whose close cannot finish a step still ends `CLOSED`, with
   * one `onClosed`, rather than listed forever behind a `closing` flag nothing resets.
   */
  private async wrapUp(reason: string): Promise<void> {
    const runner = this.runner
    if (runner) {
      await this.closeStep(reason, 'hand', async () => {
        if (!runner.isComplete) runner.cancel(reason)
        await this.onHandComplete()
      })
      // `onHandComplete` clears `this.runner` before anything it awaits, so a runner still here was never settled
      // (the cancel threw): the step below must not leave its pot unaccounted for.
      if (this.runner === runner) this.voidUnsettledHand(runner, reason)
    }
    this.cancelTimers()
    await this.closeStep(reason, 'carry-over', () => this.releaseCarryOver())
  }

  /**
   * A hand the close could not settle (its cancel threw an engine error). `startHand` moved the pot it carried in out
   * of `carryOverPot` and into the hand, and only `onHandComplete` gives it back — so put it back here, or those chips
   * leave the books. Nothing else was taken from anyone: the seats' stacks are written only by `onHandComplete`, so each
   * is still what it brought to the hand — exactly what a cancel would have refunded — and stands up with it. The hand
   * is dropped unrecorded (there is no result to record); the release step that follows returns the pot. The one thing
   * not restored is who had a claim on it (`startHand` cleared them when the pot went into the hand): the pot goes to
   * whoever is seated, or to the `carry_over` sink, and the books balance either way.
   */
  private voidUnsettledHand(runner: HandRunner, reason: string): void {
    const carryOverIn = runner.state.carryOverIn
    runner.dispose()
    this.runner = null
    this.deadlineAt = null
    this.carryOverPot += carryOverIn
    this.deps.log.error('hand voided at close: not settled, its carried-in pot goes back', { roomId: this.roomId, reason, handId: runner.state.handId, carryOverIn })
  }

  private async closeStep(reason: string, step: string, fn: () => unknown): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.deps.log.error('room close step failed', { roomId: this.roomId, reason, step, err: String(err) })
    }
  }

  /**
   * Spec §8.4. Returns a carry-over pot to the table: an equal share to every seated human, with the
   * indivisible remainder (or the whole pot when there is nobody to pay)
   * recorded as a `carry_over` sink so `Σ balances + Σ sinks` stays constant. Called from the release
   * timer, `close()` and `shutdown()`; always runs on the room queue.
   *
   * Each release is one batch under a key of its own (`carry_over:<roomId>:<id>`). A batch that is not acknowledged —
   * it may have landed — is kept aside as `pendingRelease` and settled first next time, under that same key, so a
   * release is paid once however often it is retried. Until it is settled nothing newer is released behind it.
   */
  private async releaseCarryOver(): Promise<void> {
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    if (!(await this.settlePendingRelease())) {
      // A room that is closing gets no later attempt: the older pot is logged with its key above, and a newer one held
      // behind it would leave with the room unsaid — so it is logged too, for an operator to reconcile.
      if (this.closing && this.carryOverPot > 0) {
        this.deps.log.error('carry-over not released at close', { roomId: this.roomId, pot: this.carryOverPot, behind: this.pendingRelease?.key })
      }
      return
    }
    const pot = this.carryOverPot
    if (pot <= 0) return
    const recipients = this.humans().filter((p) => p.seat !== null)
    const share = recipients.length === 0 ? 0 : Math.floor(pot / recipients.length)
    const remainder = pot - share * recipients.length
    const entries: BalanceEntry[] = share > 0
      ? recipients.map((p) => ({ playerId: p.identity.playerId, delta: share, reason: 'refund' as const, refId: this.roomId }))
      : []
    // From here the pot is this batch's: its shares are fixed, and a retry writes exactly them.
    this.pendingRelease = {
      key: `carry_over:${this.roomId}:${newId()}`,
      pot,
      entries,
      meta: { refId: this.roomId, fee: remainder, kind: 'carry_over' },
      recipients: recipients.map((p) => p.identity.playerId),
    }
    this.carryOverPot = 0
    await this.settlePendingRelease()
  }

  /**
   * Writes `pendingRelease` under its key. `true` once it is settled — landed now, or by an earlier attempt that was not
   * acknowledged (`applied: false`, which clears that release and nothing newer) — and `false` while it is still owed,
   * its pot kept aside. Also how `startHand` makes sure a pot already paid out is never dealt.
   */
  private async settlePendingRelease(): Promise<boolean> {
    const pending = this.pendingRelease
    if (pending === null) return true
    try {
      await this.deps.repos.balances.apply(pending.entries, pending.meta, { key: pending.key })
    } catch (err) {
      this.deps.log.error('carry-over release failed', { roomId: this.roomId, pot: pending.pot, key: pending.key, err: String(err) })
      return false
    }
    if (this.pendingRelease === pending) this.pendingRelease = null
    this.deps.log.info('carry-over released', { roomId: this.roomId, pot: pending.pot, key: pending.key, recipients: pending.recipients.length, sink: pending.meta.fee })
    for (const playerId of pending.recipients) await this.pushBalance(playerId)
    // status is unchanged; the event exists so every view refreshes `carryOverPot`.
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: this.status === 'IN_GAME' ? 'IN_GAME' : 'OPEN', nextHandAt: this.nextHandAt })
    return true
  }

  private armCarryOverRelease(): void {
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    if ((this.carryOverPot <= 0 && this.pendingRelease === null) || this.status === 'CLOSED') return
    this.carryOverReleaseTimer = this.deps.clock.setTimeout(() => void this.enqueue(() => this.releaseCarryOver()), this.deps.options.carryOverReleaseMs)
  }

  // ---------- hand lifecycle ----------

  /**
   * Deals the next hand if the table can play one; `false` when it cannot (too few eligible seats, or only bots). On a
   * chaos table a seat that has not drafted in this cycle opens a draft first: `true`, and the hand is dealt when the
   * draft ends (`endDraft`, which comes back here with `skipDraft`).
   */
  private async startHand(skipDraft = false): Promise<boolean> {
    if (this.status === 'CLOSED' || (this.runner && !this.runner.isComplete) || this.chaos?.draft) return false
    this.nextHandTimer?.cancel()
    this.nextHandTimer = null
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    // A release that was not acknowledged is settled before anything is dealt: a pot that may already be in the
    // players' balances must not be played as well. If it still cannot be settled it stays aside, out of this hand
    // (`carryOverIn` is only `carryOverPot`), until the release timer, a close or a shutdown settles it.
    if (this.pendingRelease !== null) await this.settlePendingRelease()
    const required = this.requiredStack()
    if (this.rules.mode === 'blind') {
      // Humans play from the stack they brought; only bots are topped up — back to the limit, never the ledger — and,
      // like a human, a bot plays a short stack all in and is topped up only once it is spent (plan 27 D2).
      const limit = blindTableLimit(this.rules)
      for (const p of this.seated()) if (p.identity.isBot && p.stack < required) p.stack = limit
    }
    // A seated human who cannot cover the requirement (a stack of 0) sits the hand out rather than silently
    // vanishing from the table: playerView reports SITTING_OUT. Since the table limit (spec 2026-09-29)
    // such a seat only exists when its stand-up in `onHandComplete` did not finish, and it is retried
    // when this hand ends. A player who *asked* to sit out stays out whatever their stack says, and so does a seat
    // whose cash-out is pending (its stack may already be home).
    for (const p of this.seated()) if (!p.identity.isBot) this.setSittingOut(p, p.sitOutRequested || p.cashOutPending || p.stack < required)
    const eligible = this.eligibleForHand()
    if (eligible.length < 2 || eligible.every((p) => p.identity.isBot)) {
      this.toOpen()
      return false
    }
    // The draft waits between hands as the hand interval does: IN_GAME, the next deal at its deadline (spec §3.2).
    if (this.chaos && !skipDraft && (await this.chaos.openDraft(eligible))) {
      this.status = 'IN_GAME'
      this.nextHandAt = this.chaos.draft!.deadlineAt
      this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: this.nextHandAt })
      this.changed()
      return true
    }
    // This hand is going ahead without them, so every voluntary sitter has been skipped once more.
    // Spec §11.3: after `handsSatOutToStand` in a row the seat goes back to the table, stack returned,
    // down the same path as the timeout stand-up — nobody parks on a seat they are not using.
    // A stand-up writes to the ledger; a ledger blip must not take the starting hand down with it, so each stand-up is
    // guarded the way `onHandComplete`'s are. A missed one leaves the seat frozen (`cashOutPending`) and is retried when
    // this hand ends.
    for (const p of this.seated()) {
      if (p.identity.isBot || !p.sitOutRequested) continue
      p.handsSatOut += 1
      if (p.handsSatOut < this.deps.options.handsSatOutToStand) continue
      try {
        await this.standUpNow(p)
      } catch (err) {
        this.deps.log.error('sit-out stand-up failed', { roomId: this.roomId, playerId: p.identity.playerId, key: this.pendingKeyOf(p), err: String(err) })
      }
    }
    const seats = eligible.map((p) => p.seat!)
    this.button = nextButton(this.button, seats, this.deps.rng)
    const handId = newId()
    const chaos = this.chaos?.planHand(eligible)
    const runner = new HandRunner(
      {
        clock: this.deps.clock,
        rng: this.deps.rng,
        bot: this.deps.bot,
        log: this.deps.log,
        turnTimerMs: this.deps.options.turnTimerMsOverride ?? this.config.turnTimerSec * 1000,
        revealDelayMs: this.deps.options.revealDelayMs,
        botDelayMs: this.deps.options.botDelayMs,
        isBotSeat: (seat) => this.seatPlayer(seat)?.identity.isBot ?? false,
        enqueue: (fn) => void this.enqueue(fn),
        onEvents: (events, deadlineAt) => this.onHandEvents(events, deadlineAt),
        onComplete: () => void this.enqueue(() => this.onHandComplete()),
      },
      { handId, rules: this.rules, seats: eligible.map((p) => ({ seat: p.seat!, playerId: p.identity.playerId, stack: p.stack, isBot: p.identity.isBot })), button: this.button, carryOverIn: this.carryOverPot, ...(chaos ? { chaos } : {}) },
    )
    this.runner = runner
    this.carryOverPot = 0 // the pot is this hand's now: whoever wins it takes it
    this.nextHandAt = null
    this.status = 'IN_GAME'
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: null })
    this.changed()
    runner.start()
    return true
  }

  private onHandEvents(events: GameEvent[], deadlineAt: number | null): void {
    this.deadlineAt = deadlineAt
    for (const event of events) {
      if (event.type === 'PLAYER_ACTED') {
        const p = this.seatPlayer(event.seat)
        // A seat the ante emptied is played for it (amount 0, all in): no timeout, and no decision of its own that would
        // start the count over (spec R14).
        const autoPlayed = event.action.kind === 'play' && event.amount === 0 && event.allIn && !event.timedOut
        if (p && !p.identity.isBot && !autoPlayed) p.consecutiveTimeouts = event.timedOut ? p.consecutiveTimeouts + 1 : 0
      }
      this.seq += 1
      const isTurn = event.type === 'TURN_CHANGED' || event.type === 'DECISION_PHASE' || event.type === 'SQUEEZE_PHASE'
      if (isTurn) this.turnStartSeq = this.seq
      const outbound = isTurn && deadlineAt !== null ? { ...event, deadlineAt } : event
      for (const p of this.connectedHumans()) {
        // A private chaos event is not sent to the others at all; the skipped seq is harmless (clients only flag a seq going back).
        const seen = filterEvent(outbound, p.seat)
        if (seen !== null) this.deps.outbox.send(p.identity.playerId, { t: 'GAME_EVENT', seq: this.seq, event: seen })
      }
    }
  }

  private async onHandComplete(): Promise<void> {
    const runner = this.runner
    if (!runner || !runner.isComplete || runner.state.result === null) return
    const state = runner.state
    const result = state.result!
    const summary: HandSummary = {
      handId: state.handId,
      roomId: this.roomId,
      mode: this.rules.mode,
      config: this.summary().config, // never the raw config: it would carry the room password
      startedAt: runner.startedAt,
      endedAt: this.deps.clock.now(),
      fee: result.fee,
      cancelled: runner.wasCancelled,
      players: [],
    }
    for (const hp of state.players) {
      const rp = this.seatPlayer(hp.seat)
      const before = runner.stacksBefore.get(hp.seat) ?? hp.stack
      const net = hp.stack - before
      if (rp) rp.stack = hp.stack
      summary.players.push({ playerId: hp.playerId, seat: hp.seat, isBot: hp.isBot, net, won: net > 0, bestCategory: result.showdown?.find((h) => h.seat === hp.seat)?.category ?? null })
    }
    if (state.chaos && !runner.wasCancelled) summary.chaosUsed = state.chaos.used.map((u) => ({ seat: u.seat, cardId: u.cardId, outcome: u.outcome }))
    this.carryOverPot = result.carryOverOut
    this.runner = null
    this.deadlineAt = null
    // Both modes move chips on the table (spec 2026-09-29), so the hand's only ledger row is the fee sink.
    if (result.fee > 0) {
      try {
        await this.deps.repos.balances.apply([], { refId: state.handId, fee: result.fee, kind: 'table_fee' })
      } catch (err) {
        // The hand is still recorded and still emitted, flagged, so an operator can reconcile it.
        summary.settlementError = String(err)
        this.deps.log.error('settlement failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
      }
    }
    try {
      await this.deps.repos.history.recordHand(summary)
    } catch (err) {
      this.deps.log.error('recordHand failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
    }
    this.deps.onDomainEvent?.({ type: 'HAND_SETTLED', summary })
    // A card credit an earlier hand could not get acknowledged is retried first, under its key (`ChaosTable.pending`),
    // so it lands before this hand's credits and before any stand-up below.
    if (this.chaos) {
      for (const p of this.players.values()) {
        if (!this.chaos.hasPending(p.identity.playerId)) continue
        try {
          await this.chaos.settlePending(p)
        } catch (err) {
          this.deps.log.error('pending chaos credit failed again', { roomId: this.roomId, playerId: p.identity.playerId, err: String(err) })
        }
      }
    }
    // The cards' side of the hand, before anyone is stood up: a seat a hand left at 0 can still be rescued (spec §5.4).
    // Its credits move stacks only, never the summary's `net`. A cancelled hand settles nothing.
    if (this.chaos && !runner.wasCancelled) {
      try {
        await this.chaos.settleHand(state, runner.stacksBefore, (seat) => this.seatPlayer(seat))
      } catch (err) {
        this.deps.log.error('chaos settlement failed', { roomId: this.roomId, handId: state.handId, err: String(err) })
      }
    } else if (this.chaos) {
      // A cancelled hand: a card played into it goes back to its owner's bonus hand now (M4).
      this.chaos.handCancelled(state, (seat) => this.seatPlayer(seat))
    }

    const required = this.requiredStack()
    for (const p of [...this.players.values()]) {
      // One player's ledger failure must not take the next deal down with it: logged with its key, and retried after
      // the next hand (the seat is frozen meanwhile: `cashOutPending`). Every pending cash-out is retried here — a
      // failed Stand Up, Leave or kick as much as the stand-ups this loop starts itself — under its own key; a failed
      // kick retries the whole removal (`leaveAfterHand`).
      try {
        if (!p.identity.isBot && p.consecutiveTimeouts >= this.deps.options.consecutiveTimeoutsToStand) {
          p.standAfterHand = true
          p.consecutiveTimeouts = 0
        }
        if (p.leaveAfterHand) await this.removePlayer(p, 'left')
        else if (p.standAfterHand) await this.standUpNow(p)
        else if (p.seat !== null && !p.identity.isBot && p.stack < required) {
          // A card credit still owed may be what keeps the seat (a rescue whose reply was lost): settled first. One that
          // fails again leaves the seat as it is — sat out by the next deal — and is retried after the next hand.
          if (this.chaos?.hasPending(p.identity.playerId)) await this.chaos.settlePending(p)
          if (p.stack < required) await this.standUpSpent(p)
        }
        else if (p.cashOutPending) await this.standUpNow(p)
      } catch (err) {
        this.deps.log.error('stand-up after hand failed', { roomId: this.roomId, playerId: p.identity.playerId, key: this.pendingKeyOf(p), err: String(err) })
      }
    }
    if (this.status === 'CLOSED') return
    // A chaos table keeps the result up for the GM's result time (BP-39), every other table for the hand interval. A room
    // that is closing asks the port nothing (M9): no hand follows anyway.
    const waitMs = this.chaos && !this.closing ? await this.chaos.resultMs() : this.deps.options.handIntervalMs
    this.nextHandAt = this.deps.clock.now() + waitMs
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: this.nextHandAt })
    // A timer that fired after the hand was started another way (every voter pressed "Bỏ qua") deals nothing.
    const timer: TimerHandle = this.deps.clock.setTimeout(() => void this.enqueue(() => (this.nextHandTimer === timer ? this.startHand() : undefined)), waitMs)
    this.nextHandTimer = timer
    // A new result wait: nobody has pressed "Bỏ qua" yet, and the table is told who is counted.
    this.resultSkips.clear()
    this.resultTally = null
    if (!this.closing) await this.recountResultSkips()
  }

  /** The wait after a chaos hand's settlement, before the next deal: the only time "Bỏ qua" counts (BP-39). */
  private inResultWait(): boolean {
    return this.chaos !== null && this.status !== 'CLOSED' && this.nextHandTimer !== null && this.runner === null && this.chaos.draft === null
  }

  /** Who "Bỏ qua" waits for: seated humans who are connected and not sitting out (nor asked to). Bots never count. */
  private resultVoters(): RoomPlayer[] {
    return this.seatedHumans().filter((p) => p.connected && !p.sittingOut && !p.sitOutRequested)
  }

  /**
   * Counts "Bỏ qua" again after anything that can change it — a press, a seat taken or left, a sit-out, a disconnect or
   * a reconnect — and says `RESULT_SKIPS` when the count moved (always once at the start of a wait). When every voter
   * has pressed it, the next hand starts now: `startHand` cancels the timer and tells the table the new `nextHandAt`.
   * Nothing outside a chaos table's result wait. Never throws: the move that caused the recount has already happened.
   */
  private async recountResultSkips(): Promise<void> {
    if (!this.inResultWait()) return
    const voters = this.resultVoters()
    const tally = { skipped: voters.filter((p) => this.resultSkips.has(p.identity.playerId)).length, total: voters.length }
    if (this.resultTally?.skipped !== tally.skipped || this.resultTally.total !== tally.total) {
      this.resultTally = tally
      this.broadcastRoomEvent({ type: 'RESULT_SKIPS', ...tally })
    }
    if (tally.total === 0 || tally.skipped < tally.total) return
    try {
      await this.startHand()
    } catch (err) {
      this.deps.log.error('start after every skip failed', { roomId: this.roomId, err: String(err) })
    }
  }

  /**
   * The chaos draft is over — every offer picked, its deadline passed, or the last seat waited on gone: the cards are
   * handed out and the hand is dealt, without a second draft. A seat that became eligible during the draft plays this
   * hand undrafted and drafts before its next one.
   */
  private async endDraft(): Promise<void> {
    if (!this.chaos?.draft || this.status === 'CLOSED') return
    this.chaos.endDraft()
    this.nextHandAt = null
    await this.startHand(true)
  }

  private toOpen(): void {
    this.status = 'OPEN'
    this.nextHandAt = null
    // Waiting again clears every human's ready flag; each one that was set is announced, or a client keeps showing
    // "Hủy sẵn sàng" (and "8/8 ready") for a flag the server no longer holds, and Start answers NOT_ENOUGH_PLAYERS (E6).
    const cleared: string[] = []
    for (const p of this.players.values()) {
      if (p.identity.isBot || !p.ready) continue
      p.ready = false
      cleared.push(p.identity.playerId)
    }
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'OPEN', nextHandAt: null })
    for (const playerId of cleared) this.broadcastRoomEvent({ type: 'PLAYER_READY', playerId, ready: false })
    this.armCarryOverRelease()
    this.changed()
  }

  // ---------- helpers ----------

  private addPlayer(identity: PlayerIdentity): RoomPlayer {
    const p: RoomPlayer = {
      identity, seat: null, stack: 0, ready: false, connected: true, joinedAt: this.deps.clock.now(), sittingOut: false,
      sitOutRequested: false, handsSatOut: 0,
      consecutiveTimeouts: 0, disconnectDeadline: null, standAfterHand: false, leaveAfterHand: false,
      sitId: null, cashOutPending: false,
    }
    this.players.set(identity.playerId, p)
    this.everJoined.add(identity.playerId)
    this.onMembership?.(identity.playerId, true)
    return p
  }

  /** A closed room accepts no further mutation — nothing may move points into or out of it. */
  private assertOpen(): void {
    if (this.status === 'CLOSED') throw new RoomError('ROOM_NOT_FOUND', 'room is closed')
  }

  private mustPlayer(playerId: string): RoomPlayer {
    const p = this.players.get(playerId)
    if (!p) throw new RoomError('NOT_IN_ROOM')
    return p
  }

  private humans(): RoomPlayer[] {
    return [...this.players.values()].filter((p) => !p.identity.isBot)
  }

  private connectedHumans(): RoomPlayer[] {
    return this.humans().filter((p) => p.connected)
  }

  private seated(): RoomPlayer[] {
    return [...this.players.values()].filter((p) => p.seat !== null)
  }

  private seatedHumans(): RoomPlayer[] {
    return this.seated().filter((p) => !p.identity.isBot)
  }

  /** Seats that count towards starting a hand: a sitting-out seat is warm, not playing. */
  private readySeats(): RoomPlayer[] {
    return this.seated().filter((p) => p.ready && !p.sittingOut)
  }

  /** What a seat needs to be dealt: any point at all, in both modes (plan 27 D2) — a short Blind seat goes all in. */
  private requiredStack(): number {
    return 1
  }

  /**
   * The only writer of the effective sit-out flag: it moves the flag, tells the room (so a client never has to
   * diff a snapshot to see it) and tells the manager. Returns whether anything actually moved.
   */
  private setSittingOut(p: RoomPlayer, sittingOut: boolean): boolean {
    if (p.sittingOut === sittingOut) return false
    p.sittingOut = sittingOut
    this.broadcastRoomEvent({ type: 'PLAYER_SIT_OUT', playerId: p.identity.playerId, sittingOut })
    this.changed()
    return true
  }

  /**
   * `autoStart`'s one condition, in one place: two seats ready to play and nobody still deciding.
   * Sitting-out humans are not waited on — they have said they are not playing — but they do not
   * count towards the two either, so a table of one player and one sitter keeps waiting.
   */
  private maybeAutoStart(): Promise<void> | undefined {
    if (!this.config.autoStart || this.status !== 'OPEN') return undefined
    if (this.readySeats().length < 2) return undefined
    if (!this.seatedHumans().every((p) => p.ready || p.sittingOut)) return undefined
    return this.startHand().then(() => undefined)
  }

  private seatPlayer(seat: number): RoomPlayer | undefined {
    return [...this.players.values()].find((p) => p.seat === seat)
  }

  /**
   * A hand is current until `onHandComplete` has settled it (and set `runner` to null), not merely until its last
   * move: that settlement is queued behind whatever was already in the room's queue. A Leave or Stand queued ahead
   * of it would otherwise take the pre-hand stack home and, the last person out of a room with bots, close the room
   * under a settlement still to come — a carried pot set on a closed room and never released.
   */
  private inCurrentHand(p: RoomPlayer): boolean {
    return p.seat !== null && this.runner !== null && this.runner.state.players.some((hp) => hp.seat === p.seat)
  }

  private eligibleForHand(): RoomPlayer[] {
    const required = this.requiredStack()
    return this.seated().filter((p) => !p.sittingOut && !p.standAfterHand && !p.leaveAfterHand && !p.cashOutPending && p.stack >= required && (p.identity.isBot || this.status !== 'OPEN' || p.ready))
  }

  private playerView(p: RoomPlayer): RoomPlayerView {
    let status: SeatStatus | null = null
    if (p.seat !== null) {
      if (!p.connected) status = 'DISCONNECTED'
      else if (this.inCurrentHand(p)) status = 'IN_HAND'
      else if (p.sittingOut) status = 'SITTING_OUT'
      else status = p.ready ? 'READY' : 'SEATED'
    }
    // `status` is one value and `IN_HAND` outranks `SITTING_OUT`, so the flag travels on its own field:
    // a player who sits out mid-hand must still read as sitting out after the next snapshot. The request
    // is reported even before the next `startHand` folds it into the effective flag.
    const view: RoomPlayerView = {
      playerId: p.identity.playerId, displayName: p.identity.displayName, isBot: p.identity.isBot, isHost: p.identity.playerId === this.hostPlayerId,
      connected: p.connected, seat: p.seat, status, sittingOut: p.sitOutRequested || p.sittingOut, stack: p.stack, ready: p.ready,
    }
    if (p.cosmetics !== undefined) view.cosmetics = p.cosmetics
    if (this.chaos && p.seat !== null) view.chaos = this.chaos.seatView(p)
    return view
  }

  /**
   * Plan 27 D2: a seat that ends a hand at 0 — in either mode — goes back to the rail, and its player is told why,
   * with the way back: relief under `ECONOMY.reliefThreshold`, or an empty seat once there are points again. Nothing
   * is left to cash out, so the stand-up writes no ledger row. No carried-over pot can be pending here either: a seat
   * reaches 0 only by playing, and a hand someone plays is not carried over.
   */
  private async standUpSpent(p: RoomPlayer): Promise<void> {
    await this.standUpNow(p)
    if (p.connected) {
      this.deps.outbox.send(p.identity.playerId, {
        t: 'NOTIFICATION',
        kind: 'STACK_SPENT',
        payload: { roomId: this.roomId, threshold: ECONOMY.reliefThreshold },
      })
    }
  }

  /**
   * Cashes the seat's stack out under `cash_out:<roomId>:<sitId>` and frees the seat. The seat is frozen
   * (`cashOutPending`) from before the write until it is acknowledged: a write that fails may still have landed, so the
   * seat keeps its stack, sits out and is never dealt in until a retry — under the same key, so it is credited at
   * most once — settles it. `applied: false` (an earlier attempt landed) settles it as well as `true` does.
   */
  private async standUpNow(p: RoomPlayer): Promise<void> {
    if (p.seat === null) return
    const seat = p.seat
    // A card credit still owed is settled before the stack is cashed out: it may have landed, and its `chaos_to_table`
    // row needs the stack behind it. Until it is acknowledged the seat is frozen exactly like a pending cash-out.
    if (this.chaos?.hasPending(p.identity.playerId)) {
      p.cashOutPending = true
      try {
        await this.chaos.settlePending(p)
      } catch (err) {
        this.setSittingOut(p, true)
        throw err
      }
    }
    if (!p.identity.isBot && p.stack > 0) {
      // Every human seat gets its id in `sitDown`; this only guarantees the key never names a missing sitting.
      const sitId = (p.sitId ??= newId())
      p.cashOutPending = true
      try {
        await this.deps.repos.balances.apply([{ playerId: p.identity.playerId, delta: p.stack, reason: 'cash_out', refId: this.roomId }], undefined, { key: this.cashOutKey(sitId) })
      } catch (err) {
        this.setSittingOut(p, true) // out of every deal, and nobody waits on it to start one
        // It may have landed: the bar is re-read now, as for a failed buy-in, rather than left short until the retry.
        await this.pushBalance(p.identity.playerId)
        throw err
      }
      await this.pushBalance(p.identity.playerId)
    }
    p.cashOutPending = false
    p.sitId = null
    p.seat = null
    p.stack = 0
    // Chaos cards and points belong to the seat (spec §3.4): gone with it, the bonus hand too (its owner is told). The
    // cycle's draft is not given back.
    const had = p.chaos
    p.chaos = undefined
    this.chaos?.seatCleared(p, had)
    this.chaos?.dropOffer(p.identity.playerId)
    p.ready = false
    p.standAfterHand = false
    p.sittingOut = false
    p.sitOutRequested = false
    p.handsSatOut = 0
    p.consecutiveTimeouts = 0
    this.broadcastRoomEvent({ type: 'PLAYER_STOOD', playerId: p.identity.playerId, seat })
    this.changed()
  }

  /**
   * Gives back a buy-in that was written and never acknowledged, for a player leaving (or a room shutting down) without
   * the seat it was for. The buy-in is replayed under its own key first, so it has landed exactly once either way, and
   * then refunded under `buy_in_refund:<roomId>:<sitId>`; a player is never left debited and unseated. From the replay
   * on (`refunding`) the buy-in can no longer pay for a seat, so a refund that fails half-way is finished, never undone.
   */
  private async refundPendingBuyIn(p: RoomPlayer): Promise<void> {
    const pending = p.pendingBuyIn
    if (pending === undefined) return
    const playerId = p.identity.playerId
    if (pending.refunding !== true) {
      try {
        await this.deps.repos.balances.apply([{ playerId, delta: -pending.amount, reason: 'buy_in', refId: this.roomId }], undefined, { key: this.buyInKey(pending.sitId) })
      } catch (err) {
        // Refused: a claimed key is never checked, so this one was never claimed — the buy-in never landed, nothing is owed.
        if (err instanceof InsufficientBalanceError) {
          p.pendingBuyIn = undefined
          return
        }
        throw err
      }
      pending.refunding = true
    }
    await this.deps.repos.balances.apply([{ playerId, delta: pending.amount, reason: 'refund', refId: this.roomId }], undefined, { key: this.buyInRefundKey(pending.sitId) })
    p.pendingBuyIn = undefined
    await this.pushBalance(playerId)
  }

  private cashOutKey(sitId: string): string {
    return `cash_out:${this.roomId}:${sitId}`
  }

  private buyInKey(sitId: string): string {
    return `buy_in:${this.roomId}:${sitId}`
  }

  private buyInRefundKey(sitId: string): string {
    return `buy_in_refund:${this.roomId}:${sitId}`
  }

  /** The key of the ledger write this player is waiting on, for the error line an operator reconciles by. */
  private pendingKeyOf(p: RoomPlayer): string | undefined {
    if (p.cashOutPending && p.sitId !== null) return this.cashOutKey(p.sitId)
    const buyIn = p.pendingBuyIn
    if (buyIn !== undefined) return buyIn.refunding === true ? this.buyInRefundKey(buyIn.sitId) : this.buyInKey(buyIn.sitId)
    return undefined
  }

  /**
   * A Stand Up, Leave, kick or buy-in refund asked for by a client: a ledger failure goes back to the client (the
   * gateway logs it without knowing the key), so it is said here too, with the key of the write that may have landed.
   */
  private async loggingMoney(what: string, p: RoomPlayer, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      if (!(err instanceof RoomError)) this.deps.log.error(what, { roomId: this.roomId, playerId: p.identity.playerId, key: this.pendingKeyOf(p), err: String(err) })
      throw err
    }
  }

  private async removePlayer(p: RoomPlayer, reason: string): Promise<void> {
    await this.standUpNow(p)
    await this.refundPendingBuyIn(p)
    // Said while the player is still on the list, so a connected player hears their own departure too. Without it
    // a player removed later than they asked — a Leave pressed mid-hand, then a reconnect that put them back on
    // the room screen before the hand ended — was dropped in silence and left looking at a frozen table.
    this.broadcastRoomEvent({ type: 'PLAYER_LEFT', playerId: p.identity.playerId })
    this.players.delete(p.identity.playerId)
    this.onMembership?.(p.identity.playerId, false)
    this.clearPlayerTimer(p.identity.playerId)
    if (p.identity.playerId === this.hostPlayerId) this.transferHost()
    this.deps.log.info('player left room', { roomId: this.roomId, playerId: p.identity.playerId, reason })
    // "Human" counts members, connected or not: a disconnected player keeps the room until the spectator grace
    // removes them. With no human left, bots have nobody to play with, so their room closes now (No3) — its carried
    // pot released like the timer's close does. A room with nobody in it at all keeps its grace and the lobby's
    // "Đang đóng…" (bug 2). Inside a `close()`/`shutdown()` the room is on its way out already: neither.
    if (this.humanCount === 0 && !this.closing) {
      if (this.seatedBotCount > 0) {
        await this.close('empty') // `onClosed` tells the manager, which takes the room off the list
        return
      }
      this.scheduleClose()
    }
    this.changed()
  }

  private transferHost(): void {
    const next = this.humans().filter((p) => !p.leaveAfterHand).sort((a, b) => a.joinedAt - b.joinedAt)[0]
    if (!next) return
    this.hostPlayerId = next.identity.playerId
    this.broadcastRoomEvent({ type: 'HOST_CHANGED', hostPlayerId: this.hostPlayerId })
  }

  private async pushBalance(playerId: string): Promise<void> {
    const p = this.players.get(playerId)
    if (!p || !p.connected) return
    try {
      const balance = await this.deps.repos.balances.get(playerId)
      this.deps.outbox.send(playerId, { t: 'BALANCE', balance })
    } catch (err) {
      this.deps.log.warn('balance lookup failed', { playerId, err: String(err) })
    }
  }

  private broadcastRoomEvent(event: RoomEvent, excludePlayerId?: string): void {
    this.seq += 1
    for (const p of this.connectedHumans()) if (p.identity.playerId !== excludePlayerId) this.deps.outbox.send(p.identity.playerId, { t: 'ROOM_EVENT', seq: this.seq, event })
  }

  private changed(): void {
    this.onChanged?.(this)
  }

  private setPlayerTimer(playerId: string, ms: number, fn: () => void | Promise<void>): void {
    this.clearPlayerTimer(playerId)
    this.playerTimers.set(playerId, this.deps.clock.setTimeout(() => void this.enqueue(fn), ms))
  }

  private clearPlayerTimer(playerId: string): void {
    this.playerTimers.get(playerId)?.cancel()
    this.playerTimers.delete(playerId)
  }

  private scheduleClose(): void {
    this.cancelClose()
    this.closeTimer = this.deps.clock.setTimeout(() => void this.enqueue(async () => { if (this.humanCount === 0) await this.close('empty') }), this.deps.options.emptyRoomCloseMs)
  }

  private cancelClose(): void {
    this.closeTimer?.cancel()
    this.closeTimer = null
  }

  private cancelTimers(): void {
    this.cancelClose()
    this.nextHandTimer?.cancel()
    this.nextHandTimer = null
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    for (const t of this.playerTimers.values()) t.cancel()
    this.playerTimers.clear()
    this.runner?.dispose()
    this.chaos?.cancel()
  }
}
