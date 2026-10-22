import { formatPoints, type Language } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { RankThresholdDto } from '../api.js'
import s from './normal.module.css'

/** What the line reads: `GET /api/me`'s three Plan 27 fields, which `GET /api/shop`'s `me` repeats. */
export interface ReputationStanding {
  reputation: number
  rank: number
  ranks: RankThresholdDto[]
}

/**
 * The reputation line (Plan 27, spec 2026-10-21 §2 A4): "Danh vọng 455 · Cao thủ · còn 1.345 tới Bậc thầy", and a bar
 * as far along from this rank's threshold to the next one's. At the top of the ladder there is no next step: the line
 * stops at the rank and the bar goes. The rank is a high-water mark, so a GM raising a threshold can leave the
 * reputation under the rank's own threshold (R15): the bar then reads empty, never negative. Nothing at all from a
 * server older than Plan 27, which sends no reputation.
 *
 * The profile draws it under the name, and the shop under the figure (spec §3 B3) — one module, so the two cannot drift.
 */
export function ReputationLine({ standing, lang }: { standing: ReputationStanding; lang: Language }) {
  const { t } = useTranslation('normal')
  if (typeof standing.reputation !== 'number' || typeof standing.rank !== 'number') return null
  const ranks = Array.isArray(standing.ranks) ? standing.ranks : []
  const rankName = (rank: number): string => t(`game:rank.${rank}`, { defaultValue: String(rank) })
  const points = formatPoints(standing.reputation, lang)
  const here = ranks.find((r) => r.rank === standing.rank)?.threshold ?? 0
  const next = ranks.filter((r) => r.rank > standing.rank).sort((x, y) => x.rank - y.rank)[0]
  const progress =
    next === undefined ? null : Math.min(1, Math.max(0, (standing.reputation - here) / Math.max(1, next.threshold - here)))
  return (
    <div className={s.repLine} data-reputation="">
      <p className={s.repText}>
        {next === undefined
          ? t('profile.reputationTop', { points, rank: rankName(standing.rank) })
          : t('profile.reputation', {
              points,
              rank: rankName(standing.rank),
              left: formatPoints(Math.max(0, next.threshold - standing.reputation), lang),
              next: rankName(next.rank),
            })}
      </p>
      {progress === null ? null : (
        <span className={s.repBar} aria-hidden="true">
          <span
            className={s.repFill}
            data-progress=""
            style={{ width: `${Math.round(progress * 1000) / 10}%`, background: `var(--rank-${standing.rank}, var(--ink-muted))` }}
          />
        </span>
      )}
    </div>
  )
}
