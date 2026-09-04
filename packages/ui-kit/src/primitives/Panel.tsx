import type { ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export type PanelTone = 'ink' | 'parchment' | 'felt'

export interface PanelProps {
  title?: string
  /** `ink` = night panel, `parchment` = light paper, `felt` = table surface. */
  tone?: PanelTone
  className?: string
  children: ReactNode
}

export function Panel({ title, tone = 'ink', className, children }: PanelProps) {
  return (
    <section className={cx(s.panel, s[tone], className)}>
      {title !== undefined ? <h2 className={s.panelTitle}>{title}</h2> : null}
      <div>{children}</div>
    </section>
  )
}
