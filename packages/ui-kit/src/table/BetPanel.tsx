import type { CSSProperties, KeyboardEvent, Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import type { RoomFrame } from './frame.js'
import s from './table.module.css'

/** The slider never offers more than this many steps: past it a thumb could not land on one (spec BP-31 §3.2, R3). */
export const MAX_BET_STEPS = 200

/** The "close the panel" glyph after "Hủy": decoration, so the button's name stays the word alone. */
const CANCEL_GLYPH = '▾'

/** How far PageUp / PageDown move, in steps. */
const PAGE_STEPS = 10

/**
 * The slider's step: the small blind, or — when that would make more than `MAX_BET_STEPS` steps between `min` and
 * `max` — the smallest multiple of the small blind that keeps it to 200 (spec BP-31 §3.2, R3). A table without a small
 * blind (Blind Poker never sizes, but be safe) steps by 1.
 */
export function betStep(min: number, max: number, smallBlind: number): number {
  const unit = Math.max(1, Math.round(smallBlind))
  const span = Math.max(0, max - min)
  if (span / unit <= MAX_BET_STEPS) return unit
  return Math.ceil(Math.ceil(span / MAX_BET_STEPS) / unit) * unit
}

/** The index of the slider's last cell, which is `max` itself whether or not the range is a multiple of the step. */
export function sliderLast(min: number, max: number, step: number): number {
  return Math.ceil((max - min) / Math.max(1, step))
}

/** The amount at cell `i`: `min + i·step`, and the last cell is clamped to `max` (P7: a native stepped range stops short). */
export function sliderValue(i: number, min: number, max: number, step: number): number {
  return i >= sliderLast(min, max, step) ? max : min + Math.max(0, i) * Math.max(1, step)
}

/** The nearest cell to an amount; `max` (or more) is the last cell. */
export function sliderIndex(v: number, min: number, max: number, step: number): number {
  return v >= max ? sliderLast(min, max, step) : Math.max(0, Math.round((v - min) / Math.max(1, step)))
}

export interface BetPanelProps {
  /** The legal range, a street total: `minRaiseTo`/`maxRaiseTo` or `minBet`/`maxBet`. `max` is all in. */
  min: number
  max: number
  /** `betStep(min, max, smallBlind)`. */
  step: number
  /** The amount chosen, already clamped into `[min, max]` by the owner. */
  value: number
  /** The pot the "½ pot" and "Pot" chips are measured against. */
  pot: number
  onChange(v: number): void
  /** With `confirmLabel`: the confirm button ("Tố 48.000"), and Enter on the slider. */
  onConfirm?(): void
  /** "Hủy ▾", and Escape on the slider. */
  onCancel?(): void
  lang: Language
  confirmLabel?: string
  /** A short stage (landscape's short tier): 32 px chips and a 36 px slider row. */
  compact?: boolean
  frame?: RoomFrame
  /** The panel's name; `labels.betPanel` ("Chọn mức cược") by default. */
  label?: string
  disabled?: boolean
  /** The range input, for the tray's R shortcut and its Enter. */
  inputRef?: Ref<HTMLInputElement>
}

/**
 * Choosing a bet or a raise (spec BP-31 §3.2): four chips — Min · ½ pot · Pot · Tất tay — over a range slider, and, when
 * the owner asks for them, a row with "Hủy ▾" and the confirm button that carries the amount.
 *
 * The slider is a native `<input type="range">` with `step={1}` that steps itself: its keys and a drag both move along
 * the cells `min + i·step`, and the last cell is `max` exactly, so a range that is no multiple of the step still reaches
 * all in (P7). A chip sets its target clamped into the range — exactly, not snapped to the grid — and every chip says
 * with `aria-pressed` whether it names the current amount, which also keeps the ops pack's `autopilot` (it clicks
 * `button:not([aria-pressed])`) off them. With one legal size (`min === max`) the slider is disabled and every chip sets
 * that size (P24). No motion: the panel appears and goes with no transition.
 */
export function BetPanel({
  min,
  max,
  step,
  value,
  pot,
  onChange,
  onConfirm,
  onCancel,
  lang,
  confirmLabel,
  compact = false,
  frame = 'desktop',
  label,
  disabled = false,
  inputRef,
}: BetPanelProps) {
  const { t } = useTranslation()
  const unit = Math.max(1, step)
  const last = sliderLast(min, max, unit)
  const single = max <= min
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))
  const confirms = confirmLabel !== undefined && onConfirm !== undefined

  const chips = [
    { key: 'min', name: t('presets.min'), target: min },
    { key: 'half', name: t('presets.half'), target: clamp(pot / 2) },
    { key: 'pot', name: t('presets.pot'), target: clamp(pot) },
    { key: 'allIn', name: t('actions.allIn'), target: max },
  ]

  /** `delta` cells from `value`; from an amount between two cells, the first cell is the next one that way. */
  const moved = (delta: number): number => {
    if (value >= max) return sliderValue(Math.max(0, last + delta), min, max, unit)
    const exact = (value - min) / unit
    const from = delta > 0 ? Math.floor(exact) : Math.ceil(exact)
    return sliderValue(Math.min(last, Math.max(0, from + delta)), min, max, unit)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    let next: number | null = null
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = moved(-1)
        break
      case 'ArrowRight':
      case 'ArrowUp':
        next = moved(1)
        break
      case 'PageDown':
        next = moved(-PAGE_STEPS)
        break
      case 'PageUp':
        next = moved(PAGE_STEPS)
        break
      case 'Home':
        next = min
        break
      case 'End':
        next = max
        break
      case 'Enter':
        if (!confirms) return
        event.preventDefault()
        onConfirm()
        return
      case 'Escape':
        if (onCancel === undefined) return
        event.preventDefault()
        onCancel()
        return
      default:
        return
    }
    event.preventDefault()
    if (next !== value) onChange(next)
  }

  const pos = single ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)))
  const shape = frame === 'landscape' ? 'corner' : confirms ? 'sheet' : 'inline'

  return (
    <div
      className={s.betPanel}
      role="group"
      aria-label={label ?? t('labels.betPanel')}
      data-shape={shape}
      data-frame={frame}
      data-compact={compact || undefined}
    >
      <div className={s.betChips} role="group" aria-label={t('labels.betSize')}>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={cx(s.preset, s.betChip)}
            aria-pressed={value === chip.target}
            disabled={disabled}
            onClick={() => onChange(chip.target)}
          >
            {chip.name}
          </button>
        ))}
      </div>
      <div className={s.betSlider} style={{ '--pos': pos.toFixed(4) } as CSSProperties}>
        <span className={s.betValue} aria-hidden="true">
          {formatPoints(value, lang)}
        </span>
        <input
          ref={inputRef}
          className={s.slider}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled || single}
          aria-label={t('labels.amountSlider')}
          aria-valuetext={formatPoints(value, lang)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const next = sliderValue(sliderIndex(Number(event.target.value), min, max, unit), min, max, unit)
            if (next !== value) onChange(next)
          }}
        />
      </div>
      {confirms || onCancel !== undefined ? (
        <div className={s.betConfirm}>
          {onCancel === undefined ? null : (
            <Button variant="ghost" size="md" className={s.betCancel} disabled={disabled} onClick={onCancel}>
              {t('actions.cancel')}
              <span aria-hidden="true">{CANCEL_GLYPH}</span>
            </Button>
          )}
          {confirms ? (
            <Button variant="gold" size="md" className={s.grow} disabled={disabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
