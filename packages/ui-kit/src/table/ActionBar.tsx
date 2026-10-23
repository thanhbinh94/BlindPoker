import type { PlayerAction, RoomView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PreActionKind } from '../client/preaction.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { BetPanel, betStep } from './BetPanel.js'
import type { FrameTier, RoomFrame } from './frame.js'
import type { TableLayout } from './PokerTable.js'
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
   * toggles bottom-left, the betting buttons bottom-right, and the bet panel in the left corner once Tố is tapped
   * (Plan 26, B4; BP-31 §3.3). `desktop` (the default) is the tray under the felt.
   */
  frame?: RoomFrame
  /**
   * The table's layout as the room resolved it (`RoomScreen`, BP-31 R9): `stack` — a phone held upright, or any window
   * under 768 px wide or 620 px tall — gets the one-row tray with 44 px buttons and the two-step bet panel; `ring` (the
   * default) the desktop tray, chips and slider always shown. The landscape frame is always `ring` here.
   */
  layout?: TableLayout
  /** The landscape frame's tier (BP-28): on the `short` one the bet panel is compact (32 px chips, a 36 px slider). */
  tier?: FrameTier
  /**
   * Landscape only: no hand is being played (the room waits, or the countdown runs with the result card closed). The
   * room's own dock holds the bottom-right corner then, so the tray gives up its right part and keeps its left one —
   * a player can still turn "Tự động chơi" off before the next deal.
   */
  betweenHands?: boolean
}

const PRE_ACTIONS: readonly PreActionKind[] = ['checkFold', 'callAny', 'fold']

/** The "open the bet panel" glyph after "Tố" / "Cược": decoration, so the button's name stays the word alone. */
const OPEN_GLYPH = '▴'

