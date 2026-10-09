import { expect, test, type Page } from '@playwright/test'
import {
  autopilot,
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  createHoldemRoom,
  handOver,
  joinByCode,
  ledgerOf,
  ledgerSince,
  newPlayer,
  ready,
  start,
  sumOf,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/** Operation test plan §4 (S-04…S-06), §5.C (lobby) and §5.D (creating a room). Two players: a host and a guest. */

test.describe.configure({ mode: 'serial' })

let host: Player
let guest: Player

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Host')
  guest = await newPlayer(browser, 'Guest')
})

test.afterAll(async () => {
  await closeAll([host, guest])
})

/** The ticket for `name` on this player's lobby board. */
const ticket = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) })

async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

test('S-04 S-05 D-05: a Blind room with three bots, a hand played to the end', async () => {
  const name = unique('Bàn S04 ')
  const code = await createBlind(host.page, { name, bots: 3 })
  expect(code, 'S-04: a six-character code').toMatch(/^[A-Z0-9]{6}$/)
  const header = host.page.locator('header').first()
  // D-05: the header repeats the configuration — the wager, and (spec 2026-09-29) the table limit of five wagers.
  for (const text of ['Blind Poker', '2 lá', 'Chơi hoặc bỏ', 'Mức cược 1.000 · Hạn mức 5.000', '4/6 người chơi']) await expect(header.getByText(text)).toBeVisible()
  await expect(host.page.getByText('Bot', { exact: true })).toHaveCount(3)

  // S-05: sit, ready, start, play; the hand ends. A Blind seat brings the table limit and plays from it, so the
  // ledger sees the sit-down and the leave — never the hand itself.
  const before = await balanceOf(host.page)
  const rowsBefore = (await ledgerOf(host.page)).length
  await takeSeat(host.page, 0)
  await ready(host.page)
  await start(host.page)
  await autopilot(host.page, ['play'], handOver(host.page))
  await host.page.getByRole('button', { name: 'Tạm nghỉ' }).click()
  await leave(host.page)
  await balanceWhen(host.page, (n) => n !== before - 5_000)
  const fresh = await ledgerSince(host.page, rowsBefore)
  expect(fresh.filter((row) => row.reason === 'buy_in').map((row) => row.amount), 'S-05: the seat took the 5.000 limit').toEqual([-5_000])
  expect(fresh.filter((row) => row.reason === 'cash_out'), 'and leaving took the stack home').toHaveLength(1)
  expect((await balanceOf(host.page)) - before, 'the balance moved by exactly the new rows').toBe(sumOf(fresh))
})

