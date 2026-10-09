import { RANK_CHARS, cardToString, rankOf, suitOf, type Card as CardId } from '@bp/core'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cardLabel } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { useDeckAnchor } from './deck-anchor.js'
import { DEAL_MS } from './motion.js'
import s from './table.module.css'

export type CardSize = 'sm' | 'md' | 'lg'

export interface CardProps {
  /** Omit (or pass `null`) to draw the back. */
  card?: CardId | null
  faceDown?: boolean
  size?: CardSize
  /**
   * When the card comes in — slid from the deck, or faded in with no deck to come from. Read once, when the card mounts:
   * a later value is ignored, since an `animation-delay` moved after mount would jump a card still waiting on the deck,
   * or put one that has landed back where its animation starts.
   */
  delayMs?: number
  highlighted?: boolean
  className?: string
  /** Dealt from the deck in this render: slides in face down from the `Deck` anchor (none → the plain fade), then, face up, turns. */
  dealt?: boolean
  /** How a card that was face down turns when revealed: in place (the default) or lifted off the felt (the showdown). */
  reveal?: 'flip' | 'lift'
  /** When a card that was face down starts to turn once it is revealed. The deal delay is the arrival's and stays as it was. */
  turnDelayMs?: number
}

/** Suit shapes live in a −5.4…5.4 box centred on the origin, so one `<use>` transform places any of them. */
function SuitShape({ suit }: { suit: number }): ReactElement {
  if (suit === 0)
    return (
      <>
        <circle cx="0" cy="-2.3" r="2.15" />
        <circle cx="-2.5" cy="1.5" r="2.15" />
        <circle cx="2.5" cy="1.5" r="2.15" />
        <path d="M-1.9 5.5C-0.8 4.6-0.35 3.3 0 1.3c0.35 2 0.8 3.3 1.9 4.2Z" />
      </>
    )
  if (suit === 1) return <path d="M0-5.4 3.6 0 0 5.4-3.6 0Z" />
  if (suit === 2) return <path d="M0 5.2C-5 1.2-4.9-2.6-2.5-3.7-1.1-4.3 0-3.4 0-2.2 0-3.4 1.1-4.3 2.5-3.7 4.9-2.6 5 1.2 0 5.2Z" />
  return (
    <>
      <path d="M0-5.4C0-5.4-4.9-1.2-4.9 1.3c0 1.7 1.3 2.7 2.7 2.7 1 0 1.7-0.4 2.2-1.1 0.5 0.7 1.2 1.1 2.2 1.1 1.4 0 2.7-1 2.7-2.7C4.9-1.2 0-5.4 0-5.4Z" />
      <path d="M-1.9 5.6C-0.8 4.6-0.35 3.3 0 1.3c0.35 2 0.8 3.3 1.9 4.3Z" />
    </>
  )
}

const COL = { L: 19, C: 30, R: 41 } as const
const ROW = [21, 31.5, 42, 52.5, 63] as const
const HALF_HI = 26.25
const HALF_LO = 57.75
const { L, C, R } = COL

/** Classic index layouts for 2–10; ranks are 0-based (`0` = deuce). */
const PIPS: Record<number, readonly (readonly [number, number])[]> = {
  0: [[C, ROW[0]], [C, ROW[4]]],
  1: [[C, ROW[0]], [C, ROW[2]], [C, ROW[4]]],
  2: [[L, ROW[0]], [R, ROW[0]], [L, ROW[4]], [R, ROW[4]]],
  3: [[L, ROW[0]], [R, ROW[0]], [C, ROW[2]], [L, ROW[4]], [R, ROW[4]]],
  4: [[L, ROW[0]], [R, ROW[0]], [L, ROW[2]], [R, ROW[2]], [L, ROW[4]], [R, ROW[4]]],
  5: [[L, ROW[0]], [R, ROW[0]], [C, HALF_HI], [L, ROW[2]], [R, ROW[2]], [L, ROW[4]], [R, ROW[4]]],
  6: [[L, ROW[0]], [R, ROW[0]], [C, HALF_HI], [L, ROW[2]], [R, ROW[2]], [C, HALF_LO], [L, ROW[4]], [R, ROW[4]]],
  7: [[L, ROW[0]], [R, ROW[0]], [L, ROW[1]], [R, ROW[1]], [C, ROW[2]], [L, ROW[3]], [R, ROW[3]], [L, ROW[4]], [R, ROW[4]]],
  8: [[L, ROW[0]], [R, ROW[0]], [L, ROW[1]], [R, ROW[1]], [C, HALF_HI], [L, ROW[3]], [R, ROW[3]], [L, ROW[4]], [R, ROW[4]], [C, HALF_LO]],
}

const SIZE_CLASS: Record<CardSize, string> = { sm: 'cardSm', md: 'cardMd', lg: 'cardLg' }
const FACE_RANKS = new Set([9, 10, 11]) // J, Q, K
const ACE = 12

