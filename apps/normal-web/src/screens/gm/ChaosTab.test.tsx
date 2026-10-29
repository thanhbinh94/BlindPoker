import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type GmChaosCardDto, type GmChaosDto, type NormalApi } from '../../api.js'
import catalogue from '../../../../normal-server/data/chaos-cards.json'
import viNormal from '../../locales/vi/normal.json'
import gameVi from '../../../../../packages/ui-kit/src/i18n/locales/vi/game.json'
import { renderWithI18n } from '../../test-i18n.js'
import { ChaosTab, dayStartOf, economyDayOf } from './ChaosTab.js'

const t = viNormal.gm
const c = t.chaos

function card(id: string, tier: GmChaosCardDto['tier'], family: string, over: Partial<GmChaosCardDto> = {}): GmChaosCardDto {
  return { id, tier, family, effect: 'swapLowest', modes: ['playOrFold', 'none'], fileEnabled: true, rule: null, activeNow: true, ...over }
}

const CARDS: GmChaosCardDto[] = [
  card('s_swap_one', 'silver', 'swap'),
  card('s_luck_1', 'silver', 'luck'),
  card('s_high_card', 'silver', 'luck'),
  card('g_swap_all', 'gold', 'swap', { rule: { enabled: true, weight: 30, startsAt: null, endsAt: null } }),
  card('g_luck_3', 'gold', 'luck'),
  card('g_extra_card', 'gold', 'extra', { fileEnabled: false, activeNow: false }),
  card('d_pick_3', 'diamond', 'luck', {
    rule: { enabled: true, weight: 5, startsAt: Date.parse('2026-02-01T00:00:00+07:00'), endsAt: Date.parse('2026-02-18T00:00:00+07:00') },
  }),
  card('d_luck_5', 'diamond', 'luck'),
  card('d_extra_card_3', 'diamond', 'extra'),
]

const CONFIG: GmChaosDto['config'] = { tierWeights: { silver: 60, gold: 30, diamond: 10 }, pointsThreshold: 10, draftMs: 15_000, resultMs: 10_000, dailyCapPoints: 100_000, dailyRescues: 3 }

type Stub = NormalApi & Record<string, ReturnType<typeof vi.fn>>

function setup(data: GmChaosDto = { cards: CARDS, config: CONFIG }, overrides: Partial<Record<keyof NormalApi, unknown>> = {}) {
  const api = {
    gmChaos: vi.fn().mockResolvedValue(data),
    gmSetChaosRules: vi.fn().mockResolvedValue({ actionId: 1, changed: 2 }),
    gmSetChaosConfig: vi.fn().mockResolvedValue({ actionId: 2 }),
    ...overrides,
  } as unknown as Stub
  const guard = (cause: unknown): never => {
    throw cause
  }
  renderWithI18n(<ChaosTab api={api} lang="vi" guard={guard} />)
  return { api }
}

const section = async (title: string) => within((await screen.findByRole('heading', { name: title, level: 2 })).closest('section')!)
const dialog = () => within(screen.getByRole('dialog'))

async function confirmWithReason(reason: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(dialog().getByLabelText(t.dialog.reason), reason)
  await user.click(dialog().getAllByRole('button').at(-1)!)
}

