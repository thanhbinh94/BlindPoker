import type { Clock, TimerHandle } from '../infra/clock.js'

interface Scheduled {
  at: number
  fn: () => void
  id: number
}

/** Deterministic clock for tests: time only moves when `advance()` is called; due timers fire in order. */
export class ManualClock implements Clock {
  t = 1_000_000
  private timers: Scheduled[] = []
  private nextId = 0

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer: Scheduled = { at: this.t + ms, fn, id: this.nextId++ }
    this.timers.push(timer)
    return { cancel: () => { this.timers = this.timers.filter((x) => x !== timer) } }
  }

  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x !== due)
      this.t = due.at
      due.fn()
    }
    this.t = target
  }

  get pending(): number {
    return this.timers.length
  }
}