/**
 * The lacquered back. While it is what the card shows, it is the card's one named image (`role="img"`, the face-down
 * label, `data-face="down"`). Drawn behind a face that has just turned up, it is artwork only: `aria-hidden`, with no
 * role, label or `data-*`, so nothing that counts or names cards ever finds it — as are the `Deck`'s.
 */
export function CardBack({ uid, label }: { uid: string; label: string | null }): ReactElement {
  const lattice = `lat-${uid}`
  const named = label !== null
  return (
    <svg
      className={cx(s.cardSide, !named && s.cardUnder)}
      viewBox="0 0 60 84"
      role={named ? 'img' : undefined}
      aria-label={named ? label : undefined}
      aria-hidden={named ? undefined : true}
      data-face={named ? 'down' : undefined}
    >
      <defs>
        <pattern id={lattice} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path className={s.cLattice} d="M0 0V9M0 0H9" />
        </pattern>
      </defs>
      <rect className={s.cBack} x="0.75" y="0.75" width="58.5" height="82.5" rx="6" />
      <rect x="0.75" y="0.75" width="58.5" height="82.5" rx="6" fill={`url(#${lattice})`} />
      <rect className={s.cBackRail} x="4.25" y="4.25" width="51.5" height="75.5" rx="4" />
      <path className={s.cBackMark} d="M30 30 40 42 30 54 20 42Z" />
      <circle className={s.cBackDot} cx="30" cy="42" r="3.2" />
    </svg>
  )
}

/**
 * Where the deck is from the card at `ref` (spec 2026-10-08 §3), for the slide that deals it: measured once, when the card
 * mounts `dealt` under a `DeckAnchorProvider`, before the first paint. `sliding` says the card has somewhere to come from
 * (the wrapper takes `.cardDealt`), and `vars` carries the offset as `--deal-dx`/`--deal-dy` and the deck's width over the
 * card's as `--deal-scale`, so the card leaves the pile at the pile's size and grows as it travels. With no deck, or not
 * dealt, nothing slides and `vars` is empty. Both hold for the card's life: the slide is its arrival, never replayed.
 */
