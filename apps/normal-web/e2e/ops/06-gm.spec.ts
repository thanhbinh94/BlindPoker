import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { shot } from '../support.js'
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
  parsePoints,
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

/** The Vietnamese words the app prints, read from its own locale file so a rename cannot drift from this test. */
const vi = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/locales/vi/normal.json', import.meta.url)), 'utf8')) as {
  achievements: Record<string, { name: string }>
  daily: { calendarTitle: string }
}

type GiftRules = Record<string, { fixed?: string[] }>

/** Every item the shipped schedule already names, in any month: the picker below must choose one that is not among them. */
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../normal-server/data/daily-gifts.json', import.meta.url)), 'utf8')) as {
  default: GiftRules
  months: Record<string, GiftRules>
}
const NAMED_BY_FILE = new Set<string>(
  [shipped.default, ...Object.values(shipped.months)].flatMap((rules) => Object.values(rules).flatMap((rule) => rule.fixed ?? [])),
)

/** Settings → "Quản trị" → the player's detail page, the way Q-01 walks it. */
async function openDetailOf(gmPage: Page, who: { displayName: string }): Promise<void> {
  await gmPage.goto('/#/settings')
  await gmPage.getByRole('link', { name: 'Quản trị' }).click()
  await expect(gmPage.getByRole('heading', { name: 'Quản trị' })).toBeVisible()
  await gmPage.getByRole('button', { name: 'Người chơi', exact: true }).click()
  await gmPage.getByLabel('Tìm theo email hoặc tên').fill(who.displayName)
  await gmPage.getByRole('button', { name: 'Tìm', exact: true }).click()
  await gmPage.getByRole('row').filter({ hasText: who.displayName }).getByRole('button', { name: 'Mở' }).click()
  await expect(gmPage.getByRole('button', { name: 'Cộng/trừ điểm' })).toBeVisible()
}

