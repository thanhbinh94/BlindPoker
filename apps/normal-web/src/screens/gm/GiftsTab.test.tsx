import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type GiftMonthDto, type GiftRuleDto, type ItemDto, type NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { GiftsTab, economyToday } from './GiftsTab.js'

const DEFAULTS: Record<string, GiftRuleDto> = {
  '7': { draw: 'common' },
  '14': { draw: 'rare' },
  '28': { fixed: ['badge_monthly', 'title_devoted'] },
}

const MONTHS: GiftMonthDto[] = [
  { month: '2026-10', days: {}, source: 'file', updatedAt: null, updatedBy: null },
  {
    month: '2026-11',
    days: { '7': { draw: 'rare' }, '28': { fixed: ['badge_monthly', 'title_devoted', 'head_tophat01'] } },
    source: 'db',
    updatedAt: 1_790_000_000_000,
    updatedBy: 'Bình',
  },
  { month: '2026-12', days: {}, source: 'file', updatedAt: null, updatedBy: null },
]

/** Only the fields the picker reads. */
const item = (id: string, slot: ItemDto['slot'], extra: Partial<ItemDto> = {}): ItemDto =>
  ({ id, slot, rarity: 'common', nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault: false, ...extra }) as ItemDto

const CATALOG = {
  items: [
    item('head_tophat01', 'head'),
    item('frame_gold', 'frame'),
    item('aura_flame', 'aura'),
    item('badge_monthly', 'badge'),
    item('title_devoted', 'title'),
    item('head_none', 'head', { isDefault: true }),
    item('eye_brown', 'eyeColor', { free: true }),
    item('hair_bob', 'hairStyle'),
    item('outfit_tee', 'outfit'),
  ],
}

const label = (key: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), key)

const editDay = (day: number) => screen.getByRole('button', { name: label(viNormal.gm.gifts.editDay, { day: String(day) }) })
const ruleButton = (name: string) => screen.getByRole('button', { name })
const saveButton = () => screen.getByRole('button', { name: viNormal.gm.gifts.save })

function setup(overrides: Partial<Record<'gmGifts' | 'gmSetGiftMonth' | 'gmClearGiftMonth', unknown>> = {}) {
  const gmGifts = vi.fn().mockResolvedValue({ default: DEFAULTS, months: MONTHS })
  const gmSetGiftMonth = vi.fn().mockResolvedValue({ actionId: 1 })
  const gmClearGiftMonth = vi.fn().mockResolvedValue({ actionId: 2 })
  const catalogItems = vi.fn().mockResolvedValue(CATALOG)
  const api = { gmGifts, gmSetGiftMonth, gmClearGiftMonth, catalogItems, ...overrides } as unknown as NormalApi
  const guard = (cause: unknown): never => {
    throw cause
  }
  renderWithI18n(<GiftsTab api={api} lang="vi" guard={guard} />)
  return { gmGifts, gmSetGiftMonth, gmClearGiftMonth }
}

/** Opens the month in the picker and waits for its calendar. */
async function openMonth(user: ReturnType<typeof userEvent.setup>, month: string): Promise<void> {
  const select = await screen.findByLabelText(viNormal.gm.gifts.month)
  await user.selectOptions(select, month)
}

/** Fills the reason dialog and presses its confirm button. */
async function confirmWith(user: ReturnType<typeof userEvent.setup>, reason: string, confirmLabel: string): Promise<void> {
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), reason)
  await user.click(within(dialog).getByRole('button', { name: confirmLabel }))
}

beforeEach(() => {
  // 2026-10-20 12:00 on the economy's clock; only `Date` is faked so the waits keep their timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T05:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('economyToday', () => {
  it('reads the month and day on the economy clock, not the machine’s', () => {
    expect(economyToday(Date.parse('2026-10-31T18:30:00Z'))).toEqual({ month: '2026-11', day: 1 })
    expect(economyToday(Date.parse('2026-10-20T05:00:00Z'))).toEqual({ month: '2026-10', day: 20 })
  })
})

