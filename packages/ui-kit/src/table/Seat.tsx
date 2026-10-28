import type { Card as CardId, ChaosCritMultiplier, HeldCardView, RoomPlayerView } from '@bp/core'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Chibi, type ChibiSubject, type Expression } from '../avatar2d/index.js'
import type { ClientSeat } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge, type BadgeTone } from '../primitives/Badge.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import { ChaosCardRow } from './ChaosCardIcon.js'
import { SHOWDOWN_STAGGER_MS, dealStaggerMs } from './motion.js'
import type { RoomFrame } from './frame.js'
import { PeelCard } from './PeelCard.js'
import { RankLabel } from './RankLabel.js'
import { TurnTimer } from './TurnTimer.js'
import s from './table.module.css'

const DEALER_GLYPH = 'D'
/** Under this many pixels of plate text the rank's name gives way to its numeral (spec 2026-10-21 §2 A4). */
export const RANK_WORD_MIN_PX = 120

/** The gap between the name and its rank (`.seatName`'s `gap`). */
const RANK_GAP_PX = 5
/** What the name's line keeps free at its end, so the rank's word never touches the plate's curve. */
const RANK_BREATH_PX = 4

/**
 * Where a seat's rank stands: its word after the name (`name`); its word after the stack, when beside the name it would
 * cut the name short (`stackWord`); its numeral in a pill after the stack (`stackPill`) — a compact plate, whose name's
 * line is the name's alone (Ruling 11).
 */
export type RankPlace = 'name' | 'stackWord' | 'stackPill'

/**
 * Measures where the rank goes. A plate that grows to its content — the viewer's own on the ring, which has a `max-width`
 * — is measured by how far it may grow (its cap less its disc, padding and gap); any other by its text box. Under
 * `RANK_WORD_MIN_PX` the numeral; otherwise the word beside the name if the whole name, the gap and the word fit with
 * `RANK_BREATH_PX` to spare, else after the stack. Nothing laid out (jsdom: a 0 px box): the word beside the name.
 * The name's `scrollWidth` and the word's width are the same on either line, and the box measured never depends on where
 * the rank sits, so the answers cannot chase each other.
 */
function placeRank(text: HTMLElement, nameText: HTMLElement): RankPlace {
  const plate = text.parentElement
  const cap = plate === null ? Number.NaN : parseFloat(getComputedStyle(plate).maxWidth)
  const grows = plate !== null && Number.isFinite(cap) && cap > 0
  const available = grows ? cap - (plate.offsetWidth - text.offsetWidth) : text.clientWidth
  const box = grows ? available : text.getBoundingClientRect().width
  if (box > 0 && box < RANK_WORD_MIN_PX) return 'stackPill'
  const word = text.querySelector<HTMLElement>(`.${s.rankLabel}`)
  // From the pill there is no word to measure yet: it goes beside the name, and the next pass measures it there.
  if (word === null || available <= 0) return 'name'
  const line = nameText.scrollWidth + RANK_GAP_PX + word.getBoundingClientRect().width
  return line <= available - RANK_BREATH_PX ? 'name' : 'stackWord'
}

/**
 * `placeRank` before the first paint, again after each answer (the label may have changed lines or form), on every
 * resize of the text box and of the window (a content-sized plate's cap is a share of the table). In the landscape frame
 * the numeral is the rule whatever the width, and nothing is measured.
 */
