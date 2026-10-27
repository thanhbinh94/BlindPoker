import { CHAOS_CARDS_SPEC, type ChaosOutcome, type ChaosTier, type ChaosTiming } from '@bp/core'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

/**
 * A card's tier from its id, for a card the viewer no longer sees held (a one-shot that has just acted). The catalogue's ids
 * are `s_…`, `g_…` and `d_…` for Bạc, Vàng and Kim cương; anything else reads as Bạc.
 */
export function tierOfCardId(cardId: string): ChaosTier {
  return cardId.startsWith('d_') ? 'diamond' : cardId.startsWith('g_') ? 'gold' : 'silver'
}

/** The catalogue by id, for a card's tier and the moment it acts. A GM can turn a card off or weigh it, never retime it. */
const SPEC_BY_ID = new Map(CHAOS_CARDS_SPEC.map((def) => [def.id, def]))

/** One card the popup describes, with the hands it has left when the viewer can see that (`null`: waits, or fires once). */
export interface ChaosCardInfoEntry {
  cardId: string
  handsLeft?: number | null
}

/** A card that has been played: who played it, on whom (display names; none for a card on the player itself), and how it went. */
export interface ChaosUseInfo {
  by: string
  targets: readonly string[]
  outcome: ChaosOutcome
}

/**
 * A step the popup offers on its card (BP-39, spec 2026-10-27 §3.4): the bonus hand's "Dùng" — a button, the confirm that
 * follows the tap that opened the popup, so a card is never played by the tap that only meant to read it — or, for a card
 * already pressed, a line saying so ("Đã đặt dùng").
 */
export type ChaosCardInfoAction =
  | { kind: 'button'; label: string; disabled?: boolean; onPress: () => void }
  | { kind: 'status'; label: string }

interface ChaosCardInfoBase {
  /** The trigger: an icon or a name. Its own markup stays as it is (the ops pack finds the icons by `[role="img"][data-tier]`). */
  children: ReactNode
  /** Extra class on the trigger button. */
  className?: string
  /** The trigger's accessible name. Left out: the card's name, its tier in words and the hands it has left. */
  label?: string
  /** What the popup offers to do with the card, under its description. Pressing the button closes the popup first. */
  action?: ChaosCardInfoAction
}

export type ChaosCardInfoProps = ChaosCardInfoBase &
  (
    | { cardId: string; handsLeft?: number | null; use?: ChaosUseInfo; cards?: never }
    /** Several cards in one popup: a seat's stacked icon on a crowded phone strip, or its "+N". */
    | { cards: readonly ChaosCardInfoEntry[]; cardId?: never; handsLeft?: never; use?: never }
  )

/** The popup keeps this far from every edge of the screen, and this far from its trigger. */
export const INFO_MARGIN = 8
const INFO_GAP = 6
/** How long a mouse may take to cross the gap from the trigger onto the popup before a hover-open popup closes. */
const HOVER_GRACE_MS = 120
const SEP = ' · '

export interface InfoPlacement {
  left: number
  top: number
  side: 'above' | 'below'
}

/**
 * Where the popup goes (spec 2026-10-27 §3.5): centred over its trigger and above it when it fits there, else below, else on
 * the side with more room; then clamped inside the screen with `INFO_MARGIN` to spare, so it never runs off sideways at
 * 360 px nor past the bottom at 780×360.
 */