describe('ChaosTab', () => {
  it('draws three tier sections, each card with its name, family and whether it is on now', async () => {
    setup()

    const silver = await section('Bạc · 3/3 thẻ đang bật')
    expect(silver.getByText('Đổi lá')).toBeInTheDocument()
    expect(silver.getByText('Bùa may nhỏ')).toBeInTheDocument()
    expect(silver.getAllByText(new RegExp(c.stateOn))).toHaveLength(3)
    const gold = await section('Vàng · 2/3 thẻ đang bật')
    expect(gold.getByText('Thêm lá')).toBeInTheDocument()
    const extra = gold.getByText('Thêm lá').closest('tr')!
    expect(within(extra).getByText(new RegExp(`${c.family.extra} · ${c.stateOff}`, 'u'))).toBeInTheDocument()
    expect(within(extra).getByLabelText('Bật thẻ Thêm lá')).not.toBeChecked()
    expect(await section('Kim cương · 3/3 thẻ đang bật')).toBeTruthy()
    expect(screen.getByRole('heading', { name: c.config.title, level: 2 })).toBeInTheDocument()
  })

  it('shows a card’s rule: its weight, and its window with the last day inclusive', async () => {
    setup()
    const diamond = await section('Kim cương · 3/3 thẻ đang bật')

    expect(diamond.getByLabelText('Trọng số của Chọn bài')).toHaveValue('5')
    expect(diamond.getByLabelText('Chọn bài: từ ngày')).toHaveValue('2026-02-01')
    expect(diamond.getByLabelText('Chọn bài: đến ngày')).toHaveValue('2026-02-17')
    expect(diamond.getByLabelText('Trọng số của Bùa may lớn')).toHaveValue('1')
    expect(diamond.getByLabelText('Bùa may lớn: từ ngày')).toHaveValue('')
  })

  it('keeps Lưu off until something is edited, then sends only the changed cards, whole, under one reason', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const silver = await section('Bạc · 3/3 thẻ đang bật')
    const save = screen.getAllByRole('button', { name: c.save })[0]!
    expect(save).toBeDisabled()

    const weight = silver.getByLabelText('Trọng số của Đổi lá')
    await user.clear(weight)
    await user.type(weight, '40')
    await user.click(silver.getByLabelText('Bật thẻ Bùa may nhỏ'))
    expect(screen.getByText('Đã sửa 2 thẻ')).toBeInTheDocument()

    await user.click(save)
    await confirmWithReason('mùa Tết đổi trọng số')

    expect(api.gmSetChaosRules).toHaveBeenCalledTimes(1)
    expect(api.gmSetChaosRules).toHaveBeenCalledWith(
      [
        { cardId: 's_swap_one', enabled: true, weight: 40, startsAt: null, endsAt: null },
        { cardId: 's_luck_1', enabled: false, weight: 1, startsAt: null, endsAt: null },
      ],
      'mùa Tết đổi trọng số',
    )
    expect(await screen.findByText('Đã lưu 2 thẻ.')).toBeInTheDocument()
    expect(api.gmChaos).toHaveBeenCalledTimes(2)
  })

  it('turns a date into the start of that economy day, and the last day into the start of the next', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const silver = await section('Bạc · 3/3 thẻ đang bật')

    await user.type(silver.getByLabelText('Đổi lá: từ ngày'), '2026-11-01')
    await user.type(silver.getByLabelText('Đổi lá: đến ngày'), '2026-11-30')
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    await confirmWithReason('mùa tháng mười một')

    expect(api.gmSetChaosRules).toHaveBeenCalledWith(
      [{ cardId: 's_swap_one', enabled: true, weight: 1, startsAt: Date.parse('2026-11-01T00:00:00+07:00'), endsAt: Date.parse('2026-12-01T00:00:00+07:00') }],
      'mùa tháng mười một',
    )
  })

  it('keeps a window’s untouched end exactly as the server has it when only the weight changes', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const diamond = await section('Kim cương · 3/3 thẻ đang bật')

    const weight = diamond.getByLabelText('Trọng số của Chọn bài')
    await user.clear(weight)
    await user.type(weight, '9')
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    await confirmWithReason('tăng trọng số')

    expect(api.gmSetChaosRules).toHaveBeenCalledWith(
      [{ cardId: 'd_pick_3', enabled: true, weight: 9, startsAt: Date.parse('2026-02-01T00:00:00+07:00'), endsAt: Date.parse('2026-02-18T00:00:00+07:00') }],
      'tăng trọng số',
    )
  })

  it('"Theo file" is off for a card with no rule and, on a card with one, sends clear: true', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const gold = await section('Vàng · 2/3 thẻ đang bật')

    expect(gold.getByRole('button', { name: 'Thêm lá: về theo file' })).toBeDisabled()
    await user.click(gold.getByRole('button', { name: 'Đổi bài: về theo file' }))
    // The row shows the file's values at once, and the reset cannot be pressed twice.
    expect(gold.getByLabelText('Trọng số của Đổi bài')).toHaveValue('1')
    expect(gold.getByRole('button', { name: 'Đổi bài: về theo file' })).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    await confirmWithReason('về theo file')

    expect(api.gmSetChaosRules).toHaveBeenCalledWith([{ cardId: 'g_swap_all', clear: true }], 'về theo file')
  })

  it('editing a card after "Theo file" makes it a rule again, not a clear', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const gold = await section('Vàng · 2/3 thẻ đang bật')

    await user.click(gold.getByRole('button', { name: 'Đổi bài: về theo file' }))
    const weight = gold.getByLabelText('Trọng số của Đổi bài')
    await user.clear(weight)
    await user.type(weight, '12')
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    await confirmWithReason('trọng số mới')

    expect(api.gmSetChaosRules).toHaveBeenCalledWith([{ cardId: 'g_swap_all', enabled: true, weight: 12, startsAt: null, endsAt: null }], 'trọng số mới')
  })

  it('prints the server’s refusal in the dialog and keeps the edits', async () => {
    const user = userEvent.setup()
    const { api } = setup(undefined, {
      gmSetChaosRules: vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_CHAOS_RULES', 'silver would keep 2 drawable cards for mode none, it needs 3')),
    })
    const silver = await section('Bạc · 3/3 thẻ đang bật')

    await user.click(silver.getByLabelText('Bật thẻ Đổi lá'))
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    await confirmWithReason('tắt một thẻ bạc')

    expect(await dialog().findByRole('alert')).toHaveTextContent('Thẻ không hợp lệ: silver would keep 2 drawable cards for mode none, it needs 3')
    expect(api.gmSetChaosRules).toHaveBeenCalledTimes(1)
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.cancel }))
    expect(silver.getByLabelText('Bật thẻ Đổi lá')).not.toBeChecked()
  })

  it('refuses a weight that is not 0–100, or a window that ends before it starts, before anything is sent', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const silver = await section('Bạc · 3/3 thẻ đang bật')

    const weight = silver.getByLabelText('Trọng số của Đổi lá')
    await user.clear(weight)
    await user.type(weight, '101')
    expect(weight).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(c.invalid)
    expect(screen.getByRole('alert')).toHaveTextContent('Đổi lá')
    expect(screen.getAllByRole('button', { name: c.save })[0]).toBeDisabled()

    await user.clear(weight)
    await user.type(weight, '100')
    await user.type(silver.getByLabelText('Đổi lá: từ ngày'), '2026-11-10')
    await user.type(silver.getByLabelText('Đổi lá: đến ngày'), '2026-11-09')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: c.save })[0]).toBeDisabled()
    expect(api.gmSetChaosRules).not.toHaveBeenCalled()
  })

  it('refuses a date with a five-digit year: marked invalid, Lưu off, no request sent', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const silver = await section('Bạc · 3/3 thẻ đang bật')

    const to = silver.getByLabelText('Đổi lá: đến ngày')
    fireEvent.change(to, { target: { value: '20266-11-01' } })
    expect(to).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Đổi lá')
    expect(screen.getAllByRole('button', { name: c.save })[0]).toBeDisabled()
    // The same for the start, and a five-digit start must not pass as "before" a four-digit end.
    fireEvent.change(to, { target: { value: '' } })
    const from = silver.getByLabelText('Đổi lá: từ ngày')
    fireEvent.change(from, { target: { value: '20266-11-01' } })
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByRole('button', { name: c.save })[0]).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: c.save })[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.gmSetChaosRules).not.toHaveBeenCalled()
  })

  it('edits the numbers, sends them whole (the draft and result times in milliseconds) and reads the tab again', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const config = await section(c.config.title)
    const save = config.getByRole('button', { name: c.config.save })
    expect(save).toBeDisabled()

    const pick = (label: string) => config.getByLabelText(label)
    expect(pick(c.config.weightSilver)).toHaveValue('60')
    expect(pick(c.config.draftSeconds)).toHaveValue('15')
    await user.clear(pick(c.config.weightDiamond))
    await user.type(pick(c.config.weightDiamond), '20')
    await user.clear(pick(c.config.draftSeconds))
    await user.type(pick(c.config.draftSeconds), '25')
    expect(pick(c.config.resultSeconds)).toHaveValue('10')
    await user.clear(pick(c.config.resultSeconds))
    await user.type(pick(c.config.resultSeconds), '7')
    await user.clear(pick(c.config.dailyRescues))
    await user.type(pick(c.config.dailyRescues), '1')

    await user.click(save)
    await confirmWithReason('cân lại thẻ hỗn loạn')

    expect(api.gmSetChaosConfig).toHaveBeenCalledWith(
      { tierWeights: { silver: 60, gold: 30, diamond: 20 }, pointsThreshold: 10, draftMs: 25_000, resultMs: 7_000, dailyCapPoints: 100_000, dailyRescues: 1 },
      'cân lại thẻ hỗn loạn',
    )
    expect(await screen.findByText(t.done.chaosConfig)).toBeInTheDocument()
    expect(api.gmChaos).toHaveBeenCalledTimes(2)
    expect(api.gmSetChaosRules).not.toHaveBeenCalled()
  })

  it('refuses a number out of range, or three zero odds, before anything is sent', async () => {
    const user = userEvent.setup()
    setup()
    const config = await section(c.config.title)

    await user.clear(config.getByLabelText(c.config.dailyRescues))
    await user.type(config.getByLabelText(c.config.dailyRescues), '21')
    expect(config.getByLabelText(c.config.dailyRescues)).toHaveAttribute('aria-invalid', 'true')
    expect(config.getByRole('alert')).toHaveTextContent(c.config.invalid)
    expect(config.getByRole('button', { name: c.config.save })).toBeDisabled()

    await user.clear(config.getByLabelText(c.config.dailyRescues))
    await user.type(config.getByLabelText(c.config.dailyRescues), '3')
    for (const label of [c.config.weightSilver, c.config.weightGold, c.config.weightDiamond]) {
      await user.clear(config.getByLabelText(label))
      await user.type(config.getByLabelText(label), '0')
    }
    expect(config.getByRole('alert')).toBeInTheDocument()
    expect(config.getByRole('button', { name: c.config.save })).toBeDisabled()
  })

  it('refuses a result time under 5 or over 15 seconds, and a fraction, before anything is sent', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const config = await section(c.config.title)
    const box = config.getByLabelText(c.config.resultSeconds)
    const save = config.getByRole('button', { name: c.config.save })

    for (const bad of ['4', '16', '7.5', '']) {
      await user.clear(box)
      if (bad !== '') await user.type(box, bad)
      expect(box).toHaveAttribute('aria-invalid', 'true')
      expect(config.getByRole('alert')).toHaveTextContent(c.config.invalid)
      expect(save).toBeDisabled()
    }
    for (const good of ['5', '15']) {
      await user.clear(box)
      await user.type(box, good)
      expect(box).not.toHaveAttribute('aria-invalid')
      expect(save).toBeEnabled()
    }
    expect(api.gmSetChaosConfig).not.toHaveBeenCalled()
  })

  it('says it could not load, and tries again on request', async () => {
    const user = userEvent.setup()
    const gmChaos = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ cards: CARDS, config: CONFIG })
    setup(undefined, { gmChaos })

    expect(await screen.findByRole('alert')).toHaveTextContent(c.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))
    await waitFor(() => expect(screen.getByRole('heading', { name: c.config.title, level: 2 })).toBeInTheDocument())
  })
})

