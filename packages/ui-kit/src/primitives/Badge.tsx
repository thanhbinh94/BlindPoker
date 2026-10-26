import type { ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export type BadgeTone = 'gold' | 'red' | 'muted' | 'teal' | 'chaos'

export interface BadgeProps {
  /** `gold` = money/turn, `red` = danger/host, `teal` = calm state, `muted` = idle, `chaos` = a Poker hỗn loạn table. */
  tone: BadgeTone
  children: ReactNode
  /** An extra class for a place the badge is laid out in (the room header's squeeze badge). */
  className?: string
}

export function Badge({ tone, children, className }: BadgeProps) {
  return <span className={cx(s.badge, s[tone], className)}>{children}</span>
}
