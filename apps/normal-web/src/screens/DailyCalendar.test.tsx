import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarEntryDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { renderWithI18n } from '../test-i18n.js'
import { DailyCalendar } from './DailyCalendar.js'

const ENTRIES: CalendarEntryDto[] = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1
  const item = day === 7 ? 'common' : day === 14 ? 'rare' : day === 28 ? 'badge_monthly' : null
  return { day, points: day * 1_000, item, items: day === 28 ? ['badge_monthly', 'title_devoted'] : [] }
})

const list = () => within(screen.getByRole('list', { name: viNormal.daily.calendarTitle }))
const editLabel = (day: number): string => viNormal.gm.gifts.editDay.replace('{{day}}', String(day))

describe('DailyCalendar', () => {
  it('draws thirty-one tiers with their points, and no mark when it is not told a day', () => {
    renderWithI18n(<DailyCalendar entries={ENTRIES} month="2026-11" lang="vi" />)

    expect(list().getAllByRole('listitem')).toHaveLength(31)
    expect(list().getByText(/^31\.000/)).toBeInTheDocument()
    expect(list().queryAllByText(viNormal.daily.claimedMark)).toHaveLength(0)
    expect(list().queryAllByText(viNormal.daily.todayMark)).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('names the month in the legend line of a fixed day', () => {
    renderWithI18n(<DailyCalendar entries={ENTRIES} month="2026-11" lang="vi" />)

    expect(screen.getByText(/Ngày 28 tháng 11\/2026/u)).toBeInTheDocument()
  })

  it('marks the days up to the claimed one and today, as the player sees them', () => {
    renderWithI18n(<DailyCalendar entries={ENTRIES} month="2026-10" day={5} claimable lang="vi" />)

    expect(list().getAllByText(viNormal.daily.claimedMark)).toHaveLength(4)
    expect(list().getAllByText(viNormal.daily.todayMark)).toHaveLength(1)
  })

  it('hides the points line with showPoints={false}', () => {
    renderWithI18n(<DailyCalendar entries={ENTRIES} month="2026-10" showPoints={false} lang="vi" />)

    expect(list().queryByText(/^31\.000/)).toBeNull()
    expect(list().queryByText(/^7\.000/)).toBeNull()
    expect(list().getAllByRole('listitem')).toHaveLength(31)
  })

  it('hands an open day to onPick and ignores a locked one', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderWithI18n(<DailyCalendar entries={ENTRIES} month="2026-10" lockedThrough={10} onPick={onPick} lang="vi" />)

    await user.click(screen.getByRole('button', { name: editLabel(11) }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(11)

    expect(screen.queryByRole('button', { name: editLabel(10) })).toBeNull()
    expect(screen.queryByRole('button', { name: editLabel(1) })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(21)
    const locked = list().getAllByRole('listitem')[9] as HTMLElement
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    await user.click(locked)
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