describe('GiftsTab', () => {
  it('lists the months, marking the edited one, and greys the days already past in the current month', async () => {
    setup()

    const select = await screen.findByLabelText(viNormal.gm.gifts.month)
    const options = within(select).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['10/2026', `11/2026 ${viNormal.gm.gifts.edited}`, '12/2026'])

    expect(screen.queryByRole('button', { name: label(viNormal.gm.gifts.editDay, { day: '20' }) })).toBeNull()
    expect(editDay(21)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Ngày \d+$/u })).toHaveLength(11)
  })

  it('opens every day of a future month', async () => {
    const user = userEvent.setup()
    setup()
    await openMonth(user, '2026-12')

    expect(screen.getAllByRole('button', { name: /^Ngày \d+$/u })).toHaveLength(31)
  })

  it('sends the month’s own rules: "as default" deletes the key, a fixed list keeps its items and gains one', async () => {
    const user = userEvent.setup()
    const { gmSetGiftMonth, gmGifts } = setup()
    await openMonth(user, '2026-11')
    expect(saveButton()).toBeDisabled()

    // Day 7 was set to a rare draw; "as default" lets the default's common draw show through again.
    await user.click(editDay(7))
    expect(ruleButton(viNormal.gm.gifts.rule.rare)).toHaveAttribute('aria-pressed', 'true')
    await user.click(ruleButton(viNormal.gm.gifts.rule.default))

    // Day 28 holds three items; a fourth is added from the picker.
    await user.click(editDay(28))
    const list = screen.getByRole('list', { name: label(viNormal.gm.gifts.items, { day: '28' }) })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await user.selectOptions(screen.getByLabelText(viNormal.gm.gifts.pickItem), 'frame_gold')
    await user.click(screen.getByRole('button', { name: viNormal.gm.gifts.addItem }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)

    await user.click(saveButton())
    await confirmWith(user, 'tháng này đổi quà', viNormal.gm.gifts.save)

    await waitFor(() => expect(gmSetGiftMonth).toHaveBeenCalledTimes(1))
    expect(gmSetGiftMonth).toHaveBeenCalledWith(
      '2026-11',
      { '28': { fixed: ['badge_monthly', 'title_devoted', 'head_tophat01', 'frame_gold'] } },
      'tháng này đổi quà',
    )
    expect(await screen.findByText(viNormal.gm.done.setGiftMonth)).toBeInTheDocument()
    await waitFor(() => expect(gmGifts).toHaveBeenCalledTimes(2))
  })

  it('offers the picker only items a fixed gift may be: not default, free, other-slot or already named', async () => {
    const user = userEvent.setup()
    setup()
    await openMonth(user, '2026-12')

    await user.click(editDay(3))
    await user.click(ruleButton(viNormal.gm.gifts.rule.fixed))

    const picker = screen.getByLabelText(viNormal.gm.gifts.pickItem)
    const values = within(picker).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    // Day 28's badge and title are named by the default, so they are taken; the rest are not gift material.
    expect(values).toEqual(['', 'head_tophat01', 'frame_gold', 'aura_flame'])
  })

  it('starts a fixed day from what the day grants now, and will not save it empty', async () => {
    const user = userEvent.setup()
    setup()
    await openMonth(user, '2026-12')

    await user.click(editDay(28))
    expect(ruleButton(viNormal.gm.gifts.rule.default)).toHaveAttribute('aria-pressed', 'true')
    await user.click(ruleButton(viNormal.gm.gifts.rule.fixed))
    const list = screen.getByRole('list', { name: label(viNormal.gm.gifts.items, { day: '28' }) })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)

    for (const name of [viNormal.items.badge_monthly, viNormal.items.title_devoted]) {
      await user.click(screen.getByRole('button', { name: `${viNormal.gm.gifts.removeItem} ${name}` }))
    }
    expect(screen.getByText(viNormal.gm.gifts.needItem)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('names "no gift" for a day the default leaves empty, and saves a draw there', async () => {
    const user = userEvent.setup()
    const { gmSetGiftMonth } = setup()
    await openMonth(user, '2026-12')

    await user.click(editDay(3))
    expect(ruleButton(viNormal.gm.gifts.rule.none)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: viNormal.gm.gifts.rule.default })).toBeNull()
    await user.click(ruleButton(viNormal.gm.gifts.rule.common))
    await user.click(saveButton())
    await confirmWith(user, 'thêm quà ngày 3', viNormal.gm.gifts.save)

    await waitFor(() => expect(gmSetGiftMonth).toHaveBeenCalledWith('2026-12', { '3': { draw: 'common' } }, 'thêm quà ngày 3'))
  })

  it('prints the server’s own message on INVALID_GIFTS and keeps the edits', async () => {
    const user = userEvent.setup()
    const gmSetGiftMonth = vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_GIFTS', 'day 3: nothing to draw'))
    const { gmGifts } = setup({ gmSetGiftMonth })
    await openMonth(user, '2026-12')
    await user.click(editDay(3))
    await user.click(ruleButton(viNormal.gm.gifts.rule.rare))
    await user.click(saveButton())
    await confirmWith(user, 'thử xem', viNormal.gm.gifts.save)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(label(viNormal.gm.errors.INVALID_GIFTS, { message: 'day 3: nothing to draw' }))
    expect(gmGifts).toHaveBeenCalledTimes(1)
    // Still there once the dialog is put away: the refusal cost the GM nothing.
    await user.click(screen.getByRole('button', { name: viNormal.gm.dialog.cancel }))
    expect(ruleButton(viNormal.gm.gifts.rule.rare)).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops an edited month back to the default, and offers that only where there is an edit', async () => {
    const user = userEvent.setup()
    const { gmClearGiftMonth, gmGifts } = setup()
    await screen.findByLabelText(viNormal.gm.gifts.month)
    expect(screen.queryByRole('button', { name: viNormal.gm.gifts.reset })).toBeNull()

    await openMonth(user, '2026-11')
    await user.click(screen.getByRole('button', { name: viNormal.gm.gifts.reset }))
    await confirmWith(user, 'về mặc định', viNormal.gm.gifts.reset)

    await waitFor(() => expect(gmClearGiftMonth).toHaveBeenCalledWith('2026-11', 'về mặc định'))
    expect(await screen.findByText(viNormal.gm.done.clearGiftMonth)).toBeInTheDocument()
    await waitFor(() => expect(gmGifts).toHaveBeenCalledTimes(2))
  })

  it('says it could not load, and tries again', async () => {
    const user = userEvent.setup()
    const gmGifts = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ default: DEFAULTS, months: MONTHS })
    setup({ gmGifts })

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.gifts.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByLabelText(viNormal.gm.gifts.month)).toBeInTheDocument()
  })
})
