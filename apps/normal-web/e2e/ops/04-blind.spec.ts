import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  autopilot,
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  expectMyNameWhole,
  expectMySeatLines,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  expectRoomFits,
  handOver,
  historyOf,
  joinByCode,
  keepPlaying,
  ledgerOf,
  ledgerSince,
  newPlayer,
  PHONE_SCREEN,
  postApi,
  promoteToGm,
  ready,
  resultCard,
  settled,
  start,
  statsOf,
  sumOf,
  takeSeat,
  touchDrag,
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
/** The result card of a hand that was played out — it has a winner — and not "Ván bị hủy", which `resultCard` takes as well. */
const winnerCard = (page: Page) => page.getByRole('group', { name: 'Người thắng', exact: true })

test('F-01 F-02 H-01: pure luck, three cards — the ante goes in, nobody decides, and the ledger writes the buy-in and the cash-out', async () => {
  const before = await balanceOf(a.page)
  const rowsBefore = (await ledgerOf(a.page)).length
  await createBlind(a.page, { name: unique('Bàn F01 '), bots: 2, mode: 'Hoàn toàn may rủi', cards: 3 })
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
  await a.page.getByRole('button', { name: 'Tạm nghỉ' }).click()
  await b.page.getByRole('button', { name: 'Tạm nghỉ' }).click()
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
  await a.page.getByRole('button', { name: 'Tạm nghỉ' }).click()
  await b.page.getByRole('button', { name: 'Tạm nghỉ' }).click()
  const cardText = (await resultCard(a.page).innerText()).replace(/\s+/g, ' ')
  expect(cardText, 'the card returns her uncalled play').toContain('Hoàn cược dư cho')
  // No11b: the winner's card, the uncalled play handed back on it — no text over text.
  await expectNoTextOverlapAt(a.page, 'Blind, result card, an uncalled play returned')
  await expect(faceUp(a.page.getByRole('group', { name: 'Bài chung' })), 'no board is dealt').toHaveCount(0)
  await expect(faceUp(mySeat(a.page, 1)), "Em's cards stay face down").toHaveCount(0)
  await leave(a.page)
  await leave(b.page)
  // Spec §8.3: Đào's play went uncalled, so it comes straight back before the pot is figured. The pot is the two
  // antes, 2.000, and she takes all of it: Blind has no table fee (plan 27). Her balance was read after the buy-in, so
  // what comes home when she leaves is the stack: the 5.000 she brought, less her 1.000 ante, plus the 2.000. (Plus
  // any achievement the win completed, e.g. a third win in a row.)
  await balanceWhen(a.page, (n) => n !== aBefore)
  const fresh = await ledgerSince(a.page, aRows)
  expect(sumOf(fresh, 'cash_out'), `result card: ${cardText}`).toBe(5_000 - 1_000 + 2_000)
  expect((await balanceOf(a.page)) - aBefore, 'the cash-out and any rewards are the whole move').toBe(sumOf(fresh))
})