describe('ChaosTab with the real 86-card catalogue (Plan 41)', () => {
  const real: GmChaosCardDto[] = (catalogue as { id: string; tier: GmChaosCardDto['tier']; family: string; effect: string; modes: string[]; enabled: boolean }[]).map(
    (def) => ({ id: def.id, tier: def.tier, family: def.family, effect: def.effect, modes: def.modes, fileEnabled: def.enabled, rule: null, activeNow: def.enabled }) as GmChaosCardDto,
  )

  it('lists all 86 cards by tier, every one by its name and family and never by its id', async () => {
    setup({ cards: real, config: { ...CONFIG, tierWeights: { silver: 50, gold: 35, diamond: 15 } } })

    expect(await section('Bạc · 30/30 thẻ đang bật')).toBeTruthy()
    expect(await section('Vàng · 28/28 thẻ đang bật')).toBeTruthy()
    expect(await section('Kim cương · 28/28 thẻ đang bật')).toBeTruthy()
    expect(real).toHaveLength(86)

    const rows = screen.getAllByRole('row').filter((row) => within(row).queryByRole('checkbox') !== null)
    expect(rows).toHaveLength(86)
    const names = (gameVi.chaos.cards as Record<string, { name?: string }>)
    for (const card of real) {
      const name = names[card.id]?.name
      expect(name, `game chaos.cards.${card.id}.name`).toBeTypeOf('string')
      expect(screen.getAllByLabelText(c.enabledOf.replace('{{card}}', name!)).length, card.id).toBeGreaterThan(0)
      expect(screen.queryByText(card.id), card.id).toBeNull()
    }
    // A family with no label would print its key; the god and dice families have theirs.
    const families = new Set(real.map((card) => card.family))
    for (const family of families) {
      expect((c.family as Record<string, string>)[family], `gm.chaos.family.${family}`).toBeTypeOf('string')
    }
    expect(families.has('god')).toBe(true)
    expect(families.has('dice')).toBe(true)
  })

  it('shows the server’s tier odds, 50 / 35 / 15 by default', async () => {
    setup({ cards: real, config: { ...CONFIG, tierWeights: { silver: 50, gold: 35, diamond: 15 } } })
    const config = await section(c.config.title)

    expect(config.getByLabelText(c.config.weightSilver)).toHaveValue('50')
    expect(config.getByLabelText(c.config.weightGold)).toHaveValue('35')
    expect(config.getByLabelText(c.config.weightDiamond)).toHaveValue('15')
  })
})

describe('economy days', () => {
  it('maps a day key to the start of that day in the economy zone (UTC+7) and back', () => {
    expect(dayStartOf('2026-11-01')).toBe(Date.parse('2026-10-31T17:00:00Z'))
    expect(economyDayOf(Date.parse('2026-10-31T17:00:00Z'))).toBe('2026-11-01')
    expect(economyDayOf(Date.parse('2026-10-31T16:59:59Z'))).toBe('2026-10-31')
  })
})
