import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export type ButtonVariant = 'primary' | 'gold' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `gold` = a screen's main action off the table (create, join, save, claim) and every money move on it (bet,
   * raise, play, start, buy in); `primary` (teal) = the table's everyday affirmatives (check, call, ready);
   * `danger` = fold/leave/kick; `ghost` = quiet. One action, one colour, wherever it appears (layout audit U1).
   */
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
