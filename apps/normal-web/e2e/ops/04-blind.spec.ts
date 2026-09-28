import { expect, test, type Page } from '@playwright/test'
import {
  autopilot,
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  handOver,
  historyOf,
  joinByCode,
  ledgerOf,
  ledgerSince,
  newPlayer,
  postApi,
  ready,
  resultCard,
  start,
  statsOf,
  sumOf,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * Operation test plan §5.F (Blind Poker), §5.H-01/H-02 (the ledger, relief) and §5.K-02 (an achievement earned
 * at the table). Two real players, bots where the case wants them.
 */

test.describe.configure({ mode: 'serial' })

let a: Player
let b: Player

test.beforeAll(async ({ browser }) => {
  a = await newPlayer(browser, 'Dao')
  b = await newPlayer(browser, 'Em')
})

test.afterAll(async () => {
  await closeAll([a, b])
})

async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

const mySeat = (page: Page, seat = 0) => page.locator(`[data-seat="${seat}"]`)
/** Face-up cards only: a card's label is "<rank> <suit>" ("10 cơ", "Già bích"); a seat also holds the dealer button and the
 * chibi, which are images with labels of their own. */
const FACE_UP = /^(\d+|Bồi|Đầm|Già|Át) (chuồn|rô|cơ|bích)$/
const faceUp = (scope: ReturnType<Page['locator']>) => scope.getByRole('img', { name: FACE_UP })

test('F-01 F-02 H-01: pure luck, three cards — the ante goes in, nobody decides, and the ledger writes the hand', async () => {
  const before = await balanceOf(a.page)
  const rowsBefore = (await ledgerOf(a.page)).length
  await createBlind(a.page, { name: unique('Bàn F01 '), bots: 2, mode: 'Thuần may rủi', cards: 3 })
  await takeSeat(a.page, 0)
  await ready(a.page)
  await start(a.page)

  // F-02: three hole cards of my own, face up.
  await expect(faceUp(mySeat(a.page))).toHaveCount(3, { timeout: 15_000 })
  // F-01: no decision to make in this mode — the hand plays itself to a result.
  await expect(a.page.getByRole('button', { name: /^Chơi\b/ })).toHaveCount(0)
  await expect(resultCard(a.page)).toBeVisible({ timeout: 30_000 })
  await leave(a.page)

  // H-01: the hand wrote one settlement row, and the rows it wrote are the whole move of the balance — the
  // settlement plus any achievement the hand unlocked (a three-card board makes "Thùng" and friends likely).
  const after = await balanceWhen(a.page, (n) => n !== before)
  await a.page.waitForTimeout(1_000)
  const ledger = await ledgerOf(a.page)
  const fresh = ledger.slice(0, ledger.length - rowsBefore)
  const settlements = fresh.filter((row) => row.reason === 'settlement')
  expect(settlements).toHaveLength(1)
  expect(fresh.every((row) => row.reason === 'settlement' || row.reason === 'achievement'), 'nothing else moved').toBe(true)
  expect((await balanceOf(a.page)) - before, 'the new rows are the whole move').toBe(fresh.reduce((sum, row) => sum + row.amount, 0))
  expect(after - before).not.toBe(0)
  const hand = (await historyOf(a.page))[0]!
  expect(hand.mode).toBe('blind')
  expect(hand.net, 'the history names the same net').toBe(settlements[0]!.amount)
})

test('F-03 F-04 F-05: two players decide blind to each other; both fold carries the pot; sitting out releases it', async () => {
  test.setTimeout(240_000)
  const code = await createBlind(a.page, { name: unique('Bàn F03 '), bots: 0, maxPlayers: 2, mode: 'Chơi hoặc bỏ', wager: '1.000', timer: '30 giây' })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0)
  await takeSeat(b.page, 1)
  await ready(a.page)
  await ready(b.page)
  const aBefore = await balanceOf(a.page)
  const bBefore = await balanceOf(b.page)
  await start(a.page)

  // F-03: Đào decides first; Em sees that she has decided, never what.
  await a.page.getByRole('button', { name: 'Bỏ bài', exact: true }).click()
  await expect(mySeat(b.page, 0).getByText('Đã chọn')).toBeVisible()
  await expect(mySeat(b.page, 0).getByText('Đã bỏ bài')).toHaveCount(0)

  // F-04: Em folds too — nobody plays, the pot carries to the next hand.
  await b.page.getByRole('button', { name: 'Bỏ bài', exact: true }).click()
  await expect(resultCard(a.page)).toBeVisible()
  await expect(a.page.getByText(/Cộng dồn/).first()).toBeVisible()

  // F-05: both sit out, so no hand can start; after a minute the carried pot is shared between the seated people.
  await a.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await b.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  const aReleased = await balanceWhen(a.page, (n) => n === aBefore, 90_000)
  const bReleased = await balanceWhen(b.page, (n) => n === bBefore, 30_000)
  expect(aReleased, 'Đào gets her half of the 2.000 back').toBe(aBefore)
  expect(bReleased, 'Em gets his half').toBe(bBefore)
  await leave(a.page)
  await leave(b.page)
})

