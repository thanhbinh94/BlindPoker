import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DailyStatusDto, LiteApi, MeDto } from '../api.js'
import { ApiError } from '../api.js'
import viLite from '../locales/vi/lite.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { DailyScreen } from './DailyScreen.js'

const OPEN_DAILY: DailyStatusDto = {
  allowed: true,
  alreadyClaimed: false,
  day: 3,
  points: 3000,
  nextDay: 4,
  nextPoints: 4000,
  streak: 3,
  lastClaim: '2026-09-03',
}

function me(overrides: Partial<MeDto> = {}): MeDto {
  return {
    playerId: 'p1',
    displayName: 'Bình',
    balance: 12000,
    stats: { handsPlayed: 4, handsWon: 1 },
    daily: OPEN_DAILY,
    relief: { eligible: false, reason: 'balance', retryAt: null },
    ...overrides,
  }
}

function stubApi(overrides: Partial<LiteApi> = {}): LiteApi {
  return {
    config: vi.fn(),
    createSession: vi.fn(),
    me: vi.fn().mockResolvedValue(me()),
    daily: vi.fn().mockResolvedValue(OPEN_DAILY),
    claimDaily: vi.fn(),
    relief: vi.fn(),
    ...overrides,
  } as unknown as LiteApi
}

const render = (api: LiteApi) => ({
  ...renderWithI18n(<DailyScreen api={api} token="tok" lang="vi" />, makeI18n('vi')),
  user: userEvent.setup(),
})

const claimButton = (): HTMLButtonElement => screen.getByRole('button', { name: viLite.daily.claim }) as HTMLButtonElement

describe('DailyScreen', () => {
  it('renders the streak, today’s reward and tomorrow’s preview from the server', async () => {
    render(stubApi())

    expect(await screen.findByText(viLite.daily.todayReward)).toBeInTheDocument()
    expect(screen.getByText(viLite.daily.streak)).toBeInTheDocument()
    expect(screen.getByText(viLite.daily.day.replace('{{day}}', '3'))).toBeInTheDocument()
    expect(screen.getByText(viLite.daily.next)).toBeInTheDocument()
    expect(screen.getByText(viLite.daily.monthlyReset)).toBeInTheDocument()
    expect(claimButton()).toBeEnabled()
  })

  it('shows "claimed" and disables the button once today is taken', async () => {
    const api = stubApi({
      me: vi.fn().mockResolvedValue(me({ daily: { ...OPEN_DAILY, allowed: false, alreadyClaimed: true, points: 0 } })),
    })
    render(api)

    expect(await screen.findByText(viLite.daily.claimed)).toBeInTheDocument()
    expect(claimButton()).toBeDisabled()
  })

  it('claims the reward and prints the receipt', async () => {
    const api = stubApi({ claimDaily: vi.fn().mockResolvedValue({ claimed: true, points: 3000, streak: 3, balance: 15000 }) })
    const { user } = render(api)

    await user.click(await screen.findByRole('button', { name: viLite.daily.claim }))

    await waitFor(() => expect(api.claimDaily).toHaveBeenCalledWith('tok'))
    expect(await screen.findByText(viLite.daily.receipt.replace('{{points}}', '3.000').replace('{{streak}}', '3'))).toBeInTheDocument()
  })

  it('hides the relief section while the balance is healthy', async () => {
    render(stubApi())

    await screen.findByText(viLite.daily.todayReward)
    expect(screen.queryByText(viLite.daily.relief.title)).not.toBeInTheDocument()
  })

  it('offers relief when the server says it is eligible, and grants it', async () => {
    const api = stubApi({
      me: vi.fn().mockResolvedValue(me({ balance: 200, relief: { eligible: true, reason: 'ok', retryAt: null } })),
      relief: vi.fn().mockResolvedValue({ granted: true, amount: 4800, balance: 5000 }),
    })
    const { user } = render(api)

    expect(await screen.findByText(viLite.daily.relief.title)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: viLite.daily.relief.button }))

    await waitFor(() => expect(api.relief).toHaveBeenCalledWith('tok'))
    expect(await screen.findByText(viLite.daily.relief.receipt.replace('{{amount}}', '4.800'))).toBeInTheDocument()
  })

  it('explains the cooldown instead of offering the button', async () => {
    const api = stubApi({
      me: vi.fn().mockResolvedValue(me({ balance: 200, relief: { eligible: false, reason: 'cooldown', retryAt: Date.UTC(2026, 8, 5, 3, 0) } })),
    })
    render(api)

    expect(await screen.findByText(viLite.daily.relief.title)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(viLite.daily.relief.cooldown.replace('{{at}}', '')))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: viLite.daily.relief.button })).not.toBeInTheDocument()
  })

  it('surfaces a load failure rather than an empty card', async () => {
    render(stubApi({ me: vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK', 'down')) }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viLite.daily.error)
  })

  it('says what the server actually refused when a claim comes back ALREADY_CLAIMED', async () => {
    const api = stubApi({ claimDaily: vi.fn().mockRejectedValue(new ApiError(409, 'ALREADY_CLAIMED', 'nope')) })
    const { user } = render(api)

    await user.click(await screen.findByRole('button', { name: viLite.daily.claim }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viLite.daily.errors.ALREADY_CLAIMED)
  })

  it('says what the server actually refused when relief comes back NOT_ELIGIBLE', async () => {
    const api = stubApi({
      me: vi.fn().mockResolvedValue(me({ balance: 200, relief: { eligible: true, reason: 'ok', retryAt: null } })),
      relief: vi.fn().mockRejectedValue(new ApiError(409, 'NOT_ELIGIBLE', 'nope')),
    })
    const { user } = render(api)

    await user.click(await screen.findByRole('button', { name: viLite.daily.relief.button }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viLite.daily.errors.NOT_ELIGIBLE)
  })

  it('falls back to the generic message for a code it has no words for', async () => {
    const api = stubApi({ claimDaily: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom')) })
    const { user } = render(api)

    await user.click(await screen.findByRole('button', { name: viLite.daily.claim }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viLite.daily.error)
  })
})
