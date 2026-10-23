import type { Card as CardId, RoomPlayerView, RoomView, ShowdownHand } from '@bp/core'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { botChibi, type ChibiSubject, type Expression } from '../avatar2d/index.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { handLabel, type Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { CommunityCards } from './CommunityCards.js'
import { Deck } from './Deck.js'
import { DeckAnchorProvider } from './deck-anchor.js'
import { DEAL_MS, DEAL_WINDOW_MS, FLIP_MS, dealOrderOf, showdownWithBoard } from './motion.js'
import { Pot } from './Pot.js'
import { Seat } from './Seat.js'
import { STACK_LAYOUT_QUERY, type FrameTier, type RoomFrame } from './frame.js'
import { ringPositions, shortRingPositions } from './geometry.js'
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
  /** The room's frame. In `landscape` (a phone on its side) the table is always the ring: the stack needs height the
   * frame does not have. Defaults to `desktop`. */
  frame?: RoomFrame
  /** The landscape frame's tier (BP-28): `short` — a stage under 300 px (`SHORT_STAGE_PX`) tall — seats the table on a stadium as wide as
   * the stage (`shortRingPositions`) with compact seats. Stamped as `data-tier` on the ring; ignored outside `landscape`.
   * Defaults to `normal`. */
  tier?: FrameTier
  /** A human seat's chibi; `null` (or no answer) falls back to the name's initial. Bots always draw their own
   * `botChibi` and never ask this — a bot has no wardrobe for the app to answer for. */
  chibiFor?: (player: RoomPlayerView) => ChibiSubject | null
  /** Per-seat expression, usually `useTableExpressions(state, serverNow)` from the room's `ClientState`. Missing
   * seats — and every seat when this is not given at all — draw `neutral`. */
  expressionFor?: (seat: number) => Expression
  /** One muted line under each seat's name — a title, a rank. Returning `null` leaves that plate as it was. */
  captionFor?: (player: RoomPlayerView) => ReactNode
  /** A human seat's reputation rank 1..5, shown after the name (Plan 27); `null` (or no answer) shows nothing. Bots are
   * never asked — a bot has no rank. */
  rankFor?: (player: RoomPlayerView) => number | null
  onSeatClick?: (seat: number) => void
  canSit: boolean
  /**
   * The hand is over but its result is not out yet: `RoomScreen` holds the result card while an opponent's cards turn over
   * where they lie (`useRevealHold`). While this is true the table keeps the result to itself too — no hand name or payout
   * under any seat, no winner glow, no gold edge on the best hand's board cards, and each plate's stack as it stood before
   * the settlement paid it (`stackBeforeResult`) — and draws every card exactly as it would without it, so the turn still
   * plays. All of it appears in the render that drops the flag. Defaults to `false`.
   */
  resultPending?: boolean
  /**
   * Squeeze mode (spec 2026-10-08 §4.2): the viewer has turned every one of their cards — peeled by hand or opened with
   * the "Lật" pill — while the round is on. Called once per hand; the room sends the `REVEAL`.
   */
  onReveal?: () => void
  /**
   * One quiet line the room lays on the felt under the board, on the ring only: the landscape room's pre-hand hint
   * ("Cần ít nhất 2 người sẵn sàng…"), which has no row of its own there — wrapped in the corner dock it doubled the
   * dock's height over the seat beside the viewer's (Plan 26, B3). Nothing when not given. The short tier's felt has no
   * bare band for it, and `RoomScreen` puts it back in the dock there (BP-28, R2).
   */
  note?: ReactNode
}

/* The ring needs roughly 310 px of stage to seat everyone around it; a short window gets the vertical layout for the
   same reason a phone does (`STACK_LAYOUT_QUERY`, shared with the room, which passes its answer as `layout`). */
const STACKED = STACK_LAYOUT_QUERY

/**
 * The ring's box, for `ringPositions` to space the seats evenly in its own pixels. The desktop ring pins a 2:1 box, but
 * a phone held sideways caps a wider one by the viewport's width, so its shape is whatever the browser made of it —
 * measured when it lays out and again on every resize. Where there is no `ResizeObserver` (jsdom) the box stays the
 * desktop's 2:1. `active` is false while the table is the stack, which has no ring to measure.
 */
