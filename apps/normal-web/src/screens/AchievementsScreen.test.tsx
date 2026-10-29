import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AchievementProgressDto, type NormalApi } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AchievementsScreen } from './AchievementsScreen.js'
import s from './normal.module.css'

const ROWS: AchievementProgressDto[] = [
  {
    id: 'login_days_7',
    category: 'login',
    metric: 'totalLoginDays',
    threshold: 7,
    reward: { points: 5_000 },
    progress: 7,
    unlockedAt: Date.UTC(2026, 2, 20),
  },
  {
    id: 'login_days_30',
    category: 'login',
    metric: 'totalLoginDays',
    threshold: 30,
    reward: { points: 20_000 },
    progress: 12,
    unlockedAt: null,
  },
  {
    id: 'login_days_100',
    category: 'login',
    metric: 'totalLoginDays',
    threshold: 100,
    reward: { itemId: 'head_crown_gold01' },
    progress: 12,
    unlockedAt: null,
  },
  {
    id: 'holdem_hands_10',
    category: 'holdem',
    metric: 'handsPlayedHoldem',
    threshold: 10,
    // The counter keeps running past the threshold; the bar must not.
    reward: { points: 3_000, itemId: 'badge_bronze' },
    progress: 240,
    unlockedAt: Date.UTC(2026, 3, 1),
  },
  {
    id: 'blind_hands_10',
    category: 'blind',
    metric: 'handsPlayedBlind',
    threshold: 10,
    reward: { points: 3_000 },
    progress: 4,
    unlockedAt: null,
  },
  {
    id: 'rooms_10',
    category: 'social',
    metric: 'roomsJoined',
    threshold: 10,
    reward: { points: 4_000 },
    progress: 9,
    unlockedAt: null,
  },
  {
    id: 'chaos_godslayer',
    category: 'chaos',
    metric: 'chaosGodsSlain',
    threshold: 2,
    reward: { points: 500_000, itemId: 'title_godslayer' },
    reputation: 500,
    progress: 1,
    unlockedAt: null,
  },
  {
    id: 'chaos_demigod',
    category: 'chaos',
    metric: 'chaosDemigods',
    threshold: 1,
    reward: { points: 150_000, itemId: 'title_demigod' },
    reputation: 150,
    progress: 1,
    unlockedAt: Date.UTC(2026, 9, 29),
  },
]

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return { achievements: vi.fn().mockResolvedValue(ROWS), ...overrides } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<AchievementsScreen api={api} lang="vi" />, makeI18n('vi'))

