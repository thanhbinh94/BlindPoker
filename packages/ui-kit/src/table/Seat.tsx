import type { RoomPlayerView } from '@bp/core'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Chibi, type ChibiSubject, type Expression } from '../avatar2d/index.js'
import type { ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge, type BadgeTone } from '../primitives/Badge.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import { SHOWDOWN_STAGGER_MS, dealStaggerMs } from './motion.js'
import type { RoomFrame } from './frame.js'
import { PeelCard } from './PeelCard.js'
import { RankLabel } from './RankLabel.js'
import { TurnTimer } from './TurnTimer.js'
import s from './table.module.css'

const DEALER_GLYPH = 'D'
/** Under this many pixels of plate text the rank's name gives way to its numeral (spec 2026-10-21 §2 A4). */
export const RANK_WORD_MIN_PX = 120

/**
 * Whether the element is narrower than `min` px: measured before the first paint and again on every resize. Where there
 * is nothing laid out (jsdom: a 0 px box) or no `ResizeObserver`, it is not — the full label is the default.
 * The two answers cannot chase each other: the numeral never makes the box wider than the word did, nor the word narrower.
 */
function useNarrowerThan(ref: RefObject<HTMLElement>, min: number, active: boolean): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || el === null) return
    const measure = (): void => {
      const width = el.getBoundingClientRect().width
      setNarrow(width > 0 && width < min)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, min, active])
  return active && narrow
}
/** Marks the host's badge apart from "you" when both are gold (layout audit C4). */
const CROWN_GLYPH = '♛ '

export interface SeatProps {
  seat: ClientSeat
  /** Roster entry for this seat; carries connection/host/sitting-out state the hand view does not. */
  player: RoomPlayerView | undefined
  isMe: boolean
  isActing: boolean
  isButton: boolean
  /** Chips won this hand, or `null` when the seat did not win. */
  winnerPayout: number | null
  /** Already-translated hand category, shown after a showdown. */
  showdownLabel: string | null
  deadlineAt: number | null
  serverNow: () => number
  turnTimerMs: number
  lang: Language
  /** Ring coordinates in percent; `null` lets the layout place the seat (stack layout). */
  position: { x: number; y: number } | null
  /** `null` when the seat has no chibi to draw — a bot always has one, a human player only when the app's
   * `chibiFor` answers one; the plate falls back to the name's initial. */
  chibi: ChibiSubject | null
  expression: Expression
  /** The 0.5 s turn bounce (spec 08 §3.4) — true for the seat whose turn it is. */
  bounce: boolean
  /**
   * One quiet line under the name — a title, a rank, whatever the app wants to say about this player. It is
   * muted, single-line and truncated, because the plate's job is the name and the stack; anything longer than
   * a couple of words belongs somewhere else on the screen.
   */
  caption?: ReactNode
  /**
   * The player's reputation rank 1..5 (Plan 27, spec 2026-10-21 §2 A4), shown after the name: the rank's name on a wide
   * plate, its roman numeral when the plate's text box is under 120 px or the room is in the `landscape` frame. Rank 1,
   * `null` and a bot's seat show nothing.
   */
  rank?: number | null
  /** The room's frame, as `PokerTable` has it: `landscape` always shortens the rank to its numeral. */
  frame?: RoomFrame
  /** The hand the cards belong to: each hand's cards are new cards, dealt afresh even when the count is the same. */
  handId: string | null
  /**
   * The cards have just been dealt: they come out of the deck one at a time round the table (spec 2026-10-08 §4.1.1).
   * Otherwise — a snapshot, a remount — they show at once, with no stagger (ruling 18).
   */
  dealt: boolean
  /** This seat's place in the deal, 0 for the first seat after the button. */
  dealIndex: number
  /**
   * How many seats are dealt in. A dealt card `i` waits `(i × dealCount + dealIndex) × dealStaggerMs(dealCount × cards)`:
   * a step of `DEAL_STAGGER_MS`, shorter when the whole deal would take longer than `DEAL_SPAN_MS` (ruling 26).
   */
  dealCount: number
  /** How a card that was face down turns when it is revealed: the viewer's own in place, an opponent's lifted. */
  reveal: 'flip' | 'lift'
  /** When the showdown's first card turns — later when the river came with it; card `i` waits `i × SHOWDOWN_STAGGER_MS` more. */
  liftAfter: number
  /**
   * The hand is on a squeeze table (spec 2026-10-08 §4.2), in every phase of it: the viewer's own cards are theirs to turn,
   * `PeelCard`s from the deal to the end of the hand.
   */
  squeezeRoom: boolean
  /** The squeeze round is on — `SQUEEZE`, or a squeeze table's `DECISION`: a seat that has turned says so to the others. */
  squeezeRound: boolean
  /**
   * The round is a play-or-fold decision (a squeeze table's `DECISION`): its 20 s covers the peel and then the choice, so
   * the viewer's ring stays until they have chosen, not just until their cards are up (ruling 21).
   */
  squeezeDecides: boolean
  /**
   * The hand was rebuilt from a snapshot (`ClientHand.restored`): after a reconnect, the server may not have the `REVEAL`
   * this seat sent before the socket dropped. Defaults to `false`.
   */
  restored?: boolean
  /**
   * Every one of my cards is up, by hand or by the "Lật" pill, while the round is on: tell the server. Once per hand —
   * and once more if the hand comes back from a snapshot that has my seat still unturned after I told it (`restored`).
   */
  onReveal?: () => void
}

