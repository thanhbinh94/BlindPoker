import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button.js'
import s from './primitives.module.css'

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
  /**
   * The dialog's action row — the buttons that answer it. Rendered after the body, centred, one section space below
   * it, so every dialog answers in the same place and a caller never spaces its own buttons (No17). Nothing
   * (`undefined`, `null`, `false`) renders no row at all, so a dialog without actions keeps no empty margin.
   */
  footer?: ReactNode
  /** Accessible name for the close button (i18n string from the host). */
  closeLabel: string
}

export function Modal({ open, title, onClose, children, footer, closeLabel }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // Callers pass an inline arrow, so `onClose` is a new function on every render. Depending on it here would move
  // focus back to the close button after every keystroke inside the dialog, so the latest one is read from a ref and
  // the effect runs once per opening.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /** Whatever had focus when the dialog opened — the button that opened it, in every real case. */
  const returnToRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    returnToRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeRef.current()
        return
      }
      // `aria-modal` tells a screen reader the rest of the page is inert; nothing tells the Tab key, so the dialog
      // has to say it itself, or the next Tab lands on the page behind and the player never finds their way back.
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (first === undefined || last === undefined) return
      const here = document.activeElement
      const wrapping = event.shiftKey ? here === first || !dialog.contains(here) : here === last
      if (!wrapping) return
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Closing hands focus back where it came from: a dialog that leaves focus on `<body>` drops a keyboard user
      // at the top of the page, with no memory of the button they pressed.
      returnToRef.current?.focus()
      returnToRef.current = null
    }
  }, [open])

  if (!open) return null

  const onBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.backdrop} data-testid="modal-backdrop" onClick={onBackdropClick}>
      <div className={s.dialog} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={s.dialogHead}>
          <h2 className={s.dialogTitle} id={titleId}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" className={s.close} aria-label={closeLabel} onClick={onClose}>
            {'×'}
          </Button>
        </div>
        <div>{children}</div>
        {footer === undefined || footer === null || footer === false ? null : <div className={s.dialogFoot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