function useRankPlace(
  textRef: RefObject<HTMLElement>,
  nameRef: RefObject<HTMLElement>,
  rank: number | null,
  landscape: boolean,
  name: string,
): RankPlace {
  const [place, setPlace] = useState<RankPlace>('name')
  const active = rank !== null && !landscape
  useLayoutEffect(() => {
    const text = textRef.current
    const nameText = nameRef.current
    if (!active || text === null || nameText === null) return
    const measure = (): void => setPlace(placeRank(text, nameText))
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    observer?.observe(text)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [textRef, nameRef, active, place, rank, name])
  return landscape ? 'stackPill' : active ? place : 'name'
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
   * The player's reputation rank 1..5 (Plan 27, spec 2026-10-21 §2 A4): the rank's name after the player's on a wide
   * plate — after the stack instead when beside the name it would cut the name short — and its roman numeral after the
   * stack when the plate's text box is under 120 px or the room is in the `landscape` frame. Rank 1, `null` and a bot's
   * seat show nothing.
   */
  rank?: number | null
  /** The room's frame, as `PokerTable` has it: `landscape` always shortens the rank to its numeral. */
  frame?: RoomFrame
  /**
   * The viewer's own seat in the stack layout (BP-31 §3.1, R1, R10): the cards fan out (`data-fan` on the cards box, `none`
   * for a hand to peel) and the plate is a one-line strip carrying the stack, the rank's numeral, the host and state badges
   * and the street bet, with the hand's name and payout as its second line at showdown. No "you" badge and no caption:
   * the strip is always the viewer. `PokerTable` passes it for `mode === 'stack' && isMe` only. Defaults to `false`.
   */
  strip?: boolean
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
  /**
   * Poker hỗn loạn: the chaos cards this seat holds (public), shown as small tier icons — four, then "+N" — on the line
   * under the plate, or on the viewer's strip. Absent or empty, nothing is drawn.
   */
  chaosCards?: readonly HeldCardView[]
  /** The viewer's own cards are face down because "Bịt mắt" hit them: the seat says so instead of leaving a bare back. */
  blindfolded?: boolean
  /** "Bạo kích ×2!" for the seat that won with it (2 or 3), drawn with its payout. */
  critMultiplier?: ChaosCritMultiplier | null
  /** The dense strip of opponents (seven or more, on a phone): the seat's cards are one icon with their number, not a row of them. */
  chaosSummary?: boolean
  /**
   * Poker hỗn loạn (BP-39, spec 2026-10-27 §3.4): how many bonus cards wait in this seat's hand — a count beside its chaos
   * cards, never which ones. Drawn for the other seats only (the viewer has the bonus hand itself); 0 or absent: nothing.
   */
  bonusCount?: number
  /**
   * "Mượn lá" at showdown: the opponent's card this seat also ranked with (a copy), drawn after its own cards with a "Mượn"
   * tag on it; `highlighted` when it is one of the winning five (the board's gold edge). Absent or `null`: nothing.
   */
  borrowed?: { card: CardId; highlighted: boolean } | null
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
  strip = false,
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
  chaosCards = [],
  blindfolded = false,
  critMultiplier = null,
  chaosSummary = false,
  bonusCount = 0,
  borrowed = null,
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

  // The rank (Plan 27): a bot has none, rank 1 says nothing. The plate is measured only while there is a rank to fit: its
  // word after the name when the whole name still fits beside it, else after the stack; a compact plate's numeral after
  // the stack, so no name is ever cut by its rank (`useRankPlace`).
  const shownRank = seat.isBot || rank === null || rank < 2 ? null : rank
  const plateTextRef = useRef<HTMLSpanElement>(null)
  const nameTextRef = useRef<HTMLSpanElement>(null)
  // The strip is one line: its rank is the numeral's badge, as in the landscape frame, and nothing is measured.
  const rankPlace = useRankPlace(plateTextRef, nameTextRef, shownRank, frame === 'landscape' || strip, name)
  const rankLabel = shownRank === null ? null : <RankLabel rank={shownRank} lang={lang} compact={rankPlace === 'stackPill'} />
  useLayoutEffect(() => {
    if (!toTurn && pillRef.current !== null && document.activeElement === pillRef.current) seatRef.current?.focus({ preventScroll: true })
  }, [toTurn])

  // What a seat says about itself, under its plate — or, for the viewer's strip, on it (BP-31 R10).
  // Gold, not red — red is for the risky acts (fold, leave, kick); a crown tells it apart from "you" when both sit on the
  // same plate (layout audit C4). The short landscape tier (BP-28) keeps an opponent's line to its bet: who the seat is
  // (host, bot) goes, and its state shrinks to a dot of the state's colour, the words kept for a screen reader. The
  // classes are those rules' handles.
  const hostBadge =
    player?.isHost === true ? (
      <Badge tone="gold" className={s.tagWho}>
        <span aria-hidden="true">{CROWN_GLYPH}</span>
        {t('labels.host')}
      </Badge>
    ) : null
  const stateBadge =
    pill === null ? null : (
      <Badge tone={pill.tone} className={s.tagState}>
        {pill.text}
      </Badge>
    )
  const betChip = seat.betThisStreet > 0 ? <span className={s.bet}>{formatPoints(seat.betThisStreet, lang)}</span> : null
  // Poker hỗn loạn: the cards the seat holds, and — for the viewer — the word for cards that are down because of one.
  const chaosRow = chaosCards.length === 0 ? null : <ChaosCardRow cards={chaosCards} summary={chaosSummary} />
  // …and how many bonus cards it holds, as a card back with the count: only the number is anyone else's business.
  const bonusBadge =
    isMe || bonusCount <= 0 ? null : (
      <span className={s.bonusBadge} role="img" aria-label={t('chaos.bonus.seat', { count: bonusCount })} data-bonus-count={bonusCount}>
        <span className={s.bonusBack} aria-hidden="true" />
        <span aria-hidden="true">{t('chaos.bonus.count', { count: bonusCount })}</span>
      </span>
    )
  const blindBadge = blindfolded ? (
    <Badge tone="chaos" title={t('chaos.blindfoldedHint')}>
      {t('chaos.blindfolded')}
    </Badge>
  ) : null
  const crit = critMultiplier !== null && winnerPayout !== null
  const result =
    showdownLabel === null && winnerPayout === null ? null : (
      <span className={s.seatResult}>
        {showdownLabel === null ? null : <span className={s.handTag}>{showdownLabel}</span>}
        {winnerPayout === null ? null : <span className={s.payout}>{payoutText}</span>}
        {crit ? <span className={s.critShout}>{t('chaos.critShout', { multiplier: critMultiplier })}</span> : null}
      </span>
    )
  const stackFigure = <span className={s.seatStack}>{formatPoints(seat.stack, lang)}</span>

  return (
    <div
      ref={seatRef}
      className={cx(
        s.seat,
        isMe && s.seatMe,
        strip && s.meStrip,
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
      {/* The cards and the plate. No box of its own (`display: contents`) in every layout but one: the short landscape
          tier (BP-28) lays the viewer's cards beside the plate as one row, the line under it centred below. */}
      <div className={s.seatTop}>
        {faces.length > 0 ? (
          // The strip's fan (BP-31 R1): two or three cards splay from their feet; a hand to peel lies flat (`none`), since
          // the peel measures the drag across the card's own box.
          <div className={s.seatCards} data-hand="" data-fan={strip ? (peeling ? 'none' : String(faces.length)) : undefined}>
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
            {borrowed === null ? null : (
              <span className={s.borrowSlot} data-borrowed="" title={t('chaos.borrowedHint')}>
                <Card card={borrowed.card} size={cardSize} highlighted={borrowed.highlighted} className={s.borrowedCard} />
                <span className={s.borrowTag}>{t('chaos.borrowed')}</span>
              </span>
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

        <div className={cx(s.plate, strip && result !== null && s.plateTwoLine)} data-plate="">
          {/* Every seat gets the same framed disc: a bot's chibi chosen by its id, the app's chibi for a human, and
              the initial when the app has none. The frame is what makes a table of six read as six faces. */}
          <span className={s.avatar} data-face={seat.isBot ? 'bot' : chibi === null ? 'default' : 'app'} aria-hidden="true">
            {chibi === null ? initial : <Chibi subject={chibi} expression={expression} frame="head" bounce={bounce} />}
          </span>
          {strip ? (
            // The strip (BP-31 R10): one line — the name, cut with "…" before anything else gives; the stack; the rank's
            // numeral; the host and state badges; the street bet — and, at showdown, the hand's name and payout under it.
            <span ref={plateTextRef} className={s.plateText}>
              <span className={s.stripLine}>
                <span className={s.seatName}>
                  <span ref={nameTextRef} className={s.seatNameText}>
                    {name}
                  </span>
                </span>
                {seat.isBot ? null : stackFigure}
                {rankLabel}
                {hostBadge}
                {blindBadge}
                {stateBadge}
                {chaosRow}
                {bonusBadge}
                {betChip}
              </span>
              {result}
            </span>
          ) : (
            <span ref={plateTextRef} className={s.plateText}>
              <span className={s.seatName}>
                <span ref={nameTextRef} className={s.seatNameText}>
                  {name}
                </span>
                {rankPlace === 'name' ? rankLabel : null}
              </span>
              {caption === undefined || caption === null ? null : <span className={s.seatCaption}>{caption}</span>}
              {/* A bot's stack is virtual — a table limit (10 × the wager) that is topped back up whenever it runs low, so
                  a figure beside it would only read as a real balance to compare against. The Bot badge below says what
                  the seat is; its bets and payouts still show like anyone else's. A bot has no rank either, so it has no
                  stack line at all. */}
              {seat.isBot ? null : (
                <span className={s.stackLine}>
                  {stackFigure}
                  {rankPlace === 'name' ? null : rankLabel}
                </span>
              )}
            </span>
          )}
          {ring ? <TurnTimer deadlineAt={deadlineAt} serverNow={serverNow} totalMs={turnTimerMs} size={strip ? 40 : 38} /> : null}
          {isButton ? (
            <span className={s.dealer} role="img" aria-label={t('labels.dealer')}>
              {DEALER_GLYPH}
            </span>
          ) : null}
        </div>
      </div>

      {/* Two lines under the plate at most (review 2026-09-29, No2): who the seat is and what it has in front of
          it — the badges and the bet — then how the hand ended for it — the hand's name and the payout. One badge,
          one chip and one tag a line each ran the viewer's own block six lines deep, past the foot of the stage.
          The strip carries all of it on its plate instead, and has no line under it. */}
      {strip ? null : (
        <div className={s.tags}>
          {isMe ? <Badge tone="gold">{t('labels.you')}</Badge> : null}
          {hostBadge}
          {seat.isBot ? (
            <Badge tone="muted" className={s.tagWho}>
              {t('labels.bot')}
            </Badge>
          ) : null}
          {blindBadge}
          {stateBadge}
          {/* Squeeze mode (§4.2.6): who has turned, for the others to see whom the round still waits on. A seat that has
              decided has turned with it (§4.2.4): its "Đã chọn" says both, and keeps the line under the plate to one. */}
          {!isMe && squeezeRound && seat.revealed === true && !seat.hasDecided ? (
            <Badge tone="teal" className={s.tagState}>
              {t('labels.revealed')}
            </Badge>
          ) : null}
          {chaosRow}
          {bonusBadge}
          {betChip}
        </div>
      )}

      {strip ? null : result}
    </div>
  )
}
