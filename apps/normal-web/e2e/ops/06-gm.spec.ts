import { expect, test } from '@playwright/test'
import {
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  joinByCode,
  newPlayer,
  OVERLAP_SCREENS,
  promoteToGm,
  ready,
  start,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

test.describe.configure({ mode: 'serial' })
let gm: Player
let alice: Player
let bob: Player

test.beforeAll(async ({ browser }) => {
  gm = await newPlayer(browser, 'GM')
  alice = await newPlayer(browser, 'Alice')
  bob = await newPlayer(browser, 'Bob')
  await promoteToGm(gm.page, gm.who.email)
})
test.afterAll(async () => {
  await closeAll([gm, alice, bob])
})

test('Q-01: a GM finds a player, grants 10.000 points with a reason; the player sees the balance move and a toast; the log has the line', async () => {
  const before = await balanceOf(alice.page)
  await gm.page.goto('/#/settings')
  await gm.page.getByRole('link', { name: 'Quản trị' }).click()
  await expect(gm.page.getByRole('heading', { name: 'Quản trị' })).toBeVisible()
  await gm.page.getByRole('button', { name: 'Người chơi', exact: true }).click()
  await gm.page.getByLabel('Tìm theo email hoặc tên').fill(alice.who.displayName)
  await gm.page.getByRole('button', { name: 'Tìm', exact: true }).click()
  const row = gm.page.getByRole('row').filter({ hasText: alice.who.displayName })
  await expect(row).toBeVisible()
  await expect(row).not.toContainText(alice.who.email) // masked in the list
  await expectNoTextOverlapAt(gm.page, 'gm players', OVERLAP_SCREENS)
  await expectNoSidewaysScroll(gm.page)
  await row.getByRole('button', { name: 'Mở' }).click()
  await expect(gm.page.getByText(alice.who.email)).toBeVisible() // full on the detail
  await gm.page.getByRole('button', { name: 'Cộng/trừ điểm' }).click()
  const dialog = gm.page.getByRole('dialog')
  await dialog.getByLabel(/Số điểm/).fill('10000')
  await expect(dialog.getByRole('button', { name: 'Xác nhận' })).toBeDisabled()
  await dialog.getByLabel(/Lý do/).fill('thưởng Q-01')
  await dialog.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(gm.page.getByText(/Đã cập nhật số dư/)).toBeVisible()
  // The toast lives 8 s: look for it first, then the balance. Alice's screen moves without a reload.
  await expect(alice.page.getByText(/Quản trị viên: \+10\.000 điểm — thưởng Q-01/)).toBeVisible()
  expect(await balanceWhen(alice.page, (n) => n === before + 10_000)).toBe(before + 10_000)
  await expect(alice.page.getByText(new Intl.NumberFormat('vi-VN').format(before + 10_000)).first()).toBeVisible()
  await gm.page.getByRole('button', { name: 'Nhật ký', exact: true }).click()
  await expect(gm.page.getByRole('row').filter({ hasText: 'thưởng Q-01' })).toContainText('Cộng điểm')
})

test('Q-02: a GM closes a Blind room mid-hand; both players are back in the lobby with their stacks home, and the log says close_room', async () => {
  const name = unique('Bàn Q02 ')
  const code = await createBlind(alice.page, { name, bots: 0, maxPlayers: 2, mode: 'Chơi hoặc bỏ', wager: '1.000', timer: '30 giây' })
  await joinByCode(bob.page, code)
  const a0 = await balanceOf(alice.page)
  const b0 = await balanceOf(bob.page)
  await takeSeat(alice.page, 0)
  await takeSeat(bob.page, 1)
  await ready(alice.page)
  await ready(bob.page)
  await gm.page.goto('/#/gm')
  await gm.page.getByRole('button', { name: 'Phòng', exact: true }).click()
  await start(alice.page)
  await expect(alice.page.getByRole('button', { name: /^Chơi\b/ })).toBeVisible({ timeout: 20_000 }) // the decision round is on
  await gm.page.getByRole('button', { name: 'Làm mới' }).click()
  const room = gm.page.getByRole('row').filter({ hasText: name })
  await expect(room).toContainText('Đang ván')
  await expectNoTextOverlapAt(gm.page, 'gm rooms', OVERLAP_SCREENS)
  await expectNoSidewaysScroll(gm.page)
  await room.getByRole('button', { name: 'Đóng phòng' }).click()
  const dialog = gm.page.getByRole('dialog')
  await expect(dialog).toContainText('Ván đang chơi sẽ bị hủy')
  await dialog.getByLabel(/Lý do/).fill('bảo trì Q-02')
  await dialog.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(gm.page.getByText(/hoàn cho 2 người/)).toBeVisible()
  await expect(alice.page).toHaveURL(/#\/lobby$/, { timeout: 15_000 })
  await expect(bob.page).toHaveURL(/#\/lobby$/, { timeout: 15_000 })
  expect(await balanceWhen(alice.page, (n) => n === a0)).toBe(a0)
  expect(await balanceWhen(bob.page, (n) => n === b0)).toBe(b0)
  await gm.page.getByRole('button', { name: 'Nhật ký', exact: true }).click()
  await expect(gm.page.getByRole('row').filter({ hasText: 'bảo trì Q-02' })).toContainText('Đóng phòng')
})
