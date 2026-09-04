import { cloneElement, useId } from 'react'
import type { ReactElement } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export interface FieldProps {
  label: string
  hint?: string
  error?: string
  /** Supply when the control already owns an id; otherwise one is generated. */
  id?: string
  children: ReactElement
}

/** Wires a visible label, hint and error onto its single control child. */
export function Field({ label, hint, error, id, children }: FieldProps) {
  const generated = useId()
  const controlId = id ?? generated
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy = cx(hint !== undefined && hintId, error !== undefined && errorId)
  const control = cloneElement(children as ReactElement<Record<string, unknown>>, {
    id: controlId,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': error !== undefined ? true : undefined,
  })
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={controlId}>
        {label}
      </label>
      {control}
      {hint !== undefined ? (
        <span className={s.hint} id={hintId}>
          {hint}
        </span>
      ) : null}
      {error !== undefined ? (
        <span className={s.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
