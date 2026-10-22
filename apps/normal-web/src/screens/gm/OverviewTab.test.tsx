import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DaySumsDto, GmOverviewDto, NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { OverviewTab } from './OverviewTab.js'

const OVERVIEW: GmOverviewDto = {
  online: 3,
  rooms: 1,
  accounts: 40,
  locked: 0,
  gms: 1,
  points24h: { sources: 1000, sinks: 400, byReason: [{ reason: 'daily_login', total: 1000 }] },
  reputation: { total: 2_400, byRank: [30, 6, 3, 1, 0] },
}

function day(n: number, sources: number, sinks: number): DaySumsDto {
  return {
    day: new Date(Date.UTC(2026, 9, 10 + n)).toISOString().slice(0, 10),
    sources: sources === 0 ? {} : { daily_login: sources },
    sinks: sinks === 0 ? {} : { rake: sinks },
    net: sources - sinks,
  }
}

/** Seven days: the largest single sum (8,000 of sources, on day 2) fixes the scale every bar is drawn against. */
const WEEK: DaySumsDto[] = [day(0, 2000, 1000), day(1, 4000, 0), day(2, 8000, 2000), day(3, 0, 6000), day(4, 1000, 1000), day(5, 0, 0), day(6, 500, 4000)]

function setup(gmDailyStats = vi.fn().mockResolvedValue(WEEK)) {
  const api = { gmOverview: vi.fn().mockResolvedValue(OVERVIEW), gmDailyStats } as unknown as NormalApi
  const guard = (cause: unknown): never => {
    throw cause
  }
  const result = renderWithI18n(<OverviewTab api={api} lang="vi" guard={guard} />)
  return { ...result, gmDailyStats }
}

const t = viNormal.gm.overview

/** The two bars of a row, by their colour class's role: the first is sources (gold), the second sinks (red). */
function barsOf(row: HTMLElement): { sources: string; sinks: string } {
  const spans = row.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')
  return { sources: spans[0]?.style.width ?? '', sinks: spans[1]?.style.width ?? '' }
}

async function bodyRows(): Promise<HTMLElement[]> {
  const table = (await screen.findByRole('table', { name: t.byDay })) as HTMLTableElement
  return within(table.tBodies[0]!).getAllByRole('row')
}

describe('OverviewTab by day', () => {
  it('asks for seven days first and draws one row per day', async () => {
    const { gmDailyStats } = setup()

    const rows = await bodyRows()

    expect(gmDailyStats).toHaveBeenCalledWith(7)
    expect(rows).toHaveLength(7)
    expect(within(rows[2]!).getByText('+6.000')).toBeInTheDocument()
  })

  it('scales the gold bars on sources and the red ones on sinks against the largest single sum', async () => {
    setup()
    const rows = await bodyRows()

    expect(barsOf(rows[2]!).sources).toBe('100%')
    expect(barsOf(rows[0]!).sources).toBe('25%')
    expect(barsOf(rows[1]!).sources).toBe('50%')
    expect(barsOf(rows[3]!).sinks).toBe('75%')
    expect(barsOf(rows[6]!).sinks).toBe('50%')
    expect(barsOf(rows[5]!)).toEqual({ sources: '0%', sinks: '0%' })
  })

  it('keeps the numbers beside the bars, and both numbers in the bar cell title', async () => {
    setup()
    const rows = await bodyRows()

    const cells = within(rows[3]!).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('13')
    expect(cells[1]).toHaveTextContent(/^0$/)
    expect(cells[2]).toHaveTextContent('6.000')
    expect(cells[3]).toHaveTextContent('-6.000')
    expect(cells[4]!.getAttribute('title')).toContain('6.000')
  })

  it('refetches with thirty days when the switch says so', async () => {
    const user = userEvent.setup()
    const thirty = Array.from({ length: 30 }, (_, i) => day(i, 1000, 500))
    const { gmDailyStats } = setup(vi.fn().mockResolvedValueOnce(WEEK).mockResolvedValueOnce(thirty))
    await bodyRows()

    await user.click(screen.getByRole('button', { name: t.days30 }))

    await waitFor(() => expect(gmDailyStats).toHaveBeenCalledWith(30))
    await waitFor(async () => expect(await bodyRows()).toHaveLength(30))
    expect(screen.getByRole('button', { name: t.days30 })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says so, and draws no bars, when the range holds no movement at all', async () => {
    const quiet = Array.from({ length: 7 }, (_, i) => day(i, 0, 0))
    setup(vi.fn().mockResolvedValue(quiet))

    expect(await screen.findByText(t.byDayEmpty)).toBeInTheDocument()
    expect(document.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0)
  })

  it('offers a retry when the days cannot be loaded', async () => {
    setup(vi.fn().mockRejectedValue(new Error('down')))

    expect(await screen.findByText(t.byDayError)).toBeInTheDocument()
  })
})

describe('OverviewTab reputation', () => {
  it('says how many accounts stand at each rank, by the rank names', async () => {
    setup()

    expect(await screen.findByText('Danh vọng, số người ở mỗi bậc: Tân binh 30 · Tay bài 6 · Cao thủ 3 · Bậc thầy 1 · Huyền thoại 0')).toBeInTheDocument()
  })
})
