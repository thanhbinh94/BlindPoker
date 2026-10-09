import type { RoomPlayerView } from '@bp/core'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Chibi, type ChibiSubject, type Expression } from '../avatar2d/index.js'
import type { ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge, type BadgeTone } from '../primitives/Badge.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import { DEAL_STAGGER_MS, SHOWDOWN_STAGGER_MS } from './motion.js'
import { PeelCard } from './PeelCard.js'
import { TurnTimer } from './TurnTimer.js'
import s from './table.module.css'

const DEALER_GLYPH = 'D'
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
  /** The hand the cards belong to: each hand's cards are new cards, dealt afresh even when the count is the same. */
  handId: string | null
  /**
   * The cards have just been dealt: they come out of the deck one at a time round the table (spec 2026-10-08 §4.1.1).
   * Otherwise — a snapshot, a remount — they show at once, with no stagger (ruling 18).
   */
  dealt: boolean
  /** This seat's place in the deal, 0 for the first seat after the button. */
  dealIndex: number
  /** How many seats are dealt in. A dealt card `i` waits `(i × dealCount + dealIndex) × DEAL_STAGGER_MS`. */
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
  /** Every one of my cards is up, by hand or by the "Lật" pill, while the round is on: tell the server. Once per hand. */
  onReveal?: () => void
}

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
  handId,
  dealt,
  dealIndex,
  dealCount,
  reveal,
  liftAfter,
  squeezeRoom,
  squeezeRound,
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

  // Squeeze mode (spec 2026-10-08 §4.2): on a squeeze table the viewer's own cards are `PeelCard`s for the whole hand —
  // swapped for `Card`s mid-hand they would remount and come out of the deck again. They open by hand, all at once on the
  // "Lật" pill, once the server has the seat turned (a decision, the forced turn at the deadline) and when the round is
  // over (§4.2.4). The pill and the round's ring on the plate (ruling 14) stay while a card is still to turn. The server
  // is told once a hand, when the last card is up — unless it turned the seat itself, or the round is over.
  const peeling = squeezeRoom && isMe && seat.holeCards !== null
  // Kept by hand, so the next hand starts afresh: the hand whose cards the pill opened, the one whose cards are all up,
  // and — read only when a card reports — which of this hand's cards are up and whether the server has been told.
  const [pressedIn, setPressedIn] = useState<string | null>(null)
  const [upIn, setUpIn] = useState<string | null>(null)
  const turnedUp = useRef<{ handId: string | null; cards: Set<number>; told: boolean }>({ handId: null, cards: new Set(), told: false })
  const openAll = pressedIn !== null && pressedIn === handId
  const allUp = upIn !== null && upIn === handId
  const toTurn = peeling && squeezeRound && !openAll && !allUp && seat.revealed !== true
  const onCardUp = (i: number): void => {
    if (turnedUp.current.handId !== handId) turnedUp.current = { handId, cards: new Set(), told: false }
    const mine = turnedUp.current
    mine.cards.add(i)
    if (mine.told || mine.cards.size < faces.length) return
    mine.told = true
    setUpIn(handId)
    if (squeezeRound && seat.revealed !== true) onReveal?.()
  }

  return (
    <div
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
      // `RoomScreen` measures the viewer's own seat and its plate to stop the result card above them (review round 2,
      // R2-3). These two markers are that contract; the CSS modules' class names are hashed and are not.
      data-me={isMe ? 'true' : undefined}
      role="group"
      aria-label={seatLabel}
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
                delayMs={dealt ? (i * dealCount + dealIndex) * DEAL_STAGGER_MS : 0}
              />
            ) : (
              <Card
                key={`${handId}:${i}`}
                card={card}
                faceDown={card === null}
                size={cardSize}
                dealt={dealt}
                reveal={reveal}
                delayMs={dealt ? (i * dealCount + dealIndex) * DEAL_STAGGER_MS : 0}
                turnDelayMs={liftAfter + i * SHOWDOWN_STAGGER_MS}
              />
            ),
          )}
        </div>
      ) : null}
      {/* The pill keeps its place for the whole hand and shows while a card is still to turn: taken out, it would move
          the seat's block — and the cards opening in it — by half its height on the ring, where a seat is centred on its
          point, and by all of it on the phone. */}
      {peeling ? (
        <button
          type="button"
          className={cx(s.revealBtn, !toTurn && s.revealBtnIdle)}
          disabled={!toTurn}
          aria-hidden={toTurn ? undefined : true}
          onClick={() => setPressedIn(handId)}
        >
          {t('actions.revealCards')}
        </button>
      ) : null}

      <div className={s.plate} data-plate="">
        {/* Every seat gets the same framed disc: a bot's chibi chosen by its id, the app's chibi for a human, and
            the initial when the app has none. The frame is what makes a table of six read as six faces. */}
        <span className={s.avatar} data-face={seat.isBot ? 'bot' : chibi === null ? 'default' : 'app'} aria-hidden="true">
          {chibi === null ? initial : <Chibi subject={chibi} expression={expression} frame="head" bounce={bounce} />}
        </span>
        <span className={s.plateText}>
          <span className={s.seatName}>{name}</span>
          {caption === undefined || caption === null ? null : <span className={s.seatCaption}>{caption}</span>}
          {/* A bot's stack is virtual — a table limit (5 × the wager) that is topped back up whenever it runs low, so
              a figure beside it would only read as a real balance to compare against. The Bot badge below says what
              the seat is; its bets and payouts still show like anyone else's. */}
          {seat.isBot ? null : <span className={s.seatStack}>{formatPoints(seat.stack, lang)}</span>}
        </span>
        {isActing || toTurn ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={38} /> : null}
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
        {/* Squeeze mode (§4.2.6): who has turned, for the others to see whom the round still waits on. */}
        {!isMe && squeezeRound && seat.revealed === true ? <Badge tone="teal">{t('labels.revealed')}</Badge> : null}
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
