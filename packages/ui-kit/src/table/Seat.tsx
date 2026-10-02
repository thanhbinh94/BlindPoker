import type { RoomPlayerView } from '@bp/core'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Chibi, type ChibiSubject, type Expression } from '../avatar2d/index.js'
import type { ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge, type BadgeTone } from '../primitives/Badge.js'
import { cx } from '../primitives/cx.js'
import { CARD_STAGGER_MS, Card } from './Card.js'
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
          {faces.map((card, i) => (
            <Card key={i} card={card} faceDown={card === null} size={cardSize} delayMs={i * CARD_STAGGER_MS} />
          ))}
        </div>
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
        {isActing ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={38} /> : null}
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
