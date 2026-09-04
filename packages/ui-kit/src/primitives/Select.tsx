import type { ChangeEvent, SelectHTMLAttributes } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
}

export interface SelectProps<T extends string | number>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> {
  value: T
  options: SelectOption<T>[]
  onChange(v: T): void
}

/** Native `<select>` that hands back the option's own (typed) value. */
export function Select<T extends string | number>({ value, options, onChange, className, ...rest }: SelectProps<T>) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const picked = options.find((option) => String(option.value) === event.target.value)
    if (picked !== undefined) onChange(picked.value)
  }
  return (
    <span className={s.selectWrap}>
      <select className={cx(s.select, className)} value={String(value)} onChange={handleChange} {...rest}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}
