import type { PlayerAction, RoomView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PreActionKind } from '../client/preaction.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

export interface ActionBarProps {
  hand: ClientHand
  room: RoomView
  onAct: (action: PlayerAction) => void
  disabled?: boolean
  lang: Language
  /**
   * Hold'em, between turns: the ticked pre-action, and the setter the toggles call. Omit both and the tray only
   * says it is waiting. The tick is one of three, exclusive; ticking the lit one again clears it.
   */
  preAction?: PreActionKind | null
  onPreAction?: (kind: PreActionKind | null) => void
  /** Blind Poker: the standing "play every decision" preference and its setter. */
  autoPlay?: boolean
  onAutoPlay?: (on: boolean) => void
}

const PRE_ACTIONS: readonly PreActionKind[] = ['checkFold', 'callAny', 'fold']

const SLIDER_STEPS = 50

/** The lines the tray can print while the seat has no legal action: one `labels.*` key each. */
export type TrayWaitKey =
  | 'labels.handOver'
  | 'labels.waitFolded'
  | 'labels.waitAllIn'
  | 'labels.waitDecided'
  | 'labels.waitReveal'
  | 'labels.waitingForTurn'

/**
 * What a seat with no legal action is waiting for, as the key of the line the tray prints (review round 2, R2-3).
 * The first row that fits wins, so a finished hand reads "over" whatever the seat did in it:
 *
 *  1. the hand is complete — the result card may still be held on the felt, but nothing is left to wait for;
 *  2. the seat folded — it waits for the next deal;
 *  3. the seat is all in — it waits for the result;
 *  4. Blind, deciding, and this seat has already chosen — it waits for the others;
 *  5. Blind, deciding, and it has not chosen — its own decision is on its way, the old line still fits;
 *  6. Blind, any other phase (the reveal; a pure-luck hand never enters the decision) — it waits for the cards;
 *  7. Hold'em, revealing, with fewer than two seats that can still act — a run-out: no turn is coming;
 *  8. anything else is Hold'em between turns — the old line.
 *
 * `mine` is the viewer's own seat and is `undefined` for a spectator (or before the seat is in the hand).
 */
export function trayWaitKey(hand: ClientHand, mine: ClientSeat | undefined): TrayWaitKey {
  if (hand.phase === 'COMPLETE') return 'labels.handOver'
  if (mine?.folded === true) return 'labels.waitFolded'
  if (mine?.allIn === true) return 'labels.waitAllIn'
  if (hand.mode === 'blind') {
    if (hand.phase !== 'DECISION') return 'labels.waitReveal'
    return mine?.hasDecided === true ? 'labels.waitDecided' : 'labels.waitingForTurn'
  }
  const canStillAct = hand.seats.filter((seat) => !seat.folded && !seat.allIn).length
  if (hand.phase === 'REVEAL' && canStillAct < 2) return 'labels.waitReveal'
  return 'labels.waitingForTurn'
}

/**
 * The lacquered action tray, anchored to the bottom edge at every size.
 *
 * Only the kinds the server declared legal are offered; the bet/raise control is bounded by the legal range and every
 * preset is clamped into it, so a click can never produce an illegal amount. Shortcuts: F fold, C check/call,
 * R focus the amount, Enter submit — all advertised through `aria-keyshortcuts`.
 *
 * Between turns the tray stays put and says what the seat is waiting for (`trayWaitKey`): it is a fixture of the room,
 * not a popup, and a tray that came and went would resize the felt above it on every turn.
 */
