import { RANK_CHARS, cardToString, rankOf, suitOf, type Card as CardId } from '@bp/core'
import { useId, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { cardLabel } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

export type CardSize = 'sm' | 'md' | 'lg'

export interface CardProps {
  /** Omit (or pass `null`) to draw the back. */
  card?: CardId | null
  faceDown?: boolean
  size?: CardSize
  /** Stagger for the deal-in, and for the turn when the card is revealed; the caller multiplies by ~60 ms. */
  delayMs?: number
  highlighted?: boolean
  className?: string
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
 * role, label or `data-*`, so nothing that counts or names cards ever finds it.
 */
function CardBack({ uid, label }: { uid: string; label: string | null }): ReactElement {
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
 * One playing card (60 × 84): ivory face, corner indices, classic pip layouts, a lacquered medallion for the court
 * cards and a gold-lattice back. Every pip carries `data-pip` so views can count/animate them.
 *
 * The card is three boxes: the `.card` wrapper (size, drop shadow, the deal-in), an inner flipper and the side(s) it
 * shows. A card that turns from face down to face up — an opponent's hand at the showdown — **turns over** (review
 * 2026-09-29, No1): the flipper starts the turn from 180° with the back towards the viewer and comes to rest on the
 * face. Whichever side is showing carries the role, label and `data-card`/`data-face`, and it changes in the render
 * that reveals the card — never at the turn's midpoint, and never on `animationend`. The resting style is the face,
 * so under `prefers-reduced-motion` (every animation off) the reveal is instant. A card that mounts face up — the
 * viewer's own, the board, the result card's — has nothing to turn from and keeps only its deal-in.
 */
export function Card({ card, faceDown = false, size = 'md', delayMs = 0, highlighted = false, className }: CardProps) {
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
  const style = delayMs > 0 ? ({ '--deal-delay': `${delayMs}ms` } as CSSProperties) : undefined

  return (
    <span className={cx(s.card, s[SIZE_CLASS[size]], down && s.cardDown, highlighted && s.cardHi, className)} style={style}>
      <span className={cx(s.cardFlip, turned && s.cardTurn)}>
        {shown === null ? null : <CardFace card={shown} uid={uid} label={cardLabel(shown, t)} />}
        {down || turned ? <CardBack uid={uid} label={down ? t('labels.faceDown') : null} /> : null}
      </span>
    </span>
  )
}

function CardFace({ card, uid, label }: { card: CardId; uid: string; label: string }): ReactElement {
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
    <svg className={s.cardSide} viewBox="0 0 60 84" role="img" aria-label={label} data-card={cardToString(card)} data-face="up">
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