/** What a seat knows of its own cards in a squeeze round, for one hand (see `Seat`). */
interface TurnedUp {
  handId: string | null
  /** The cards seen up. */
  cards: Set<number>
  /** All of them have been: `setUpIn` has run, and the server was told if it had to be. */
  allUp: boolean
  /** The server was told while the hand was live, not rebuilt from a snapshot: what a reconnect may have lost. */
  toldLive: boolean
  /** …and told once more after the snapshot. */
  retold: boolean
}

const turnedUpIn = (handId: string | null): TurnedUp => ({ handId, cards: new Set(), allUp: false, toldLive: false, retold: false })

/** One seat plaque: cards, name, stack, bet, state pill, dealer button, turn ring and winner glow. */
export function Seat({
  seat,
  player,
  isMe,
  isActing,
  isButton,
  winnerPayout,
  showdownLabel,
  deadlineAt,
  serverNow,
  turnTimerMs,
  lang,
  position,
  chibi,
  expression,
  bounce,
  caption,
  rank = null,
  frame = 'desktop',
  handId,
  dealt,
  dealIndex,
  dealCount,
  reveal,
  liftAfter,
  squeezeRoom,
  squeezeRound,
  squeezeDecides,
  restored = false,
  onReveal,
}: SeatProps) {
  const { t } = useTranslation()
  const name = seat.displayName === '' ? (player?.displayName ?? '') : seat.displayName
  const seatLabel = t('labels.seatNumber', { seat: seat.seat + 1 })
  const initial = name.trim().slice(0, 1).toUpperCase()
  const style: CSSProperties | undefined = position === null ? undefined : { left: `${position.x}%`, top: `${position.y}%` }

  const pill: { tone: BadgeTone; text: string } | null = seat.folded
    ? { tone: 'muted', text: t('labels.folded') }
    : seat.allIn
      ? { tone: 'gold', text: t('labels.allIn') }
      : player?.connected === false
        ? { tone: 'red', text: t('labels.disconnected') }
        : player?.status === 'SITTING_OUT'
          ? { tone: 'muted', text: t('labels.sittingOut') }
          : seat.hasDecided
            ? { tone: 'teal', text: t('labels.decided') }
            : null

  const faces = seat.holeCards ?? Array.from({ length: seat.cardCount }, () => null)
  const cardSize = isMe ? 'md' : 'sm'
  const payoutText = winnerPayout === null ? '' : `+${formatPoints(winnerPayout, lang)}`
  /**
   * When card `i` comes out of the deck: round the table, one card per seat at a time, the whole deal within
   * `DEAL_SPAN_MS` (every seat holds as many cards as this one); at once when not dealt just now.
   */
  const dealStep = dealStaggerMs(dealCount * faces.length)
  const dealDelay = (i: number): number => (dealt ? (i * dealCount + dealIndex) * dealStep : 0)

  // Squeeze mode (spec 2026-10-08 §4.2): on a squeeze table the viewer's own cards are `PeelCard`s for the whole hand —
  // swapped for `Card`s mid-hand they would remount and come out of the deck again. They open by hand, all at once on the
  // "Lật" pill, once the server has the seat turned (a decision, the forced turn at the deadline) and when the round is
  // over (§4.2.4). The pill stays while a card is still to turn, and the round's ring on the plate (ruling 14) as long —
  // or, on a play-or-fold table, until the viewer has chosen (ruling 21). The server is told once a hand, when the last
  // card is up — unless it turned the seat itself, or the round is over.
  const peeling = squeezeRoom && isMe && seat.holeCards !== null
  // Kept by hand, so the next hand starts afresh: the hand whose cards the pill opened, the one whose cards are all up,
  // and — read only when a card reports — which of this hand's cards are up, whether they have all been seen up, and
  // whether the server was told while the hand was live (and told again since). All of it lives with this seat: a
  // ring↔stack switch mid-round remounts it, a card peeled but not yet reported comes back down, and the next "Lật" may
  // send a second REVEAL — which the engine takes as the no-op it is (spec §6).
  const [pressedIn, setPressedIn] = useState<string | null>(null)
  const [upIn, setUpIn] = useState<string | null>(null)
  const turnedUp = useRef<TurnedUp>(turnedUpIn(null))
  const openAll = pressedIn !== null && pressedIn === handId
  const allUp = upIn !== null && upIn === handId
  const toTurn = peeling && squeezeRound && !openAll && !allUp && seat.revealed !== true
  // Not keyed on `revealed`: a REVEAL during the decision turns the seat with the choice still to make.
  const ring = isActing || toTurn || (isMe && squeezeDecides && !seat.hasDecided)
  const onCardUp = (i: number): void => {
    if (turnedUp.current.handId !== handId) turnedUp.current = turnedUpIn(handId)
    const mine = turnedUp.current
    mine.cards.add(i)
    if (mine.allUp || mine.cards.size < faces.length) return
    mine.allUp = true
    setUpIn(handId)
    if (squeezeRound && seat.revealed !== true) {
      mine.toldLive = !restored
      onReveal?.()
    }
  }

  // A REVEAL lost with the socket (final fix wave M2): sent while the hand was live, it never reached the server, and the
  // reconnect's snapshot rebuilds the hand with my seat unturned — while my cards, in this same seat, stay up and the pill
  // stays hidden. Told once more, then. Not for a hand that was already a snapshot when I told: nothing was lost there.
  const retell = restored && peeling && squeezeRound && allUp && seat.revealed === false
  useEffect(() => {
    const mine = turnedUp.current
    if (!retell || mine.handId !== handId || !mine.toldLive || mine.retold) return
    mine.retold = true
    onReveal?.()
  }, [retell, handId, onReveal])

  // The pill goes out of reach (disabled, hidden) the moment there is nothing left to turn — pressed, the last card
  // peeled, the server's turn, the round's end. Focus on it would fall to the page (final fix wave M4): it moves to the
  // seat itself, before the browser drops it.
  const seatRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)

  // The rank after the name (Plan 27): a bot has none, rank 1 says nothing. The plate's text box is measured only while
  // there is a rank to fit, and in the landscape frame the numeral is the rule whatever the width.
  const shownRank = seat.isBot || rank === null || rank < 2 ? null : rank
  const plateTextRef = useRef<HTMLSpanElement>(null)
  const narrowPlate = useNarrowerThan(plateTextRef, RANK_WORD_MIN_PX, shownRank !== null && frame !== 'landscape')
  const compactRank = frame === 'landscape' || narrowPlate
  useLayoutEffect(() => {
    if (!toTurn && pillRef.current !== null && document.activeElement === pillRef.current) seatRef.current?.focus({ preventScroll: true })
  }, [toTurn])

  return (
    <div
      ref={seatRef}
      className={cx(
        s.seat,
        isMe && s.seatMe,
        isActing && s.seatActing,
        winnerPayout !== null && s.seatWin,
        seat.folded && s.seatFolded,
        player?.connected === false && s.seatOffline,
      )}
      style={style}
      data-seat={seat.seat}
      data-half={position !== null && position.y < 50 ? 'top' : 'bottom'}
      // The ring's flanks: a line under the plate wider than the seat runs onto the felt from there instead of
      // centring past the stage's edge (the landscape ring, Plan 26 B3).
      data-edge={position === null ? undefined : position.x < 15 ? 'left' : position.x > 85 ? 'right' : undefined}
      // `RoomScreen` measures the viewer's own seat and its plate to stop the result card above them (review round 2,
      // R2-3). These two markers are that contract; the CSS modules' class names are hashed and are not.
      data-me={isMe ? 'true' : undefined}
      role="group"
      aria-label={seatLabel}
      // where the pill hands focus on when it hides: reachable from a script, never by Tab
      tabIndex={peeling ? -1 : undefined}
    >
      {faces.length > 0 ? (
        <div className={s.seatCards}>
          {faces.map((card, i) =>
            peeling && card !== null ? (
              <PeelCard
                key={`${handId}:${i}`}
                card={card}
                size={cardSize}
                open={openAll || seat.revealed === true || !squeezeRound}
                onRevealed={() => onCardUp(i)}
                dealt={dealt}
                delayMs={dealDelay(i)}
              />
            ) : (
              <Card
                key={`${handId}:${i}`}
                card={card}
                faceDown={card === null}
                size={cardSize}
                dealt={dealt}
                reveal={reveal}
                delayMs={dealDelay(i)}
                turnDelayMs={liftAfter + i * SHOWDOWN_STAGGER_MS}
              />
            ),
          )}
          {/* The pill keeps its place for the whole hand and shows while a card is still to turn. It lies over the foot of the
              cards, centred, and takes no row of its own (Plan 26, B6): a row cost a squeeze table's stage 11 px on a 375 px
              phone, where the seat is the tallest thing in the felt. Hidden, it stays in the box, so nothing about the cards
              moves as the last one opens. */}
          {peeling ? (
            <button
              ref={pillRef}
              type="button"
              className={cx(s.revealBtn, !toTurn && s.revealBtnIdle)}
              disabled={!toTurn}
              aria-hidden={toTurn ? undefined : true}
              onClick={() => setPressedIn(handId)}
            >
              {t('actions.revealCards')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.plate} data-plate="">
        {/* Every seat gets the same framed disc: a bot's chibi chosen by its id, the app's chibi for a human, and
            the initial when the app has none. The frame is what makes a table of six read as six faces. */}
        <span className={s.avatar} data-face={seat.isBot ? 'bot' : chibi === null ? 'default' : 'app'} aria-hidden="true">
          {chibi === null ? initial : <Chibi subject={chibi} expression={expression} frame="head" bounce={bounce} />}
        </span>
        <span ref={plateTextRef} className={s.plateText}>
          <span className={s.seatName}>
            <span className={s.seatNameText}>{name}</span>
            {shownRank === null ? null : <RankLabel rank={shownRank} lang={lang} compact={compactRank} />}
          </span>
          {caption === undefined || caption === null ? null : <span className={s.seatCaption}>{caption}</span>}
          {/* A bot's stack is virtual — a table limit (5 × the wager) that is topped back up whenever it runs low, so
              a figure beside it would only read as a real balance to compare against. The Bot badge below says what
              the seat is; its bets and payouts still show like anyone else's. */}
          {seat.isBot ? null : <span className={s.seatStack}>{formatPoints(seat.stack, lang)}</span>}
        </span>
        {ring ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={38} /> : null}
        {isButton ? (
          <span className={s.dealer} role="img" aria-label={t('labels.dealer')}>
            {DEALER_GLYPH}
          </span>
        ) : null}
      </div>

      {/* Two lines under the plate at most (review 2026-09-29, No2): who the seat is and what it has in front of
          it — the badges and the bet — then how the hand ended for it — the hand's name and the payout. One badge,
          one chip and one tag a line each ran the viewer's own block six lines deep, past the foot of the stage. */}
      <div className={s.tags}>
        {isMe ? <Badge tone="gold">{t('labels.you')}</Badge> : null}
        {/* Gold, not red — red is for the risky acts (fold, leave, kick); a crown tells it apart from "you"
            when both sit on the same plate (layout audit C4). */}
        {player?.isHost === true ? (
          <Badge tone="gold">
            <span aria-hidden="true">{CROWN_GLYPH}</span>
            {t('labels.host')}
          </Badge>
        ) : null}
        {seat.isBot ? <Badge tone="muted">{t('labels.bot')}</Badge> : null}
        {pill === null ? null : <Badge tone={pill.tone}>{pill.text}</Badge>}
        {/* Squeeze mode (§4.2.6): who has turned, for the others to see whom the round still waits on. A seat that has
            decided has turned with it (§4.2.4): its "Đã chọn" says both, and keeps the line under the plate to one. */}
        {!isMe && squeezeRound && seat.revealed === true && !seat.hasDecided ? <Badge tone="teal">{t('labels.revealed')}</Badge> : null}
        {seat.betThisStreet > 0 ? <span className={s.bet}>{formatPoints(seat.betThisStreet, lang)}</span> : null}
      </div>

      {showdownLabel === null && winnerPayout === null ? null : (
        <div className={s.seatResult}>
          {showdownLabel === null ? null : <span className={s.handTag}>{showdownLabel}</span>}
          {winnerPayout === null ? null : <span className={s.payout}>{payoutText}</span>}
        </div>
      )}
    </div>
  )
}
