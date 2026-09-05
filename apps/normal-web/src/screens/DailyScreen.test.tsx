import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type CalendarEntryDto,
  type DailyClaimDto,
  type DailyStatusDto,
  type NormalApi,
  type ReliefStatusDto,
} from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { DailyScreen } from './DailyScreen.js'
import { formatMoment } from './format.js'

/** The server's own schedule: a common on 7, a rare on 14 and 21, the month's badge on 28. */
const CALENDAR: CalendarEntryDto[] = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1
  const item = day === 7 ? 'common' : day === 14 || day === 21 ? 'rare' : day === 28 ? 'badge_monthly' : null
  return { day, points: day * 1_000, item }
})

const RESET_AT = Date.UTC(2026, 8, 5, 17, 0)
const RETRY_AT = Date.UTC(2026, 8, 5, 9, 30)

const STATUS: DailyStatusDto = {
  claimable: true,
  day: 5,
  streak: 5,
  reward: 5_000,
  item: null,
  nextResetAt: RESET_AT,
  calendar: CALENDAR,
}

const RELIEF: ReliefStatusDto = { eligible: false, reason: 'balance', retryAt: null, threshold: 10_000, target: 50_000 }

const CLAIM: DailyClaimDto = {
  claimed: true,
  day: 5,
  points: 5_000,
  item: null,
  items: ['hat_crown'],
  fallbackPoints: 0,
  balance: 128_000,
  streak: 5,
}

function stubApi(overrides: Partial<NormalApi> = {}, relief: ReliefStatusDto = RELIEF): NormalApi {
  return {
    daily: vi.fn().mockResolvedValue(STATUS),
    me: vi.fn().mockResolvedValue({ relief }),
    claimDaily: vi.fn().mockResolvedValue(CLAIM),
    relief: vi.fn(),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<DailyScreen api={api} lang="vi" />, makeI18n('vi'))

/** The calendar names itself, so its cells can be counted without the receipt's rows joining in. */
const calendar = () => within(screen.getByRole('list', { name: viNormal.daily.calendarTitle }))

const interpolate = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template)

describe('DailyScreen — the calendar', () => {
  it('shows a status line while the day is in flight', () => {
    renderScreen(stubApi({ daily: vi.fn(() => new Promise<DailyStatusDto>(() => undefined)) }))

    expect(screen.getAllByRole('status')[0]).toHaveTextContent(viNormal.screens.loading)
  })

  it('says so when the day cannot be read, and asks again when told to', async () => {
    const daily = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(STATUS)
    const user = userEvent.setup()
    renderScreen(stubApi({ daily }))

    expect(await screen.findByText(viNormal.daily.error)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: viNormal.screens.retry })[0] as HTMLElement)

    expect(await screen.findByRole('list', { name: viNormal.daily.calendarTitle })).toBeInTheDocument()
  })

  it('draws all thirty-one tiers, with an item marker on exactly four of them', async () => {
    renderScreen()
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(calendar().getAllByRole('listitem')).toHaveLength(31)
    expect(calendar().getAllByText(viNormal.daily.marker.common)).toHaveLength(1)
    expect(calendar().getAllByText(viNormal.daily.marker.rare)).toHaveLength(2)
    expect(calendar().getAllByText(viNormal.daily.marker.monthly)).toHaveLength(1)
    // Points are printed per tier, in the language's own grouping.
    expect(calendar().getByText(/^31\.000/)).toBeInTheDocument()
  })

  it('marks today and every day already taken', async () => {
    renderScreen()
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    const today = calendar()
      .getAllByRole('listitem')
      .filter((cell) => cell.getAttribute('aria-current') === 'date')
    expect(today).toHaveLength(1)
    expect(within(today[0] as HTMLElement).getByText(interpolate(viNormal.daily.dayLabel, { day: '5' }))).toBeInTheDocument()
    expect(within(today[0] as HTMLElement).getByText(viNormal.daily.todayMark)).toBeInTheDocument()

    // Day 5 is still to be taken, so the four before it are the claimed ones.
    expect(calendar().getAllByText(viNormal.daily.claimedMark)).toHaveLength(4)
  })

  it('counts today as claimed once there is nothing left to claim, and disables the button', async () => {
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue({ ...STATUS, claimable: false }) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(screen.getByRole('button', { name: viNormal.daily.claim })).toBeDisabled()
    expect(screen.getByText(viNormal.daily.claimed)).toBeInTheDocument()
    expect(calendar().getAllByText(viNormal.daily.claimedMark)).toHaveLength(5)
  })

  it('prints the streak and the instant the next day begins', async () => {
    renderScreen()
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(screen.getByText(interpolate(viNormal.daily.streak, { streak: '5' }))).toBeInTheDocument()
    expect(screen.getByText(interpolate(viNormal.daily.resetsAt, { at: formatMoment(RESET_AT, 'vi') }))).toBeInTheDocument()
  })
})

