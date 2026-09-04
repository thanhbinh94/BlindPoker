export interface TimerHandle {
  cancel(): void
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): TimerHandle
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms)
    return { cancel: () => clearTimeout(t) }
  },
}
