import type { Card as CardId, RoomPlayerView, RoomView, ShowdownHand } from '@bp/core'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { handLabel, type Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { CommunityCards } from './CommunityCards.js'
import { Pot } from './Pot.js'
import { Seat } from './Seat.js'
import { ringPositions } from './geometry.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

export type TableLayout = 'ring' | 'stack'

export interface PokerTableProps {
  room: RoomView
  hand: ClientHand | null
  myPlayerId: string | null
  deadlineAt: number | null
  serverNow: () => number
  turnTimerMs: number
  lang: Language
  /** Defaults to `stack` under 768 px wide or 620 px tall, and `ring` above both. */
  layout?: TableLayout
  avatarFor?: (player: RoomPlayerView) => ReactNode
  onSeatClick?: (seat: number) => void
  canSit: boolean
}

/* The ring needs roughly 310 px of stage to seat everyone around it without the plates running into the board, and a
   short window has no more to give than a narrow one — so a laptop with a 600 px-tall viewport gets the vertical
   layout for the same reason a phone does. */
const STACKED = '(max-width: 767px), (max-height: 620px)'

const seatFromPlayer = (seat: number, player: RoomPlayerView): ClientSeat => ({
  seat,
  playerId: player.playerId,
  displayName: player.displayName,
  isBot: player.isBot,
  stack: player.stack,
  betThisStreet: 0,
  folded: false,
  allIn: false,
  cardCount: 0,
  holeCards: null,
  hasDecided: false,
  decision: null,
  lastAction: null,
  timedOut: false,
})

/**
 * The table: seats on the rim of a lacquered ellipse with the viewer always at the bottom, community cards and pot in
 * the middle. On a screen too narrow or too short for that it becomes a vertical stack — opponents on top, board in
 * the middle, the viewer pinned to the bottom — which is the same components in a different grid, not a second
 * implementation.
 */
export function PokerTable({
  room,
  hand,
  myPlayerId,
  deadlineAt,
  serverNow,
  turnTimerMs,
  lang,
  layout,
  avatarFor,
  onSeatClick,
  canSit,
}: PokerTableProps) {
  const { t } = useTranslation()
  const narrow = useMediaQuery(STACKED)
  const mode: TableLayout = layout ?? (narrow ? 'stack' : 'ring')

  const seated = new Map<number, RoomPlayerView>()
  for (const p of room.players) if (p.seat !== null) seated.set(p.seat, p)

  const mySeat =
    hand?.mySeat ?? (myPlayerId === null ? null : (room.players.find((p) => p.playerId === myPlayerId)?.seat ?? null))
  const order = Array.from({ length: room.maxPlayers }, (_, i) => i)
  const positions = mode === 'ring' ? ringPositions(order, mySeat) : null

  const handSeats = new Map<number, ClientSeat>((hand?.seats ?? []).map((hs) => [hs.seat, hs]))
  const payouts = new Map<number, number>()
  for (const p of hand?.result?.payouts ?? []) payouts.set(p.seat, (payouts.get(p.seat) ?? 0) + p.amount)
  const showdown = new Map<number, ShowdownHand>((hand?.result?.showdown ?? []).map((h) => [h.seat, h]))

  // The board cards belonging to the best showdown hand keep a gold edge once the hand is over.
  const topSeat = [...payouts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const best = topSeat === undefined ? undefined : showdown.get(topSeat)?.best
  const community = hand?.community ?? []
  const highlight: CardId[] | undefined = best === undefined ? undefined : best.filter((c) => community.includes(c))

  const renderSeat = (index: number): ReactNode => {
    const player = seated.get(index)
    const position = positions?.get(index) ?? null
    const style: CSSProperties | undefined = position === null ? undefined : { left: `${position.x}%`, top: `${position.y}%` }
    const seatText = t('labels.seatNumber', { seat: index + 1 })

    if (player === undefined) {
      const sit = canSit && onSeatClick !== undefined
      return (
        <div key={index} className={cx(s.seat, s.seatEmpty)} style={style} data-seat={index}>
          {sit ? (
            <button type="button" className={s.sitBtn} onClick={() => onSeatClick(index)}>
              {t('actions.sitDown')}
              <span className={s.sr}>{seatText}</span>
            </button>
          ) : (
            <span className={s.emptyMark} aria-label={`${t('labels.emptySeat')} — ${seatText}`} role="img">
              {seatText}
            </span>
          )}
        </div>
      )
    }

    const clientSeat = handSeats.get(index) ?? seatFromPlayer(index, player)
    const acting = hand !== null && hand.actingSeat === index
    const hit = showdown.get(index)
    return (
      <Seat
        key={index}
        seat={clientSeat}
        player={player}
        isMe={myPlayerId !== null && player.playerId === myPlayerId}
        isActing={acting}
        isButton={hand !== null && hand.button === index}
        winnerPayout={payouts.get(index) ?? null}
        showdownLabel={hit === undefined ? null : handLabel(hit.category, t)}
        deadlineAt={acting ? deadlineAt : null}
        serverNow={serverNow}
        turnTimerMs={turnTimerMs}
        lang={lang}
        position={mode === 'ring' ? position : null}
        avatar={avatarFor?.(player)}
      />
    )
  }

  const showPot = hand !== null || room.carryOverPot > 0
  const centre = (
    <div className={s.centre}>
      <CommunityCards cards={community} highlight={highlight} />
      {showPot ? (
        <Pot pot={hand?.pot ?? 0} carryOver={hand?.carryOverIn ?? room.carryOverPot} pulse={hand?.potPulse ?? 0} lang={lang} />
      ) : null}
    </div>
  )

  if (mode === 'stack') {
    return (
      <section className={cx(s.table, s.stack)} data-surface="night" aria-label={t('labels.table')}>
        <div className={s.others}>{order.filter((i) => i !== mySeat).map(renderSeat)}</div>
        <div className={s.stackFelt}>{centre}</div>
        {mySeat === null ? null : <div className={s.mine}>{renderSeat(mySeat)}</div>}
      </section>
    )
  }

  return (
    <section className={cx(s.table, s.ring)} data-seats={room.maxPlayers} data-surface="night" aria-label={t('labels.table')}>
      <div className={s.felt} aria-hidden="true" />
      {centre}
      {order.map(renderSeat)}
    </section>
  )
}
