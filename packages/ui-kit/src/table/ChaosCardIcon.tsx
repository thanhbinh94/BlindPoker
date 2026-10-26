import type { ChaosTier, HeldCardView } from '@bp/core'
import { useTranslation } from 'react-i18next'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

/**
 * A card's tier from its id, for a card the viewer no longer sees held (a one-shot that has just acted). The catalogue's ids
 * are `s_…`, `g_…` and `d_…` for Bạc, Vàng and Kim cương; anything else reads as Bạc.
 */
export function tierOfCardId(cardId: string): ChaosTier {
  return cardId.startsWith('d_') ? 'diamond' : cardId.startsWith('g_') ? 'gold' : 'silver'
}

/** The most icons a seat shows; the rest are a "+N". */
export const MAX_CHAOS_ICONS = 4
/** The sign before the count of icons not drawn. */
const MORE_MARK = '+'

export interface ChaosCardIconProps {
  card: HeldCardView
  className?: string
}

/**
 * One chaos card a seat holds, as a small tier-framed icon (spec 2026-10-26 §7): the tier in its frame and its text
 * colour, the card's initial inside, the hands it has left as a corner count. The name is the tooltip and the accessible
 * name — with the tier in words, since a frame's colour must not be the only thing that says it — and the card itself is
 * described in the draft and in the "Thẻ đã dùng" line.
 */
export function ChaosCardIcon({ card, className }: ChaosCardIconProps) {
  const { t } = useTranslation()
  const name = t(`chaos.cards.${card.cardId}.name`, { defaultValue: card.cardId })
  const left = card.handsLeft === null ? null : t('chaos.handsLeft', { count: card.handsLeft })
  const label = `${name} (${t(`chaos.tier.${card.tier}`)})${left === null ? '' : ` · ${left}`}`
  return (
    <span className={cx(s.chaosIcon, className)} data-tier={card.tier} role="img" aria-label={label} title={label}>
      <span className={s.chaosGlyph} aria-hidden="true">
        {name.trim().slice(0, 1).toUpperCase()}
      </span>
      {card.handsLeft === null ? null : (
        <span className={s.chaosLeft} aria-hidden="true">
          {card.handsLeft}
        </span>
      )}
    </span>
  )
}

export interface ChaosCardRowProps {
  cards: readonly HeldCardView[]
  className?: string
  /**
   * One icon for the whole hand — framed in the best tier it holds, with the number of cards inside, the cards named in its
   * tooltip — where a row of icons would cost a chip another line: the dense strip of opponents on a phone (seven or more).
   */
  summary?: boolean
}

/** A seat's cards as icons, at most `MAX_CHAOS_ICONS`, then "+N" for the rest. Nothing at all for a seat holding none. */
export function ChaosCardRow({ cards, className, summary = false }: ChaosCardRowProps) {
  const { t } = useTranslation()
  if (cards.length === 0) return null
  if (summary) {
    const best: ChaosTier = cards.some((c) => c.tier === 'diamond') ? 'diamond' : cards.some((c) => c.tier === 'gold') ? 'gold' : 'silver'
    const names = cards.map((c) => t(`chaos.cards.${c.cardId}.name`, { defaultValue: c.cardId })).join(', ')
    return (
      <span className={cx(s.chaosRow, className)} data-chaos-cards={cards.length}>
        <span className={s.chaosIcon} data-tier={best} role="img" aria-label={names} title={names}>
          {cards.length}
        </span>
      </span>
    )
  }
  const shown = cards.slice(0, MAX_CHAOS_ICONS)
  const more = cards.length - shown.length
  const hidden = cards
    .slice(MAX_CHAOS_ICONS)
    .map((c) => t(`chaos.cards.${c.cardId}.name`, { defaultValue: c.cardId }))
    .join(', ')
  return (
    <span className={cx(s.chaosRow, className)} data-chaos-cards={cards.length}>
      {shown.map((card) => (
        <ChaosCardIcon key={card.uid} card={card} />
      ))}
      {more > 0 ? (
        <span className={s.chaosMore} role="img" title={hidden} aria-label={hidden}>
          {MORE_MARK}
          {more}
        </span>
      ) : null}
    </span>
  )
}
