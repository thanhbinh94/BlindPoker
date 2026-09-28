import type { ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The group's accessible name ("Language", "Mode"…). */
  label: string
  disabled?: boolean
  className?: string
}

/**
 * The one control for "pick one of a few": a pill of real buttons, each carrying its own `aria-pressed`. The
 * language switch, the lobby's mode filter, the create form's mode and the theme choice all draw it, so a
 * single choice looks the same wherever it appears (layout audit C1, 2026-09-28 — the theme used to be two
 * loose buttons beside a language pill).
 */
export function Segmented<T extends string>({ options, value, onChange, label, disabled = false, className }: SegmentedProps<T>) {
  return (
    <div className={cx(s.segment, className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={s.segBtn}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
