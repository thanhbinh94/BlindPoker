import { formatPoints, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { CalendarEntryDto } from '../api.js'
import { itemName } from '../catalog-i18n.js'
import { formatMonthKey } from './format.js'
import s from './normal.module.css'

/** A claimed tier's tick, a named value rather than a literal in the markup (`react/jsx-no-literals`). */
const CHECK_GLYPH = '✓'

/** What an item tier pays, as the colour of its gift icon (`.calGift[data-kind]`). */
export type MarkerKind = 'common' | 'rare' | 'fixed'

/** The draws a tier can advertise, and the words for them. A fixed day names its items instead (`markerOf`). */
const DRAW_MARKERS: Record<string, { kind: MarkerKind; key: string }> = {
  common: { kind: 'common', key: 'daily.marker.common' },
  rare: { kind: 'rare', key: 'daily.marker.rare' },
}

/** The draw kinds, in the legend's order. */
const DRAW_KINDS = ['common', 'rare'] as const

/** Between two gift names — "Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông" — the same in both languages. */
const GIFT_JOIN = ' + '

/**
 * A fixed day's items, read defensively: `items` arrived with Plan 22, and a bundle that meets an older server (a
 * `vite dev` session against an un-rebuilt one, say) should lose the names, not the whole page.
 */
const fixedItems = (entry: CalendarEntryDto): readonly string[] => entry.items ?? []

/** A fixed day's gifts, by name, in the schedule's order. */
export function giftNames(itemIds: readonly string[], t: TFunction): string {
  return itemIds.map((id) => itemName(id, t)).join(GIFT_JOIN)
}

/**
 * The calendar's item column, as something to draw (spec 2026-10-12 §4.3).
 *
 * A fixed day names what it grants, from `items` — the month's own list, so day 28 of 11/2026 reads "Huy hiệu tháng
 * + Chuyên cần + Mũ chóp quý ông" and day 28 of 10/2026 the pair alone. A random tier cannot name its item in
 * advance — the server picks it against the inventory at the moment of the claim — so days 7, 14 and 21 advertise a
 * *rarity* and get the wardrobe's own tone for it.
 *
 * The draws are exhaustive rather than open-ended: a marker this bundle predates draws nothing at all, which is
 * honest, where a catch-all would confidently promise a prize the tier does not give. The points on that day still
 * show — only the promise this app cannot keep is withheld.
 */
export function markerOf(entry: CalendarEntryDto, t: TFunction): { kind: MarkerKind; label: string } | null {
  const items = fixedItems(entry)
  if (items.length > 0) return { kind: 'fixed', label: giftNames(items, t) }
  const draw = entry.item === null ? undefined : DRAW_MARKERS[entry.item]
  return draw === undefined ? null : { kind: draw.kind, label: t(draw.key) }
}

/** The rail's own Daily pictogram, as the calendar's item marker: a stroked gift in the tier's colour. */
function GiftIcon() {
  return (
    <svg className={s.calGiftIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 5h18v4H3zm9 0v16M12 5c-1.5-3-5-3-5 0m5 0c1.5-3 5-3 5 0" />
    </svg>
  )
}

export interface DailyCalendarProps {
  entries: CalendarEntryDto[]
  /** `YYYY-MM`, the month `entries` describe: the legend's line for a fixed day names it. */
  month: string
  /** The tier this claim is *for* (`DailyStatusDto.day`). Absent, the calendar draws no claimed or today mark. */
  day?: number | null
  /** Whether that tier is still to be taken: the line between claimed and unclaimed moves with it. */
  claimable?: boolean
  /** Makes each open tier a button, as the game master's gift editor needs; absent, the tiers are plain items. */
  onPick?: (day: number) => void
  /** Tiers up to and including this one cannot be picked (a month's days that have already passed). */
  lockedThrough?: number
  /** `false` where the points are not this page's business (the editor shows gifts only). */
  showPoints?: boolean
  lang: Language
}

/**
 * A month's streak tiers — seven to a row, four on a phone — and the legend that says what the gifts on them are.
 *
 * The player's Daily screen draws it from their own status, the game master's gift editor from a schedule it is
 * editing; one component keeps the two looking exactly alike, so what a GM saves is what a player will see.
 */
export function DailyCalendar({ entries, month, day = null, claimable = false, onPick, lockedThrough = 0, showPoints = true, lang }: DailyCalendarProps) {
  const { t } = useTranslation('normal')
  // `day` is the tier this claim is *for*: the one about to be taken while it is claimable, and the one already
  // taken once it is not. So the line between claimed and unclaimed moves with it.
  const claimedThrough = day === null ? 0 : claimable ? day - 1 : day

  return (
    <>
      <ol className={s.calendar} aria-label={t('daily.calendarTitle')}>
        {entries.map((entry) => {
          const claimed = entry.day <= claimedThrough
          const marker = markerOf(entry, t)
          const mark = claimed ? t('daily.claimedMark') : entry.day === day ? t('daily.todayMark') : null
          const locked = onPick !== undefined && entry.day <= lockedThrough
          return (
            <li
              className={s.calCell}
              key={entry.day}
              data-claimed={String(claimed)}
              {...(entry.day === day ? { 'aria-current': 'date' as const } : {})}
              {...(locked ? { 'aria-disabled': true, title: t('gm.gifts.locked') } : {})}
            >
              <span className={s.calDay}>{t('daily.dayLabel', { day: entry.day })}</span>
              {/* The number alone: the lead above says these are points, and "12.000 điểm" does not fit a
                  seventh of the page, let alone a quarter of a phone. */}
              {showPoints ? <span className={s.calPoints}>{formatPoints(entry.points, lang)}</span> : null}
              {marker === null ? null : (
                <span className={s.calGift} data-kind={marker.kind} title={marker.label}>
                  <GiftIcon />
                  <span className="visually-hidden">{marker.label}</span>
                </span>
              )}
              {mark === null ? null : claimed ? (
                <span className={s.calCheck}>
                  <span aria-hidden="true">{CHECK_GLYPH}</span>
                  <span className="visually-hidden">{mark}</span>
                </span>
              ) : (
                <span className={s.calToday}>{mark}</span>
              )}
              {onPick === undefined || locked ? null : (
                <button type="button" className={s.calPick} aria-label={t('gm.gifts.editDay', { day: entry.day })} onClick={() => onPick(entry.day)} />
              )}
            </li>
          )
        })}
      </ol>
      {/* What the gifts mean, once, instead of a two-line pill in four cells: the draws this month has, then each
          fixed day by its day, its month and its gifts' names — the one place a phone, which has no tooltip,
          reads them (spec 2026-10-12 §4.3). A fixed day takes a row of its own (`calLegendDay`). */}
      <ul className={s.calLegend}>
        {DRAW_KINDS.filter((kind) => entries.some((entry) => fixedItems(entry).length === 0 && entry.item === kind)).map((kind) => (
          <li key={kind}>
            <span className={s.calGift} data-kind={kind}>
              <GiftIcon />
            </span>
            {t(`daily.marker.${kind}`)}
          </li>
        ))}
        {entries
          .filter((entry) => fixedItems(entry).length > 0)
          .map((entry) => (
            <li key={`day-${entry.day}`} className={s.calLegendDay}>
              <span className={s.calGift} data-kind="fixed">
                <GiftIcon />
              </span>
              {t('daily.marker.fixedDay', { day: entry.day, month: formatMonthKey(month), items: giftNames(fixedItems(entry), t) })}
            </li>
          ))}
      </ul>
    </>
  )
}