function useRingBox(ref: RefObject<HTMLElement>, active: boolean): { w: number; h: number } | undefined {
  const [box, setBox] = useState<{ w: number; h: number } | undefined>(undefined)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || el === null || typeof ResizeObserver === 'undefined') return
    // A new object only when the shape moved: the same box again must not render the table again.
    const take = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return
      setBox((prev) => (prev !== undefined && prev.w === width && prev.h === height ? prev : { w: width, h: height }))
    }
    // Measured now, before the browser paints: the observer's first report comes after the first frame, which would
    // otherwise draw the seats on the 2:1 fallback and then jump. The ring has no padding or border, so its border box
    // is the content box the observer reports.
    const first = el.getBoundingClientRect()
    take(first.width, first.height)
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect
      if (rect !== undefined) take(rect.width, rect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, active])
  return active ? box : undefined
}

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
 *
 * Every card comes out of the `Deck` on the felt (spec 2026-10-08 §3, §4.1): the hole cards round the table from the
 * seat after the button, one card per seat at a time, and each street's cards to the board — but only cards that have
 * just arrived (`DEAL_WINDOW_MS`). A hand rebuilt from a snapshot, or a table remounted later in the hand, shows its
 * cards where they lie, all at once. At the showdown an opponent's cards lift and turn, one seat's cards
 * `SHOWDOWN_STAGGER_MS` apart, after the river when it came with the showdown (`showdownWithBoard`).
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
  frame = 'desktop',
  tier = 'normal',
  chibiFor,
  expressionFor,
  captionFor,
  rankFor,
  onSeatClick,
  canSit,
  resultPending = false,
  onReveal,
  note,
}: PokerTableProps) {
  const { t } = useTranslation()
  const narrow = useMediaQuery(STACKED)
  const mode: TableLayout = layout ?? (frame === 'landscape' ? 'ring' : narrow ? 'stack' : 'ring')
  const deckRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLElement>(null)
  const ringBox = useRingBox(ringRef, mode === 'ring')

  const seated = new Map<number, RoomPlayerView>()
  for (const p of room.players) if (p.seat !== null) seated.set(p.seat, p)

  const mySeat =
    hand?.mySeat ?? (myPlayerId === null ? null : (room.players.find((p) => p.playerId === myPlayerId)?.seat ?? null))
  const order = Array.from({ length: room.maxPlayers }, (_, i) => i)
  const short = frame === 'landscape' && tier === 'short'
  const positions = mode !== 'ring' ? null : short ? shortRingPositions(order, mySeat, ringBox) : ringPositions(order, mySeat, ringBox)

  const handSeats = new Map<number, ClientSeat>((hand?.seats ?? []).map((hs) => [hs.seat, hs]))
  // While the result is pending the table has none to show — no payouts, no hands named, so no result line, no winner
  // glow and no best hand to put a gold edge on — but its cards (`handSeats`, `community`) are untouched, so they still turn.
  const payouts = new Map<number, number>()
  for (const p of resultPending ? [] : (hand?.result?.payouts ?? [])) payouts.set(p.seat, (payouts.get(p.seat) ?? 0) + p.amount)
  const showdown = new Map<number, ShowdownHand>((resultPending ? [] : (hand?.result?.showdown ?? [])).map((h) => [h.seat, h]))

  // The board cards belonging to the best showdown hand keep a gold edge once the hand is over.
  const topSeat = [...payouts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const best = topSeat === undefined ? undefined : showdown.get(topSeat)?.best
  const community = hand?.community ?? []
  const highlight: CardId[] | undefined = best === undefined ? undefined : best.filter((c) => community.includes(c))

  // The motion. "Dealt" is "arrived just now", by the client clock the arrival stamps are in (not `serverNow`); a card
  // reads it when it mounts, so the window running out later changes nothing on the table.
  const now = Date.now()
  const dealt = hand !== null && !hand.restored && hand.dealtAt !== null && now - hand.dealtAt < DEAL_WINDOW_MS
  const boardDealt = hand !== null && hand.boardAt !== null && now - hand.boardAt < DEAL_WINDOW_MS
  const dealOrder = dealOrderOf(hand)
  const liftAfter = showdownWithBoard(hand) ? DEAL_MS + FLIP_MS : 0

  // Squeeze mode (spec 2026-10-08 §4.2): a hand on a squeeze table, and its round — a pure-luck hand's `SQUEEZE`, or a
  // play-or-fold hand's `DECISION`, which runs the same 20 s with the cards to turn and then the choice to make. The
  // round's countdown is drawn on the viewer's own plate (rulings 14, 21): nobody is acting in it, so no other seat gets
  // the deadline.
  const squeezeRoom = hand !== null && hand.mode === 'blind' && room.config.blind?.squeeze === true
  const squeezeRound = squeezeRoom && (hand.phase === 'SQUEEZE' || hand.phase === 'DECISION')
  const squeezeDecides = squeezeRound && hand.phase === 'DECISION'

  const renderSeat = (index: number): ReactNode => {
    const player = seated.get(index)
    const position = positions?.get(index) ?? null
    const style: CSSProperties | undefined = position === null ? undefined : { left: `${position.x}%`, top: `${position.y}%` }
    const seatText = t('labels.seatNumber', { seat: index + 1 })

    if (player === undefined) {
      const sit = canSit && onSeatClick !== undefined
      // The short tier hangs, stands or centres a seat by these, as `Seat` stamps them; an empty seat's box would
      // otherwise sit centred on a point at the stage's very edge, half off it (BP-28). The other layouts centre it.
      const line =
        short && position !== null
          ? { 'data-half': position.y < 50 ? 'top' : 'bottom', 'data-edge': position.x < 15 ? 'left' : position.x > 85 ? 'right' : undefined }
          : {}
      return (
        <div key={index} className={cx(s.seat, s.seatEmpty)} style={style} data-seat={index} {...line}>
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

    const handSeat = handSeats.get(index)
    const clientSeat =
      handSeat === undefined
        ? seatFromPlayer(index, player)
        : resultPending && handSeat.stackBeforeResult !== undefined
          ? { ...handSeat, stack: handSeat.stackBeforeResult }
          : handSeat
    const acting = hand !== null && hand.actingSeat === index
    const hit = showdown.get(index)
    const chibi = player.isBot ? botChibi(player.playerId) : (chibiFor?.(player) ?? null)
    // The turn bounce (spec 08 §3.4): only the seat whose turn it is *and* only when that seat is the viewer's
    // own — an opponent's chibi does not bounce for the viewer, since it is not their decision to make.
    const bounce = hand !== null && hand.actingSeat === index && index === hand.mySeat
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
        deadlineAt={acting || (squeezeRound && index === hand.mySeat) ? deadlineAt : null}
        serverNow={serverNow}
        turnTimerMs={turnTimerMs}
        lang={lang}
        position={mode === 'ring' ? position : null}
        chibi={chibi}
        expression={expressionFor?.(index) ?? 'neutral'}
        bounce={bounce}
        caption={captionFor?.(player)}
        rank={player.isBot ? null : (rankFor?.(player) ?? null)}
        frame={frame}
        handId={hand?.handId ?? null}
        dealt={dealt}
        dealIndex={Math.max(0, dealOrder.indexOf(index))}
        dealCount={dealOrder.length}
        reveal={index === hand?.mySeat ? 'flip' : 'lift'}
        liftAfter={liftAfter}
        squeezeRoom={squeezeRoom}
        squeezeRound={squeezeRound}
        squeezeDecides={squeezeDecides}
        restored={hand?.restored ?? false}
        onReveal={onReveal}
      />
    )
  }

  const showPot = hand !== null || room.carryOverPot > 0
  // The deck shares the pot's row, as tall as the pot, so it adds no height to the centre: above the board it ran into
  // the top seat's lines on the ring and pushed the pot onto the viewer's cards on a short one (1366 × 768). Its ref is
  // set in tree order, so a card mounting in the same commit as the table and ahead of the deck — the board, the phone's
  // strip — finds no deck and fades in: a table that has just mounted shows its cards where they lie.
  const centre = (
    <div className={s.centre}>
      <CommunityCards cards={community} highlight={highlight} dealt={boardDealt} handId={hand?.handId ?? null} />
      <div className={s.centreRow}>
        <Deck ref={deckRef} />
        {showPot ? (
          <Pot pot={hand?.pot ?? 0} carryOver={hand?.carryOverIn ?? room.carryOverPot} pulse={hand?.potPulse ?? 0} lang={lang} />
        ) : null}
      </div>
    </div>
  )

  if (mode === 'stack') {
    // Spec §27.1/§27.3: the strip shows every other seat, always. Four opponents or more and it holds two rows
    // open, and the plates go compact so the board and the viewer's own seat still fit a phone beside them
    // (layout audit L1, 2026-09-28 — at six seats the full plates pushed the felt off a 375 × 812 screen once
    // cards were out); seven or more and the plates also give up the app's caption so the third row fits.
    const opponents = order.filter((i) => i !== mySeat)
    return (
      <DeckAnchorProvider value={deckRef}>
        <section className={cx(s.table, s.stack)} data-surface="night" aria-label={t('labels.table')}>
          <div
            className={cx(s.others, opponents.length > 3 && s.othersTwoRow, opponents.length > 3 && s.othersChip, opponents.length > 6 && s.othersDense)}
            role="group"
            aria-label={t('labels.players')}
          >
            {opponents.map(renderSeat)}
          </div>
          <div className={s.stackFelt}>{centre}</div>
          {mySeat === null ? null : <div className={s.mine}>{renderSeat(mySeat)}</div>}
        </section>
      </DeckAnchorProvider>
    )
  }

  return (
    <DeckAnchorProvider value={deckRef}>
      <section
        ref={ringRef}
        className={cx(s.table, s.ring)}
        data-seats={room.maxPlayers}
        data-frame={frame}
        data-tier={frame === 'landscape' ? tier : undefined}
        data-surface="night"
        aria-label={t('labels.table')}
      >
        <div className={s.felt} aria-hidden="true" />
        {centre}
        {note === undefined || note === null ? null : <p className={s.note}>{note}</p>}
        {order.map(renderSeat)}
      </section>
    </DeckAnchorProvider>
  )
}
