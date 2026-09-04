import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (deadlineAt === null) return
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS)
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