describe('AchievementsScreen', () => {
  it('shows a status line while the list is in flight', () => {
    renderScreen(stubApi({ achievements: vi.fn(() => new Promise<AchievementProgressDto[]>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
  })

  it('says so when the list cannot be read, and asks again when told to', async () => {
    const achievements = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(ROWS)
    const user = userEvent.setup()
    renderScreen(stubApi({ achievements }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.achievements.ui.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText(viNormal.achievements.login_days_7.name)).toBeInTheDocument()
  })

  it('counts what is unlocked and groups the rest by category', async () => {
    renderScreen()
    await screen.findByText(viNormal.achievements.login_days_7.name)

    expect(screen.getByText(viNormal.achievements.ui.summary.replace('{{unlocked}}', '3').replace('{{total}}', '8'))).toBeInTheDocument()
    for (const label of Object.values(viNormal.achievements.ui.category)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(viNormal.achievements.login_days_7.desc)).toBeInTheDocument()
  })

  it('files the chaos titles under their own heading, last, with the reputation they pay beside points and title', async () => {
    renderScreen()
    // The title the achievement pays shares its name: the row is the first match.
    await screen.findAllByText(viNormal.achievements.chaos_godslayer.name)

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.at(-1)).toBe(viNormal.achievements.ui.category.chaos)

    const row = screen.getAllByText(viNormal.achievements.chaos_godslayer.name)[0]!.closest('li')!
    expect(within(row).getByText(viNormal.achievements.chaos_godslayer.desc)).toBeInTheDocument()
    // Points and title, each kept whole: a line may break between them, never inside the title.
    const points = within(row).getByText('500.000 điểm')
    const title = within(points.parentElement!).getByText(viNormal.items.title_godslayer)
    for (const part of [points, title]) expect(part).toHaveClass(s.achPart!)
    expect(points.parentElement).toHaveTextContent(`500.000 điểm · ${viNormal.items.title_godslayer}`)
    expect(within(row).getByText('500 danh vọng')).toBeInTheDocument()
    expect(screen.getByText(viNormal.achievements.ui.progress.replace('{{progress}}', '1').replace('{{threshold}}', '2'))).toBeInTheDocument()
    const demigod = screen.getAllByText(viNormal.achievements.chaos_demigod.name)[0]!.closest('li')!
    expect(demigod).toHaveAttribute('data-unlocked', 'true')
    expect(demigod).toHaveTextContent('150 danh vọng')
  })

  it('shows no reputation on an achievement that names none', async () => {
    renderScreen()
    await screen.findByText(viNormal.achievements.login_days_7.name)

    const row = screen.getByText(viNormal.achievements.login_days_7.name).closest('li')!
    expect(row).not.toHaveTextContent('danh vọng')
  })

  it('gives each row a progress bar that says how far along it is, clamped at the threshold', async () => {
    renderScreen()
    await screen.findByText(viNormal.achievements.login_days_7.name)

    const partway = screen.getByRole('progressbar', { name: viNormal.achievements.login_days_30.name })
    expect(partway).toHaveAttribute('aria-valuenow', '12')
    expect(partway).toHaveAttribute('aria-valuemax', '30')
    expect(screen.getByText(viNormal.achievements.ui.progress.replace('{{progress}}', '12').replace('{{threshold}}', '30'))).toBeInTheDocument()

    // 240 hands played against a threshold of 10 is still "10 of 10", not 2400 %.
    const past = screen.getByRole('progressbar', { name: viNormal.achievements.holdem_hands_10.name })
    expect(past).toHaveAttribute('aria-valuenow', '10')
    expect(past).toHaveAttribute('aria-valuetext', viNormal.achievements.ui.progress.replace('{{progress}}', '10').replace('{{threshold}}', '10'))
  })

  it('draws an unlocked row full even when its counter has not reached the threshold (a GM unlocked it)', async () => {
    const forced: AchievementProgressDto = {
      id: 'login_days_30',
      category: 'login',
      metric: 'totalLoginDays',
      threshold: 30,
      reward: { points: 20_000 },
      progress: 12,
      unlockedAt: Date.UTC(2026, 9, 20),
    }
    renderScreen(stubApi({ achievements: vi.fn().mockResolvedValue([forced]) }))
    await screen.findByText(viNormal.achievements.login_days_30.name)

    const bar = screen.getByRole('progressbar', { name: viNormal.achievements.login_days_30.name })
    const full = viNormal.achievements.ui.progress.replace('{{progress}}', '30').replace('{{threshold}}', '30')
    expect(bar).toHaveAttribute('aria-valuenow', '30')
    expect(bar).toHaveAttribute('aria-valuetext', full)
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' })
    expect(screen.getByText(full)).toBeInTheDocument()
  })

  it('groups the digits of a large counter the way every other number on screen is grouped', async () => {
    const big: AchievementProgressDto = {
      id: 'big_win_100k',
      category: 'holdem',
      metric: 'biggestWin',
      threshold: 100_000,
      reward: { points: 10_000 },
      progress: 2_500,
      unlockedAt: null,
    }
    renderScreen(stubApi({ achievements: vi.fn().mockResolvedValue([big]) }))
    await screen.findByText(viNormal.achievements.big_win_100k.name)

    // Layout audit L7: this used to read "2500 trên 100000".
    const counter = viNormal.achievements.ui.progress.replace('{{progress}}', '2.500').replace('{{threshold}}', '100.000')
    expect(screen.getByText(counter)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: viNormal.achievements.big_win_100k.name })
    // The machine-readable values stay plain numbers.
    expect(bar).toHaveAttribute('aria-valuenow', '2500')
    expect(bar).toHaveAttribute('aria-valuemax', '100000')
  })

  it('prints the reward as points, as an item, or as both, and dates what is unlocked', async () => {
    const { i18n } = renderScreen()
    await screen.findByText(viNormal.achievements.login_days_7.name)

    const points = `5.000 ${i18n.t('common:units.pointsShort')}`
    expect(screen.getByText(points)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.head_crown_gold01)).toBeInTheDocument()
    // Both: one badge, the two parts each kept whole.
    const both = screen.getByText(viNormal.items.badge_bronze).parentElement!
    expect(both).toHaveTextContent(`3.000 ${i18n.t('common:units.pointsShort')} · ${viNormal.items.badge_bronze}`)

    const done = screen.getByText(viNormal.achievements.login_days_7.name).closest('li')
    expect(done).not.toBeNull()
    expect(within(done as HTMLElement).getByText(/2026/)).toBeInTheDocument()
    expect(done).toHaveAttribute('data-unlocked', 'true')
    const locked = screen.getByText(viNormal.achievements.login_days_30.name).closest('li')
    // The state is the row's look now, not a printed "Chưa mở" on every row (layout audit C8) — but it is still
    // said to a screen reader, after the name.
    expect(locked).toHaveAttribute('data-unlocked', 'false')
    expect(within(locked as HTMLElement).getByText(viNormal.achievements.ui.locked, { exact: false })).toHaveClass('visually-hidden')
    expect(within(done as HTMLElement).getByText(viNormal.achievements.ui.unlocked, { exact: false })).toHaveClass('visually-hidden')
  })

  it('falls back to the id for an achievement this bundle has never heard of', async () => {
    const unknown: AchievementProgressDto = {
      id: 'hand_royal_flush',
      category: 'holdem',
      metric: 'bestHandRank',
      threshold: 1,
      reward: { itemId: 'hat_lunar_2027' },
      progress: 0,
      unlockedAt: null,
    }
    renderScreen(stubApi({ achievements: vi.fn().mockResolvedValue([unknown]) }))

    // The name carries the id, the reward names its item the same way — and the description, which would
    // only repeat the line above it, says nothing at all rather than announcing a key to a screen reader.
    expect(await screen.findByText('hand_royal_flush')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'hand_royal_flush' })).toBeInTheDocument()
    expect(screen.getByText('hat_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText(/^achievements\./)).toBeNull()
    expect(screen.queryByText(/^items\./)).toBeNull()
  })
})