test('F-06: one plays, one folds — the one who played takes the pot without a board, and no one sees the folded cards', async () => {
  const code = await createBlind(a.page, { name: unique('Bàn F06 '), bots: 0, maxPlayers: 2, mode: 'Chơi hoặc bỏ', wager: '1.000', timer: '30 giây' })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0)
  await takeSeat(b.page, 1)
  await ready(a.page)
  await ready(b.page)
  const aBefore = await balanceOf(a.page)
  const aRows = (await ledgerOf(a.page)).length
  await start(a.page)
  const play = a.page.getByRole('button', { name: /^Chơi\b/ })
  const fold = b.page.getByRole('button', { name: 'Bỏ bài', exact: true })
  await expect(play).toBeEnabled()
  await expect(fold).toBeEnabled()
  await play.click()
  await fold.click()
  // Em's choice is his own until the phase ends; on his own screen the tray is gone once it is made.
  await expect(b.page.getByRole('button', { name: 'Bỏ bài', exact: true })).toHaveCount(0)
  await expect(resultCard(a.page)).toBeVisible()
  // Both sit out at once: the room deals the next hand five seconds after this one (FR-G08), and a leave that
  // lands inside that next hand would fold it and cost its ante — which is not what this case measures.
  await a.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await b.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  const cardText = (await resultCard(a.page).innerText()).replace(/\s+/g, ' ')
  expect(cardText, 'the card returns her uncalled play').toContain('Hoàn lại phần cược dư')
  await expect(faceUp(a.page.getByRole('group', { name: 'Bài chung' })), 'no board is dealt').toHaveCount(0)
  await expect(faceUp(mySeat(a.page, 1)), "Em's cards stay face down").toHaveCount(0)
  await leave(a.page)
  await leave(b.page)
  // Spec §8.3: Đào's play went uncalled, so it comes straight back before the pot and the fee are figured. The pot
  // is the two antes, 2.000; less 2 % she takes 1.960 — a settlement of +960 on her own 1.000 ante. (Plus any
  // achievement the win completed, e.g. a third win in a row.)
  await balanceWhen(a.page, (n) => n !== aBefore)
  const fresh = await ledgerSince(a.page, aRows)
  expect(sumOf(fresh, 'settlement'), `result card: ${cardText}`).toBe(2_000 - Math.floor(2_000 * 0.02) - 1_000)
  expect((await balanceOf(a.page)) - aBefore, 'the settlement and its rewards are the whole move').toBe(sumOf(fresh))
})

test('F-08 (T3): the host asks a bot to leave', async () => {
  // Finding T3 of the 2026-09-28 run: "Quản lý bàn" offers "Đuổi" beside every bot, but the server refuses to kick
  // a bot (`Room.kick`: ILLEGAL_ACTION "cannot kick this player") and the press changes nothing on screen.
  // Expected to fail until T3 is decided and fixed — Playwright reports it the day it starts passing.
  test.fail(true, 'T3: a bot cannot be kicked, but the button is offered')
  await createBlind(a.page, { name: unique('Bàn F08 '), bots: 2, mode: 'Chơi hoặc bỏ' })
  await a.page.getByRole('button', { name: 'Quản lý bàn' }).click()
  const dialog = a.page.getByRole('dialog', { name: 'Người trong phòng' })
  await dialog.getByRole('button', { name: 'Đuổi — Bot 1' }).click()
  try {
    await expect(dialog.getByText('Bot 1')).toHaveCount(0, { timeout: 5_000 })
  } finally {
    await a.page.keyboard.press('Escape')
    await leave(a.page)
  }
})

