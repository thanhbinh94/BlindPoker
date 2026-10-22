import { formatPoints } from '@bp/ui-kit'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AchievementDefDto, type GmPlayerDetailDto, type NormalApi, type PlayerStatsDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { PlayerDetail } from './PlayerDetail.js'

const DETAIL: GmPlayerDetailDto = {
  playerId: 'p1',
  displayName: 'Bình',
  email: 'binh@example.com',
  role: 'player',
  locked: null,
  balance: 123_000,
  createdAt: Date.UTC(2026, 8, 1),
  lastLoginAt: Date.UTC(2026, 9, 17, 8, 30),
  stats: { handsPlayedHoldem: 12, handsPlayedBlind: 3 } as unknown as PlayerStatsDto,
  room: null,
  inventoryCount: 7,
  unlockedAchievementIds: [],
  reputation: 455,
  rank: 3,
}

const ACHIEVEMENTS: AchievementDefDto[] = [
  { id: 'login_days_7', category: 'login', metric: 'totalLoginDays', threshold: 7, reward: { points: 5_000 } },
  { id: 'login_days_30', category: 'login', metric: 'totalLoginDays', threshold: 30, reward: { points: 20_000 } },
]

const CLAIMED = { claimedToday: true, day: 3, streak: 3, points: 2_000, itemIds: ['head_crown_gold01', 'badge_bronze'] }

type Stub = NormalApi & Record<string, ReturnType<typeof vi.fn>>

function stubApi(detail: GmPlayerDetailDto = DETAIL, overrides: Partial<Record<keyof NormalApi, unknown>> = {}): Stub {
  return {
    gmPlayer: vi.fn().mockResolvedValue(detail),
    gmPlayerLedger: vi.fn().mockResolvedValue({
      entries: [{ id: 5, amount: 2_000, reason: 'gm_grant', refId: null, createdAt: Date.UTC(2026, 9, 17) }],
      nextBefore: null,
    }),
    gmPlayerHistory: vi.fn().mockResolvedValue([]),
    gmPoints: vi.fn().mockResolvedValue({ balance: 122_500, actionId: 9 }),
    gmGrantItem: vi.fn().mockResolvedValue({ granted: ['hair.bob'], alreadyOwned: 0 }),
    gmGrantWardrobe: vi.fn().mockResolvedValue({ granted: ['a', 'b', 'c'], alreadyOwned: 1 }),
    gmLock: vi.fn().mockResolvedValue({ locked: true }),
    gmUnlock: vi.fn().mockResolvedValue({ locked: false }),
    gmSetRole: vi.fn().mockResolvedValue({ role: 'gm' }),
    gmCheckin: vi.fn().mockResolvedValue({ claimedToday: false, day: 0, streak: 0, points: 0, itemIds: [] }),
    gmUnlockAchievement: vi.fn().mockResolvedValue({ actionId: 11, reward: { points: 5_000 }, balance: 128_000 }),
    gmResetCheckin: vi.fn().mockResolvedValue({ actionId: 12, undone: { points: 2_000, itemIds: [] }, balance: 121_000 }),
    catalogAchievements: vi.fn().mockResolvedValue({ achievements: ACHIEVEMENTS }),
    gmGrantReputation: vi.fn().mockResolvedValue({ actionId: 13, reputation: 1_955, rank: 4 }),
    ...overrides,
  } as unknown as Stub
}

function setup(api: Stub = stubApi()) {
  const onBack = vi.fn()
  const guard = (cause: unknown): never => {
    throw cause
  }
  const result = renderWithI18n(<PlayerDetail api={api} lang="vi" guard={guard} playerId="p1" onBack={onBack} />)
  return { ...result, api, onBack }
}

const action = (name: string) => screen.getByRole('button', { name })
const queryAction = (name: string) => screen.queryByRole('button', { name })
const dialog = () => within(screen.getByRole('dialog'))

