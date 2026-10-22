import type { PlayerAction, RoomView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PreActionKind } from '../client/preaction.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { AmountDialog } from './AmountDialog.js'
import type { RoomFrame } from './frame.js'
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
  /**
   * The room's frame (`useRoomFrame`). `landscape` — a phone on its side — splits the tray into two corner docks: the
   * toggles bottom-left, the betting buttons bottom-right, presets in place of the slider and a dialog for a typed
   * amount (Plan 26, B4). `desktop` (the default) is the tray as it always was.
   */
  frame?: RoomFrame
  /**
   * Landscape only: no hand is being played (the room waits, or the countdown runs with the result card closed). The
   * room's own dock holds the bottom-right corner then, so the tray gives up its right part and keeps its left one —
   * a player can still turn "Tự động chơi" off before the next deal.
   */
  betweenHands?: boolean
}

const PRE_ACTIONS: readonly PreActionKind[] = ['checkFold', 'callAny', 'fold']

const SLIDER_STEPS = 50

/** The landscape tray's "type an amount" button (`labels.amountDialog` is its name). */
const EDIT_GLYPH = '✎'

/** The lines the tray can print while the seat has no legal action: one `labels.*` key each. */
export type TrayWaitKey =
  | 'labels.handOver'
  | 'labels.waitFolded'
  | 'labels.waitAllIn'
  | 'labels.waitDecided'
  | 'labels.waitReveal'
  | 'labels.waitSqueeze'
  | 'labels.waitOthersReveal'
  | 'labels.waitingForTurn'

/**
 * What a seat with no legal action is waiting for, as the key of the line the tray prints (review round 2, R2-3).
 * The first row that fits wins, so a finished hand reads "over" whatever the seat did in it:
 *
 *  1. the hand is complete — the result card may still be held on the felt, but nothing is left to wait for;
 *  2. the seat folded — it waits for the next deal;
 *  3. the seat is all in — it waits for the result;
 *  4. Blind, a pure-luck squeeze round (spec 2026-10-08 §4.2.3) — its own cards to turn, or, turned, the others; a
 *     spectator has none to turn and waits for the cards like row 7;
 *  5. Blind, deciding, and this seat has already chosen — it waits for the others;
 *  6. Blind, deciding, and it has not chosen — its own decision is on its way, the old line still fits;
 *  7. Blind, any other phase (the reveal; a pure-luck hand never enters the decision) — it waits for the cards;
 *  8. Hold'em, revealing, with fewer than two seats that can still act — a run-out: no turn is coming;
 *  9. anything else is Hold'em between turns — the old line.
 *
 * `mine` is the viewer's own seat and is `undefined` for a spectator (or before the seat is in the hand).
 */
