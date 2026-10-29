import {
  EngineError, applyCommand, createHand, legalActions, playerView,
  type BotStrategy, type CreateHandInput, type GameEvent, type HandCommand, type HandState, type PlayerAction, type Rng,
} from '@bp/core'
import type { Clock, TimerHandle } from '../infra/clock.js'
import type { Logger } from '../infra/logger.js'

export interface HandRunnerDeps {
  clock: Clock
  rng: Rng
  bot: BotStrategy
  log: Logger
  turnTimerMs: number
  revealDelayMs: number
  botDelayMs: [number, number]
  isBotSeat: (seat: number) => boolean
  /** Runs `fn` on the owning room's serialized queue (timer callbacks must never touch state directly). */
  enqueue: (fn: () => void) => void
  onEvents: (events: GameEvent[], deadlineAt: number | null) => void
  onComplete: () => void
}

/** Drives one hand of `@bp/core` inside a room: timers, reveal pacing, bot turns, auto-folds. */
export class HandRunner {
  private current: HandState
  private readonly initialEvents: GameEvent[]
  readonly startedAt: number
  readonly stacksBefore: ReadonlyMap<number, number>
  private timers: TimerHandle[] = []
  private readonly autoFold = new Set<number>()
  private completed = false
  /**
   * `turnSeq` of the DECISION or SQUEEZE round the current round/bot timers were scheduled for, or `null` when not
   * in one. DECISION_MADE and PLAYER_REVEALED do not bump `turnSeq`, so several players can decide (or turn their
   * cards) independently without disturbing each other's still-pending timers (or the shared deadline) — only a real
   * phase/round change should cancel and reschedule them.
   */
  private decisionScheduledTurnSeq: number | null = null
  private currentDeadlineAt: number | null = null
  private cancelled = false

  constructor(
    private readonly deps: HandRunnerDeps,
    input: CreateHandInput,
  ) {
    const r = createHand(input, deps.rng)
    this.current = r.state
    this.initialEvents = r.events
    this.startedAt = deps.clock.now()
    this.stacksBefore = new Map(input.seats.map((s) => [s.seat, s.stack]))
  }

  get state(): HandState {
    return this.current
  }

  get isComplete(): boolean {
    return this.completed
  }

  get wasCancelled(): boolean {
    return this.cancelled
  }

  start(): void {
    this.afterCommand(this.initialEvents)
  }

  submit(cmd: HandCommand): GameEvent[] {
    if (this.completed) throw new EngineError('HAND_COMPLETE')
    const r = applyCommand(this.current, cmd, this.deps.rng)
    this.current = r.state
    this.afterCommand(r.events)
    return r.events
  }

  markAutoFold(seat: number): void {
    this.autoFold.add(seat)
    this.applyAutoFolds()
  }

  cancel(reason: string): GameEvent[] {
    this.cancelled = true
    return this.submit({ type: 'CANCEL', reason })
  }

  dispose(): void {
    for (const t of this.timers) t.cancel()
    this.timers = []
  }