test('F-09: auto-play decides every hand by itself', async () => {
  await createBlind(a.page, { name: unique('Bàn F09 '), bots: 1, mode: 'Chơi hoặc bỏ' })
  // Auto-play on from the first decision; the next hands need no press at all.
  await takeSeat(a.page, 0)
  await ready(a.page)
  await start(a.page)
  await a.page.getByRole('button', { name: 'Tự động chơi' }).click()
  const before = (await historyOf(a.page)).length
  await expect.poll(async () => (await historyOf(a.page)).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(before + 3)
  await leave(a.page)
})

test('K-02: ten Blind hands unlock "Mười ván Blind Poker" and pay its 2.000', async () => {
  test.setTimeout(420_000)
  await createBlind(a.page, { name: unique('Bàn K02 '), bots: 1, mode: 'Chơi hoặc bỏ', autoStart: true })
  await takeSeat(a.page, 0)
  await a.page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
  await a.page.getByRole('button', { name: 'Tự động chơi' }).click()
  await expect.poll(async () => (await statsOf(a.page)).handsPlayedBlind, { timeout: 360_000, intervals: [3_000] }).toBeGreaterThanOrEqual(10)
  await leave(a.page)
  await expect.poll(async () => (await ledgerOf(a.page)).some((row) => row.reason === 'achievement' && row.amount === 2_000)).toBe(true)
  await a.page.goto('/#/achievements')
  const row = a.page.getByRole('listitem').filter({ hasText: 'Mười ván Blind Poker' }).first()
  await expect(row).toHaveAttribute('data-unlocked', 'true')
})

test('H-02 F-07: below 5.000 the relief tops up to 5.000 once; a stake the balance cannot cover is refused', async () => {
  test.setTimeout(420_000)
  // Lose on purpose: one play-or-fold hand at a time, folded, each at the biggest stake the balance can still enter
  // (play-or-fold needs twice the stake), until the balance is under the relief line. Pure luck would not do: one
  // lucky pot at a table of six pays 294.000.
  const page = b.page
  const STAKES = [50_000, 20_000, 10_000, 5_000, 2_000, 1_000]
  for (let round = 0; round < 40 && (await balanceOf(page)) >= 5_000; round++) {
    const balanceNow = await balanceOf(page)
    const stake = STAKES.find((w) => 2 * w <= balanceNow)!
    await createBlind(page, { name: unique('Bàn H02 '), bots: 1, mode: 'Chơi hoặc bỏ', wager: stake.toLocaleString('vi-VN') })
    await takeSeat(page, 0)
    await ready(page)
    await start(page)
    await autopilot(page, ['fold'], handOver(page))
    await page.getByRole('button', { name: 'Ngồi ngoài' }).click()
    await leave(page)
    await balanceWhen(page, (n) => n < balanceNow)
  }
  let balance = await balanceOf(page)
  test.skip(balance >= 5_000, `the run left Em at ${balance}, above the relief line — H-02 needs a balance under 5.000`)

  // H-02: the relief, then a second ask refused.
  await page.goto('/#/daily')
  await page.getByRole('button', { name: 'Nhận cứu trợ' }).click()
  expect(await balanceWhen(page, (n) => n === 5_000), 'topped up to 5.000').toBe(5_000)
  const again = await postApi(page, '/api/economy/relief')
  expect(again.status, 'once per 24 hours').toBe(409)
  balance = 5_000

  // F-07 (FR-R07): a 10.000 stake is more than 5.000 — the seat is refused, in words, and nothing is charged. (A
  // player already seated whose balance falls below the stake sits out instead — the rounds above did exactly that
  // after each fold, which is what the "Vào lại" toggle on their tray was saying.)
  await createBlind(page, { name: unique('Bàn F07 '), bots: 1, mode: 'Thuần may rủi', wager: '10.000' })
  await mySeat(page).getByRole('button', { name: /Ngồi vào bàn/ }).click()
  await expect(page.getByText('Số dư không đủ')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toHaveCount(0)
  expect(await balanceOf(page), 'nothing charged').toBe(balance)
  await leave(page)
})