export function trayWaitKey(hand: ClientHand, mine: ClientSeat | undefined): TrayWaitKey {
  if (hand.phase === 'COMPLETE') return 'labels.handOver'
  if (mine?.folded === true) return 'labels.waitFolded'
  if (mine?.allIn === true) return 'labels.waitAllIn'
  if (hand.mode === 'blind') {
    if (hand.phase === 'SQUEEZE') return mine === undefined ? 'labels.waitReveal' : mine.revealed === true ? 'labels.waitOthersReveal' : 'labels.waitSqueeze'
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
 *
 * On a phone held sideways (`frame="landscape"`) the felt takes the whole height, so the tray is two corner docks over
 * it instead of a strip under it (Plan 26, B4). Its right part is one row of action buttons; the bet/raise button
 * first opens the presets in the left corner ("✎" among them, for a typed amount in `AmountDialog`), and with them
 * open it raises. There is no slider (Q7) and no inline number field: the soft keyboard would cover it.
 */
export function ActionBar({
  hand,
  room,
  onAct,
  disabled = false,
  lang,
  preAction = null,
  onPreAction,
  autoPlay = false,
  onAutoPlay,
  frame = 'desktop',
  betweenHands = false,
}: ActionBarProps) {
  const { t } = useTranslation()
  const legal = hand.legal
  const amountRef = useRef<HTMLInputElement>(null)
  const landscape = frame === 'landscape'

  const kinds = useMemo(() => legal?.kinds ?? [], [legal])
  const canRaise = kinds.includes('raise')
  const canBet = kinds.includes('bet')
  const sizing = canRaise || canBet
  const min = canRaise ? (legal?.minRaiseTo ?? 0) : (legal?.minBet ?? 0)
  const max = canRaise ? (legal?.maxRaiseTo ?? 0) : (legal?.maxBet ?? 0)

  const [raw, setRaw] = useState(() => String(min))
  // Landscape: the presets in the left corner, and the typed-amount dialog. Each turn starts with both shut.
  const [sizerOpen, setSizerOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const yourTurn = legal !== null
  useEffect(() => {
    setRaw(String(min))
    setSizerOpen(false)
    setDialogOpen(false)
  }, [min, max, hand.handId, yourTurn])

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
    // The dialog answers its own keys (Enter confirms it, Escape closes it); the tray's would fold under it.
    if (legal === null || disabled || dialogOpen) return
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
      else if (key === 'r' && sizing && landscape) {
        setSizerOpen(true)
        setDialogOpen(true)
      } else if (key === 'r' && sizing) amountRef.current?.focus()
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [legal, disabled, dialogOpen, sizing, landscape, kinds, emit, submit])

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

  // The pieces every variant draws; the frame decides where they go.
  const waitLine =
    legal === null ? (
      <p className={s.trayWait} role="status">
        {t(trayWaitKey(hand, mine))}
      </p>
    ) : null
  // Pre-actions are for the time between turns: with a legal action in hand there is nothing to tick in advance.
  const preActionRow =
    legal === null && offersPreActions ? (
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
    ) : null
  const autoPlayRow =
    autoPlayToggle === null ? null : (
      <div className={s.preRow} role="group" aria-label={t('preActions.label')}>
        {autoPlayToggle}
      </div>
    )

  const onAmountChange = (event: ChangeEvent<HTMLInputElement>): void => setRaw(event.target.value)
  const preset = (n: number): void => setRaw(String(clamp(n)))
  const step = Math.max(1, Math.round((max - min) / SLIDER_STEPS))

  const wager = legal !== null && legal.callAmount > 0 ? legal.callAmount : (room.config.blind?.fixedWager ?? 0)
  const callAmount = legal?.callAmount ?? 0
  /**
   * A verb with its figure: "Theo 104.000". On the desktop it is one string, as it always was. In landscape the two are
   * spans, so a narrow corner can stack the figure under the verb (`.btnAmount`, a container query) — the figure stays
   * on screen, since a phone has no hover to show a tooltip — and the button's name is the whole phrase.
   */
  const labelled = (verb: string, amount: number | null): { children: ReactNode; label: string | undefined } => {
    const full = amount === null ? verb : `${verb} ${formatPoints(amount, lang)}`
    if (!landscape || amount === null) return { children: full, label: undefined }
    return {
      children: (
        <>
          <span>{verb}</span>
          <span className={s.btnAmount}>{formatPoints(amount, lang)}</span>
        </>
      ),
      label: full,
    }
  }
  // Plan 27 D2: a seat short of the wager plays all in for what the ante left (`callAmount` is min(stack, wager)), and
  // the button says so with the stable "Tất tay" — still a `play` on the wire.
  const fixedWager = room.config.blind?.fixedWager ?? 0
  const playsAllIn = legal !== null && legal.callAmount > 0 && legal.callAmount < fixedWager
  const play = labelled(t(playsAllIn ? 'actions.allIn' : 'actions.play'), wager)
  const call = labelled(t('actions.call'), callAmount > 0 ? callAmount : null)
  const submitLabel = labelled(t(canRaise ? 'actions.raise' : 'actions.bet'), value)

  const presetButtons = (
    <>
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
    </>
  )

  // Blind mode's play-or-fold decision is its own two-button row: no sizing, no call.
  const playRow = (
    <div className={s.trayRow}>
      <Button variant="danger" size="lg" disabled={disabled} aria-keyshortcuts="F" onClick={() => emit({ kind: 'fold' })}>
        {t('actions.fold')}
      </Button>
      <Button variant="gold" size="lg" disabled={disabled} className={s.grow} aria-label={play.label} onClick={() => emit({ kind: 'play' })}>
        {play.children}
      </Button>
    </div>
  )

  // Landscape keeps one row until the player asks to size: the bet/raise button opens the presets, then raises.
  const sizerShut = landscape && !sizerOpen
  const actionRow = (
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
        <Button
          variant="primary"
          size="lg"
          disabled={disabled}
          aria-keyshortcuts="C"
          aria-label={call.label}
          onClick={() => emit({ kind: 'call' })}
        >
          {call.children}
        </Button>
      ) : null}
      {sizing ? (
        <Button
          variant="gold"
          size="lg"
          disabled={disabled}
          className={s.grow}
          aria-keyshortcuts="Enter"
          aria-label={sizerShut ? undefined : submitLabel.label}
          onClick={sizerShut ? () => setSizerOpen(true) : submit}
        >
          {sizerShut ? t(canRaise ? 'actions.raise' : 'actions.bet') : submitLabel.children}
        </Button>
      ) : null}
      {/* Landscape, sizing: "Max" in the left corner raises everything, and the corner has no width for a fifth label. */}
      {kinds.includes('allIn') && !(sizing && landscape && sizerOpen) ? (
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
  )

  if (landscape) {
    // The presets take the left corner, which has nothing else to hold on the player's own turn (the pre-actions are
    // for the time between turns): stacked over the buttons they made the right corner two rows tall, and that row
    // ran into the seat beside the viewer's (Plan 26, B4).
    const sizerRow =
      sizing && sizerOpen && !betweenHands ? (
        <div className={s.presets} role="group" aria-label={t('labels.betSize')}>
          {presetButtons}
          <button type="button" className={s.preset} disabled={disabled} aria-label={t('labels.amountDialog')} onClick={() => setDialogOpen(true)}>
            {EDIT_GLYPH}
          </button>
        </div>
      ) : null
    const toggles =
      preActionRow === null && autoPlayRow === null ? null : (
        <>
          {preActionRow}
          {autoPlayRow}
        </>
      )
    const left = sizerRow ?? toggles
    const right = legal === null ? waitLine : kinds.includes('play') ? playRow : actionRow
    return (
      <div className={s.tray} data-frame={frame} data-surface="night" role="group" aria-label={t('labels.actions')}>
        {left === null ? null : <div className={s.trayLeft}>{left}</div>}
        {betweenHands ? null : <div className={s.trayRight}>{right}</div>}
        {sizing ? (
          <AmountDialog
            open={dialogOpen}
            value={value}
            min={min}
            max={max}
            onConfirm={(amount) => {
              setRaw(String(amount))
              setDialogOpen(false)
            }}
            onClose={() => setDialogOpen(false)}
          />
        ) : null}
      </div>
    )
  }

  if (legal === null) {
    return (
      <div className={s.tray} data-frame={frame} data-surface="night" role="group" aria-label={t('labels.actions')}>
        {waitLine}
        {preActionRow}
        {autoPlayRow}
      </div>
    )
  }

  if (kinds.includes('play')) {
    return (
      <div className={s.tray} data-frame={frame} data-surface="night" role="group" aria-label={t('labels.actions')}>
        {playRow}
        {autoPlayRow}
      </div>
    )
  }

  return (
    <div className={s.tray} data-frame={frame} data-surface="night" role="group" aria-label={t('labels.actions')}>
      {sizing ? (
        <div className={s.sizer} role="group" aria-label={t('labels.betSize')}>
          <div className={s.presets}>{presetButtons}</div>
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
      {actionRow}
    </div>
  )
}
