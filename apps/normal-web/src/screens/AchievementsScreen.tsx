import { Badge, Button, Panel, formatPoints, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AchievementProgressDto, NormalApi } from '../api.js'
import { achievementDesc, achievementName, itemName } from '../catalog-i18n.js'
import { formatDay } from './format.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

/** The earned row's tick, a named value rather than a literal in the markup (`react/jsx-no-literals`). */
const CHECK_GLYPH = '✓'

/** `apps/normal-server/data/achievements.json` — the four buckets, in the order the screen reads best. */
export const CATEGORY_ORDER = ['login', 'holdem', 'blind', 'social']

/** A reward is points, an item, or both. Anything with neither is a definition bug, and prints nothing. */
export function rewardText(row: AchievementProgressDto, lang: Language, t: TFunction): string {
  const parts: string[] = []
  if (row.reward.points !== undefined) parts.push(`${formatPoints(row.reward.points, lang)} ${t('common:units.pointsShort')}`)
  if (row.reward.itemId !== undefined) parts.push(itemName(row.reward.itemId, t))
  return parts.join(' · ')
}

/**
 * A category order that a server-side addition cannot fall out of: the four known buckets first, in order,
 * then anything else in the order it arrived.
 */
export function categoriesOf(rows: AchievementProgressDto[]): string[] {
  const seen = [...new Set(rows.map((row) => row.category))]
  return [...CATEGORY_ORDER.filter((key) => seen.includes(key)), ...seen.filter((key) => !CATEGORY_ORDER.includes(key))]
}

export interface AchievementsScreenProps {
  api: NormalApi
  lang: Language
}

/**
 * Every achievement, whether it is done, and how far along the rest are.
 *
 * The progress bar is a `div` with the progressbar role rather than a `<progress>` element, and deliberately:
 * the numbers matter here — "84 of 100" is the whole point of an unfinished row — and an explicit
 * `aria-valuenow`/`aria-valuetext` pair is the only way to be sure they are what gets announced.
 *
 * Progress is clamped at the threshold. The server keeps counting past it (the counter is the metric, not
 * the achievement), so an unclamped bar would render at 340 % and read as broken.
 */
export function AchievementsScreen({ api, lang }: AchievementsScreenProps) {
  const { t } = useTranslation('normal')
  const list = useAsync<AchievementProgressDto[]>(() => api.achievements())
  const rows = list.data

  if (list.loading && rows === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (rows === null) {
    return (
      <main className={s.page}>
        <p className={s.alert} role="alert">
          {t('achievements.ui.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={list.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </main>
    )
  }

  const unlocked = rows.filter((row) => row.unlockedAt !== null).length

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('achievements.ui.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.summary}>{t('achievements.ui.summary', { unlocked, total: rows.length })}</p>

      {rows.length === 0 ? <p className={s.footnote}>{t('achievements.ui.empty')}</p> : null}

      {categoriesOf(rows).map((category) => (
        <Panel title={t(`achievements.ui.category.${category}`, { defaultValue: category })} key={category}>
          <ul className={s.rows}>
            {rows
              .filter((row) => row.category === category)
              .map((row) => {
                const done = Math.min(row.progress, row.threshold)
                // No shipped definition has a threshold of 0, but `NaN%` is what one would paint, so the
                // degenerate case reads as "there was nothing to do" rather than as a broken bar.
                const filled = row.threshold === 0 ? 100 : (done / row.threshold) * 100
                const reward = rewardText(row, lang, t)
                // Grouped like every other number on screen — "0 trên 100.000", not "0 trên 100000" (layout
                // audit L7); `formatPoints` is the kit's integer formatter, points or not.
                const counter = t('achievements.ui.progress', {
                  progress: formatPoints(done, lang),
                  threshold: formatPoints(row.threshold, lang),
                })
                const unlocked = row.unlockedAt !== null
                // Three fixed columns — what it is, how far along, what it pays — so every bar starts at the same
                // x; the state is the row's look (✓ and a date, or dimmed) rather than "Chưa mở" printed 34
                // times (layout audit C8, 2026-09-28). The word stays for a screen reader.
                return (
                  <li className={s.achievement} key={row.id} data-unlocked={String(unlocked)}>
                    <span className={s.rowMain}>
                      <span className={s.rowTitle}>
                        {unlocked ? (
                          <span className={s.achCheck} aria-hidden="true">
                            {CHECK_GLYPH}
                          </span>
                        ) : null}
                        {achievementName(row.id, t)}
                        <span className="visually-hidden">
                          {' — '}
                          {unlocked ? t('achievements.ui.unlocked') : t('achievements.ui.locked')}
                        </span>
                      </span>
                      <span className={s.rowMeta}>{achievementDesc(row.id, t)}</span>
                    </span>

                    <span className={s.trackWrap}>
                      <span
                        className={s.track}
                        role="progressbar"
                        aria-label={achievementName(row.id, t)}
                        aria-valuemin={0}
                        aria-valuemax={row.threshold}
                        aria-valuenow={done}
                        aria-valuetext={counter}
                      >
                        <span className={s.fill} style={{ width: `${filled}%` }} />
                      </span>
                      <span className={s.rowMeta}>{counter}</span>
                    </span>

                    <span className={s.achReward}>
                      {reward === '' ? null : (
                        <Badge tone={unlocked ? 'gold' : 'muted'}>
                          <span className="visually-hidden">{t('achievements.ui.reward')}</span>
                          {reward}
                        </Badge>
                      )}
                      {row.unlockedAt === null ? null : (
                        <time className={s.rowMeta} dateTime={new Date(row.unlockedAt).toISOString()}>
                          {t('achievements.ui.unlockedAt', { date: formatDay(row.unlockedAt, lang) })}
                        </time>
                      )}
                    </span>
                  </li>
                )
              })}
          </ul>
        </Panel>
      ))}
    </main>
  )
}
