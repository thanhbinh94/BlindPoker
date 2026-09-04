import { useEffect, useRef } from 'react'
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

/**
 * Every slip clears itself. An error is a refusal the player just caused, so it goes sooner; a notification is news
 * they may not have been looking at, so it stays longer. Neither waits forever: a stack of unread slips over the
 * felt is a stack of buttons the player cannot reach.
 */
const ERROR_TTL_MS = 6000
const NOTE_TTL_MS = 8000

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

  // The countdown between hands re-renders the room every second. Depending on `onClearError` here would restart the
  // timer on every one of those renders and the slip would never clear itself, so the schedule is keyed on the error
  // alone (a stable object that changes only when a *new* refusal arrives) and reads the latest callback from a ref.
  const clearRef = useRef(onClearError)
  clearRef.current = onClearError

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => clearRef.current(), ERROR_TTL_MS)
    return () => clearTimeout(timer)
  }, [error])

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
        <NoteSlip key={n.id} id={n.id} text={describe(n)} closeLabel={t('actions.close')} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * One notification slip, owning its own dismissal timer. Each slip is its own component so the schedule can be keyed
 * on that slip's id — the same reason the error's timer is keyed on the error object, and the same ref trick for the
 * callback, which the room re-creates on every tick of its countdown.
 */
function NoteSlip({ id, text, closeLabel, onDismiss }: { id: number; text: string; closeLabel: string; onDismiss: (id: number) => void }) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(id), NOTE_TTL_MS)
    return () => clearTimeout(timer)
  }, [id])

  return (
    <div className={s.toast} role="status">
      <span className={s.toastGlyph} aria-hidden="true">
        {GLYPH.note}
      </span>
      <span className={s.toastText}>{text}</span>
      <button type="button" className={s.toastClose} aria-label={closeLabel} onClick={() => onDismiss(id)}>
        {'×'}
      </button>
    </div>
  )
}
