import type { RoomPlayerView } from '@bp/core'
import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge, type BadgeTone } from '../primitives/Badge.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import { TurnTimer } from './TurnTimer.js'
import s from './table.module.css'

const DEALER_GLYPH = 'D'

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
  avatar?: ReactNode
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
  avatar,
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
      role="group"
      aria-label={seatLabel}
    >
      {faces.length > 0 ? (
        <div className={s.seatCards}>
          {faces.map((card, i) => (
            <Card key={i} card={card} faceDown={card === null} size={cardSize} delayMs={i * 60} />
          ))}
        </div>
      ) : null}

      <div className={s.plate}>
        <span className={s.avatar} aria-hidden="true">
          {avatar ?? initial}
        </span>
        <span className={s.plateText}>
          <span className={s.seatName}>{name}</span>
          {caption === undefined || caption === null ? null : <span className={s.seatCaption}>{caption}</span>}
          <span className={s.seatStack}>{formatPoints(seat.stack, lang)}</span>
        </span>
        {isActing ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={38} /> : null}
        {isButton ? (
          <span className={s.dealer} role="img" aria-label={t('labels.dealer')}>
            {DEALER_GLYPH}
          </span>
        ) : null}
      </div>

      <div className={s.tags}>
        {isMe ? <Badge tone="gold">{t('labels.you')}</Badge> : null}
        {player?.isHost === true ? <Badge tone="red">{t('labels.host')}</Badge> : null}
        {seat.isBot ? <Badge tone="muted">{t('labels.bot')}</Badge> : null}
        {pill === null ? null : <Badge tone={pill.tone}>{pill.text}</Badge>}
      </div>

      {seat.betThisStreet > 0 ? <span className={s.bet}>{formatPoints(seat.betThisStreet, lang)}</span> : null}
      {showdownLabel === null ? null : <span className={s.handTag}>{showdownLabel}</span>}
      {winnerPayout === null ? null : <span className={s.payout}>{payoutText}</span>}
    </div>
  )
}
