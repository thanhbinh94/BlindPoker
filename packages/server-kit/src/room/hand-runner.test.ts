import { createBotStrategy, seededRng, type BlindRules, type ChaosHandPlan, type GameEvent, type HoldemRules } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../infra/logger.js'
import { ManualClock } from '../testing/manual-clock.js'
import { HandRunner, type HandRunnerDeps } from './hand-runner.js'

const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
const BLIND_B: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }

function setup(rules: HoldemRules | BlindRules, seats: { seat: number; stack: number; isBot: boolean }[], over: Partial<HandRunnerDeps> = {}, chaos?: ChaosHandPlan) {
  const clock = new ManualClock()
  const batches: { events: GameEvent[]; deadlineAt: number | null }[] = []
  let completed = 0
  const deps: HandRunnerDeps = {
    clock,
    rng: seededRng(5),
    bot: createBotStrategy(),
    log: silentLogger,
    turnTimerMs: 30_000,
    revealDelayMs: 1_500,
    botDelayMs: [1_000, 1_000],
    isBotSeat: (seat) => seats.find((s) => s.seat === seat)?.isBot ?? false,
    enqueue: (fn) => fn(),
    onEvents: (events, deadlineAt) => batches.push({ events, deadlineAt }),
    onComplete: () => completed++,
    ...over,
  }
  const runner = new HandRunner(deps, { handId: 'h1', rules, seats: seats.map((s) => ({ ...s, playerId: `p${s.seat}` })), button: 0, carryOverIn: 0, ...(chaos ? { chaos } : {}) })
  runner.start()
  const all = () => batches.flatMap((b) => b.events)
  return { clock, runner, batches, all, completed: () => completed }
}

describe('HandRunner — hold’em', () => {
  it('emits creation events with a turn deadline and schedules one turn timer', () => {
    const { clock, runner, batches } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.events.map((e) => e.type)).toContain('TURN_CHANGED')
    expect(batches[0]!.deadlineAt).toBe(clock.now() + 30_000)
    expect(clock.pending).toBe(1)
    expect(runner.state.actingSeat).toBe(0) // heads-up: button acts first preflop
  })

  it('times out the acting seat and ignores a stale timer after the turn moved on', () => {
    const { clock, runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    runner.submit({ type: 'ACTION', seat: 0, action: { kind: 'call' } }) // turn moves to seat 1, old timer cancelled
    expect(clock.pending).toBe(1)
    clock.advance(30_000)
    const acted = all().filter((e) => e.type === 'PLAYER_ACTED')
    expect(acted.at(-1)).toMatchObject({ seat: 1, action: { kind: 'check' }, timedOut: true })
    expect(runner.state.street).toBe('FLOP')
  })

  it('lets a bot act after its think delay and finishes a hand against a passive human', () => {
    const { clock, runner, all, completed } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: true }])
    let guard = 0
    while (!runner.isComplete && guard++ < 50) {
      const s = runner.state
      if (s.phase === 'BETTING' && s.actingSeat === 0) {
        const legal = all().filter((e): e is Extract<GameEvent, { type: 'TURN_CHANGED' }> => e.type === 'TURN_CHANGED').at(-1)!.legal
        runner.submit({ type: 'ACTION', seat: 0, action: { kind: legal.kinds.includes('check') ? 'check' : 'call' } })
      } else {
        clock.advance(1_500) // bot delay or reveal pacing
      }
    }
    expect(runner.isComplete).toBe(true)
    expect(completed()).toBe(1)
    expect(all().at(-1)!.type).toBe('HAND_COMPLETE')
    expect(clock.pending).toBe(0)
    expect(() => runner.submit({ type: 'ADVANCE' })).toThrow(/HAND_COMPLETE/)
  })

  it('auto-folds a marked seat immediately when it is its turn, and later when its turn comes', () => {
    const { runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }, { seat: 2, stack: 1000, isBot: false }])
    expect(runner.state.actingSeat).toBe(0)
    runner.markAutoFold(2) // not its turn yet
    runner.markAutoFold(0) // acting now → folds immediately
    expect(runner.state.players[0]!.folded).toBe(true)
    expect(runner.state.actingSeat).toBe(1)
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'call' } }) // seat 2 would act next → auto-fold → seat 1 wins
    expect(runner.state.players[2]!.folded).toBe(true)
    expect(runner.isComplete).toBe(true)
    expect(all().some((e) => e.type === 'SETTLEMENT')).toBe(true)
  })

  it('cancel refunds and clears timers', () => {
    const { clock, runner, all } = setup(HOLDEM, [{ seat: 0, stack: 1000, isBot: false }, { seat: 1, stack: 1000, isBot: false }])
    const events = runner.cancel('shutdown')
    expect(events.map((e) => e.type)).toEqual(['HAND_CANCELLED', 'HAND_COMPLETE'])
    expect(runner.state.players.every((p) => p.stack === 1000)).toBe(true)
    expect(clock.pending).toBe(0)
    expect(all().at(-1)!.type).toBe('HAND_COMPLETE')
  })
})

