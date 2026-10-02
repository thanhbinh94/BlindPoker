import type { Card as CardId } from '@bp/core'
import { useTranslation } from 'react-i18next'
import { CARD_STAGGER_MS, Card } from './Card.js'
import s from './table.module.css'

export interface CommunityCardsProps {
  cards: CardId[]
  /** Cards belonging to the winning five; they keep a gold edge after the showdown. */
  highlight?: CardId[]
}

const SLOTS = [0, 1, 2, 3, 4]

/** The five board slots. Empty slots stay as outlined ghosts so the board never reflows as streets arrive. */
export function CommunityCards({ cards, highlight }: CommunityCardsProps) {
  const { t } = useTranslation()
  return (
    <div className={s.community} role="group" aria-label={t('labels.community')}>
      {SLOTS.map((i) => {
        const card = cards[i]
        if (card === undefined) return <span key={i} className={s.slot} aria-hidden="true" />
        return <Card key={i} card={card} size="lg" delayMs={i * CARD_STAGGER_MS} highlighted={highlight?.includes(card)} />
      })}
    </div>
  )
}
