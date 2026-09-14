import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AchievementProgressDto, type NormalApi } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AchievementsScreen } from './AchievementsScreen.js'

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

    expect(screen.getByText(viNormal.achievements.ui.summary.replace('{{unlocked}}', '2').replace('{{total}}', '6'))).toBeInTheDocument()
    for (const label of Object.values(viNormal.achievements.ui.category)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(viNormal.achievements.login_days_7.desc)).toBeInTheDocument()
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

  it('prints the reward as points, as an item, or as both, and dates what is unlocked', async () => {
    const { i18n } = renderScreen()
    await screen.findByText(viNormal.achievements.login_days_7.name)

    const points = `5.000 ${i18n.t('common:units.pointsShort')}`
    expect(screen.getByText(points)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.head_crown_gold01)).toBeInTheDocument()
    expect(screen.getByText(`3.000 ${i18n.t('common:units.pointsShort')} · ${viNormal.items.badge_bronze}`)).toBeInTheDocument()

    const done = screen.getByText(viNormal.achievements.login_days_7.name).closest('li')
    expect(done).not.toBeNull()
    expect(within(done as HTMLElement).getByText(/2026/)).toBeInTheDocument()
    const locked = screen.getByText(viNormal.achievements.login_days_30.name).closest('li')
    expect(within(locked as HTMLElement).getByText(viNormal.achievements.ui.locked)).toBeInTheDocument()
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
