import {
  EngineError, blindRequiredStack, blindTableLimit, engineErrorToErrorCode, filterEvent, nextButton, playerView, roomConfigToRuleset,
  type GameEvent, type PlayerAction, type PlayerIdentity, type RoomConfig, type RoomEvent, type RoomPlayerView,
  type RoomSummary, type RoomView, type Ruleset, type SeatStatus, type ServerMessage,
} from '@bp/core'
import type { TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import { InsufficientBalanceError, type BalanceEntry, type HandSummary } from '../repositories.js'
import { HandRunner } from './hand-runner.js'
import { RoomError, type RoomDeps, type RoomPlayer } from './types.js'

export interface RoomInit {
  roomId: string
  code: string
  config: RoomConfig
  host: PlayerIdentity
  deps: RoomDeps
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

  private readonly deps: RoomDeps
  private runner: HandRunner | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private nextHandTimer: TimerHandle | null = null
  private closeTimer: TimerHandle | null = null
  private carryOverReleaseTimer: TimerHandle | null = null
  private readonly playerTimers = new Map<string, TimerHandle>()
  private turnStartSeq = 0
  /**
   * Everyone who has ever been in this room — the host (and the bots) from the start, every joiner after. A
   * player's `ROOM_JOINED` is said once per room (the host's by `RoomManager.create`, everyone else's by their
   * first `join`): "rooms joined" counts rooms, so walking out and back in must not count again, or a player could
   * farm "Mười phòng"/"Trăm phòng" by pressing Leave and rejoining.
   */
  private readonly everJoined = new Set<string>()

  constructor(init: RoomInit) {
    this.roomId = init.roomId
    this.code = init.code
    this.config = init.config
    this.deps = init.deps
    this.rules = roomConfigToRuleset(init.config)
    this.hostPlayerId = init.host.playerId
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
      carryOverPot: this.carryOverPot,
      nextHandAt: this.nextHandAt,
    }
  }

  snapshot(viewerId: string | null): Snapshot {
    const viewer = viewerId === null ? undefined : this.players.get(viewerId)
    const seat = viewer?.seat ?? null
    const hand = this.runner && !this.runner.isComplete ? playerView(this.runner.state, seat) : null
    return { t: 'ROOM_SNAPSHOT', seq: this.seq, room: this.view(), hand, deadlineAt: hand ? this.deadlineAt : null }
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
      return this.removePlayer(p, 'left')
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
      return this.removePlayer(target, 'kicked')
    })
  }

  // ---------- seats ----------

  sitDown(playerId: string, seat: number, buyIn?: number): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      const p = this.mustPlayer(playerId)
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.config.maxPlayers) throw new RoomError('ILLEGAL_ACTION', 'seat out of range')
      if (p.seat !== null) throw new RoomError('ILLEGAL_ACTION', 'already seated')
      if (this.seatPlayer(seat)) throw new RoomError('SEAT_TAKEN')
      // Both modes bring a table stack out of the balance (spec 2026-09-29): Hold'em the buy-in the player chose, Blind
      // the table limit — or the whole balance when that is less, as long as it covers one hand.
      let amount: number
      if (this.rules.mode === 'holdem') {
        const bb = this.rules.bigBlind
        const min = (this.config.holdem?.minBuyInBB ?? 0) * bb
        const max = (this.config.holdem?.maxBuyInBB ?? 0) * bb
        if (buyIn === undefined || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) throw new RoomError('INVALID_AMOUNT', `buy-in must be ${min}–${max}`)
        amount = buyIn
      } else {
        const balance = await this.deps.repos.balances.get(playerId)
        if (balance < blindRequiredStack(this.rules)) throw new RoomError('INSUFFICIENT_BALANCE')
        amount = Math.min(balance, blindTableLimit(this.rules))
      }
      try {
        await this.deps.repos.balances.apply([{ playerId, delta: -amount, reason: 'buy_in', refId: this.roomId }])
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw new RoomError('INSUFFICIENT_BALANCE')
        throw err
      }
      if (this.seatPlayer(seat)) {
        // lost the race while awaiting: refund
        await this.deps.repos.balances.apply([{ playerId, delta: amount, reason: 'refund', refId: this.roomId }])
        throw new RoomError('SEAT_TAKEN')
      }
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
      await this.standUpNow(p)
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
      this.setSittingOut(p, out || p.stack < this.requiredStack())
      // Sitting back in can be the move that completes the table, so it gets the same look autoStart
      // takes when someone readies up — otherwise the room waits for a ready toggle it does not need.
      return out ? undefined : this.maybeAutoStart()
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
    })
  }

  private async onReconnectExpired(playerId: string): Promise<void> {
    const p = this.players.get(playerId)
    if (!p || p.connected) return
    if (p.seat !== null) {
      if (this.inCurrentHand(p)) {
        p.standAfterHand = true
        this.runner!.markAutoFold(p.seat)
      } else await this.standUpNow(p)
    }
    this.setPlayerTimer(playerId, this.deps.options.spectatorGraceMs, () => {
      const still = this.players.get(playerId)
      if (!still || still.connected) return
      if (this.inCurrentHand(still)) {
        still.leaveAfterHand = true
        return
      }
      return this.removePlayer(still, 'timeout')
    })
  }

  // ---------- shutdown / close ----------

  shutdown(reason: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.status === 'CLOSED') return
      if (this.runner && !this.runner.isComplete) {
        this.runner.cancel(reason)
        await this.onHandComplete()
      }
      this.cancelTimers()
      await this.releaseCarryOver()
      for (const p of this.seatedHumans()) await this.standUpNow(p)
      this.status = 'CLOSED'
      this.broadcastRoomEvent({ type: 'ROOM_CLOSED', reason })
      this.onClosed?.(this, reason)
    })
  }

  private async close(reason: string): Promise<void> {
    if (this.status === 'CLOSED') return
    if (this.runner && !this.runner.isComplete) {
      this.runner.cancel(reason)
      await this.onHandComplete()
    }
    this.cancelTimers()
    await this.releaseCarryOver()
    this.status = 'CLOSED'
    this.onClosed?.(this, reason)
  }

  /**
   * Spec §8.4. Returns a carry-over pot to the table: an equal share to every seated human, with
   * the indivisible remainder (or the whole pot when nobody is seated) recorded as a `carry_over`
   * sink so `Σ balances + Σ sinks` stays constant. Called from the release timer, `close()` and
   * `shutdown()`; always runs on the room queue.
   */
  private async releaseCarryOver(): Promise<void> {
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    const pot = this.carryOverPot
    if (pot <= 0) return
    const humans = this.seatedHumans()
    const share = humans.length === 0 ? 0 : Math.floor(pot / humans.length)
    const remainder = pot - share * humans.length
    const entries: BalanceEntry[] = share > 0
      ? humans.map((p) => ({ playerId: p.identity.playerId, delta: share, reason: 'refund' as const, refId: this.roomId }))
      : []
    this.carryOverPot = 0
    try {
      await this.deps.repos.balances.apply(entries, { refId: this.roomId, fee: remainder, kind: 'carry_over' })
    } catch (err) {
      this.carryOverPot = pot // nothing was written: keep the pot so a later attempt can release it
      this.deps.log.error('carry-over release failed', { roomId: this.roomId, pot, err: String(err) })
      return
    }
    this.deps.log.info('carry-over released', { roomId: this.roomId, pot, recipients: humans.length, sink: remainder })
    for (const p of humans) await this.pushBalance(p.identity.playerId)
    // status is unchanged; the event exists so every view refreshes `carryOverPot`.
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: this.status === 'IN_GAME' ? 'IN_GAME' : 'OPEN', nextHandAt: this.nextHandAt })
  }

  private armCarryOverRelease(): void {
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    if (this.carryOverPot <= 0 || this.status === 'CLOSED') return
    this.carryOverReleaseTimer = this.deps.clock.setTimeout(() => void this.enqueue(() => this.releaseCarryOver()), this.deps.options.carryOverReleaseMs)
  }

  // ---------- hand lifecycle ----------

  /** Deals the next hand if the table can play one; `false` when it cannot (too few eligible seats, or only bots). */
  private async startHand(): Promise<boolean> {
    if (this.status === 'CLOSED' || (this.runner && !this.runner.isComplete)) return false
    this.nextHandTimer?.cancel()
    this.nextHandTimer = null
    this.carryOverReleaseTimer?.cancel()
    this.carryOverReleaseTimer = null
    const required = this.requiredStack()
    if (this.rules.mode === 'blind') {
      // Humans play from the stack they brought; only bots are topped up — back to the limit, never the ledger.
      const limit = blindTableLimit(this.rules)
      for (const p of this.seated()) if (p.identity.isBot && p.stack < required) p.stack = limit
    }
    // A seated human who cannot cover the requirement sits the hand out rather than silently
    // vanishing from the table: playerView reports SITTING_OUT. Since the table limit (spec 2026-09-29)
    // such a seat only exists when its stand-up in `onHandComplete` could not write, and it is retried
    // when this hand ends. A player who *asked* to sit out stays out whatever their stack says.
    for (const p of this.seated()) if (!p.identity.isBot) this.setSittingOut(p, p.sitOutRequested || p.stack < required)
    const eligible = this.eligibleForHand()
    if (eligible.length < 2 || eligible.every((p) => p.identity.isBot)) {
      this.toOpen()
      return false
    }
    // This hand is going ahead without them, so every voluntary sitter has been skipped once more.
    // Spec §11.3: after `handsSatOutToStand` in a row the seat goes back to the table, stack returned,
    // down the same path as the timeout stand-up — nobody parks on a seat they are not using.
    // A stand-up writes to the ledger; a ledger blip must not take the starting hand down with it, so the
    // whole sweep is guarded the way `onHandComplete`'s settlement is. A missed stand-up retries next hand.
    try {
      for (const p of this.seated()) {
        if (p.identity.isBot || !p.sitOutRequested) continue
        p.handsSatOut += 1
        if (p.handsSatOut >= this.deps.options.handsSatOutToStand) await this.standUpNow(p)
      }
    } catch (err) {
      this.deps.log.error('sit-out stand-up failed', { roomId: this.roomId, err: String(err) })
    }
    const seats = eligible.map((p) => p.seat!)
    this.button = nextButton(this.button, seats, this.deps.rng)
    const handId = newId()
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
      { handId, rules: this.rules, seats: eligible.map((p) => ({ seat: p.seat!, playerId: p.identity.playerId, stack: p.stack, isBot: p.identity.isBot })), button: this.button, carryOverIn: this.carryOverPot },
    )
    this.runner = runner
    this.carryOverPot = 0
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
        if (p && !p.identity.isBot) p.consecutiveTimeouts = event.timedOut ? p.consecutiveTimeouts + 1 : 0
      }
      this.seq += 1
      const isTurn = event.type === 'TURN_CHANGED' || event.type === 'DECISION_PHASE'
      if (isTurn) this.turnStartSeq = this.seq
      const outbound = isTurn && deadlineAt !== null ? { ...event, deadlineAt } : event
      for (const p of this.connectedHumans()) this.deps.outbox.send(p.identity.playerId, { t: 'GAME_EVENT', seq: this.seq, event: filterEvent(outbound, p.seat) })
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

    const required = this.requiredStack()
    for (const p of [...this.players.values()]) {
      // One player's ledger failure must not take the next deal down with it: logged, and retried after the next hand
      // (a short seat sits that hand out in `startHand`).
      try {
        if (!p.identity.isBot && p.consecutiveTimeouts >= this.deps.options.consecutiveTimeoutsToStand) {
          p.standAfterHand = true
          p.consecutiveTimeouts = 0
        }
        if (p.leaveAfterHand) await this.removePlayer(p, 'left')
        else if (p.standAfterHand) await this.standUpNow(p)
        else if (p.seat !== null && !p.identity.isBot && p.stack < required) await this.standUpSpent(p)
      } catch (err) {
        this.deps.log.error('stand-up after hand failed', { roomId: this.roomId, playerId: p.identity.playerId, err: String(err) })
      }
    }
    if (this.status === 'CLOSED') return
    this.nextHandAt = this.deps.clock.now() + this.deps.options.handIntervalMs
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: this.nextHandAt })
    this.nextHandTimer = this.deps.clock.setTimeout(() => void this.enqueue(() => this.startHand()), this.deps.options.handIntervalMs)
  }

  private toOpen(): void {
    this.status = 'OPEN'
    this.nextHandAt = null
    for (const p of this.players.values()) if (!p.identity.isBot) p.ready = false
    this.broadcastRoomEvent({ type: 'ROOM_STATUS', status: 'OPEN', nextHandAt: null })
    this.armCarryOverRelease()
    this.changed()
  }

  // ---------- helpers ----------

  private addPlayer(identity: PlayerIdentity): RoomPlayer {
    const p: RoomPlayer = {
      identity, seat: null, stack: 0, ready: false, connected: true, joinedAt: this.deps.clock.now(), sittingOut: false,
      sitOutRequested: false, handsSatOut: 0,
      consecutiveTimeouts: 0, disconnectDeadline: null, standAfterHand: false, leaveAfterHand: false,
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

  private requiredStack(): number {
    return this.rules.mode === 'blind' ? blindRequiredStack(this.rules) : 1
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

  private inCurrentHand(p: RoomPlayer): boolean {
    return p.seat !== null && this.runner !== null && !this.runner.isComplete && this.runner.state.players.some((hp) => hp.seat === p.seat)
  }

  private eligibleForHand(): RoomPlayer[] {
    const required = this.requiredStack()
    return this.seated().filter((p) => !p.sittingOut && !p.standAfterHand && !p.leaveAfterHand && p.stack >= required && (p.identity.isBot || this.status !== 'OPEN' || p.ready))
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
    return view
  }

  /**
   * Spec 2026-09-29 (table limit): a seat whose stack can no longer cover a hand goes back to the rail when the hand
   * ends — whatever is left goes home — and a Blind player is told why, so the empty seat reads as "your limit is
   * spent, sit again" rather than a glitch. Hold'em's busted seat (stack 0) takes the same path without the notice.
   */
  private async standUpSpent(p: RoomPlayer): Promise<void> {
    const returned = p.stack
    await this.standUpNow(p)
    if (this.rules.mode === 'blind' && p.connected) {
      this.deps.outbox.send(p.identity.playerId, {
        t: 'NOTIFICATION',
        kind: 'TABLE_LIMIT_SPENT',
        payload: { roomId: this.roomId, limit: blindTableLimit(this.rules), amount: returned },
      })
    }
  }

  private async standUpNow(p: RoomPlayer): Promise<void> {
    if (p.seat === null) return
    const seat = p.seat
    if (!p.identity.isBot && p.stack > 0) {
      await this.deps.repos.balances.apply([{ playerId: p.identity.playerId, delta: p.stack, reason: 'cash_out', refId: this.roomId }])
      await this.pushBalance(p.identity.playerId)
    }
    p.seat = null
    p.stack = 0
    p.ready = false
    p.standAfterHand = false
    p.sittingOut = false
    p.sitOutRequested = false
    p.handsSatOut = 0
    p.consecutiveTimeouts = 0
    this.broadcastRoomEvent({ type: 'PLAYER_STOOD', playerId: p.identity.playerId, seat })
    this.changed()
  }

  private async removePlayer(p: RoomPlayer, reason: string): Promise<void> {
    await this.standUpNow(p)
    // Said while the player is still on the list, so a connected player hears their own departure too. Without it
    // a player removed later than they asked — a Leave pressed mid-hand, then a reconnect that put them back on
    // the room screen before the hand ended — was dropped in silence and left looking at a frozen table.
    this.broadcastRoomEvent({ type: 'PLAYER_LEFT', playerId: p.identity.playerId })
    this.players.delete(p.identity.playerId)
    this.onMembership?.(p.identity.playerId, false)
    this.clearPlayerTimer(p.identity.playerId)
    if (p.identity.playerId === this.hostPlayerId) this.transferHost()
    if (this.humanCount === 0) this.scheduleClose()
    this.deps.log.info('player left room', { roomId: this.roomId, playerId: p.identity.playerId, reason })
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
  }
}
