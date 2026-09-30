import { expect, test, type Page } from '@playwright/test'
import {
  autopilot,
  balanceOf,
  balanceWhen,
  closeAll,
  createHoldemRoom,
  expectNoTextOverlapAt,
  feeOn,
  handOver,
  historyOf,
  joinByCode,
  ledgerOf,
  newPlayer,
  OVERLAP_SCREENS,
  PHONE_SCREEN,
  ready,
  resultCard,
  start,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * Operation test plan §5.E (a Hold'em table) and §5.H-03 (conservation), with three real players in three
 * browsers. Blinds 100/200, a 15-second clock so the time-out cases take seconds rather than minutes.
 */

test.describe.configure({ mode: 'serial' })

const BB = 200
let a: Player
let b: Player
let c: Player

test.beforeAll(async ({ browser }) => {
  a = await newPlayer(browser, 'An')
  b = await newPlayer(browser, 'Binh')
  c = await newPlayer(browser, 'Chi')
})

test.afterAll(async () => {
  await closeAll([a, b, c])
})

const acts = (page: Page) => page.getByRole('group', { name: 'Hành động' })
const standUp = (page: Page) => page.getByRole('button', { name: 'Đứng dậy', exact: true })

/**
 * No11b: the only Hold'em hands any e2e plays are this file's, so the text-overlap rule reads them at the pack's own
 * size and at the three the default e2e holds every screen to — the user's 1920 × 940, a 1366 × 768 laptop and a
 * 375 × 812 phone. The page's own size comes back afterwards. All four reads take about a second.
 */
const holdemSizes = (page: Page) => [page.viewportSize() ?? { width: 1440, height: 900 }, ...OVERLAP_SCREENS, PHONE_SCREEN]

async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

test('E-01 E-02 E-03 E-12 E-07 E-08: buy in, play a hand out, the next deals itself, three time-outs stand a player up', async () => {
  test.setTimeout(480_000)
  const code = await createHoldemRoom(a.page, { name: unique('Bàn E '), timer: '15 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(b.page, code)
  await joinByCode(c.page, code)

  // E-01: the buy-in leaves the balance at once.
  await takeSeat(a.page, 0, 10_000)
  expect(await balanceWhen(a.page, (n) => n === 90_000), 'E-01: 100.000 − 10.000').toBe(90_000)
  // E-02: nobody ready — Start is off and says why.
  await expect(a.page.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeDisabled()
  await expect(a.page.getByText('Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một người chơi thật.')).toBeVisible()

  await takeSeat(b.page, 1, 20_000)
  await takeSeat(c.page, 2, 40_000)
  await ready(a.page)
  await ready(b.page)
  await ready(c.page)
  await start(a.page)

  // E-03: everyone checks or calls to the river; a result card with a fee within the cap.
  await Promise.all([a, b, c].map((p) => autopilot(p.page, ['check', 'call'], handOver(p.page))))
  const card = resultCard(a.page)
  await expect(card).toBeVisible()
  const fee = await feeOn(card)
  expect(fee, 'the fee is at most one big blind').toBeLessThanOrEqual(BB)

  // E-12: the next hand deals itself a few seconds later.
  await expect(a.page.getByText(/Ván tiếp theo sau/).first()).toBeVisible({ timeout: 6_000 })
  // No11b: the Hold'em result card counting down to that deal — no text over text (the next deal waits for no one).
  await expectNoTextOverlapAt(a.page, 'Hold’em, result card counting down', holdemSizes(a.page))
  await expect(acts(a.page)).toBeVisible({ timeout: 12_000 })

  // E-07 + E-08: Bình stops pressing anything. His turns time out (check where he may, fold where he must), and
  // after the hand holding his third straight time-out he is stood up, his stack back in his balance.
  const idle = autopilot(a.page, ['check', 'call'], async () => (await standUp(b.page).count()) === 0, 300_000)
  const idleToo = autopilot(c.page, ['check', 'call'], async () => (await standUp(b.page).count()) === 0, 300_000)
  // E-07 has no mark of its own on the seat (a timed-out check looks like a check); what proves it is that the
  // hands keep finishing while Bình never presses a thing — and E-08 below only passes after three of them.
  const handsBefore = (await historyOf(a.page)).length
  await Promise.all([idle, idleToo])
  expect((await historyOf(a.page)).length, 'E-07: hands went on around the idle player').toBeGreaterThan(handsBefore)
  await expect(standUp(b.page), 'E-08: stood up after three time-outs').toHaveCount(0)
  const bBalance = await balanceWhen(b.page, (n) => n > 80_000)
  expect(bBalance, "E-08: Bình's stack is back in his balance").toBeGreaterThan(80_000)

  // Everyone out; stacks go home.
  await leave(a.page)
  await leave(b.page)
  await leave(c.page)
})

test('E-05: three all-ins of different sizes make a side pot', async () => {
  const code = await createHoldemRoom(a.page, { name: unique('Bàn pot phụ '), timer: '15 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(b.page, code)
  await joinByCode(c.page, code)
  await takeSeat(a.page, 0, 10_000)
  await takeSeat(b.page, 1, 20_000)
  await takeSeat(c.page, 2, 40_000)
  for (const p of [a, b, c]) await ready(p.page)
  await start(a.page)

  await Promise.all([
    autopilot(a.page, ['allIn', 'call', 'check'], handOver(a.page)),
    autopilot(b.page, ['allIn', 'call', 'check'], handOver(b.page)),
    autopilot(c.page, ['call', 'check'], handOver(c.page)),
  ])
  const card = resultCard(c.page)
  // The ledger sits under the rows, and the card scrolls inside itself once it is taller than the felt: each line is
  // scrolled to first, and must then be on screen — reachable, not merely somewhere in the DOM.
  const main = card.getByText('Pot chính')
  await main.scrollIntoViewIfNeeded()
  await expect(main).toBeVisible()
  await expect(main).toBeInViewport()
  const side = card.getByText('Pot phụ 1')
  await side.scrollIntoViewIfNeeded()
  await expect(side, 'the short all-in cannot win the deeper stacks’ extra').toBeVisible()
  await expect(side).toBeInViewport()
  // No11b: the card, text clear of text — its pot ledger scrolled into view at the pack's size, and read at the other
  // sizes as the resize leaves it. (Should a short stack that won the main pot be dealt in again five seconds on, a
  // late read sees that hand instead: still a Hold'em table, still held to the rule.)
  await expectNoTextOverlapAt(c.page, 'Hold’em, result card with a side pot', holdemSizes(c.page))
  for (const p of [a, b, c]) await leave(p.page)
})

test('E-10 E-11: leaving mid-hand folds and settles after; standing up between hands returns the stack at once', async () => {
  const code = await createHoldemRoom(a.page, { name: unique('Bàn rời '), timer: '15 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0, 10_000)
  await takeSeat(b.page, 1, 10_000)
  const bBefore = await balanceOf(b.page)
  await ready(a.page)
  await ready(b.page)
  await start(a.page)
  await expect(acts(b.page)).toBeVisible()
  // No11b: a Hold'em hand in play, the tray up — the one hand shape the default e2e (Blind only) never shows.
  await expectNoTextOverlapAt(b.page, 'Hold’em, in hand, the tray up', holdemSizes(b.page))

  // E-10: Bình walks out with cards in hand: he folds, and his stack reaches his balance once the hand is over.
  // An keeps playing meanwhile — heads-up she may be first to act, and an idle An would time out into a fold.
  await leave(b.page)
  await autopilot(a.page, ['check', 'call'], handOver(a.page), 60_000)
  await expect(resultCard(a.page)).toBeVisible()
  const bAfter = await balanceWhen(b.page, (n) => n > bBefore)
  expect(bAfter - bBefore, 'E-10: the stack came home, less at most his blind').toBeGreaterThanOrEqual(10_000 - BB)

  // E-11: An stands up between hands — no other player, no next hand — and the stack is back at once.
  const aBefore = await balanceOf(a.page)
  await standUp(a.page).click()
  const aAfter = await balanceWhen(a.page, (n) => n > aBefore, 10_000)
  expect(aAfter - aBefore, 'E-11: the whole stack').toBeGreaterThanOrEqual(10_000)
  await leave(a.page)
})

test('E-06: a player who only ever arms "Theo mọi mức" plays a whole hand without one time-out', async () => {
  const code = await createHoldemRoom(a.page, { name: unique('Bàn E06 '), timer: '15 giây', tier: '100/200', minBB: 50, maxBB: 200 })
  await joinByCode(c.page, code)
  await takeSeat(a.page, 0, 10_000)
  await takeSeat(c.page, 1, 10_000)
  await ready(a.page)
  await ready(c.page)
  const began = Date.now()
  await start(a.page)

  // Chi (re-)arms the call-any toggle whenever it is showing and off, and presses a real button only when her turn
  // arrives with nothing armed — which can happen once, heads-up, if she is first to act before she could arm.
  const armed = c.page.getByRole('group', { name: 'Trước lượt của bạn' }).getByRole('button', { name: 'Theo mọi mức' })
  const bar = c.page.getByRole('group', { name: 'Hành động' })
  const manual = bar.locator('button:not([aria-pressed])', { hasText: /^(Xem|Theo( [\d.]+)?)$/ })
  let pressed = 0
  // Every click is bounded: the toggle row is hidden the moment Chi's turn arrives, and an unbounded click on a
  // button that has just gone waits for it to come *back* — one whole turn later, after her clock ran out. That race
  // (re-arming as a new street is dealt) failed this case once in the 2026-09-29 review run with an 18-second hand.
  const QUICK = { timeout: 500 }
  const arming = (async () => {
    while ((await resultCard(c.page).count()) === 0) {
      if ((await armed.count()) > 0) {
        if ((await armed.getAttribute('aria-pressed', QUICK).catch(() => null)) === 'false') await armed.click(QUICK).catch(() => undefined)
      } else if ((await manual.count()) > 0 && (await manual.first().isEnabled(QUICK).catch(() => false))) {
        if (await manual.first().click(QUICK).then(() => true, () => false)) pressed++
      }
      await c.page.waitForTimeout(150)
    }
  })()
  await Promise.all([autopilot(a.page, ['check', 'call'], handOver(a.page)), arming])
  // A check-down hand gives Chi exactly four turns, one a street. Heads-up, whoever is first to act on a street
  // cannot arm before it (the button preflop, the big blind after the flop), so she presses one or three of them
  // herself, never all four; the rest were answered by the armed toggle — and none waited out its clock (one
  // 15-second time-out would pass the time bound below).
  await expect(resultCard(c.page)).toBeVisible()
  expect(pressed, 'the armed toggle answered at least one of her four turns').toBeLessThanOrEqual(3)
  await expect(c.page.getByRole('group', { name: 'Bài chung' }).getByRole('img')).toHaveCount(5)
  expect(Date.now() - began, 'no turn waited out its clock').toBeLessThan(15_000)
  await leave(a.page)
  await leave(c.page)
})

test('H-03: every Hold’em hand of the run conserves points — the nets of its seats sum to minus a fee of at most 1 BB', async () => {
  const seen = new Map<string, number>()
  for (const p of [a, b, c]) {
    for (const hand of await historyOf(p.page)) {
      if (hand.mode !== 'holdem' || hand.cancelled) continue
      seen.set(hand.handId, hand.players.reduce((sum, seat) => sum + seat.net, 0))
    }
  }
  expect(seen.size, 'the run played several Hold’em hands').toBeGreaterThanOrEqual(4)
  for (const [handId, total] of seen) {
    expect(-total, `hand ${handId}: the fee is what the seats lost together`).toBeGreaterThanOrEqual(0)
    expect(-total, `hand ${handId}: and at most one big blind`).toBeLessThanOrEqual(BB)
  }
  // And the balances agree with the ledger and with the history. Hold'em writes no row per hand — chips move on
  // the table, the ledger sees the buy-in and the cash-out — so a player who has left every table holds
  // 100.000, plus every hand's net, plus whatever the ledger credited outside the table (an achievement won along
  // the way, a daily reward).
  const OFF_TABLE = new Set(['achievement', 'daily_reward', 'daily_login', 'daily_item_fallback', 'relief', 'refund'])
  for (const p of [a, b, c]) {
    const balance = await balanceOf(p.page)
    const ledger = await ledgerOf(p.page)
    expect(ledger.reduce((sum, row) => sum + row.amount, 0), `${p.who.displayName}: the ledger sums to the balance`).toBe(balance)
    const credited = ledger.filter((row) => OFF_TABLE.has(row.reason)).reduce((sum, row) => sum + row.amount, 0)
    const nets = (await historyOf(p.page)).filter((h) => !h.cancelled).reduce((sum, h) => sum + h.net, 0)
    expect(balance - credited, `${p.who.displayName}: 100.000 plus every hand's net`).toBe(100_000 + nets)
  }
})