export function placeChaosInfo(
  trigger: { left: number; top: number; width: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): InfoPlacement {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
  const left = clamp(trigger.left + trigger.width / 2 - size.width / 2, INFO_MARGIN, viewport.width - INFO_MARGIN - size.width)
  const roomAbove = trigger.top - INFO_GAP - INFO_MARGIN
  const roomBelow = viewport.height - trigger.bottom - INFO_GAP - INFO_MARGIN
  const side = size.height <= roomAbove ? 'above' : size.height <= roomBelow ? 'below' : roomAbove >= roomBelow ? 'above' : 'below'
  const wanted = side === 'above' ? trigger.top - INFO_GAP - size.height : trigger.bottom + INFO_GAP
  return { left: Math.max(left, INFO_MARGIN), top: Math.max(clamp(wanted, INFO_MARGIN, viewport.height - INFO_MARGIN - size.height), INFO_MARGIN), side }
}

/** How the popup came to be open: a mouse resting on the trigger, the keyboard's focus, or a tap or click (which pins it). */
type Opener = 'hover' | 'focus' | 'tap'

/** The page shows one card popup at a time: opening one closes whichever was open. */
let closeOpenInfo: (() => void) | null = null

/**
 * Our own tooltip for a chaos card (spec 2026-10-27 §3.5), because `title=` shows only to a mouse and never on a phone. It
 * wraps its trigger in a button: a tap or click opens it and a second one closes it; a mouse resting on it or the keyboard's
 * focus opens it too. A press outside, `Esc`, the focus leaving or the trigger going away closes it. It says the card's
 * name, its tier (in its colour and in words), the whole description, when it acts and the hands it has left — and, for a
 * card that was played, who played it, on whom and how it went.
 *
 * The popup is drawn into `document.body`, fixed to the screen: the seat lines and the felt clip what overflows them. It
 * carries `data-surface="night"` so it reads the felt's palette in either theme.
 */
export function ChaosCardInfo(props: ChaosCardInfoProps) {
  const { t } = useTranslation()
  const { children, className, action } = props
  const entries: readonly ChaosCardInfoEntry[] = props.cards ?? [{ cardId: props.cardId, handsLeft: props.handsLeft ?? null }]
  const use = props.cards === undefined ? props.use : undefined

  const [open, setOpen] = useState<Opener | null>(null)
  const [place, setPlace] = useState<InfoPlacement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  /** Set while the popup hands the focus back to its trigger as it closes: that focus must not open it again. */
  const refocusing = useRef(false)
  /**
   * Set between a pointer's press and its release: the focus a mouse press brings is the click's, not the keyboard's. (A
   * touch's focus comes after the lift; `onClick` tells that one apart by its `detail`.)
   */
  const pressing = useRef(false)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tipId = useId()

  const cancelGrace = (): void => {
    if (graceTimer.current !== null) clearTimeout(graceTimer.current)
    graceTimer.current = null
  }
  const leaveSoon = (): void => {
    cancelGrace()
    graceTimer.current = setTimeout(() => setOpen((was) => (was === 'hover' ? null : was)), HOVER_GRACE_MS)
  }
  useEffect(
    () => () => {
      if (graceTimer.current !== null) clearTimeout(graceTimer.current)
    },
    [],
  )

  /**
   * Closes the popup; when the focus is inside it (its button pressed, `Esc` from it, Tab out of it) the focus goes back to
   * the trigger rather than to the page with the popup gone — without opening it again.
   */
  const closeToTrigger = (): void => {
    const inside = tipRef.current !== null && tipRef.current.contains(document.activeElement)
    setOpen(null)
    if (inside && triggerRef.current !== null) {
      refocusing.current = true
      triggerRef.current.focus({ preventScroll: true })
      refocusing.current = false
    }
  }
  const closeToTriggerRef = useRef(closeToTrigger)
  closeToTriggerRef.current = closeToTrigger

  const isOpen = open !== null
  // While open: close any other card popup, and close this one on a press outside it or `Esc`.
  useEffect(() => {
    if (!isOpen) {
      setPlace(null)
      return
    }
    const close = (): void => setOpen(null)
    if (closeOpenInfo !== null && closeOpenInfo !== close) closeOpenInfo()
    closeOpenInfo = close
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return close()
      if (triggerRef.current?.contains(target) === true || tipRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeToTriggerRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      if (closeOpenInfo === close) closeOpenInfo = null
    }
  }, [isOpen])

  // Measured before the first paint, then again whenever the screen turns or something scrolls under it.
  useLayoutEffect(() => {
    if (!isOpen) return
    const measure = (): void => {
      const trigger = triggerRef.current
      const tip = tipRef.current
      if (trigger === null || tip === null) return
      const width = document.documentElement.clientWidth || window.innerWidth
      setPlace(placeChaosInfo(trigger.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, { width, height: window.innerHeight }))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [isOpen])

  const nameOf = (cardId: string): string => t(`chaos.cards.${cardId}.name`, { defaultValue: cardId })
  const tierOf = (cardId: string): ChaosTier => SPEC_BY_ID.get(cardId)?.tier ?? tierOfCardId(cardId)
  const leftOf = (handsLeft: number | null | undefined): string | null =>
    handsLeft === null || handsLeft === undefined ? null : t('chaos.handsLeft', { count: handsLeft })
  const first = entries[0]
  const label =
    props.label ??
    (first === undefined
      ? ''
      : `${nameOf(first.cardId)} (${t(`chaos.tier.${tierOf(first.cardId)}`)})${leftOf(first.handsLeft) === null ? '' : `${SEP}${leftOf(first.handsLeft)}`}`)

  const tip = isOpen ? (
    <div
      ref={tipRef}
      id={tipId}
      role="tooltip"
      className={s.cardInfo}
      data-surface="night"
      data-side={place?.side}
      style={place === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: place.left, top: place.top }}
      // Focusable from a script, never by Tab: a press on its text lands the focus here, not on nothing, so the trigger's
      // blur sees the focus stay with the popup and keeps it open (Chrome blurs with no `relatedTarget` otherwise).
      tabIndex={-1}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') cancelGrace()
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') leaveSoon()
      }}
      onBlur={(e) => {
        const to = e.relatedTarget
        if (to instanceof Node && (tipRef.current?.contains(to) === true || triggerRef.current?.contains(to) === true)) return
        // The focus left the popup for somewhere else on the page; a press outside has already closed it.
        if (to instanceof Node) setOpen((was) => (was === 'hover' ? was : null))
      }}
      onKeyDown={(e) => {
        // Tab either way from inside the popup goes back to its trigger and closes it: the popup is drawn at the end of the
        // page, so the browser's own next stop would be nowhere near the card.
        if (e.key !== 'Tab') return
        e.preventDefault()
        closeToTrigger()
      }}
    >
      {entries.map((entry, i) => {
        const tier = tierOf(entry.cardId)
        const timing: ChaosTiming | undefined = SPEC_BY_ID.get(entry.cardId)?.timing
        const left = leftOf(entry.handsLeft)
        const when = [timing === undefined ? null : t(`chaos.timing.${timing}`), left].filter((x): x is string => x !== null).join(SEP)
        return (
          <div key={`${entry.cardId}-${i}`} className={s.cardInfoEntry} data-tier={tier}>
            <p className={s.cardInfoHead}>
              <strong className={s.cardInfoName}>{nameOf(entry.cardId)}</strong>
              <span className={s.cardInfoTier}>{t(`chaos.tier.${tier}`)}</span>
            </p>
            <p className={s.cardInfoDesc}>{t(`chaos.cards.${entry.cardId}.desc`, { defaultValue: '' })}</p>
            {when === '' ? null : <p className={s.cardInfoMeta}>{when}</p>}
          </div>
        )
      })}
      {use === undefined ? null : (
        <div className={s.cardInfoUse}>
          <p>{t('chaos.info.by', { name: use.by })}</p>
          {use.targets.length === 0 ? null : <p>{t('chaos.info.on', { targets: use.targets.join(', ') })}</p>}
          <p data-outcome={use.outcome}>{t('chaos.info.outcome', { outcome: t(`chaos.outcome.${use.outcome}`) })}</p>
        </div>
      )}
      {action === undefined ? null : action.kind === 'status' ? (
        <p className={s.cardInfoStatus}>{action.label}</p>
      ) : (
        <button
          ref={actionRef}
          type="button"
          className={s.cardInfoAction}
          disabled={action.disabled === true}
          onClick={() => {
            // Closed first, so the press is the popup's last: one press, one call.
            closeToTrigger()
            action.onPress()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx(s.cardInfoTrigger, className)}
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tipId : undefined}
        onPointerDown={() => {
          pressing.current = true
        }}
        onPointerUp={() => {
          pressing.current = false
        }}
        onPointerCancel={() => {
          pressing.current = false
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return
          cancelGrace()
          setOpen((was) => was ?? 'hover')
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') leaveSoon()
        }}
        onFocus={() => {
          // A tap focuses the button on its way to a click; only a focus with no press behind it is the keyboard's.
          if (!pressing.current && !refocusing.current) setOpen((was) => was ?? 'focus')
        }}
        onKeyDown={(e) => {
          // The popup's button is drawn at the end of the page: Tab from the trigger of an open popup steps into it.
          if (e.key !== 'Tab' || e.shiftKey || !isOpen || actionRef.current === null || actionRef.current.disabled) return
          e.preventDefault()
          actionRef.current.focus({ preventScroll: true })
        }}
        onBlur={(e) => {
          pressing.current = false
          if (e.relatedTarget instanceof Node && tipRef.current?.contains(e.relatedTarget) === true) return
          setOpen((was) => (was === 'hover' ? was : null))
        }}
        onClick={(e) => {
          cancelGrace()
          // A tap or a click (`detail` ≥ 1) opens it, pinning a hover — and a focus, since Chrome on a phone focuses the
          // button between the finger's lift and the click; a second one closes it. Enter or Space (`detail` 0) toggles it.
          const byPointer = e.detail > 0
          setOpen((was) => (was === null || was === 'hover' || (byPointer && was === 'focus') ? 'tap' : null))
        }}
      >
        {children}
      </button>
      {tip === null ? null : createPortal(tip, document.body)}
    </>
  )
}
