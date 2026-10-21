import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../primitives/Button.js'
import { Modal } from '../primitives/Modal.js'
import s from './table.module.css'

export interface AmountDialogProps {
  open: boolean
  /** The amount the tray holds now; the field starts from it. */
  value: number
  min: number
  max: number
  /** Called with the typed amount, clamped into `min`–`max`; the dialog then closes. */
  onConfirm(amount: number): void
  onClose(): void
}

/**
 * The typed bet on a phone held sideways (Plan 26, B4). The landscape tray has room for the presets but not for a number
 * field beside them, so "✎" (or the R key) opens this: one number field and a confirm. It hangs from the top of the
 * screen (`Modal anchor="top"`, R11) because the soft keyboard covers the bottom half of a page that does not scroll.
 * Enter confirms, as it would in the desktop tray's field; it never raises by itself — the raise button does that.
 */
export function AmountDialog({ open, value, min, max, onConfirm, onClose }: AmountDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  // Each opening starts from what the tray holds, and puts the caret in the field: `Modal` focuses its first control
  // (the close button), and this effect, the parent's, runs after it.
  useEffect(() => {
    if (!open) return
    setDraft(String(value))
    inputRef.current?.focus()
    inputRef.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` is read when the dialog opens, never after: re-seeding on a later change would wipe what the player is typing.
  }, [open])

  const confirm = (): void => {
    const typed = Number(draft)
    const n = draft.trim() === '' || !Number.isFinite(typed) ? min : typed
    onConfirm(Math.min(max, Math.max(min, Math.round(n))))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    // Claimed here, so the tray's own Enter shortcut (which raises) leaves it alone.
    event.preventDefault()
    confirm()
  }

  return (
    <Modal
      open={open}
      anchor="top"
      title={t('labels.amountDialog')}
      closeLabel={t('actions.close')}
      onClose={onClose}
      footer={
        <Button variant="gold" onClick={confirm}>
          {t('actions.confirm')}
        </Button>
      }
    >
      <input
        ref={inputRef}
        className={s.amountField}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={t('labels.amount')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </Modal>
  )
}