  private afterCommand(events: GameEvent[]): void {
    const s = this.current
    if (s.phase === 'COMPLETE') {
      this.dispose()
      this.completed = true
      this.deps.onEvents(events, null)
      this.deps.onComplete()
      return
    }
    // A DECISION_MADE or PLAYER_REVEALED from one seat doesn't bump turnSeq and doesn't need to disturb the shared
    // deadline or the other seats' still-pending bot timers — only reschedule on an actual round change.
    if ((s.phase === 'DECISION' || s.phase === 'SQUEEZE') && this.decisionScheduledTurnSeq === s.turnSeq) {
      this.deps.onEvents(events, this.currentDeadlineAt)
      this.applyAutoFolds()
      return
    }
    this.dispose()
    let deadlineAt: number | null = null
    if (s.phase === 'BETTING' && s.actingSeat !== null) {
      const seat = s.actingSeat
      const turnSeq = s.turnSeq
      this.decisionScheduledTurnSeq = null
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onTurnTimeout(seat, turnSeq))
      if (this.deps.isBotSeat(seat)) this.scheduleBot(seat, turnSeq)
    } else if (s.phase === 'DECISION') {
      const turnSeq = s.turnSeq
      this.decisionScheduledTurnSeq = turnSeq
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onDecisionTimeout(turnSeq))
      for (const p of s.players) if (p.decision === null && this.deps.isBotSeat(p.seat)) this.scheduleBot(p.seat, turnSeq)
    } else if (s.phase === 'SQUEEZE') {
      // Squeeze mode (spec 2026-10-08 §4.2.3): one table-wide deadline; bots are revealed from the deal, so no bot timer.
      const turnSeq = s.turnSeq
      this.decisionScheduledTurnSeq = turnSeq
      deadlineAt = this.deps.clock.now() + this.deps.turnTimerMs
      this.schedule(this.deps.turnTimerMs, () => this.onSqueezeTimeout(turnSeq))
    } else if (s.phase === 'REVEAL') {
      this.decisionScheduledTurnSeq = null
      this.schedule(this.deps.revealDelayMs, () => {
        if (!this.completed && this.current.phase === 'REVEAL') this.submit({ type: 'ADVANCE' })
      })
    }
    this.currentDeadlineAt = deadlineAt
    this.deps.onEvents(events, deadlineAt)
    this.applyAutoFolds()
  }

  private schedule(ms: number, fn: () => void): void {
    this.timers.push(this.deps.clock.setTimeout(() => this.deps.enqueue(fn), ms))
  }

  private scheduleBot(seat: number, turnSeq: number): void {
    const [min, max] = this.deps.botDelayMs
    const delay = min + this.deps.rng.int(Math.max(1, max - min + 1))
    this.schedule(delay, () => this.botAct(seat, turnSeq))
  }

  private applyAutoFolds(): void {
    for (;;) {
      if (this.completed) return
      const s = this.current
      let seat: number | null = null
      if (s.phase === 'BETTING' && s.actingSeat !== null && this.autoFold.has(s.actingSeat)) seat = s.actingSeat
      else if (s.phase === 'DECISION') seat = s.players.find((p) => p.decision === null && this.autoFold.has(p.seat))?.seat ?? null
      else if (s.phase === 'SQUEEZE') seat = s.players.find((p) => !p.revealed && this.autoFold.has(p.seat))?.seat ?? null
      if (seat === null) return
      // A seat that left or stood up has nobody to turn its cards, so the squeeze round must not wait for it (§6). It
      // forfeits rather than folds (BP-41 A2): a no-fold hand refuses a `fold`, never a `FORFEIT`. Ruling 14: at a
      // play-or-fold decision where the seat may not fold (Cấm bỏ bài, a Thần), it plays instead, as a timeout does —
      // spec G11 "luôn có người đối đầu" — so leaving is no way out of the rule.
      const kinds = s.phase === 'DECISION' ? legalActions(s, seat).kinds : []
      const noFold = kinds.includes('play') && !kinds.includes('fold')
      this.submit(s.phase === 'SQUEEZE' ? { type: 'REVEALED', seat } : noFold ? { type: 'ACTION', seat, action: { kind: 'play' } } : { type: 'FORFEIT', seat })
    }
  }

  private onTurnTimeout(seat: number, turnSeq: number): void {
    const s = this.current
    if (this.completed || s.phase !== 'BETTING' || s.actingSeat !== seat || s.turnSeq !== turnSeq) return
    this.submit({ type: 'TIMEOUT', seat })
  }

  private onDecisionTimeout(turnSeq: number): void {
    if (this.completed || this.current.phase !== 'DECISION' || this.current.turnSeq !== turnSeq) return
    const undecided = this.current.players.filter((p) => p.decision === null).map((p) => p.seat)
    for (const seat of undecided) {
      if (this.completed || this.current.phase !== 'DECISION') return
      this.submit({ type: 'TIMEOUT', seat })
    }
  }

  /** The squeeze round ran out: the server turns whoever has not (§4.2.3). Not a timeout — no seat is charged one. */
  private onSqueezeTimeout(turnSeq: number): void {
    if (this.completed || this.current.phase !== 'SQUEEZE' || this.current.turnSeq !== turnSeq) return
    for (const seat of this.current.players.filter((p) => !p.revealed).map((p) => p.seat)) {
      if (this.completed || this.current.phase !== 'SQUEEZE') return
      this.submit({ type: 'REVEALED', seat })
    }
  }

  private botAct(seat: number, turnSeq: number): void {
    const s = this.current
    if (this.completed || s.turnSeq !== turnSeq) return
    if (s.phase === 'BETTING' && s.actingSeat !== seat) return
    if (s.phase === 'DECISION' && s.players.find((p) => p.seat === seat)?.decision !== null) return
    if (s.phase !== 'BETTING' && s.phase !== 'DECISION') return
    const legal = legalActions(s, seat)
    if (legal.kinds.length === 0) return
    // BP-41 A2: a bot that may not fold plays (as "Tự động chơi" does) — the only safe choice it was offered.
    const safe: PlayerAction = { kind: legal.kinds.includes('check') ? 'check' : legal.kinds.includes('fold') ? 'fold' : 'play' }
    let action: PlayerAction
    try {
      action = this.deps.bot.decide(playerView(s, seat), legal, this.deps.rng)
    } catch (err) {
      this.deps.log.error('bot.decide threw; using safe action', { seat, err: String(err) })
      action = safe
    }
    try {
      this.submit({ type: 'ACTION', seat, action })
    } catch (err) {
      if (!(err instanceof EngineError)) throw err
      this.deps.log.warn('bot action rejected; using safe action', { seat, action, code: err.code })
      this.submit({ type: 'ACTION', seat, action: safe })
    }
  }
}