test("Q-03: a GM reopens a claimed check-in, unlocks an achievement, and sets a future month's gift; the player and the log see each", async () => {
  // ── the player claims today's check-in ────────────────────────────────────────────────────────────
  const start0 = await balanceOf(alice.page)
  await alice.page.goto('/#/daily')
  const claim = alice.page.getByRole('button', { name: 'Nhận thưởng' })
  await expect(claim).toBeEnabled()
  await claim.click()
  await expect(claim).toBeDisabled()
  const afterClaim = await balanceWhen(alice.page, (n) => n > start0)
  const reward = afterClaim - start0
  expect(reward, 'the first day of a streak pays points').toBeGreaterThan(0)

  // ── the GM reopens it: the dialog names exactly what is taken back ───────────────────────────────
  await openDetailOf(gm.page, alice.who)
  const reset = gm.page.getByRole('button', { name: 'Đặt lại điểm danh' })
  await expect(reset).toBeEnabled()
  await reset.click()
  const dialog = gm.page.getByRole('dialog')
  const named = /trừ lại ([\d.]+) điểm/.exec(await dialog.innerText())
  expect(named, 'the dialog says how many points come back').not.toBeNull()
  expect(parsePoints(named?.[1] ?? ''), 'the dialog names the points the claim paid').toBe(reward)
  await expect(dialog.getByRole('button', { name: 'Xác nhận' })).toBeDisabled()
  await dialog.getByLabel(/Lý do/).fill('mở lại Q-03')
  await dialog.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(gm.page.getByText('Đã mở lại lượt điểm danh hôm nay.')).toBeVisible()

  // The player is told how much is taken back and why, the points leave, and the Daily page she is still on reads its
  // status again on the notice (Ruling 11): the button is hers once more without a reload.
  const toast = alice.page.getByText(/Lượt điểm danh hôm nay đã được mở lại/)
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(`trừ lại ${named?.[1] ?? ''} điểm — mở lại Q-03`)
  expect(await balanceWhen(alice.page, (n) => n === start0), 'the reward is taken back').toBe(start0)
  await expect(claim, 'the claim button comes back on the notice').toBeEnabled({ timeout: 10_000 })
  await claim.click()
  expect(await balanceWhen(alice.page, (n) => n === afterClaim), 'the second claim pays the day again').toBe(afterClaim)

  // ── the GM unlocks an achievement: the reward is paid in full ──────────────────────────────────
  await openDetailOf(gm.page, alice.who)
  await gm.page.getByRole('button', { name: 'Mở thành tựu' }).click()
  const picker = gm.page.getByRole('dialog')
  await picker.getByLabel('Thành tựu').selectOption('login_days_7')
  await picker.getByLabel(/Lý do/).fill('mở thành tựu Q-03')
  await picker.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(gm.page.getByText('Đã mở thành tựu và trả thưởng.')).toBeVisible()
  const sevenDays = vi.achievements.login_days_7?.name ?? ''
  expect(sevenDays).not.toBe('')
  await expect(alice.page.getByText(`GM đã mở thành tựu "${sevenDays}" cho bạn.`)).toBeVisible()
  expect(await balanceWhen(alice.page, (n) => n === afterClaim + 5_000), 'the achievement pays 5.000').toBe(afterClaim + 5_000)

  // ── the GM sets a future month's day 21 to a fixed gift ──────────────────────────────────────
  await gm.page.getByRole('button', { name: 'Quay lại danh sách' }).click()
  await gm.page.getByRole('button', { name: 'Quà tháng', exact: true }).click()
  const monthSelect = gm.page.getByLabel('Tháng', { exact: true })
  await expect(monthSelect).toBeVisible()
  const months = await monthSelect.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  const next = months[1] ?? ''
  expect(next, 'the picker lists this month and the ones to come').not.toBe('')
  await monthSelect.selectOption(next)
  await gm.page.getByRole('button', { name: 'Ngày 21', exact: true }).click()
  await gm.page.getByRole('group', { name: 'Quà của ngày 21' }).getByRole('button', { name: 'Cố định', exact: true }).click()
  const itemSelect = gm.page.getByLabel('Chọn món', { exact: true })
  const options = await itemSelect
    .locator('option')
    .evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() })))
  const chosen = options.find((o) => o.value !== '' && !NAMED_BY_FILE.has(o.value))
  expect(chosen, 'the catalogue has a gift the shipped schedule does not already name').toBeDefined()
  await itemSelect.selectOption(chosen?.value ?? '')
  await gm.page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(gm.page.getByRole('list', { name: 'Món của ngày 21' })).toContainText(chosen?.label ?? '')
  await gm.page.getByRole('button', { name: 'Lưu', exact: true }).click()
  const saveDialog = gm.page.getByRole('dialog')
  await saveDialog.getByLabel(/Lý do/).fill('quà tháng Q-03')
  await saveDialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(gm.page.getByText('Đã lưu quà tháng.')).toBeVisible()

  // A reload reads it back from the database: the month is marked as edited, and day 21 shows the gift.
  await gm.page.reload()
  await gm.page.getByRole('button', { name: 'Quà tháng', exact: true }).click()
  await gm.page.getByLabel('Tháng', { exact: true }).selectOption(next)
  await expect(gm.page.getByLabel('Tháng', { exact: true }).locator('option:checked')).toContainText('(đã sửa)')
  const day21 = gm.page.getByRole('list', { name: vi.daily.calendarTitle }).getByRole('listitem').nth(20)
  await expect(day21).toContainText('Ngày 21')
  await expect(day21.locator('[data-kind="fixed"]')).toContainText(chosen?.label ?? '')

  // The tab and the per-day table at the three sizes the user reads the console at (spec Part A §A4).
  for (const [width, height] of [
    [1920, 940],
    [1366, 768],
    [375, 812],
  ] as const) {
    await gm.page.setViewportSize({ width, height })
    await gm.page.getByRole('button', { name: 'Quà tháng', exact: true }).click()
    await gm.page.getByLabel('Tháng', { exact: true }).selectOption(next)
    await expect(gm.page.getByRole('list', { name: vi.daily.calendarTitle })).toBeVisible()
    await expectNoTextOverlapAt(gm.page, `gm gifts ${width}`)
    await expectNoSidewaysScroll(gm.page)
    await shot(gm.page, `gm-gifts-${width}`)

    await gm.page.getByRole('button', { name: 'Tổng quan', exact: true }).click()
    const byDay = gm.page.getByText('Theo ngày', { exact: true })
    await expect(byDay).toBeVisible()
    await expectNoTextOverlapAt(gm.page, `gm by-day ${width}`)
    await expectNoSidewaysScroll(gm.page)
    await byDay.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await shot(gm.page, `gm-byday-${width}`)
  }
  await gm.page.setViewportSize({ width: 1440, height: 900 })

  // ── the log has all three ───────────────────────────────────────────────────────────────────────
  await gm.page.getByRole('button', { name: 'Nhật ký', exact: true }).click()
  await expect(gm.page.getByRole('row').filter({ hasText: 'mở lại Q-03' })).toContainText('Đặt lại điểm danh')
  await expect(gm.page.getByRole('row').filter({ hasText: 'mở thành tựu Q-03' })).toContainText('Mở thành tựu')
  await expect(gm.page.getByRole('row').filter({ hasText: 'quà tháng Q-03' })).toContainText('Đổi quà tháng')
})
