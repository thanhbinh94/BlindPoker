import { expect, test, type Page } from '@playwright/test'
import {
  autopilot,
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  expectNoTextOverlapAt,
  handOver,
  historyOf,
  joinByCode,
  keepPlaying,
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

test('F-01 F-02 H-01: pure luck, three cards — the ante goes in, nobody decides, and the ledger writes the buy-in and the cash-out', async () => {
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

  // H-01 (spec 2026-09-29): a Blind seat plays from the table limit it brought, so the ledger sees the sit-down
  // (`buy_in` −5.000) and the leave (`cash_out`, the stack) and never the hand itself; those rows, plus any achievement
  // the hand unlocked (a three-card board makes "Thùng" and friends likely), are the whole move of the balance.
  const after = await balanceWhen(a.page, (n) => n !== before - 5_000)
  await a.page.waitForTimeout(1_000)
  const ledger = await ledgerOf(a.page)
  const fresh = ledger.slice(0, ledger.length - rowsBefore)
  const buyIn = fresh.filter((row) => row.reason === 'buy_in')
  const cashOut = fresh.filter((row) => row.reason === 'cash_out')
  expect(buyIn.map((row) => row.amount)).toEqual([-5_000])
  expect(cashOut).toHaveLength(1)
  expect(fresh.every((row) => ['buy_in', 'cash_out', 'achievement'].includes(row.reason)), 'nothing else moved').toBe(true)
  expect((await balanceOf(a.page)) - before, 'the new rows are the whole move').toBe(fresh.reduce((sum, row) => sum + row.amount, 0))
  expect(after - before, 'a pure-luck hand always moves points').not.toBe(0)
  const hand = (await historyOf(a.page))[0]!
  expect(hand.mode).toBe('blind')
  expect(hand.net, 'the history names the same net').toBe(buyIn[0]!.amount + cashOut[0]!.amount)
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
  // No11b: a Blind hand in play between two people, the other's choice marked on her seat — no text over text.
  await expectNoTextOverlapAt(b.page, 'Blind, in hand, the other player has chosen')

  // F-04: Em folds too — nobody plays, the pot carries to the next hand.
  await b.page.getByRole('button', { name: 'Bỏ bài', exact: true }).click()
  await expect(resultCard(a.page)).toBeVisible()
  await expect(a.page.getByText(/Cộng dồn/).first()).toBeVisible()

  // F-05: both sit out, so no hand can start; after a minute the carried pot is shared between the seated people.
  // The balances were read after the buy-ins: each 1.000 ante came off a table stack (4.000 stays on each seat), and
  // the release pays the halves of the 2.000 into the balances, not onto the stacks (spec 2026-09-29 §4.6).
  await a.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await b.page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  // No11b: the result card of a hand nobody played, the pot carried — read once both sit out, so no deal can follow.
  await expectNoTextOverlapAt(a.page, 'Blind, result card, everyone folded and the pot carries')
  const aReleased = await balanceWhen(a.page, (n) => n === aBefore + 1_000, 90_000)
  const bReleased = await balanceWhen(b.page, (n) => n === bBefore + 1_000, 30_000)
  expect(aReleased, 'Đào gets her half of the 2.000').toBe(aBefore + 1_000)
  expect(bReleased, 'Em gets his half').toBe(bBefore + 1_000)
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
  // No11b: the winner's card, the uncalled play handed back on it — no text over text.
  await expectNoTextOverlapAt(a.page, 'Blind, result card, an uncalled play returned')
  await expect(faceUp(a.page.getByRole('group', { name: 'Bài chung' })), 'no board is dealt').toHaveCount(0)
  await expect(faceUp(mySeat(a.page, 1)), "Em's cards stay face down").toHaveCount(0)
  await leave(a.page)
  await leave(b.page)
  // Spec §8.3: Đào's play went uncalled, so it comes straight back before the pot and the fee are figured. The pot
  // is the two antes, 2.000; less 2 % she takes 1.960. Her balance was read after the buy-in, so what comes home
  // when she leaves is the stack: the 5.000 she brought, less her 1.000 ante, plus the 1.960. (Plus any achievement
  // the win completed, e.g. a third win in a row.)
  await balanceWhen(a.page, (n) => n !== aBefore)
  const fresh = await ledgerSince(a.page, aRows)
  expect(sumOf(fresh, 'cash_out'), `result card: ${cardText}`).toBe(5_000 - 1_000 + (2_000 - Math.floor(2_000 * 0.02)))
  expect((await balanceOf(a.page)) - aBefore, 'the cash-out and any rewards are the whole move').toBe(sumOf(fresh))
})

test('F-08 (T3): the host asks a bot to leave', async () => {
  // Finding T3 of the 2026-09-28 run: "Quản lý bàn" offered "Đuổi" beside every bot, but the server refused to kick
  // a bot. Now a bot goes between hands like anyone else: off the list, off its seat, and the seat is free.
  await createBlind(a.page, { name: unique('Bàn F08 '), bots: 2, mode: 'Chơi hoặc bỏ' })
  await expect(a.page.locator('[data-seat]').filter({ hasText: 'Bot 1' })).toHaveCount(1)
  await a.page.getByRole('button', { name: 'Quản lý bàn' }).click()
  const dialog = a.page.getByRole('dialog', { name: 'Người trong phòng' })
  await dialog.getByRole('button', { name: 'Đuổi — Bot 1' }).click()
  await expect(dialog.getByText('Bot 1')).toHaveCount(0, { timeout: 5_000 })
  await expect(dialog.getByText('Bot 2'), 'the other bot stays').toBeVisible()
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('[data-seat]').filter({ hasText: 'Bot 1' }), 'its seat is empty').toHaveCount(0)
  await leave(a.page)
})