/** Controls that answer Enter themselves: the tray's Enter must leave them be (a focused Bỏ bài folds, a chip sets). */
const OWN_ENTER = 'button, a, [role="button"], [role="menuitem"], [role="menuitemcheckbox"]'

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
 * Only the kinds the server declared legal are offered; a bet or a raise is chosen in the `BetPanel` (chips and a
 * slider, no number field anywhere — BP-31 §3.2), bounded by the legal range, so a click can never produce an illegal
 * amount. Shortcuts: F fold, C check/call, R the bet panel, Enter raise, Esc close the panel — all advertised through
 * `aria-keyshortcuts`. Enter on a focused button is that button's own (it never raises behind it).
 *
 * Three shapes (BP-31 R6, R9):
 *  - `ring` on the desktop frame — one step: the chips and the slider stand over the action row whenever sizing is
 *    offered, the row keeps Tất tay apart (R4), and its buttons are 52 px (`lg`).
 *  - `stack` — one row of 44 px buttons (`md`): Bỏ bài · Xem|Theo N · Tố ▴|Cược ▴ (or Tất tay when no size is legal).
 *    Two steps: Tố ▴ (or Enter, or R) swaps the row for the panel, which carries Hủy ▾ and the confirm "Tố N"; all in is
 *    the panel's chip (R2). Between turns the pre-action toggles take the row, and the wait line shows only without them.
 *  - the landscape frame — two corner docks over the felt (Plan 26, B4): the right one a row of action buttons, the
 *    left one the toggles; Tố ▴ puts the panel in the left corner and the same button becomes "Tố N".
 *
 * Between turns the tray stays put and says what the seat is waiting for (`trayWaitKey`): it is a fixture of the room,
 * not a popup, and a tray that came and went would resize the felt above it on every turn.
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
  layout = 'ring',
  tier = 'normal',
  betweenHands = false,
}: ActionBarProps) {
  const { t } = useTranslation()
  const legal = hand.legal
  const amountRef = useRef<HTMLInputElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const landscape = frame === 'landscape'
  const stack = !landscape && layout === 'stack'
  /** R6: the phone trays (stack and landscape) open the panel first; the desktop ring shows it at once. */
  const twoStep = stack || landscape
  const buttonSize = stack ? 'md' : 'lg'

  const kinds = useMemo(() => legal?.kinds ?? [], [legal])
  const canRaise = kinds.includes('raise')
  const canBet = kinds.includes('bet')
  const sizing = canRaise || canBet
  const min = canRaise ? (legal?.minRaiseTo ?? 0) : (legal?.minBet ?? 0)
  const max = canRaise ? (legal?.maxRaiseTo ?? 0) : (legal?.maxBet ?? 0)

  // The amount chosen this turn; `null` is "the minimum", whatever the minimum is when it is read.
  const [amount, setAmount] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // Where the focus goes once the panel has drawn or gone: the slider (opened from the keyboard), or back to Tố ▴.
  const [focusNext, setFocusNext] = useState<'slider' | 'open' | null>(null)
  const yourTurn = legal !== null
  // Each turn — each street and each hand — starts at the minimum with the panel shut: a seat can act last on one street
  // and first on the next without `yourTurn` ever going false between them, so the board's length is in the key too.
  // New bounds within the turn (a reconnect, a bot acting) keep the panel open and the amount re-clamps (P6).
  const street = hand.community.length
  useEffect(() => {
    setAmount(null)
    setPanelOpen(false)
  }, [hand.handId, yourTurn, street])
  useEffect(() => {
    setAmount((a) => (a === null ? null : Math.min(max, Math.max(min, a))))
  }, [min, max])

  const value = Math.min(max, Math.max(min, Math.round(amount ?? min)))
  const panelShown = sizing && legal !== null && (!twoStep || (panelOpen && !(landscape && betweenHands)))

  useEffect(() => {
    if (focusNext === null) return
    if (focusNext === 'slider') amountRef.current?.focus()
    else trayRef.current?.querySelector<HTMLButtonElement>('[data-bet-open]')?.focus()
    setFocusNext(null)
  }, [focusNext, panelShown])

  const emit = useCallback(
    (action: PlayerAction) => {
      if (!disabled) onAct(action)
    },
    [disabled, onAct],
  )
  const submit = useCallback(() => {
    emit({ kind: canRaise ? 'raise' : 'bet', amount: value })
  }, [emit, canRaise, value])
  const openPanel = useCallback((focus: boolean) => {
    setPanelOpen(true)
    if (focus) setFocusNext('slider')
  }, [])
  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setFocusNext('open')
  }, [])

  useEffect(() => {
    if (legal === null || disabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
      if (event.key === 'Enter') {
        if (!sizing) return
        // A focused button (Bỏ bài, a chip, Hủy, the confirm) answers its own Enter: raising behind it is a money bug.
        if (target?.closest(OWN_ENTER) != null) return
        if (inField && target !== amountRef.current) return
        event.preventDefault()
        if (twoStep && !panelShown) openPanel(true)
        else submit()
        return
      }
      if (event.key === 'Escape') {
        if (!twoStep || !panelShown) return
        event.preventDefault()
        closePanel()
        return
      }
      if (inField) return
      const key = event.key.toLowerCase()
      if (key === 'f' && kinds.includes('fold')) emit({ kind: 'fold' })
      else if (key === 'c' && kinds.includes('check')) emit({ kind: 'check' })
      else if (key === 'c' && kinds.includes('call')) emit({ kind: 'call' })
      else if (key === 'r' && sizing && twoStep) openPanel(true)
      else if (key === 'r' && sizing) amountRef.current?.focus()
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [legal, disabled, sizing, twoStep, panelShown, kinds, emit, submit, openPanel, closePanel])

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

  // The pieces every variant draws; the frame and the layout decide where they go.
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

  const wager = legal !== null && legal.callAmount > 0 ? legal.callAmount : (room.config.blind?.fixedWager ?? 0)
  const callAmount = legal?.callAmount ?? 0
  /**
   * A verb with its figure: "Theo 104.000". On the desktop and in the stack it is one string, as it always was. In
   * landscape the two are spans, so a narrow corner can stack the figure under the verb (`.btnAmount`, a container
   * query) — the figure stays on screen, since a phone has no hover to show a tooltip — and the button's name is the
   * whole phrase.
   */
  const labelled = (verb: string, figure: number | null): { children: ReactNode; label: string | undefined } => {
    const full = figure === null ? verb : `${verb} ${formatPoints(figure, lang)}`
    if (!landscape || figure === null) return { children: full, label: undefined }
    return {
      children: (
        <>
          <span>{verb}</span>
          <span className={s.btnAmount}>{formatPoints(figure, lang)}</span>
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
  const sizeVerb = t(canRaise ? 'actions.raise' : 'actions.bet')
  const submitLabel = labelled(sizeVerb, value)

  const panel = panelShown ? (
    <BetPanel
      min={min}
      max={max}
      step={betStep(min, max, room.config.holdem?.smallBlind ?? 1)}
      value={value}
      pot={hand.pot}
      lang={lang}
      disabled={disabled}
      frame={frame}
      compact={landscape && tier === 'short'}
      onChange={setAmount}
      inputRef={amountRef}
      // The stack's sheet carries the confirm; landscape's is the right corner's single button; the ring's is the row's.
      {...(twoStep ? { onCancel: closePanel } : {})}
      {...(stack ? { confirmLabel: `${sizeVerb} ${formatPoints(value, lang)}`, onConfirm: submit } : {})}
    />
  ) : null

  const foldButton = (
    <Button variant="danger" size={buttonSize} disabled={disabled} aria-keyshortcuts="F" onClick={() => emit({ kind: 'fold' })}>
      {t('actions.fold')}
    </Button>
  )

  // Blind mode's play-or-fold decision: no sizing, no call. The stack puts "Tự động chơi" in the same row (P11).
  const playRow = (
    <div className={s.trayRow}>
      {stack ? autoPlayToggle : null}
      {foldButton}
      <Button variant="gold" size={buttonSize} disabled={disabled} className={s.grow} aria-label={play.label} onClick={() => emit({ kind: 'play' })}>
        {play.children}
      </Button>
    </div>
  )

  // The bet/raise button. One step (the ring): it raises by the chosen amount. Two steps: closed, "Tố ▴" opens the
  // panel; open, landscape's same button raises ("Tố N"), and the stack's row is gone under the panel.
  const sizeButton = !sizing ? null : twoStep && !panelShown ? (
    <Button
      data-bet-open=""
      variant="gold"
      size={buttonSize}
      disabled={disabled}
      className={s.grow}
      aria-keyshortcuts="R Enter"
      // The stack's row unmounts under the panel, so its focus moves to the slider rather than falling to the page; in
      // landscape the button stays (it becomes "Tố N"), and only a keyboard press (`detail` 0) moves the focus on.
      onClick={(event) => openPanel(stack || event.detail === 0)}
    >
      {sizeVerb}
      <span aria-hidden="true">{OPEN_GLYPH}</span>
    </Button>
  ) : (
    <Button
      variant="gold"
      size={buttonSize}
      disabled={disabled}
      className={s.grow}
      aria-keyshortcuts="Enter"
      aria-label={submitLabel.label}
      onClick={submit}
    >
      {submitLabel.children}
    </Button>
  )
  // All in stands apart on the ring (R4), and fills the size button's place wherever no size is legal; on the phone
  // trays with sizing it is the panel's chip (R2).
  const allInButton =
    kinds.includes('allIn') && !(sizing && twoStep) ? (
      <Button
        variant={sizing ? 'ghost' : 'gold'}
        size={buttonSize}
        disabled={disabled}
        className={cx(sizing ? s.allInGhost : s.grow)}
        onClick={() => emit({ kind: 'allIn' })}
      >
        {t('actions.allIn')}
      </Button>
    ) : null
  const actionRow = (
    <div className={s.trayRow}>
      {kinds.includes('fold') ? foldButton : null}
      {kinds.includes('check') ? (
        <Button variant="primary" size={buttonSize} disabled={disabled} aria-keyshortcuts="C" onClick={() => emit({ kind: 'check' })}>
          {t('actions.check')}
        </Button>
      ) : null}
      {kinds.includes('call') ? (
        <Button
          variant="primary"
          size={buttonSize}
          disabled={disabled}
          aria-keyshortcuts="C"
          aria-label={call.label}
          onClick={() => emit({ kind: 'call' })}
        >
          {call.children}
        </Button>
      ) : null}
      {sizeButton}
      {allInButton}
    </div>
  )

  const trayProps = {
    ref: trayRef,
    className: s.tray,
    'data-frame': frame,
    'data-layout': stack ? 'stack' : 'ring',
    'data-panel': panel === null ? 'closed' : 'open',
    'data-surface': 'night',
    role: 'group',
    'aria-label': t('labels.actions'),
  } as const

  if (landscape) {
    // The panel takes the left corner, which has nothing else to hold on the player's own turn (the pre-actions are
    // for the time between turns): stacked over the buttons it would make the right corner two rows tall, and that row
    // ran into the seat beside the viewer's (Plan 26, B4).
    const toggles =
      preActionRow === null && autoPlayRow === null ? null : (
        <>
          {preActionRow}
          {autoPlayRow}
        </>
      )
    const left = panel ?? toggles
    const right = legal === null ? waitLine : kinds.includes('play') ? playRow : actionRow
    return (
      <div {...trayProps}>
        {left === null ? null : <div className={s.trayLeft}>{left}</div>}
        {betweenHands ? null : <div className={s.trayRight}>{right}</div>}
      </div>
    )
  }

  if (stack) {
    // One row, whatever the state (spec §3.1): the row of the turn, or the panel in its place; between turns the
    // toggles, or — with none to offer — the line saying what the seat waits for. Blind keeps its line beside
    // "Tự động chơi" (P11).
    let row: ReactNode
    if (legal === null) {
      if (hand.mode === 'blind') {
        row =
          autoPlayToggle === null ? (
            waitLine
          ) : (
            <div className={s.trayRow}>
              {autoPlayToggle}
              {waitLine}
            </div>
          )
      } else row = preActionRow ?? waitLine
    } else if (kinds.includes('play')) row = playRow
    else row = panel ?? actionRow
    return <div {...trayProps}>{row}</div>
  }

  if (legal === null) {
    return (
      <div {...trayProps}>
        {waitLine}
        {preActionRow}
        {autoPlayRow}
      </div>
    )
  }

  if (kinds.includes('play')) {
    return (
      <div {...trayProps}>
        {playRow}
        {autoPlayRow}
      </div>
    )
  }

  return (
    <div {...trayProps}>
      {panel}
      {actionRow}
    </div>
  )
}
