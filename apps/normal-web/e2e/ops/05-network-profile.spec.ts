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
  newPlayer,
  ready,
  resultCard,
  start,
  statsOf,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * Operation test plan §5.G (connection: reload, a dropped network, the host leaving) and §5.K (profile,
 * statistics, renaming, an achievement for rooms joined). Three players.
 */

test.describe.configure({ mode: 'serial' })

let a: Player
let b: Player
let c: Player

test.beforeAll(async ({ browser }) => {
  a = await newPlayer(browser, 'Giang')
  b = await newPlayer(browser, 'Ha')
  c = await newPlayer(browser, 'Khoa')
})

test.afterAll(async () => {
  await closeAll([a, b, c])
})

const acts = (page: Page) => page.getByRole('group', { name: 'Hành động' })
const seatOf = (page: Page, seat: number) => page.locator(`[data-seat="${seat}"]`)

async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

test('G-01 G-02: a reload mid-hand, and twenty seconds offline, both land back in the same seat and hand', async () => {
  const code = await createHoldemRoom(a.page, { name: unique('Bàn G01 '), timer: '60 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0, 10_000)
  await takeSeat(b.page, 1, 10_000)
  await ready(a.page)
  await ready(b.page)
  await start(a.page)
  await expect(acts(b.page)).toBeVisible()

  // G-01: Hà reloads with cards in hand.
  await b.page.reload()
  await expect(b.page).toHaveURL(/#\/room$/)
  await expect(b.page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'still seated').toBeVisible()
  await expect(seatOf(b.page, 1).getByRole('img', { name: /(chuồn|rô|cơ|bích)$/ }), 'his two cards are back').toHaveCount(2)

  // G-02: Hà's connection goes for twenty seconds — his tab is gone (Playwright's `setOffline` leaves an open
  // WebSocket alone, so it cannot stand in for a dropped line), then he comes back in the same browser, cookie and
  // all. Giang sees the seat marked while he is away and unmarked once he is back; the seat and the hand are his.
  await b.page.close()
  await expect(seatOf(a.page, 1).getByText('Mất kết nối'), "Giang's view of the dropped seat").toBeVisible({ timeout: 20_000 })
  await a.page.waitForTimeout(20_000)
  b.page = await b.context.newPage()
  await b.page.goto('/#/room')
  await expect(seatOf(a.page, 1).getByText('Mất kết nối'), 'marked back online').toHaveCount(0, { timeout: 30_000 })
  await expect(b.page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()

  // And the hand plays out between them.
  await Promise.all([autopilot(a.page, ['check', 'call'], handOver(a.page)), autopilot(b.page, ['check', 'call'], handOver(b.page))])
  await expect(resultCard(b.page)).toBeVisible()
  await a.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await b.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await leave(a.page)
  await leave(b.page)
})

test('G-03: more than ninety seconds offline stands the seat up after the hand; the stack goes home', async () => {
  test.setTimeout(300_000)
  const code = await createHoldemRoom(a.page, { name: unique('Bàn G03 '), timer: '15 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0, 10_000)
  await takeSeat(b.page, 1, 10_000)
  const bWithout = await balanceOf(b.page)
  await ready(a.page)
  await ready(b.page)
  await start(a.page)
  await expect(acts(b.page)).toBeVisible()

  await b.page.close()
  // Giang keeps playing; Hà's turns time out (check or fold) until the 90-second reconnect window closes and he is
  // stood up after the hand.
  await autopilot(a.page, ['check', 'call'], async () => (await seatOf(a.page, 1).getByText(b.who.displayName).count()) === 0, 200_000)
  b.page = await b.context.newPage()
  await b.page.goto('/#/lobby')
  // Spec §16.6 keeps him in the room as a spectator for five minutes, and the server refuses any other room until he
  // is out of it. Finding T5: the lobby used to say nothing about it. Now the app answers the reconnect by taking him
  // straight to that room, where its leave button is.
  await expect(b.page, 'reopening lands on the room he is still in').toHaveURL(/#\/room$/, { timeout: 15_000 })
  await expect(b.page.getByRole('button', { name: 'Rời phòng' }), 'the room is still his to leave').toBeVisible()
  await expect(b.page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'as a spectator, not in a seat').toHaveCount(0)
  // His stack came home: at least the 10.000 less the blinds he could have lost.
  const back = await balanceWhen(b.page, (n) => n > bWithout, 30_000)
  expect(back - bWithout, 'the stack reached his balance').toBeGreaterThan(9_000)
  await leave(a.page)
  await leave(b.page)
})

test('G-04: the host leaves, and the person who came in first after them hosts', async () => {
  const code = await createBlind(a.page, { name: unique('Bàn G04 '), bots: 1 })
  await joinByCode(b.page, code)
  await joinByCode(c.page, code)
  await expect(b.page.getByRole('button', { name: 'Quản lý bàn' })).toHaveCount(0)
  await leave(a.page)
  // Hà came in before Khoa: he gets the host's controls, Khoa does not.
  await expect(b.page.getByRole('button', { name: 'Quản lý bàn' })).toBeVisible({ timeout: 10_000 })
  await expect(c.page.getByRole('button', { name: 'Quản lý bàn' })).toHaveCount(0)
  await leave(b.page)
  await leave(c.page)
})

test('K-03: joining ten rooms unlocks "Mười phòng"', async () => {
  test.setTimeout(240_000)
  // Giang opens the rooms and Khoa walks into each. Both count: finding T6 of the 2026-09-28 run was that a room
  // its creator is in did not ("Vào 10 phòng chơi" said otherwise); the host now gets ROOM_JOINED at creation.
  const hostBefore = (await statsOf(a.page)).roomsJoined ?? 0
  for (let i = 0; i < 10; i++) {
    const code = await createBlind(a.page, { name: unique('Bàn K03 '), bots: 1 })
    await joinByCode(c.page, code)
    await expect(c.page).toHaveURL(/#\/room$/)
    await leave(c.page)
    await leave(a.page)
  }
  await expect.poll(async () => (await statsOf(c.page)).roomsJoined, { timeout: 30_000 }).toBeGreaterThanOrEqual(10)
  await expect.poll(async () => (await ledgerOf(c.page)).some((row) => row.reason === 'achievement' && row.amount === 2_000)).toBe(true)
  await c.page.goto('/#/achievements')
  await expect(c.page.getByRole('listitem').filter({ hasText: 'Mười phòng' }).first()).toHaveAttribute('data-unlocked', 'true')
  // T6: the ten rooms Giang created count for her too, once each, and they take her past ten as well.
  await expect.poll(async () => (await statsOf(a.page)).roomsJoined, { timeout: 30_000 }).toBe(hostBefore + 10)
  await a.page.goto('/#/achievements')
  await expect(a.page.getByRole('listitem').filter({ hasText: 'Mười phòng' }).first()).toHaveAttribute('data-unlocked', 'true')
})

test('K-04 K-05: the profile counts what was played, and a rename shows everywhere — but not onto a taken name', async () => {
  const page = a.page
  const stats = await statsOf(page)
  await page.goto('/#/profile')
  const holdem = page.getByRole('heading', { name: "Texas Hold'em", level: 3 }).locator('xpath=ancestor::section[1]')
  await expect(holdem.getByText(String(stats.handsPlayedHoldem), { exact: true }).first(), 'K-04: the counter is the server’s').toBeVisible()

  // K-05: a taken name is refused; a free one is saved and shows in the lobby bar.
  const field = page.getByLabel('Tên hiển thị mới')
  await field.fill(b.who.displayName)
  await page.getByRole('button', { name: 'Lưu tên' }).click()
  await expect(page.getByText('Tên hiển thị đã có người dùng')).toBeVisible()
  const fresh = unique('Giang Moi ')
  await field.fill(fresh)
  await page.getByRole('button', { name: 'Lưu tên' }).click()
  await expect(page.getByRole('heading', { name: fresh, level: 2 })).toBeVisible()
  // The lobby bar reads the socket's identity, which keeps the old name until the connection is made again —
  // finding T7: the confirmation only warns about the table. After a reload the new name is everywhere.
  await page.goto('/#/lobby')
  await page.reload()
  await expect(page.getByRole('banner').getByText(fresh, { exact: true }).first()).toBeVisible()
})
