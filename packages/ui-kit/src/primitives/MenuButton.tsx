import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from './cx.js'
import s from './primitives.module.css'

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Defined → the item is an on/off one (`menuitemcheckbox` with `aria-checked`); left out → a plain `menuitem`. */
  checked?: boolean
}

export interface MenuButtonProps {
  /** The trigger's accessible name and the menu's. The trigger itself only draws `⋯`. */
  label: string
  items: MenuItem[]
  /** Which edge of the trigger the menu lines up with. */
  align?: 'left' | 'right'
  /** Extra class on the trigger. */
  className?: string
}

/** Kept out of the JSX: the literal rule (`eslint.config.js`) allows no such glyph in markup. */
const MORE_GLYPH = '⋯'

/** The items the keys can land on: a disabled one is skipped, as it cannot be picked. */
const enabledItems = (menu: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])

/**
 * A `⋯` button that opens a short menu of actions under it — the menu-button pattern: the first item takes the focus,
 * the arrow keys walk the enabled items, and Escape, a press outside or a pick closes it. Escape and a pick hand the
 * focus back to the trigger.
 */
export function MenuButton({ label, items, align = 'right', className }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  // A menu that opens takes the focus onto its first live item, so the keys work straight away.
  useEffect(() => {
    if (open) enabledItems(menuRef.current)[0]?.focus()
  }, [open])

  // A press anywhere outside closes it; the trigger is inside, so its own click toggles instead.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    const live = enabledItems(menuRef.current)
    if (live.length === 0) return
    const at = live.findIndex((item) => item === document.activeElement)
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % live.length
        : event.key === 'ArrowUp'
          ? (at - 1 + live.length) % live.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? live.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    live[next]?.focus()
  }

  return (
    <div ref={rootRef} className={s.menuWrap} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(s.menuTrigger, className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">{MORE_GLYPH}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(s.menu, align === 'left' ? s.menuLeft : s.menuRight)}
          data-surface="night"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              className={s.menuItem}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                close(true)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
