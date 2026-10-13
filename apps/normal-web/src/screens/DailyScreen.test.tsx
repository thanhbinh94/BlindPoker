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

/** The server's own schedule for October 2026: a common on 7, a rare on 14 and 21, the badge and the title on 28. */
const CALENDAR: CalendarEntryDto[] = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1
  const item = day === 7 ? 'common' : day === 14 || day === 21 ? 'rare' : day === 28 ? 'badge_monthly' : null
  return { day, points: day * 1_000, item, items: day === 28 ? ['badge_monthly', 'title_devoted'] : [] }
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
  month: '2026-10',
  calendar: CALENDAR,
}

const RELIEF: ReliefStatusDto = { eligible: false, reason: 'balance', retryAt: null, threshold: 10_000, target: 50_000 }

const CLAIM: DailyClaimDto = {
  claimed: true,
  day: 5,
  points: 5_000,
  item: null,
  items: ['head_crown_gold01'],
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

/** The fallback line up to its first placeholder — enough to spot the sentence, whatever amount it names. */
const FALLBACK_PREFIX = viNormal.daily.receipt.fallback.split('{{')[0] as string

/** Day 28 of October, by name: what its cell says, and what the legend's line for it ends with. */
const PAIR_LABEL = `${viNormal.items.badge_monthly} + ${viNormal.items.title_devoted}`

describe('DailyScreen — the calendar', () => {
  it('shows a status line while the day is in flight', async () => {
    renderScreen(stubApi({ daily: vi.fn(() => new Promise<DailyStatusDto>(() => undefined)) }))
    // The relief panel settles a moment after mount; waiting for it keeps that update inside `act`, and
    // leaves the day's own line as the only status on the page.
    await screen.findByText(viNormal.daily.relief.reason.balance)

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
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
    expect(calendar().getAllByText(PAIR_LABEL)).toHaveLength(1)
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

  it('prints the streak already earned, not the one today would reach', async () => {
    renderScreen()
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    // The server sends `streak: 5` for a player who has claimed four days and not yet claimed today. Five is
    // what the claim *would* make it; four is what the calendar beside this line is marking.
    expect(screen.getByText(interpolate(viNormal.daily.streak, { streak: '4' }))).toBeInTheDocument()
    expect(screen.getByText(interpolate(viNormal.daily.resetsAt, { at: formatMoment(RESET_AT, 'vi') }))).toBeInTheDocument()
  })

  it('greets a player who has never claimed with no streak at all', async () => {
    const fresh = { ...STATUS, claimable: true, day: 1, streak: 1 }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(fresh) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(screen.getByText(interpolate(viNormal.daily.streak, { streak: '0' }))).toBeInTheDocument()
    expect(calendar().queryAllByText(viNormal.daily.claimedMark)).toHaveLength(0)
  })

  it('counts the streak whole once today has been taken', async () => {
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue({ ...STATUS, claimable: false }) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(screen.getByText(interpolate(viNormal.daily.streak, { streak: '5' }))).toBeInTheDocument()
  })

  it('draws no marker for an item tier this bundle has no words for', async () => {
    const odd = { ...STATUS, calendar: CALENDAR.map((e) => (e.day === 7 ? { ...e, item: 'epic' } : e)) }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(odd) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    // Silence beats a confident promise of the wrong prize; the tier's points still show.
    expect(calendar().queryAllByText(viNormal.daily.marker.common)).toHaveLength(0)
    expect(calendar().queryAllByText(PAIR_LABEL)).toHaveLength(1)
    expect(calendar().getByText(/^7\.000/)).toBeInTheDocument()
  })

  it('names every gift of a fixed day in its cell and in the legend, with the month', async () => {
    const november = {
      ...STATUS,
      month: '2026-11',
      calendar: CALENDAR.map((e) => (e.day === 28 ? { ...e, items: ['badge_monthly', 'title_devoted', 'head_tophat01'] } : e)),
    }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(november) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    const names = `${PAIR_LABEL} + ${viNormal.items.head_tophat01}`
    expect(names).toBe('Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông')
    const gift = calendar().getByText(names).closest('[title]') as HTMLElement
    expect(gift).toHaveAttribute('title', names)
    expect(gift).toHaveAttribute('data-kind', 'fixed')
    // The legend is what a phone reads, having no tooltip: the day, the month and the names.
    expect(screen.getByText(`Ngày 28 tháng 11/2026: ${names}`)).toBeInTheDocument()
  })

  it('names a fixed gift on any day the schedule puts one, and lists in the legend only the draws the month has', async () => {
    const odd = {
      ...STATUS,
      calendar: CALENDAR.map((e) =>
        e.day === 14 ? { ...e, item: 'frame_gold', items: ['frame_gold'] } : e.day === 21 ? { ...e, item: 'common' } : e,
      ),
    }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(odd) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(calendar().getByText(viNormal.items.frame_gold)).toBeInTheDocument()
    expect(screen.getByText(`Ngày 14 tháng 10/2026: ${viNormal.items.frame_gold}`)).toBeInTheDocument()
    // No rare day is left this month, so the legend explains none; the common one is days 7 and 21, and the legend.
    expect(screen.queryByText(viNormal.daily.marker.rare)).toBeNull()
    expect(screen.getAllByText(viNormal.daily.marker.common)).toHaveLength(3)
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
    // Scoped to the receipt: day 5 of the calendar is worth 5.000 too, and that is the wrong 5.000. The scope
    // is the live region, which is also the assertion that the whole receipt gets announced on insertion.
    const region = head.closest('[role="status"]') as HTMLElement
    expect(region).not.toBeNull()
    const receipt = within(region)
    const unit = i18n.t('common:units.pointsShort')
    expect(receipt.getByText(`5.000 ${unit}`)).toBeInTheDocument()
    expect(receipt.getByText(viNormal.items.head_crown_gold01)).toBeInTheDocument()
    expect(receipt.getByText(`128.000 ${unit}`)).toBeInTheDocument()
    // The fallback line is gated on `fallbackPoints > 0`, and this claim granted a real item.
    expect(receipt.queryByText(new RegExp(FALLBACK_PREFIX))).toBeNull()

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
    expect(screen.queryByText(viNormal.items.head_crown_gold01)).toBeNull()
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
