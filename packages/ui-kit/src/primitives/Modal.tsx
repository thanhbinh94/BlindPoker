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
  /** Accessible name for the close button (i18n string from the host). */
  closeLabel: string
}

export function Modal({ open, title, onClose, children, closeLabel }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // Callers pass an inline arrow, so `onClose` is a new function on every render. Depending on it here would move
  // focus back to the close button after every keystroke inside the dialog, so the latest one is read from a ref and
  // the effect runs once per opening.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
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
      </div>
    </div>,
    document.body,
  )
}
