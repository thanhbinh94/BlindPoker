import type { ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export type BadgeTone = 'gold' | 'red' | 'muted' | 'teal'

export interface BadgeProps {
  /** `gold` = money/turn, `red` = danger/host, `teal` = calm state, `muted` = idle. */
  tone: BadgeTone
  children: ReactNode
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={cx(s.badge, s[tone])}>{children}</span>
}