describe('DailyScreen — claiming', () => {
  it('claims, prints the receipt with the item it granted, and asks the server again', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    const { i18n } = renderScreen(api)
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    await user.click(screen.getByRole('button', { name: viNormal.daily.claim }))

    const head = await screen.findByRole('heading', { name: interpolate(viNormal.daily.receipt.title, { day: '5' }) })
    // Scoped to the receipt: day 5 of the calendar is worth 5.000 too, and that is the wrong 5.000.
    const receipt = within(head.closest('section') as HTMLElement)
    const unit = i18n.t('common:units.pointsShort')
    expect(receipt.getByText(`5.000 ${unit}`)).toBeInTheDocument()
    expect(receipt.getByText(viNormal.items.hat_crown)).toBeInTheDocument()
    expect(receipt.getByText(`128.000 ${unit}`)).toBeInTheDocument()

    // A claim moved the streak and the balance, so both panels are asked again.
    await waitFor(() => expect(api.daily).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2))
  })

  it('explains the substitute when the tier had no new item left', async () => {
    const claimDaily = vi.fn().mockResolvedValue({ ...CLAIM, items: [], fallbackPoints: 10_000 })
    const user = userEvent.setup()
    const { i18n } = renderScreen(stubApi({ claimDaily }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    await user.click(screen.getByRole('button', { name: viNormal.daily.claim }))

    const line = interpolate(viNormal.daily.receipt.fallback, { amount: `10.000 ${i18n.t('common:units.pointsShort')}` })
    expect(await screen.findByText(line)).toBeInTheDocument()
    expect(screen.queryByText(viNormal.items.hat_crown)).toBeNull()
  })

  it('says the day is already gone on a 409, and reloads the calendar', async () => {
    const claimDaily = vi.fn().mockRejectedValue(new ApiError(409, 'ALREADY_CLAIMED', 'already', { claimed: false }))
    const api = stubApi({ claimDaily })
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    await user.click(screen.getByRole('button', { name: viNormal.daily.claim }))

    expect(await screen.findByText(viNormal.daily.errors.ALREADY_CLAIMED)).toBeInTheDocument()
    await waitFor(() => expect(api.daily).toHaveBeenCalledTimes(2))
    // A refusal is not a receipt: nothing was granted, so nothing is listed.
    expect(screen.queryByRole('heading', { name: interpolate(viNormal.daily.receipt.title, { day: '5' }) })).toBeNull()
  })
})

describe('DailyScreen — relief', () => {
  it('explains a cooldown with the instant it lifts, and refuses to ask', async () => {
    const relief: ReliefStatusDto = { eligible: false, reason: 'cooldown', retryAt: RETRY_AT, threshold: 10_000, target: 50_000 }
    renderScreen(stubApi({}, relief))

    const line = interpolate(viNormal.daily.relief.reason.cooldown, { at: formatMoment(RETRY_AT, 'vi') })
    expect(await screen.findByText(line)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: viNormal.daily.relief.claim })).toBeDisabled()
  })

  it('names the threshold and the target it would top up to', async () => {
    const { i18n } = renderScreen()
    await screen.findByText(viNormal.daily.relief.reason.balance)

    const unit = i18n.t('common:units.pointsShort')
    const lead = interpolate(viNormal.daily.relief.lead, { threshold: `10.000 ${unit}`, target: `50.000 ${unit}` })
    expect(screen.getByText(lead)).toBeInTheDocument()
  })

  it('grants relief and prints what it added', async () => {
    const eligible: ReliefStatusDto = { eligible: true, reason: null, retryAt: null, threshold: 10_000, target: 50_000 }
    const api = stubApi({ relief: vi.fn().mockResolvedValue({ granted: true, amount: 48_000, balance: 50_000 }) }, eligible)
    const user = userEvent.setup()
    const { i18n } = renderScreen(api)
    await screen.findByText(viNormal.daily.relief.eligible)

    await user.click(screen.getByRole('button', { name: viNormal.daily.relief.claim }))

    const unit = i18n.t('common:units.pointsShort')
    const line = interpolate(viNormal.daily.relief.granted, { amount: `48.000 ${unit}`, balance: `50.000 ${unit}` })
    expect(await screen.findByText(line)).toBeInTheDocument()
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2))
  })

  it('prefers the refusal the server just sent over the eligibility it had loaded', async () => {
    const eligible: ReliefStatusDto = { eligible: true, reason: null, retryAt: null, threshold: 10_000, target: 50_000 }
    const refusal = new ApiError(409, 'NOT_ELIGIBLE', 'no', { granted: false, reason: 'cooldown', retryAt: RETRY_AT })
    const api = stubApi({ relief: vi.fn().mockRejectedValue(refusal) }, eligible)
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByText(viNormal.daily.relief.eligible)

    await user.click(screen.getByRole('button', { name: viNormal.daily.relief.claim }))

    const line = interpolate(viNormal.daily.relief.reason.cooldown, { at: formatMoment(RETRY_AT, 'vi') })
    expect(await screen.findByText(line)).toBeInTheDocument()
  })

  it('says so when the relief block cannot be read, without taking the calendar down with it', async () => {
    renderScreen(stubApi({ me: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'nope')) }))

    expect(await screen.findByText(viNormal.daily.relief.error)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: viNormal.daily.calendarTitle })).toBeInTheDocument()
  })
})