export function ActionBar({ hand, room, onAct, disabled = false, lang, preAction = null, onPreAction, autoPlay = false, onAutoPlay }: ActionBarProps) {
  const { t } = useTranslation()
  const legal = hand.legal
  const amountRef = useRef<HTMLInputElement>(null)

  const kinds = useMemo(() => legal?.kinds ?? [], [legal])
  const canRaise = kinds.includes('raise')
  const canBet = kinds.includes('bet')
  const sizing = canRaise || canBet
  const min = canRaise ? (legal?.minRaiseTo ?? 0) : (legal?.minBet ?? 0)
  const max = canRaise ? (legal?.maxRaiseTo ?? 0) : (legal?.maxBet ?? 0)

  const [raw, setRaw] = useState(() => String(min))
  useEffect(() => {
    setRaw(String(min))
  }, [min, max, hand.handId])

  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max])
  const typed = Number(raw)
  const value = clamp(raw.trim() === '' || !Number.isFinite(typed) ? min : typed)

  const emit = useCallback(
    (action: PlayerAction) => {
      if (!disabled) onAct(action)
    },
    [disabled, onAct],
  )
  const submit = useCallback(() => {
    emit({ kind: canRaise ? 'raise' : 'bet', amount: value })
  }, [emit, canRaise, value])

  useEffect(() => {
    if (legal === null || disabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
      if (event.key === 'Enter') {
        if (!sizing) return
        if (inField && target !== amountRef.current) return
        event.preventDefault()
        submit()
        return
      }
      if (inField) return
      const key = event.key.toLowerCase()
      if (key === 'f' && kinds.includes('fold')) emit({ kind: 'fold' })
      else if (key === 'c' && kinds.includes('check')) emit({ kind: 'check' })
      else if (key === 'c' && kinds.includes('call')) emit({ kind: 'call' })
      else if (key === 'r' && sizing) amountRef.current?.focus()
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [legal, disabled, sizing, kinds, emit, submit])

  // The pre-action row is offered only to a seat that can still act this hand: not folded, not all-in, cards on
  // the table. Anyone else — a spectator, a seat waiting for the next deal — gets the plain waiting line.
  const mine = hand.mySeat === null ? undefined : hand.seats.find((seat) => seat.seat === hand.mySeat)
  const live = mine !== undefined && !mine.folded && !mine.allIn && hand.phase !== 'COMPLETE'
  const offersPreActions = hand.mode === 'holdem' && live && onPreAction !== undefined
  // Play-or-fold has a question to answer; a pure-luck squeeze table has cards to turn — there, auto-play means "turn mine at once".
  const offersAutoPlay =
    hand.mode === 'blind' && mine !== undefined && onAutoPlay !== undefined && (room.config.blind?.decisionMode === 'playOrFold' || room.config.blind?.squeeze === true)

  const autoPlayToggle = offersAutoPlay ? (
    <button
      type="button"
      className={cx(s.preset, s.preToggle)}
      aria-pressed={autoPlay}
      disabled={disabled}
      onClick={() => onAutoPlay(!autoPlay)}
    >
      {t('preActions.autoPlay')}
    </button>
  ) : null

  if (legal === null) {
    return (
      <div className={s.tray} data-surface="night" role="group" aria-label={t('labels.actions')}>
        <p className={s.trayWait} role="status">
          {t(trayWaitKey(hand, mine))}
        </p>
        {offersPreActions ? (
          <div className={s.preRow} role="group" aria-label={t('preActions.label')}>
            {PRE_ACTIONS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cx(s.preset, s.preToggle)}
                aria-pressed={preAction === kind}
                disabled={disabled}
                onClick={() => onPreAction(preAction === kind ? null : kind)}
              >
                {t(`preActions.${kind}`)}
              </button>
            ))}
          </div>
        ) : null}
        {autoPlayToggle === null ? null : (
          <div className={s.preRow} role="group" aria-label={t('preActions.label')}>
            {autoPlayToggle}
          </div>
        )}
      </div>
    )
  }

  const onAmountChange = (event: ChangeEvent<HTMLInputElement>): void => setRaw(event.target.value)
  const preset = (n: number): void => setRaw(String(clamp(n)))
  const step = Math.max(1, Math.round((max - min) / SLIDER_STEPS))

  const wager = legal.callAmount > 0 ? legal.callAmount : (room.config.blind?.fixedWager ?? 0)
  const playText = `${t('actions.play')} ${formatPoints(wager, lang)}`
  const callText = legal.callAmount > 0 ? `${t('actions.call')} ${formatPoints(legal.callAmount, lang)}` : t('actions.call')
  const submitText = `${t(canRaise ? 'actions.raise' : 'actions.bet')} ${formatPoints(value, lang)}`

  // Blind mode's play-or-fold decision is its own two-button tray: no sizing, no call.
  if (kinds.includes('play')) {
    return (
      <div className={s.tray} data-surface="night" role="group" aria-label={t('labels.actions')}>
        <div className={s.trayRow}>
          <Button variant="danger" size="lg" disabled={disabled} aria-keyshortcuts="F" onClick={() => emit({ kind: 'fold' })}>
            {t('actions.fold')}
          </Button>
          <Button variant="gold" size="lg" disabled={disabled} className={s.grow} onClick={() => emit({ kind: 'play' })}>
            {playText}
          </Button>
        </div>
        {autoPlayToggle === null ? null : (
          <div className={s.preRow} role="group" aria-label={t('preActions.label')}>
            {autoPlayToggle}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={s.tray} data-surface="night" role="group" aria-label={t('labels.actions')}>
      {sizing ? (
        <div className={s.sizer} role="group" aria-label={t('labels.betSize')}>
          <div className={s.presets}>
            <button type="button" className={s.preset} disabled={disabled} onClick={() => preset(min)}>
              {t('presets.min')}
            </button>
            <button type="button" className={s.preset} disabled={disabled} onClick={() => preset(hand.pot / 2)}>
              {t('presets.half')}
            </button>
            <button type="button" className={s.preset} disabled={disabled} onClick={() => preset(hand.pot)}>
              {t('presets.pot')}
            </button>
            <button type="button" className={s.preset} disabled={disabled} onClick={() => preset(max)}>
              {t('presets.max')}
            </button>
          </div>
          <div className={s.sizerRow}>
            <input
              ref={amountRef}
              className={s.amount}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={raw}
              disabled={disabled}
              aria-label={t('labels.amount')}
              aria-keyshortcuts="R"
              onChange={onAmountChange}
            />
            <input
              className={s.slider}
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              disabled={disabled}
              aria-label={t('labels.amountSlider')}
              onChange={onAmountChange}
            />
          </div>
        </div>
      ) : null}

      <div className={s.trayRow}>
        {kinds.includes('fold') ? (
          <Button variant="danger" size="lg" disabled={disabled} aria-keyshortcuts="F" onClick={() => emit({ kind: 'fold' })}>
            {t('actions.fold')}
          </Button>
        ) : null}
        {kinds.includes('check') ? (
          <Button variant="primary" size="lg" disabled={disabled} aria-keyshortcuts="C" onClick={() => emit({ kind: 'check' })}>
            {t('actions.check')}
          </Button>
        ) : null}
        {kinds.includes('call') ? (
          <Button variant="primary" size="lg" disabled={disabled} aria-keyshortcuts="C" onClick={() => emit({ kind: 'call' })}>
            {callText}
          </Button>
        ) : null}
        {sizing ? (
          <Button variant="gold" size="lg" disabled={disabled} className={s.grow} aria-keyshortcuts="Enter" onClick={submit}>
            {submitText}
          </Button>
        ) : null}
        {kinds.includes('allIn') ? (
          <Button
            variant={sizing ? 'ghost' : 'gold'}
            size="lg"
            disabled={disabled}
            className={cx(sizing ? s.allInGhost : s.grow)}
            onClick={() => emit({ kind: 'allIn' })}
          >
            {t('actions.allIn')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
