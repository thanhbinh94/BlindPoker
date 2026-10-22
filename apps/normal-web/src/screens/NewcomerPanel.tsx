import { formatPoints, Panel, type Language } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { NewcomerStatusDto } from '../api.js'
import s from './normal.module.css'
import w from './welcome.module.css'

/** The newcomer calendar's length (spec 2026-10-21 §4 C2): day 1 is the welcome claim, days 2–7 the check-ins after it. */
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** Day 7's reputation when the status does not say (a server older than the Plan 27 fix wave): `rules.newcomer_day7`'s default. */
export const NEWCOMER_DAY7_REPUTATION = 200

type Mark = 'claimed' | 'today' | 'locked'

const GLYPH: Record<Mark, string> = { claimed: '✓', today: '★', locked: '🔒' }

export interface NewcomerPanelProps {
  /** `DailyStatusDto.newcomer`: absent with no welcome claim yet, once finished, and from an older server. */
  newcomer: NewcomerStatusDto | undefined
  lang: Language
}

/**
 * "Tuần đầu tiên" (spec 2026-10-21 §4 C2, R7): the first seven check-ins as seven cells — ✓ for a day already
 * counted, ★ "Hôm nay" for the one today's claim reaches, 🔒 for the rest — with the gifts of days 3 and 7 written in
 * their own cells. It counts check-ins, not calendar days, so a missed day moves nothing. Gone once the calendar is
 * finished; the claim that finishes it says so on the receipt instead.
 */
export function NewcomerPanel({ newcomer, lang }: NewcomerPanelProps) {
  const { t } = useTranslation('normal')
  if (newcomer === undefined || newcomer.finished) return null
  const claimed = new Set(newcomer.claimedDays)

  const markOf = (day: number): Mark => (claimed.has(day) ? 'claimed' : day === newcomer.day ? 'today' : 'locked')
  const giftOf = (day: number): string | null =>
    day === 3 ? t('daily.newcomer.common') : day === 7 ? t('daily.newcomer.rare', { amount: formatPoints(newcomer.day7Reputation ?? NEWCOMER_DAY7_REPUTATION, lang) }) : null

  return (
    <Panel title={t('daily.newcomer.title')}>
      <p className={`${s.footnote} ${w.newcomerLead}`}>{t('daily.newcomer.lead')}</p>
      <ol className={s.calendar} aria-label={t('daily.newcomer.title')}>
        {DAYS.map((day) => {
          const mark = markOf(day)
          const gift = giftOf(day)
          return (
            <li
              key={day}
              className={s.calCell}
              data-mark={mark}
              {...(mark === 'claimed' ? { 'data-claimed': 'true' } : {})}
              {...(mark === 'today' ? { 'aria-current': 'date' as const } : {})}
            >
              <span className={s.calDay}>{t('daily.newcomer.day', { day })}</span>
              <span className={w.cellMark} aria-hidden="true">
                {GLYPH[mark]}
              </span>
              {mark === 'today' ? <span className={w.cellWord}>{t('daily.newcomer.today')}</span> : <span className="visually-hidden">{t(`daily.newcomer.${mark}`)}</span>}
              {gift === null ? null : <span className={w.cellGift}>{gift}</span>}
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
