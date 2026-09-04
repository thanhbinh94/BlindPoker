import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

export interface TurnTimerProps {
  /** Server-clock deadline; `null` hides the timer entirely. */
  deadlineAt: number | null
  /** `Date.now()` corrected by the client's `serverTimeOffset`. */
  serverNow: () => number
  totalMs: number
  size?: number
}

const TICK_MS = 250

/**
 * Conic-gradient countdown ring. The only timer in the kit: a 250 ms interval re-renders the seconds text and the
 * ring's `--pct`, so nothing animates on a JS frame loop.
 */
export function TurnTimer({ deadlineAt, serverNow, totalMs, size = 44 }: TurnTimerProps) {
  const [, setTick] = useState(0)
  // `serverNow` is a fresh closure on every render of the room; reading it through a ref keeps the schedule keyed
  // on the deadline alone.
  const nowRef = useRef(serverNow)
  nowRef.current = serverNow

  useEffect(() => {
    // Nothing left to count: a ring frozen at zero does not need four re-renders a second until the seat is
    // cleared, and a timed-out seat can sit there for a while.
    if (deadlineAt === null || deadlineAt - nowRef.current() <= 0) return
    const id = setInterval(() => {
      setTick((n) => n + 1)
      if (deadlineAt - nowRef.current() <= 0) clearInterval(id)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [deadlineAt])

  if (deadlineAt === null) return null

  const remaining = Math.max(0, deadlineAt - serverNow())
  const seconds = Math.ceil(remaining / 1000)
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remaining / totalMs)) : 0
  const style = { '--pct': `${(fraction * 100).toFixed(2)}%`, '--ring': `${size}px` } as CSSProperties

  return (
    <span className={cx(s.timer, remaining <= 5000 && s.timerUrgent)} role="timer" aria-live="off" style={style}>
      <span className={s.timerText}>{seconds}</span>
    </span>
  )
}
