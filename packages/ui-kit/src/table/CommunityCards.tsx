import type { Card as CardId } from '@bp/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from './Card.js'
import { BOARD_STAGGER_MS } from './motion.js'
import s from './table.module.css'

export interface CommunityCardsProps {
  cards: CardId[]
  /** Cards belonging to the winning five; they keep a gold edge after the showdown. */
  highlight?: CardId[]
  /** The newest cards have just arrived: they come out of the deck and turn where they land (spec 2026-10-08 §4.1.2). */
  dealt?: boolean
  /** The hand the board belongs to: each hand's cards are new cards, dealt afresh in the same slots. */
  handId?: string | null
  /** "Nhìn trộm": the next board cards, for this viewer alone, face up in the first empty slots with a tag over the first. */
  peek?: CardId[]
  /** The chaos banner's slot: laid over the board's own box, centred, taking no room. */
  banner?: ReactNode
}

const SLOTS = [0, 1, 2, 3, 4]

/**
 * The five board slots. Empty slots stay as outlined ghosts so the board never reflows as streets arrive. A dealt flop's
 * three cards come in `BOARD_STAGGER_MS` apart, each sliding in while the one before it turns; the turn and the river
 * come alone. A board that was already out shows at once.
 */
export function CommunityCards({ cards, highlight, dealt = false, handId = null, peek = [], banner }: CommunityCardsProps) {
  const { t } = useTranslation()
  return (
    <div className={s.community} role="group" aria-label={t('labels.community')}>
      {SLOTS.map((i) => {
        const card = cards[i]
        if (card === undefined) {
          const seen = peek[i - cards.length]
          if (seen === undefined) return <span key={i} className={s.slot} aria-hidden="true" />
          return (
            <span key={i} className={s.peekSlot} data-peek="">
              <Card card={seen} size="lg" className={s.peeked} />
              {i === cards.length ? <span className={s.peekTag}>{t('chaos.peek')}</span> : null}
            </span>
          )
        }
        return (
          <Card
            key={`${handId}:${i}`}
            card={card}
            size="lg"
            dealt={dealt}
            delayMs={dealt && i < 3 ? i * BOARD_STAGGER_MS : 0}
            highlighted={highlight?.includes(card)}
          />
        )
      })}
      {banner}
    </div>
  )
}
