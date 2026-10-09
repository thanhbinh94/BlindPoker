import { forwardRef, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { CardBack } from './Card.js'
import s from './table.module.css'

/**
 * Three backs, stacked: the pile every card is dealt from (spec 2026-10-08 §3, Q5). `PokerTable` hands its ref to the
 * cards through `DeckAnchorProvider` (`deck-anchor.ts`). Artwork only — it names itself once and counts for no card.
 */
export const Deck = forwardRef<HTMLDivElement>(function Deck(_props, ref) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <div ref={ref} className={s.deck} data-deck="" role="img" aria-label={t('labels.deck')}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={s.deckCard} aria-hidden="true">
          <CardBack uid={`${uid}-${i}`} label={null} />
        </span>
      ))}
    </div>
  )
})
