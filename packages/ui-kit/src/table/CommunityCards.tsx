import type { Card as CardId } from '@bp/core'
import { useTranslation } from 'react-i18next'
import { BOARD_STAGGER_MS, Card } from './Card.js'
import s from './table.module.css'

export interface CommunityCardsProps {
  cards: CardId[]
  /** Cards belonging to the winning five; they keep a gold edge after the showdown. */
  highlight?: CardId[]
  /** The newest cards have just arrived: they come out of the deck and turn where they land (spec 2026-10-08 §4.1.2). */
  dealt?: boolean
}

const SLOTS = [0, 1, 2, 3, 4]

/**
 * The five board slots. Empty slots stay as outlined ghosts so the board never reflows as streets arrive. The flop's three
 * cards come in `BOARD_STAGGER_MS` apart, each sliding in while the one before it turns; the turn and the river come alone.
 */
export function CommunityCards({ cards, highlight, dealt = false }: CommunityCardsProps) {
  const { t } = useTranslation()
  return (
    <div className={s.community} role="group" aria-label={t('labels.community')}>
      {SLOTS.map((i) => {
        const card = cards[i]
        if (card === undefined) return <span key={i} className={s.slot} aria-hidden="true" />
        return <Card key={i} card={card} size="lg" dealt={dealt} delayMs={(i < 3 ? i : 0) * BOARD_STAGGER_MS} highlighted={highlight?.includes(card)} />
      })}
    </div>
  )
}
