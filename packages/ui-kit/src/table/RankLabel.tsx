import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n/index.js'
import s from './table.module.css'

const NUMERALS = ['I', 'II', 'III', 'IV', 'V'] as const

/** A rank 1..5 as its roman numeral: what a narrow plate shows (spec 2026-10-21 §2 A4). */
export const rankNumeral = (rank: number): string => NUMERALS[rank - 1] ?? ''

export interface RankLabelProps {
  /** The player's rank 1..5. Rank 1, no rank (a bot, a cache still loading) and a number off the ladder show nothing. */
  rank: number | null | undefined
  lang: Language
  /** A narrow plate, a landscape phone, a list row: the roman numeral in a pill, the rank's name in its `title`. */
  compact?: boolean
}

/**
 * A player's reputation rank beside their name (Plan 27, spec §2 A3–A4): the rank's name in its colour (`--rank-N`), or
 * — `compact` — its roman numeral in a pill of the same colour. Rank 1 is where everyone starts, so it says nothing:
 * the label is something earned.
 */
export function RankLabel({ rank, lang, compact = false }: RankLabelProps) {
  const { t } = useTranslation()
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 2 || rank > NUMERALS.length) return null
  const name = t(`game:rank.${rank}`, { lng: lang })
  if (!compact) {
    return (
      <span className={s.rankLabel} data-rank={rank}>
        {name}
      </span>
    )
  }
  return (
    <span className={s.rankPill} data-rank={rank} title={name} role="img" aria-label={name}>
      {rankNumeral(rank)}
    </span>
  )
}