test('F-09: auto-play decides every hand by itself', async () => {
  await createBlind(a.page, { name: unique('Bàn F09 '), bots: 1, mode: 'Chơi hoặc bỏ' })
  // Auto-play on from the first decision; the next hands need no press at all.
  await takeSeat(a.page, 0)
  await ready(a.page)
  await start(a.page)
  await a.page.getByRole('button', { name: 'Tự động chơi' }).click()
  const before = (await historyOf(a.page)).length
  // Auto-play pays to play every hand, so two lost hands spend the 5.000 limit and stand the seat up (F-10):
  // `keepPlaying` sits back down and switches auto-play on again whenever that happens.
  await expect
    .poll(
      async () => {
        await keepPlaying(a.page, 0)
        return (await historyOf(a.page)).length
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(before + 3)
  await leave(a.page)
})

test('F-10: the table limit — five wagers on the table, folded away, then stood up and asked to sit again', async () => {
  test.setTimeout(300_000)
  // Spec 2026-09-29: play-or-fold at 1.000 needs 2.000 a hand and brings 5.000 to the table. Folding costs exactly the
  // ante, so four folds leave 1.000 — short of a hand — and the seat is stood up with that 1.000 going home.
  //
  // Em plays this one, not Đào: F-09 left Đào's auto-play table mid-hand, and her stack comes home only when that hand
  // ends — a cash-out that could land inside this case's money checks. Em's last table (F-06) was left between hands.
  // (It also keeps Đào's Blind hand count below ten for K-02, which is the case that has to reach it.)
  const page = b.page
  const before = await balanceOf(page)
  const rowsBefore = (await ledgerOf(page)).length
  await createBlind(page, { name: unique('Bàn F10 '), bots: 1, mode: 'Chơi hoặc bỏ', wager: '1.000' })
  await expect(page.locator('header').first().getByText(/Hạn mức 5\.000/)).toBeVisible()
  await takeSeat(page, 0)
  expect(await balanceWhen(page, (n) => n === before - 5_000), 'the seat took the limit').toBe(before - 5_000)
  await ready(page)
  await start(page)
  const notice = page.getByText(/Bạn đã dùng hết hạn mức ở bàn này/)
  await autopilot(page, ['fold'], async () => (await notice.count()) > 0, 240_000)
  await expect(notice).toContainText('1.000 điểm còn lại đã về số dư')
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'no longer seated').toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rời phòng' }), 'still in the room').toBeVisible()
  const fresh = await ledgerSince(page, rowsBefore)
  expect(fresh.filter((row) => row.reason === 'buy_in').map((row) => row.amount)).toEqual([-5_000])
  expect(fresh.filter((row) => row.reason === 'cash_out').map((row) => row.amount)).toEqual([1_000])
  expect(sumOf(fresh, 'buy_in') + sumOf(fresh, 'cash_out'), 'four antes').toBe(-4_000)
  expect((await balanceOf(page)) - before, 'the rows are the whole move').toBe(sumOf(fresh))
  // With no one left to play the bot, the room stops dealing and asks for a seat. Sitting again is a fresh buy-in of
  // the limit. (Waiting for that, rather than sitting inside the five-second countdown, keeps the next deal from
  // taking Em straight back into a hand.)
  await expect(page.getByText('Hãy ngồi vào bàn để chơi.'), 'the table waits for a seat').toBeVisible()
  await takeSeat(page, 0)
  const again = await ledgerSince(page, rowsBefore)
  expect(again.filter((row) => row.reason === 'buy_in').map((row) => row.amount)).toEqual([-5_000, -5_000])
  await page.getByRole('button', { name: 'Ngồi ngoài' }).click()
  await leave(page)
})

test('K-02: ten Blind hands unlock "Mười ván Blind Poker" and pay its 2.000', async () => {
  test.setTimeout(420_000)
  await createBlind(a.page, { name: unique('Bàn K02 '), bots: 1, mode: 'Chơi hoặc bỏ', autoStart: true })
  await takeSeat(a.page, 0)
  await a.page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
  await a.page.getByRole('button', { name: 'Tự động chơi' }).click()
  // A spent limit stands the seat up between hands; `keepPlaying` takes it again, readies and re-arms auto-play.
  await expect
    .poll(
      async () => {
        await keepPlaying(a.page, 0)
        return (await statsOf(a.page)).handsPlayedBlind
      },
      { timeout: 360_000, intervals: [3_000] },
    )
    .toBeGreaterThanOrEqual(10)
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
    // The seat brought min(balance, 5 × stake) — read off the ledger, which an achievement landing mid-round cannot
    // skew — and the fold below costs one stake.
    const brought = -(await ledgerOf(page)).find((row) => row.reason === 'buy_in')!.amount
    await ready(page)
    await start(page)
    await autopilot(page, ['fold'], handOver(page))
    if (brought - stake >= 2 * stake) {
      // Still enough for a hand: sit out, so the leave cannot land in the next deal.
      await page.getByRole('button', { name: 'Ngồi ngoài' }).click()
    } else {
      // Not enough for another hand: the room stands Em up as the hand ends (F-10), the rest already on its way home.
      await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'a spent limit stands the seat up').toHaveCount(0)
    }
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
  // seated player whose table stack can no longer cover a hand is stood up instead — F-10.)
  // "Nothing charged" is read off the ledger rather than the balance: every room Em creates counts towards "Mười
  // phòng" since T6, and the room below may be the one that pays it.
  const rowsBefore = (await ledgerOf(page)).length
  await createBlind(page, { name: unique('Bàn F07 '), bots: 1, mode: 'Thuần may rủi', wager: '10.000' })
  // Spec 2026-09-29: a spectator who cannot cover a seat is told so before trying; the refusal still says it in words.
  await expect(page.getByText('Số dư không đủ để vào bàn (cần 10.000 điểm)'), 'the hint under the controls').toBeVisible()
  await mySeat(page).getByRole('button', { name: /Ngồi vào bàn/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Số dư không đủ' }), 'the refusal').toBeVisible()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toHaveCount(0)
  const charged = (await ledgerSince(page, rowsBefore)).filter((row) => row.reason !== 'achievement')
  expect(charged, `nothing charged (the balance was ${balance})`).toEqual([])
  await leave(page)
})