export function useDealFrom(ref: RefObject<HTMLElement | null>, dealt: boolean): { sliding: boolean; vars: CSSProperties } {
  const anchor = useDeckAnchor()
  const [from, setFrom] = useState<{ dx: number; dy: number; scale: number | null } | null>(null)
  useLayoutEffect(() => {
    const deck = anchor?.current
    const self = ref.current
    if (!dealt || !deck || !self) return
    // The wrapper's entrance keyframe (the plain fade starts turned and raised) would skew its box, so it is measured
    // with no animation at all — put back before the paint, which then starts the slide instead.
    self.style.animation = 'none'
    const a = deck.getBoundingClientRect()
    const b = self.getBoundingClientRect()
    self.style.animation = ''
    setFrom({
      dx: a.left + a.width / 2 - (b.left + b.width / 2),
      dy: a.top + a.height / 2 - (b.top + b.height / 2),
      // no box to compare (a card not laid out): the keyframe's own fallback
      scale: a.width > 0 && b.width > 0 ? a.width / b.width : null,
    })
    // Only on mount: the slide is the card's arrival, never replayed on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (from === null) return { sliding: false, vars: {} }
  const vars = {
    '--deal-dx': `${from.dx.toFixed(1)}px`,
    '--deal-dy': `${from.dy.toFixed(1)}px`,
    ...(from.scale === null ? {} : { '--deal-scale': from.scale.toFixed(3) }),
  } as CSSProperties
  return { sliding: true, vars }
}

/**
 * One playing card (60 × 84): ivory face, corner indices, classic pip layouts, a lacquered medallion for the court
 * cards and a gold-lattice back. Every pip carries `data-pip` so views can count/animate them.
 *
 * The card is three boxes: the `.card` wrapper (size, drop shadow, the deal-in), an inner flipper and the side(s) it
 * shows. A card that turns from face down to face up — an opponent's hand at the showdown — **turns over** (review
 * 2026-09-29, No1): the flipper starts the turn from 180° with the back towards the viewer and comes to rest on the
 * face. Whichever side is showing carries the role, label and `data-card`/`data-face`, and it changes in the render
 * that reveals the card — never at the turn's midpoint, and never on `animationend`. The resting style is the face,
 * so under `prefers-reduced-motion` (every animation off) the reveal is instant. With `reveal="lift"` (the showdown,
 * spec 2026-10-08 §3) the card lifts off the felt as it turns, its shadow widening, and lands with a small overshoot;
 * it waits `turnDelayMs`.
 *
 * A card `dealt` under a `Deck` comes out of it (spec 2026-10-08 §3): the wrapper slides in from the deck, back up,
 * after `delayMs`, and a face-up card then turns over where it landed — the flat turn, `DEAL_MS` after its slide began,
 * whatever `reveal` says: the lift is for a card that was lying face down. A face-down card stays a back. With no deck to
 * come from, or not dealt, a card that mounts face up — the viewer's own after a refresh, the result card's — keeps only
 * its plain fade-in. Both wait the `delayMs` the card mounted with, whatever it is given later.
 */
export function Card({ card, faceDown = false, size = 'md', delayMs = 0, highlighted = false, className, dealt = false, reveal = 'flip', turnDelayMs = 0 }: CardProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const shown = faceDown || card === undefined || card === null ? null : card
  const down = shown === null
  // Was this card face down before? Kept as state and updated during render — React's pattern for "information
  // from previous renders", which StrictMode's double render cannot trip — rather than a ref written mid-render.
  // `turned` holds while the card stays up, so a later re-render (the winner's gold edge) leaves the turn alone.
  const [was, setWas] = useState({ down, turned: false })
  if (was.down !== down) setWas({ down, turned: was.down })
  const turned = !down && was.turned
  const ref = useRef<HTMLSpanElement>(null)
  const { sliding, vars } = useDealFrom(ref, dealt)
  // The arrival's delay, latched: the caller's "dealt just now" runs out mid-deal on a full table, and a delay that
  // moved with it would jump a card still waiting on the deck.
  const [arrivalDelay] = useState(delayMs)
  // A card dealt face up turns once it has slid in (the back is what travels); a revealed card turns where it lies.
  const turning = turned || (sliding && !down)
  const lifting = turned && reveal === 'lift'
  // The turn has a delay of its own, so revealing a card never touches the deal delay its slide ran on.
  const turnDelay = turned ? turnDelayMs : arrivalDelay + DEAL_MS
  const style = {
    ...(arrivalDelay > 0 ? { '--deal-delay': `${arrivalDelay}ms` } : {}),
    ...vars,
    ...(turning && turnDelay > 0 ? { '--turn-delay': `${turnDelay}ms` } : {}),
  } as CSSProperties

  return (
    <span
      ref={ref}
      className={cx(s.card, s[SIZE_CLASS[size]], down && s.cardDown, highlighted && s.cardHi, sliding && s.cardDealt, lifting && s.cardLifting, className)}
      style={style}
    >
      <span className={cx(s.cardFlip, turning && (lifting ? s.cardLift : s.cardTurn))}>
        {shown === null ? null : <CardFace card={shown} uid={uid} label={cardLabel(shown, t)} />}
        {down || turning ? <CardBack uid={uid} label={down ? t('labels.faceDown') : null} /> : null}
      </span>
    </span>
  )
}

/**
 * The ivory face: the card's one named image while it is up (`role="img"`, its label, `data-card`, `data-face="up"`).
 * `hidden` — a `PeelCard`'s face while the card is still down — it is artwork only: `aria-hidden`, with no role, label or
 * `data-card`/`data-face`, as a `CardBack` drawn with no label.
 */
export function CardFace({ card, uid, label, hidden = false }: { card: CardId; uid: string; label: string; hidden?: boolean }): ReactElement {
  const rank = rankOf(card)
  const suit = suitOf(card)
  const rankChar = RANK_CHARS[rank]!
  const rankText = rankChar === 'T' ? '10' : rankChar
  const pipId = `pip-${uid}`
  const pipRef = `#${pipId}`
  const suitClass = suit === 1 || suit === 2 ? s.cRed : s.cInk
  const pips = PIPS[rank] ?? []

  const corner = (
    <g className={suitClass}>
      <text className={cx(s.cRank, rankText.length > 1 && s.cRankWide)} x="8.5" y="16">
        {rankText}
      </text>
      <use href={pipRef} transform="translate(8.5 22.5) scale(0.44)" />
    </g>
  )

  return (
    <svg
      className={s.cardSide}
      viewBox="0 0 60 84"
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden ? true : undefined}
      data-card={hidden ? undefined : cardToString(card)}
      data-face={hidden ? undefined : 'up'}
    >
      <defs>
        <g id={pipId}>
          <SuitShape suit={suit} />
        </g>
      </defs>
      <rect className={s.cFace} x="0.75" y="0.75" width="58.5" height="82.5" rx="6" />
      {corner}
      <g transform="rotate(180 30 42)">{corner}</g>
      {rank === ACE ? (
        <g className={suitClass}>
          <circle className={s.cAceRing} cx="30" cy="42" r="17" />
          <use data-pip="" href={pipRef} transform="translate(30 42) scale(2.15)" />
        </g>
      ) : FACE_RANKS.has(rank) ? (
        <g className={suitClass}>
          <rect className={cx(s.cCourt, suit === 1 || suit === 2 ? s.cCourtRed : s.cCourtInk)} x="13" y="19" width="34" height="46" rx="4" />
          <rect className={s.cCourtRail} x="15.5" y="21.5" width="29" height="41" rx="2.5" />
          <text className={s.cCourtLetter} x="30" y="46">
            {rankChar}
          </text>
          <use data-pip="" href={pipRef} transform="translate(30 55) scale(0.78)" />
        </g>
      ) : (
        <g className={suitClass}>
          {pips.map(([x, y]) => (
            <use
              key={`${x}-${y}`}
              data-pip=""
              href={pipRef}
              transform={y > 42 ? `translate(${x} ${y}) scale(0.88) rotate(180)` : `translate(${x} ${y}) scale(0.88)`}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