describe('HandRunner — blind mode B', () => {
  it('schedules bot decisions, times out the undecided human, reveals with pacing and completes', () => {
    const { clock, runner, all, completed } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: true }, { seat: 2, stack: 20000, isBot: true }], { turnTimerMs: 15_000 })
    expect(runner.state.phase).toBe('DECISION')
    expect(clock.pending).toBe(3) // decision timer + 2 bot timers
    clock.advance(1_000)
    expect(all().filter((e) => e.type === 'DECISION_MADE')).toHaveLength(2)
    expect(runner.state.phase).toBe('DECISION')
    clock.advance(14_000) // decision deadline → human folds
    expect(all().some((e) => e.type === 'DECISIONS_REVEALED')).toBe(true)
    while (!runner.isComplete) clock.advance(1_500)
    expect(completed()).toBe(1)
    expect(clock.pending).toBe(0)
  })

  it('a seat the ante emptied is never scheduled as a bot and never timed out', () => {
    // Seat 1 (a bot) and seat 2 (a human) hold less than the 1.000 ante: both are played all in on the spot (D1).
    const { clock, runner, all } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 600, isBot: true }, { seat: 2, stack: 400, isBot: false }], { turnTimerMs: 15_000 })
    expect(runner.state.phase).toBe('DECISION')
    expect(clock.pending).toBe(1) // the decision timer alone: no bot timer for the emptied bot
    expect(all().filter((e) => e.type === 'DECISION_MADE').map((e) => e.type === 'DECISION_MADE' && e.seat)).toEqual([1, 2])
    clock.advance(15_000) // the deadline times out the one seat still undecided, and only it
    const acted = all().filter((e): e is Extract<GameEvent, { type: 'PLAYER_ACTED' }> => e.type === 'PLAYER_ACTED')
    expect(acted.map((e) => [e.seat, e.action.kind, e.timedOut])).toEqual([[0, 'fold', true], [1, 'play', false], [2, 'play', false]])
    while (!runner.isComplete) clock.advance(1_500)
    expect(clock.pending).toBe(0)
  })

  it('auto-fold applies during DECISION', () => {
    const { runner } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: false }])
    runner.markAutoFold(0)
    expect(runner.state.players[0]!.decision).toBe('fold')
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'play' } })
    expect(runner.isComplete).toBe(true) // one player plays → wins immediately
  })

  describe('BP-41 A2: a hand nobody may fold (Cấm bỏ bài, a Thần)', () => {
    const noFold = (seats: number[]): ChaosHandPlan => ({
      seats: seats.map((seat) => ({ seat, effects: [], shield: null, blindfolded: false })), reverse: false, noFoldSeats: seats,
    })

    it('a seat that left still folds (FORFEIT); the timer plays the seats still there', () => {
      const { clock, runner, all } = setup(BLIND_B, [0, 1, 2].map((seat) => ({ seat, stack: 20000, isBot: false })), { turnTimerMs: 15_000 }, noFold([0, 1, 2]))
      runner.markAutoFold(1)
      expect(runner.state.players[1]!.decision).toBe('fold')
      clock.advance(15_000)
      const acted = all().filter((e): e is Extract<GameEvent, { type: 'PLAYER_ACTED' }> => e.type === 'PLAYER_ACTED')
      expect(acted.map((e) => [e.seat, e.action.kind, e.timedOut])).toEqual([[0, 'play', true], [1, 'fold', false], [2, 'play', true]])
      while (!runner.isComplete) clock.advance(1_500)
    })

    it('a bot plays and the hand completes', () => {
      const { clock, runner, all } = setup(BLIND_B, [0, 1, 2].map((seat) => ({ seat, stack: 20000, isBot: true })), {}, noFold([0, 1, 2]))
      clock.advance(1_000)
      const revealed = all().find((e): e is Extract<GameEvent, { type: 'DECISIONS_REVEALED' }> => e.type === 'DECISIONS_REVEALED')!
      expect(revealed.decisions.map((d) => d.decision)).toEqual(['play', 'play', 'play'])
      while (!runner.isComplete) clock.advance(1_500)
    })

    it('a bot whose strategy throws falls back to "play", the only safe choice it has', () => {
      const bot = { decide: () => { throw new Error('boom') } }
      const { clock, all } = setup(BLIND_B, [0, 1].map((seat) => ({ seat, stack: 20000, isBot: true })), { bot }, noFold([0, 1]))
      clock.advance(1_000)
      const revealed = all().find((e): e is Extract<GameEvent, { type: 'DECISIONS_REVEALED' }> => e.type === 'DECISIONS_REVEALED')!
      expect(revealed.decisions.map((d) => d.decision)).toEqual(['play', 'play'])
    })
  })

  it('a stale decision timer is ignored once the phase resolved', () => {
    const { clock, runner, all } = setup(BLIND_B, [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: false }], { turnTimerMs: 15_000 })
    runner.submit({ type: 'ACTION', seat: 0, action: { kind: 'fold' } })
    runner.submit({ type: 'ACTION', seat: 1, action: { kind: 'fold' } }) // all fold → carry over → COMPLETE
    expect(runner.isComplete).toBe(true)
    const before = all().length
    clock.advance(20_000)
    expect(all().length).toBe(before)
  })
})

