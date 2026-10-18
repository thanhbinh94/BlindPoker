import { Button, Modal } from '@bp/ui-kit'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api.js'
import s from '../normal.module.css'
import { refusalText } from '../refusal.js'
import g from './gm.module.css'

/** The most points one action may move, either way (spec 2026-10-18 §7); the server refuses past it too. */
export const MAX_POINTS = 10_000_000

/** The shortest reason the log accepts. The server's own bound is 3–200 characters, trimmed. */
export const MIN_REASON = 3
export const MAX_REASON = 200

export interface ReasonValues {
  reason: string
  amount?: number
  itemId?: string
}

export interface ReasonDialogProps {
  open: boolean
  title: string
  /** One paragraph of consequence, shown above the form: what the action does to the person it lands on. */
  body?: string
  /** Which extra inputs the action needs; the reason is always asked. */
  fields: { amount?: boolean; item?: boolean }
  confirmLabel: string
  /** Rejects with the server's refusal, which the dialog prints; resolves and the dialog closes. */
  onConfirm: (values: ReasonValues) => Promise<void>
  onClose: () => void
}

/** The amount as a number, or `null` when it is anything but a whole, non-zero count within the cap. */
function parseAmount(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?\d+$/u.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > MAX_POINTS) return null
  return value
}

/**
 * The one door every console action goes through: a reason is asked for, always, because the log has a
 * "why" column and an empty one is worthless. Confirm is off until the form could pass the server's checks
 * (the server still makes them), and a refusal that gets through anyway is printed under the form, in words.
 */
export function ReasonDialog({ open, title, body, fields, confirmLabel, onConfirm, onClose }: ReasonDialogProps) {
  const { t } = useTranslation('normal')
  const errorId = useId()
  const [reason, setReason] = useState('')
  const [amountText, setAmountText] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A dialog opened a second time must not remember the first: the last reason, and above all the last
  // amount, sitting pre-filled in front of a different player is how a wrong person gets paid.
  useEffect(() => {
    if (!open) return
    setReason('')
    setAmountText('')
    setItemId('')
    setBusy(false)
    setError(null)
  }, [open])

  const cleanReason = reason.trim()
  const amount = fields.amount === true ? parseAmount(amountText) : undefined
  const cleanItem = itemId.trim()
  const valid =
    cleanReason.length >= MIN_REASON &&
    (fields.amount !== true || amount !== null) &&
    (fields.item !== true || cleanItem !== '')

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    const values: ReasonValues = { reason: cleanReason }
    if (fields.amount === true && amount !== null && amount !== undefined) values.amount = amount
    if (fields.item === true) values.itemId = cleanItem
    setBusy(true)
    setError(null)
    try {
      await onConfirm(values)
      setBusy(false)
      onClose()
    } catch (cause) {
      setBusy(false)
      setError(
        cause instanceof ApiError
          ? t(`gm.errors.${cause.code}`, { defaultValue: refusalText(cause, t) })
          : refusalText(cause, t),
      )
    }
  }

  const reasonId = useId()
  const amountId = useId()
  const itemFieldId = useId()

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      closeLabel={t('gm.dialog.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('gm.dialog.cancel')}
          </Button>
          <Button variant="gold" disabled={!valid} loading={busy} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        {body === undefined ? null : <p className={s.footnote}>{body}</p>}

        {fields.amount === true ? (
          <div className={g.field}>
            <label className={s.label} htmlFor={amountId}>
              {t('gm.dialog.amount')}
            </label>
            <input
              id={amountId}
              className={s.input}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </div>
        ) : null}

        {fields.item === true ? (
          <div className={g.field}>
            <label className={s.label} htmlFor={itemFieldId}>
              {t('gm.dialog.item')}
            </label>
            <input
              id={itemFieldId}
              className={s.input}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            />
          </div>
        ) : null}

        <div className={g.field}>
          <label className={s.label} htmlFor={reasonId}>
            {t('gm.dialog.reason')}
          </label>
          <textarea
            id={reasonId}
            className={`${s.input} ${g.reasonBox}`}
            rows={3}
            maxLength={MAX_REASON}
            value={reason}
            aria-describedby={error === null ? undefined : errorId}
            aria-invalid={error === null ? undefined : true}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {error === null ? null : (
          <p className={s.alert} id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
