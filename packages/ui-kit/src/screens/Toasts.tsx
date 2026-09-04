import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientError, ClientNotification } from '../client/types.js'
import { errorLabel, formatPoints, type Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import s from './screens.module.css'

export interface ToastsProps {
  error: ClientError | null
  notifications: ClientNotification[]
  onClearError: () => void
  onDismiss: (id: number) => void
  lang: Language
}

/** Errors clear themselves; notifications wait to be read. */
const ERROR_TTL_MS = 6000

/** Redundant with the colour, on purpose: hue is never the only signal. */
const GLYPH = { error: '!', note: '♠' }

const amountOf = (payload: unknown): number | null => {
  if (typeof payload !== 'object' || payload === null || !('amount' in payload)) return null
  const { amount } = payload as { amount: unknown }
  return typeof amount === 'number' ? amount : null
}

/**
 * The one place the screens speak up: a bottom-right stack of lacquered slips. Errors are assertive (`role="alert"`,
 * red edge), notifications are polite (`role="status"`, gold edge) — the colour is never the only signal, each slip
 * also carries its own icon glyph and its own dismissal affordance.
 */
export function Toasts({ error, notifications, onClearError, onDismiss, lang }: ToastsProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(onClearError, ERROR_TTL_MS)
    return () => clearTimeout(timer)
  }, [error, onClearError])

  if (error === null && notifications.length === 0) return null

  const describe = (n: ClientNotification): string => {
    const amount = amountOf(n.payload)
    return t(`notify.${n.kind}`, {
      defaultValue: t('notify.other'),
      amount: amount === null ? '' : formatPoints(amount, lang),
    })
  }

  return (
    <div className={s.toasts} role="region" aria-label={t('labels.notifications')}>
      {error === null ? null : (
        <div className={cx(s.toast, s.toastError)} role="alert">
          <span className={s.toastGlyph} aria-hidden="true">
            {GLYPH.error}
          </span>
          <span className={s.toastText}>{errorLabel(error.code, t)}</span>
          <button type="button" className={s.toastClose} aria-label={t('actions.close')} onClick={onClearError}>
            {'×'}
          </button>
        </div>
      )}
      {notifications.map((n) => (
        <div key={n.id} className={s.toast} role="status">
          <span className={s.toastGlyph} aria-hidden="true">
            {GLYPH.note}
          </span>
          <span className={s.toastText}>{describe(n)}</span>
          <button type="button" className={s.toastClose} aria-label={t('actions.close')} onClick={() => onDismiss(n.id)}>
            {'×'}
          </button>
        </div>
      ))}
    </div>
  )
}