test('F-08 (T3): the host asks a bot to leave', async () => {
  // Finding T3 of the 2026-09-28 run: "Quản lý bàn" offered "Đuổi" beside every bot, but the server refused to kick
  // a bot. Now a bot goes between hands like anyone else: off the list, off its seat, and the seat is free.
  await createBlind(a.page, { name: unique('Bàn F08 '), bots: 2, mode: 'Chơi hoặc bỏ' })
  await expect(a.page.locator('[data-seat]').filter({ hasText: 'Bot 1' })).toHaveCount(1)
  await a.page.getByRole('button', { name: 'Quản lý bàn' }).click()
  const dialog = a.page.getByRole('dialog', { name: 'Người trong phòng' })
  await dialog.getByRole('button', { name: 'Mời ra — Bot 1' }).click()
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
  // Auto-play pays to play every hand, so a run of lost hands takes the 5.000 down to 0 and stands the seat up (F-10):
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

test('F-10: a Blind seat plays down to zero and is stood up with the Cứu trợ nudge', async ({ browser }) => {
  test.setTimeout(360_000)
  // Plan 27 D2: one wager seats a player, a short seat is dealt and goes all in for what it has ("Tất tay N"), and a
  // seat is stood up only at 0 — with a notice that points at Cứu trợ. A GM first brings Em's balance down to 2.500,
  // so the seat brings all of it: below the 5.000 limit, above the one wager it needs.
  //
  // Em plays this one, not Đào: F-09 left Đào's auto-play table mid-hand, and her stack comes home only when that hand
  // ends — a cash-out that could land inside this case's money checks. Em's last table (F-06) was left between hands.
  // (It also keeps Đào's Blind hand count below ten for K-02, which is the case that has to reach it.) Em leaves this
  // case at 0, which H-02 below wants anyway: it needs a balance under the relief line.
  const page = b.page
  const gm = await newPlayer(browser, 'GmF10')
  try {
    await promoteToGm(gm.page, gm.who.email)
    const me = (await (await page.request.get('/api/me')).json()) as { playerId: string; balance: number }
    if (me.balance !== 2_500) {
      const adjusted = await postApi(gm.page, `/api/gm/players/${me.playerId}/points`, { amount: 2_500 - me.balance, reason: 'F-10: số dư nhỏ để chơi về 0' })
      expect(adjusted.status, 'the GM adjustment').toBe(200)
    }
    expect(await balanceWhen(page, (n) => n === 2_500), 'the balance the case starts from').toBe(2_500)
  } finally {
    await closeAll([gm])
  }
  const rowsBefore = (await ledgerOf(page)).length
  await createBlind(page, { name: unique('Bàn F10 '), bots: 1, mode: 'Chơi hoặc bỏ', wager: '1.000' })
  await expect(page.locator('header').first().getByText(/Hạn mức 5\.000/)).toBeVisible()
  await takeSeat(page, 0)
  expect(await balanceWhen(page, (n) => n === 0), 'the seat took the whole 2.500').toBe(0)
  await ready(page)
  await start(page)

  // Hand 1: 1.500 is left after the ante, enough for the 1.000 play — the button is the plain "Chơi". Em folds it.
  const bar = page.getByRole('group', { name: 'Hành động' })
  const action = (text: RegExp) => bar.locator('button:not([aria-pressed])', { hasText: text })
  await expect(action(/^Chơi 1\.000$/), 'a full play').toBeVisible({ timeout: 30_000 })
  await action(/^Bỏ bài$/).click()
  await expect(resultCard(page)).toBeVisible({ timeout: 30_000 })

  // Hand 2: the ante leaves 500, short of the wager — the play goes all in for it, and the button says so.
  const allIn = action(/^Tất tay 500$/)
  await expect(allIn, '"Tất tay 500" instead of "Chơi"').toBeVisible({ timeout: 30_000 })
  await expect(action(/^Chơi/)).toHaveCount(0)
  await allIn.click()

  // From here: fold whatever can be folded and play all in whatever cannot, so every hand costs at least its ante and
  // the stack only grows by winning an all-in. A loss there ends it; thirty hands is the cap.
  const notice = page.getByText(/Bạn đã hết điểm ở bàn này/)
  const handsBefore = (await historyOf(page)).length
  let nextLook = 0
  let capped = false
  await autopilot(page, ['allIn', 'fold'], async () => {
    if ((await notice.count()) > 0) return true
    if (Date.now() < nextLook) return false
    nextLook = Date.now() + 5_000
    capped = (await historyOf(page)).length - handsBefore >= 30
    return capped
  }, 300_000)
  test.skip(capped, 'thirty hands without losing an all-in: run the case again')
  await expect(notice).toContainText('Nhận Cứu trợ nếu số dư dưới 5.000 điểm')
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'no longer seated').toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rời phòng' }), 'still in the room').toBeVisible()
  // Nothing was left on the table, so nothing came home: the buy-in is the whole move, and the balance is 0.
  const fresh = (await ledgerSince(page, rowsBefore)).filter((row) => row.reason !== 'achievement')
  expect(fresh.map((row) => [row.reason, row.amount])).toEqual([['buy_in', -2_500]])
  expect(await balanceOf(page), 'all of it was played').toBe(sumOf(await ledgerSince(page, rowsBefore), 'achievement'))
  // A spectator with less than one wager is told what a seat needs before trying.
  await expect(page.getByText('Số dư không đủ để vào bàn (cần 1.000 điểm)'), 'the hint under the controls').toBeVisible()
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
  // Lose on purpose: one play-or-fold hand at a time, folded, each at the biggest stake the balance covers twice (one
  // stake seats a player since plan 27, but a seat whose ante took it all would be played for, not folded), until the
  // balance is under the relief line. Pure luck would not do: one lucky pot at a table of six pays 294.000. (F-10
  // leaves Em at 0, so this loop usually has nothing to do.)
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
    // The fold left at least one stake on the table (the seat brought two or more), so the seat stays (F-10 stands a
    // seat up only at 0): sit out, so the leave cannot land in the next deal.
    expect(brought - stake, 'points left on the table').toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Tạm nghỉ' }).click()
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
  // seated player plays on down to 0 and is stood up there instead — F-10.)
  // "Nothing charged" is read off the ledger rather than the balance: every room Em creates counts towards "Mười
  // phòng" since T6, and the room below may be the one that pays it.
  const rowsBefore = (await ledgerOf(page)).length
  await createBlind(page, { name: unique('Bàn F07 '), bots: 1, mode: 'Hoàn toàn may rủi', wager: '10.000' })
  // Spec 2026-09-29: a spectator who cannot cover a seat is told so before trying; the refusal still says it in words.
  await expect(page.getByText('Số dư không đủ để vào bàn (cần 10.000 điểm)'), 'the hint under the controls').toBeVisible()
  await mySeat(page).getByRole('button', { name: /Ngồi vào bàn/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Số dư không đủ' }), 'the refusal').toBeVisible()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toHaveCount(0)
  const charged = (await ledgerSince(page, rowsBefore)).filter((row) => row.reason !== 'achievement')
  expect(charged, `nothing charged (the balance was ${balance})`).toEqual([])
  await leave(page)
})

test('F-11: a squeeze table — one peels by hand, the other presses Lật, and the round ends before its 20 s', async ({ browser }) => {
  test.setTimeout(180_000)
  // A second player on a laptop's 1366 × 768, with an account of its own: the case does not depend on what H-02 left of Em's balance.
  const sq = await newPlayer(browser, 'sq', { width: 1366, height: 768 })
  const aScreen = a.page.viewportSize()
  try {
    const code = await createBlind(a.page, { name: unique('Bàn F11 '), bots: 0, mode: 'Hoàn toàn may rủi', squeeze: true })
    await expect(a.page.locator('header').getByText('Nặn bài', { exact: true })).toBeVisible()
    await joinByCode(sq.page, code)
    await takeSeat(a.page, 0)
    await takeSeat(sq.page, 1)
    await ready(a.page)
    await ready(sq.page)
    // The ops desktop project is 1440 × 900; the user's own screen is 1920 × 940 (set before the hand: a resize in the
    // round could switch the layout and remount the seat).
    await a.page.setViewportSize({ width: 1920, height: 940 })
    const t0 = Date.now()
    await start(a.page)

    // Both see their own cards face down, the hint says squeeze, and the round's timer is on their own plate.
    const mine = a.page.locator('[data-me="true"] [data-peel]')
    const his = sq.page.locator('[data-me="true"] [data-peel]')
    await expect(mine).toHaveCount(2)
    await expect(his).toHaveCount(2)
    await expect(mine.first()).toHaveAttribute('data-face', 'down')
    await expect(his.first()).toHaveAttribute('data-face', 'down')
    await expect(a.page.getByText('Mời nặn bài')).toBeVisible()
    await expect(sq.page.getByText('Mời nặn bài')).toBeVisible()
    await expect(a.page.locator('[data-me="true"]').getByRole('timer')).toBeVisible()
    await expect(sq.page.locator('[data-me="true"]').getByRole('timer')).toBeVisible()
    await settled(mine.first())
    await settled(mine.last())
    await a.page.screenshot({ path: 'test-results/shots/1920x940-squeeze-dealt.png' })

    // Đào peels both cards from the bottom edge, with the mouse. Each card must open by its own drag: the 5 s bounds make a
    // dead drag fail as itself, not turn green at the 20 s mark on the server's forced turn and fail later on the clock.
    for (const i of [0, 1]) {
      const box = (await mine.nth(i).boundingBox())!
      const x = box.x + box.width / 2
      await a.page.mouse.move(x, box.y + box.height - 4)
      await a.page.mouse.down()
      await a.page.mouse.move(x, box.y + box.height * 0.55, { steps: 8 })
      await expect(mine.nth(i)).toHaveAttribute('data-face', 'peeling', { timeout: 5_000 })
      if (i === 0) await a.page.screenshot({ path: 'test-results/shots/1920x940-squeeze-peeling.png' })
      await a.page.mouse.move(x, box.y + box.height * 0.25, { steps: 8 })
      await a.page.mouse.up()
      await expect(mine.nth(i)).toHaveAttribute('data-face', 'up', { timeout: 5_000 })
      if (i === 0) {
        // One card up does not turn the seat: the other is still down, Đào's tray still waits, and the other player does
        // not see her seat turned (the seat is told once, when its last card is up).
        await expect(mine.nth(1)).toHaveAttribute('data-face', 'down')
        await expect(a.page.getByText('Mời nặn bài')).toBeVisible()
        await expect(sq.page.locator('[data-seat="0"]').getByText('Đã lật')).toHaveCount(0)
      }
    }
    await expect(faceUp(a.page.locator('[data-me="true"]'))).toHaveCount(2)
    await expect(a.page.getByText('Đã lật — chờ người chơi khác')).toBeVisible()
    // The other sees Đào's seat turned, and presses Lật instead.
    await expect(sq.page.locator('[data-seat="0"]').getByText('Đã lật')).toBeVisible()
    await sq.page.getByRole('button', { name: 'Lật', exact: true }).click()

    // Their own two cards turn where they lie, and the round ends: the flop comes, and the result is out well before the
    // 20 s would have run.
    await expect(faceUp(sq.page.locator('[data-me="true"]'))).toHaveCount(2)
    await expect.poll(() => faceUp(sq.page.getByRole('group', { name: 'Bài chung' })).count(), { message: 'the flop is on the felt' }).toBeGreaterThanOrEqual(3)
    await expect(winnerCard(a.page)).toBeVisible({ timeout: 15_000 })
    expect(Date.now() - t0).toBeLessThan(20_000)
    await sq.page.screenshot({ path: 'test-results/shots/1366x768-squeeze-result.png' })
    await leave(a.page)
  } finally {
    if (aScreen !== null) await a.page.setViewportSize(aScreen).catch(() => undefined)
    await closeAll([sq])
  }
})

/** F-12 and F-12b: a squeeze table on the mobile project's phone (375 × 812, touch), from the deal to the winner card. */
async function squeezeFitsPhone({ id, mode, what, shot }: { id: string; mode: 'Hoàn toàn may rủi' | 'Chơi hoặc bỏ'; what: string; shot: string }) {
  // The mobile project's own phone: 375 × 812, with a touch screen (`a` is made in this project's context).
  const page = a.page
  expect(page.viewportSize(), 'the mobile project’s phone').toEqual(PHONE_SCREEN)
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'a touch screen').toBeGreaterThan(0)

  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 1, mode, squeeze: true })
  await expect(page.locator('header').getByText('Nặn bài', { exact: true })).toBeVisible()
  await takeSeat(page, 0)
  await ready(page)
  const t0 = Date.now()
  await start(page)

  const mine = page.locator('[data-me="true"] [data-peel]')
  const pill = page.getByRole('button', { name: 'Lật', exact: true })
  const timer = page.locator('[data-me="true"]').getByRole('timer')
  await expect(mine).toHaveCount(2)
  await expect(pill).toBeVisible()
  await expect(timer).toBeVisible()
  // The hint belongs to the pure-luck table; a play-or-fold one asks for its choice in the tray instead.
  if (mode === 'Hoàn toàn may rủi') await expect(page.getByText('Mời nặn bài')).toBeVisible()
  await settled(mine.first())
  await settled(mine.last())

  // Both cards, the pill and the timer sit whole inside the screen, above the tray (which covers the foot of the stage).
  const tray = (await page.locator('footer').last().boundingBox())!
  const parts: [string, Locator][] = [['card 1', mine.first()], ['card 2', mine.last()], ['the Lật pill', pill], ['the timer', timer]]
  for (const [label, part] of parts) {
    const box = await part.boundingBox()
    expect(box, `${label} has a box`).not.toBeNull()
    expect(box!.x, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.y, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label} ends inside the screen`).toBeLessThanOrEqual(PHONE_SCREEN.width)
    expect(box!.y + box!.height, `${label} ends above the tray`).toBeLessThanOrEqual(tray.y + 1)
  }
  // And the room holds on the phone: nothing scrolls sideways, neither the page nor the stage scrolls down, the viewer's
  // plate keeps to its lines with the name whole beside the round's timer, and no text lands on text.
  await expectNoSidewaysScroll(page)
  await expectRoomFits(page, `${what} table, dealt`, [PHONE_SCREEN])
  await expectMySeatLines(page, a.who.displayName, `${what} table, dealt`)
  await expectMyNameWhole(page, a.who.displayName, `${what} table, dealt`, [PHONE_SCREEN])
  await expectNoTextOverlapAt(page, `Blind, ${what}, dealt`)
  await page.screenshot({ path: `test-results/shots/375x812-${shot}-dealt.png` })
  // The overlap check above ran under reduced motion; motion back on deals the cards from the deck again (`settled`).
  await settled(mine.first())
  await settled(mine.last())

  // One card by finger: from its bottom-left corner, along the diagonal, past the middle. Pointer Events of type `touch`.
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(globalThis, { pointerTypes: seen })
    addEventListener('pointerdown', (e) => seen.push(e.pointerType), true)
  })
  const card = (await mine.first().boundingBox())!
  const corner = { x: card.x + 4, y: card.y + card.height - 4 }
  const cdp = await a.context.newCDPSession(page)
  await touchDrag(cdp, corner, { x: corner.x + (card.width - 8) * 0.8, y: corner.y - (card.height - 8) * 0.8 }, async () => {
    await expect(mine.first()).toHaveAttribute('data-face', 'peeling', { timeout: 5_000 })
    await page.screenshot({ path: `test-results/shots/375x812-${shot}-peeling.png` })
  })
  // 5 s: a drag that did not take must fail as itself, not wait for the server's forced turn at 20 s.
  await expect(mine.first()).toHaveAttribute('data-face', 'up', { timeout: 5_000 })
  expect(await page.evaluate(() => (globalThis as unknown as { pointerTypes: string[] }).pointerTypes), 'the press was a touch').toEqual(['touch'])
  // One card up does not turn the seat: the other is still down, the pill and the tray still wait for it.
  await expect(mine.last()).toHaveAttribute('data-face', 'down')
  await expect(pill).toBeEnabled()
  if (mode === 'Hoàn toàn may rủi') await expect(page.getByText('Mời nặn bài')).toBeVisible()

  // The pill, by tap, turns the other one; with the bot already turned the round ends on the human's turn.
  await pill.tap()
  await expect(mine.last()).toHaveAttribute('data-face', 'up', { timeout: 5_000 })
  await expect(faceUp(page.locator('[data-me="true"]'))).toHaveCount(2)
  // A play-or-fold table asks for the choice after the peel; the round then ends on the human's Chơi. A board is dealt only
  // when both play: a bot that folds hands the pot to the human at once, with no flop (F-06), so there the card is the end.
  if (mode === 'Chơi hoặc bỏ') await page.getByRole('button', { name: /^Chơi\b/ }).click()
  else await expect.poll(() => faceUp(page.getByRole('group', { name: 'Bài chung' })).count(), { message: 'the flop is on the felt' }).toBeGreaterThanOrEqual(3)
  await expect(winnerCard(page)).toBeVisible({ timeout: 15_000 })
  expect(Date.now() - t0).toBeLessThan(20_000)
  await leave(page)
}

test('F-12: @mobile the squeeze fits a phone — the viewer’s cards, the Lật pill and the timer are on screen', async () => {
  test.setTimeout(180_000)
  await squeezeFitsPhone({ id: 'F12', mode: 'Hoàn toàn may rủi', what: 'a squeeze', shot: 'squeeze' })
})

// Plan 26 (B6): the play-or-fold squeeze has the header's gold badge and the viewer's Lật pill too; both used to cost a row,
// and the stage scrolled 11 px in the round.
test('F-12b: @mobile the play-or-fold squeeze also fits a phone — no 11 px scroll in the round', async () => {
  test.setTimeout(180_000)
  await squeezeFitsPhone({ id: 'F12b', mode: 'Chơi hoặc bỏ', what: 'a play-or-fold squeeze', shot: 'squeeze-pof' })
})