describe('HandRunner — squeeze round', () => {
  const SQUEEZE: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0.02, squeeze: true }
  const seats = [{ seat: 0, stack: 20000, isBot: false }, { seat: 1, stack: 20000, isBot: false }, { seat: 2, stack: 20000, isBot: true }]

  it('arms one table-wide deadline and no bot timer, and a seat turning its cards leaves it alone', () => {
    const { clock, runner, batches } = setup(SQUEEZE, seats, { turnTimerMs: 20_000 })
    const deadlineAt = clock.now() + 20_000
    expect(batches[0]!.events.map((e) => e.type)).toContain('SQUEEZE_PHASE')
    expect(batches[0]!.deadlineAt).toBe(deadlineAt)
    expect(clock.pending).toBe(1)
    clock.advance(5_000)
    runner.submit({ type: 'REVEALED', seat: 0 })
    expect(clock.pending).toBe(1)
    expect(batches.at(-1)).toEqual({ events: [{ type: 'PLAYER_REVEALED', seat: 0 }], deadlineAt })
  })

  it('turns exactly the seats that have not turned when the deadline passes, and goes on to the reveal', () => {
    const { clock, runner, all } = setup(SQUEEZE, seats, { turnTimerMs: 20_000 })
    runner.submit({ type: 'REVEALED', seat: 0 })
    clock.advance(20_000)
    expect(all().filter((e) => e.type === 'PLAYER_REVEALED')).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }, { type: 'PLAYER_REVEALED', seat: 1 }])
    expect(all().filter((e) => e.type === 'SQUEEZE_ENDED')).toHaveLength(1)
    expect(runner.state.phase).toBe('REVEAL')
    expect(all().some((e) => e.type === 'PLAYER_ACTED')).toBe(false) // nobody was timed out
    expect(clock.pending).toBe(1) // the squeeze timer is gone; the reveal pacing is armed
  })

  it('a squeeze timer that fires after the hand was cancelled does nothing', () => {
    const queue: (() => void)[] = []
    const { clock, runner, all } = setup(SQUEEZE, seats, { turnTimerMs: 20_000, enqueue: (fn) => queue.push(fn) })
    clock.advance(20_000) // the timer fires; its work waits on the room's queue
    expect(queue).toHaveLength(1)
    runner.cancel('closed')
    const before = all().length
    expect(() => queue[0]!()).not.toThrow()
    expect(all().length).toBe(before)
  })

  it('a seat marked auto-fold is turned for, so the round does not wait on it', () => {
    const { runner, all } = setup(SQUEEZE, seats)
    runner.markAutoFold(1)
    expect(all().filter((e) => e.type === 'PLAYER_REVEALED')).toEqual([{ type: 'PLAYER_REVEALED', seat: 1 }])
    expect(runner.state.phase).toBe('SQUEEZE')
    runner.submit({ type: 'REVEALED', seat: 0 })
    expect(runner.state.phase).toBe('REVEAL')
    expect(all().filter((e) => e.type === 'SQUEEZE_ENDED')).toHaveLength(1)
  })
})