describe('PlayerDetail', () => {
  it('shows the account in full: address, balance, wardrobe, and where they sit', async () => {
    const { i18n } = setup(stubApi({ ...DETAIL, room: { roomId: 'r1', code: 'ABC', name: 'Bàn 1', seat: 2 } }))

    expect(await screen.findByText('binh@example.com')).toBeInTheDocument()
    expect(screen.getByText(`${formatPoints(123_000, 'vi')} ${i18n.t('common:units.pointsShort')}`)).toBeInTheDocument()
    expect(screen.getByText('Đang ở phòng Bàn 1 (ABC)')).toBeInTheDocument()
    expect(screen.getByText('7 món trong tủ đồ')).toBeInTheDocument()
  })

  it('says when the player is in no room', async () => {
    setup()

    expect(await screen.findByText(viNormal.gm.player.notInRoom)).toBeInTheDocument()
  })

  it('moves points with a reason, then reads the account again and says what happened', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')
    expect(api.gmPlayer).toHaveBeenCalledTimes(1)

    await user.click(action(viNormal.gm.actions.points))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.amount), '-500')
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'sửa')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmPoints).toHaveBeenCalledWith('p1', -500, 'sửa')
    expect(await screen.findByText(`Đã cập nhật số dư: ${formatPoints(122_500, 'vi')}`)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Đã cập nhật số dư')
    expect(api.gmPlayer).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the reputation with the rank reached (Plan 27)', async () => {
    setup()

    expect(await screen.findByText('Danh vọng: 455 (Cao thủ)')).toBeInTheDocument()
  })

  it('adds reputation with an amount of 1 to 100 000 and a reason, then reads the account again', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')

    await user.click(action(viNormal.gm.actions.grantReputation))
    expect(dialog().getByText(viNormal.gm.dialog.reputationBody)).toBeInTheDocument()
    const amount = dialog().getByLabelText(viNormal.gm.dialog.reputationAmount)
    const confirm = dialog().getByRole('button', { name: viNormal.gm.dialog.confirm })
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'thưởng giải')
    // Never a deduction, never over the cap.
    for (const bad of ['-5', '0', '100001']) {
      await user.clear(amount)
      await user.type(amount, bad)
      expect(confirm).toBeDisabled()
    }
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(confirm)

    expect(api.gmGrantReputation).toHaveBeenCalledWith('p1', 1_500, 'thưởng giải')
    expect(await screen.findByText(`Đã cộng danh vọng: ${formatPoints(1_955, 'vi')} (Bậc thầy)`)).toBeInTheDocument()
    expect(api.gmPlayer).toHaveBeenCalledTimes(2)
  })

  it('reloads the ledger after an action so the new row is there', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')
    expect(api.gmPlayerLedger).toHaveBeenCalledTimes(1)
    expect(api.gmPlayerLedger).toHaveBeenCalledWith('p1', { limit: 50 })

    await user.click(action(viNormal.gm.actions.wardrobe))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'quà')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await screen.findByText('Đã cấp 3 món')).toBeInTheDocument()
    expect(api.gmGrantWardrobe).toHaveBeenCalledWith('p1', 'quà')
    expect(api.gmPlayerLedger).toHaveBeenCalledTimes(2)
  })

  it('grants one item by id', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')

    await user.click(action(viNormal.gm.actions.item))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.item), 'hair.bob')
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'quà')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmGrantItem).toHaveBeenCalledWith('p1', 'hair.bob', 'quà')
    expect(await screen.findByText('Đã cấp 1 món')).toBeInTheDocument()
  })

  it('locks with the consequences spelled out first', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')
    expect(queryAction(viNormal.gm.actions.unlock)).toBeNull()

    await user.click(action(viNormal.gm.actions.lock))
    expect(screen.getByText(viNormal.gm.dialog.lockBody)).toBeInTheDocument()
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'gian lận')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmLock).toHaveBeenCalledWith('p1', 'gian lận')
    expect(await screen.findByText(viNormal.gm.done.lock)).toBeInTheDocument()
  })

  it('offers Mở khóa, not Khóa, for a locked account, and shows why it was locked', async () => {
    const user = userEvent.setup()
    const { api } = setup(stubApi({ ...DETAIL, locked: { at: Date.UTC(2026, 9, 16), reason: 'gian lận' } }))
    await screen.findByText('binh@example.com')

    expect(queryAction(viNormal.gm.actions.lock)).toBeNull()
    expect(screen.getByText(/gian lận/u)).toBeInTheDocument()
    await user.click(action(viNormal.gm.actions.unlock))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'xong rồi')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmUnlock).toHaveBeenCalledWith('p1', 'xong rồi')
  })

  it('makes a player a game master', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('binh@example.com')
    expect(queryAction(viNormal.gm.actions.demote)).toBeNull()

    await user.click(action(viNormal.gm.actions.promote))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'tin cậy')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmSetRole).toHaveBeenCalledWith('p1', 'gm', 'tin cậy')
  })

  it('cannot lock a game master, and offers to take the role back', async () => {
    const user = userEvent.setup()
    const { api } = setup(stubApi({ ...DETAIL, role: 'gm' }))
    await screen.findByText('binh@example.com')

    expect(queryAction(viNormal.gm.actions.lock)).toBeNull()
    expect(queryAction(viNormal.gm.actions.promote)).toBeNull()
    await user.click(action(viNormal.gm.actions.demote))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'nghỉ việc')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmSetRole).toHaveBeenCalledWith('p1', 'player', 'nghỉ việc')
  })

  it('prints the server refusal inside the dialog and keeps it open', async () => {
    const user = userEvent.setup()
    const gmSetRole = vi.fn().mockRejectedValue(new ApiError(409, 'LAST_GM', ''))
    const { api } = setup(stubApi({ ...DETAIL, role: 'gm' }, { gmSetRole }))
    await screen.findByText('binh@example.com')

    await user.click(action(viNormal.gm.actions.demote))
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'nghỉ việc')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await dialog().findByRole('alert')).toHaveTextContent(viNormal.gm.errors.LAST_GM)
    expect(api.gmPlayer).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('unlocks an achievement from a picker that disables what the player already has', async () => {
    const user = userEvent.setup()
    const { api } = setup(stubApi({ ...DETAIL, unlockedAchievementIds: ['login_days_7'] }))
    await screen.findByText('binh@example.com')

    await user.click(action(viNormal.gm.actions.unlockAchievement))
    const picker = await dialog().findByLabelText(viNormal.gm.dialog.achievement)
    expect(within(picker).getByRole('option', { name: viNormal.achievements.login_days_7.name })).toBeDisabled()
    await user.selectOptions(picker, 'login_days_30')
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'thiếu thưởng')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmUnlockAchievement).toHaveBeenCalledWith('p1', 'login_days_30', 'thiếu thưởng')
    expect(await screen.findByText(viNormal.gm.done.unlockAchievement)).toBeInTheDocument()
    expect(api.gmPlayer).toHaveBeenCalledTimes(2)
  })

  it('keeps Đặt lại điểm danh off until the preview says the player has claimed today', async () => {
    setup()
    await screen.findByText('binh@example.com')

    await waitFor(() => expect(screen.getByRole('button', { name: viNormal.gm.actions.resetCheckin })).toBeDisabled())
  })

  it('spells out what the reset takes back, then resets and reads the preview again', async () => {
    const user = userEvent.setup()
    const gmCheckin = vi
      .fn()
      .mockResolvedValueOnce(CLAIMED)
      .mockResolvedValue({ claimedToday: false, day: 0, streak: 3, points: 0, itemIds: [] })
    const { api } = setup(stubApi(DETAIL, { gmCheckin }))
    await screen.findByText('binh@example.com')

    await waitFor(() => expect(action(viNormal.gm.actions.resetCheckin)).toBeEnabled())
    await user.click(action(viNormal.gm.actions.resetCheckin))
    const body = viNormal.gm.dialog.checkinBody
      .replace('{{points}}', formatPoints(2_000, 'vi'))
      .replace('{{items}}', `${viNormal.items.head_crown_gold01}, ${viNormal.items.badge_bronze}`)
    expect(screen.getByText(body)).toBeInTheDocument()
    await user.type(dialog().getByLabelText(viNormal.gm.dialog.reason), 'bấm nhầm')
    await user.click(dialog().getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(api.gmResetCheckin).toHaveBeenCalledWith('p1', 'bấm nhầm')
    expect(await screen.findByText(viNormal.gm.done.resetCheckin)).toBeInTheDocument()
    expect(api.gmCheckin).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(action(viNormal.gm.actions.resetCheckin)).toBeDisabled())
  })

  it('says "no items" when the claim gave only points', async () => {
    const user = userEvent.setup()
    setup(stubApi(DETAIL, { gmCheckin: vi.fn().mockResolvedValue({ ...CLAIMED, itemIds: [] }) }))
    await screen.findByText('binh@example.com')

    await waitFor(() => expect(action(viNormal.gm.actions.resetCheckin)).toBeEnabled())
    await user.click(action(viNormal.gm.actions.resetCheckin))

    expect(
      screen.getByText(viNormal.gm.dialog.checkinBody.replace('{{points}}', formatPoints(2_000, 'vi')).replace('{{items}}', viNormal.gm.dialog.noItems)),
    ).toBeInTheDocument()
  })

  it('goes back to the list', async () => {
    const user = userEvent.setup()
    const { onBack } = setup()
    await screen.findByText('binh@example.com')

    await user.click(screen.getByRole('button', { name: viNormal.gm.player.back }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('says when the account cannot be read, and tries again', async () => {
    const user = userEvent.setup()
    const gmPlayer = vi.fn().mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', '')).mockResolvedValue(DETAIL)
    setup(stubApi(DETAIL, { gmPlayer }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.player.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText('binh@example.com')).toBeInTheDocument()
  })
})