test('S-06 C-06: an empty room says so for sixty seconds, comes back when someone joins, then closes', async () => {
  test.setTimeout(240_000)
  const name = unique('Bàn C06 ')
  // No bots: a room left with only bots closes at once instead (C-07). An empty one keeps its minute (bug 2).
  await createHoldemRoom(host.page, { name })
  await guest.page.goto('/#/lobby')
  await expect(ticket(guest.page, name)).toBeVisible()

  // The host leaves: the guest's board marks the room as closing, without a reload.
  await leave(host.page)
  await expect(ticket(guest.page, name).getByText('Đang đóng…')).toBeVisible({ timeout: 10_000 })

  // The guest joins within the minute: the room is alive again.
  await ticket(guest.page, name).getByRole('button', { name: new RegExp(`^Vào phòng — ${name}`) }).click()
  await expect(guest.page).toHaveURL(/#\/room$/)
  await expect(ticket(host.page, name)).toBeVisible()
  await expect(ticket(host.page, name).getByText('Đang đóng…')).toHaveCount(0, { timeout: 10_000 })

  // The guest leaves too: closing again, and gone a minute later.
  await leave(guest.page)
  await expect(ticket(host.page, name).getByText('Đang đóng…')).toBeVisible({ timeout: 10_000 })
  await expect(ticket(host.page, name)).toHaveCount(0, { timeout: 80_000 })
})

test('C-07: a room left with only bots closes at once', async () => {
  const name = unique('Bàn C07 ')
  await createBlind(host.page, { name, bots: 2 })
  await guest.page.goto('/#/lobby')
  await expect(ticket(guest.page, name)).toBeVisible()

  // The host is the last person in it: the bots have nobody to play with, so the room does not wait out a minute.
  await leave(host.page)
  await expect(ticket(guest.page, name), 'gone from the other lobby, without a reload').toHaveCount(0, { timeout: 5_000 })

  // The leaver's own lobby too, once it has provably loaded — an absence on a list that has not arrived proves
  // nothing. A room the guest opens now must reach it; the closed one must not be there, where a grace would keep it
  // for a minute.
  const marker = unique('Bàn C07 mốc ')
  await createHoldemRoom(guest.page, { name: marker })
  await expect(ticket(host.page, marker), 'the leaver’s lobby is live').toBeVisible({ timeout: 10_000 })
  await expect(ticket(host.page, name), 'and has no ticket for the room that closed').toHaveCount(0)
  await leave(guest.page)
})

test('C-01 C-02: a new public room reaches the other lobby live, and the mode filter holds', async () => {
  await guest.page.goto('/#/lobby')
  const name = unique('Bàn C01 ')
  await createHoldemRoom(host.page, { name })
  await expect(ticket(guest.page, name), 'C-01: no reload needed').toBeVisible({ timeout: 10_000 })

  const filters = guest.page.getByRole('group', { name: 'Chế độ' })
  await filters.getByRole('button', { name: 'Blind Poker' }).click()
  await expect(ticket(guest.page, name)).toHaveCount(0)
  await filters.getByRole('button', { name: "Texas Hold'em" }).click()
  await expect(ticket(guest.page, name)).toBeVisible()
  await filters.getByRole('button', { name: 'Tất cả' }).click()
  await leave(host.page)
})

test('C-03 C-04: a private room is off the board, and its door is its code and its password', async () => {
  const name = unique('Bàn riêng ')
  const code = await createHoldemRoom(host.page, { name, password: 'mk1234' })
  await guest.page.goto('/#/lobby')
  await guest.page.waitForTimeout(1500)
  await expect(ticket(guest.page, name), 'C-03: not listed').toHaveCount(0)

  await joinByCode(guest.page, code, 'sai-mk')
  await expect(guest.page.getByText('Sai mật khẩu')).toBeVisible()
  await expect(guest.page).toHaveURL(/#\/lobby$/)
  await joinByCode(guest.page, code, 'mk1234')
  await expect(guest.page).toHaveURL(/#\/room$/)
  await leave(guest.page)

  // C-04: a code that names no room.
  await joinByCode(guest.page, 'ZZZZZZ')
  await expect(guest.page.getByText('Không tìm thấy phòng')).toBeVisible()
  await leave(host.page)
})

test('C-05: a room whose seats are bots and one person is full to the next person', async () => {
  const name = unique('Bàn đầy ')
  const code = await createBlind(host.page, { name, bots: 3, maxPlayers: 4 })
  await takeSeat(host.page, 0)
  await guest.page.goto('/#/lobby')
  await expect(ticket(guest.page, name).getByText('4/4')).toBeVisible()
  await joinByCode(guest.page, code)
  await expect(guest.page.getByText('Phòng đã đầy')).toBeVisible()
  await expect(guest.page).toHaveURL(/#\/lobby$/)
  await leave(host.page)
})

test('D-01 D-02 D-03 D-04: the create form refuses what it cannot build and builds what it is told', async () => {
  const page = host.page
  await page.goto('/#/lobby')
  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  const dialog = page.getByRole('dialog')

  // D-03: no name (the dialog opens with a random one, so the field is emptied first); and the field itself stops at thirty characters.
  await dialog.getByLabel('Tên phòng').fill('')
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(dialog.getByText('Tên phòng cần 1–30 ký tự.')).toBeVisible()
  await dialog.getByLabel('Tên phòng').fill('x'.repeat(31))
  expect((await dialog.getByLabel('Tên phòng').inputValue()).length, 'the name field holds thirty').toBe(30)

  // D-02: a minimum above the maximum.
  await dialog.getByLabel('Tên phòng').fill(unique('Bàn D0 '))
  await dialog.getByLabel('Buy-in tối thiểu').fill('300')
  await dialog.getByLabel('Buy-in tối đa').fill('100')
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(dialog.getByText('Buy-in tối thiểu không được lớn hơn buy-in tối đa.')).toBeVisible()

  // D-04: a password of three characters.
  await dialog.getByLabel('Buy-in tối thiểu').fill('50')
  await dialog.getByLabel('Buy-in tối đa').fill('200')
  await dialog.getByLabel('Phòng riêng tư').check()
  await dialog.getByLabel('Mật khẩu phòng').fill('abc')
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(dialog.getByText('Mật khẩu cần 4–20 ký tự.')).toBeVisible()
  await page.keyboard.press('Escape')

  // D-01: four seats, 45 seconds, 250/500, 40–100 BB — the header and the buy-in prompt say so.
  const name = unique('Bàn D01 ')
  await createHoldemRoom(page, { name, maxPlayers: 4, timer: '45 giây', tier: '250/500', minBB: 40, maxBB: 100 })
  const header = page.locator('header').first()
  await expect(header.getByText('Blind 250/500')).toBeVisible()
  await expect(header.getByText(/\/4 người chơi/)).toBeVisible()
  await page.locator('[data-seat="0"]').getByRole('button', { name: /Ngồi vào bàn/ }).click()
  const prompt = page.getByRole('dialog', { name: 'Chọn số điểm mang vào bàn' })
  await expect(prompt.getByText('20.000 – 50.000')).toBeVisible()
  await page.keyboard.press('Escape')
  await leave(page)
})

test('D-06: auto-start deals once every real player is ready', async () => {
  const page = host.page
  await createBlind(page, { name: unique('Bàn D06 '), bots: 1, autoStart: true })
  await takeSeat(page, 0)
  // Not `ready()`: that waits for "Hủy sẵn sàng", and with auto-start the room deals the moment Ready lands.
  await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Hành động' }), 'the hand starts without "Bắt đầu"').toBeVisible({ timeout: 15_000 })
  await autopilot(page, ['fold'], handOver(page))
  await leave(page)
})

// `start` is used by S-05 above; keep the import honest for the linter's sake.
void start
