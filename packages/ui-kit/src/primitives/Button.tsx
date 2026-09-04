import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export type ButtonVariant = 'primary' | 'gold' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `gold` = money moves, `danger` = fold/leave/kick, `ghost` = quiet. */
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.btn, s[variant], s[size], className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={s.spinner} aria-hidden="true" /> : null}
      {!loading && icon !== undefined ? (
        <span className={s.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  )
}
