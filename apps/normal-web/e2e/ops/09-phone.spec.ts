import { expect, test, type Locator, type Page } from '@playwright/test'
import { shot } from '../support.js'
import {
  account,
  closeAll,
  closeRoomMenu,
  createBlind,
  createHoldemRoom,
  expectNoTextOverlapAt,
  expectRoomFits,
  joinByCode,
  newPlayer,
  openBetPanel,
  openRoomMenu,
  PHONE_SCREEN,
  raiseButton,
  ready,
  registerPatiently,
  resultCard,
  setBet,
  settled,
  start,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * BP-31 (spec 2026-10-23 §3.1–3.2, §4): the table on a phone held upright — the `mobile` project, 375 × 812 with a touch
 * screen, which the room draws in its stack layout. My cards fan out over the felt's foot, my seat is a one-line strip,
 * the hand's tray is one row of 44 px buttons, a raise opens a panel of chips over a slider behind "Tố ▴", and the seat's
 * own controls live in the header's "Thêm" menu, with Sẵn sàng and Bắt đầu in a dock between hands.
 */

/** The room's own header — the one holding the room's code. */
const roomHeader = (page: Page) => page.locator('header').filter({ has: page.getByLabel('Mã phòng') })
const tray = (page: Page) => page.getByRole('group', { name: 'Hành động' })
const dock = (page: Page) => page.getByRole('group', { name: 'Điều khiển bàn' })
/** My fanned cards: each card under the fan, never the squeeze's Lật pill (a button) when a peel hand is dealt. */
const fanCards = (page: Page) => page.locator('[data-me="true"] [data-fan] > :not(button)')
/** The fan itself — what `settled` waits on: my strip's turn ring keeps animating while the clock runs. */
const myHand = (page: Page) => page.locator('[data-me="true"] [data-fan]')
/** The pot's box on the felt: the word "Pot" and its figure. */
const potBox = (page: Page) => page.getByText('Pot', { exact: true }).locator('..')
/** The opponents' chips above the felt, each a seat group ("Ghế N"). */
const opponentChips = (page: Page) => page.getByRole('group', { name: 'Người chơi', exact: true }).locator('[role="group"][aria-label^="Ghế"]')

/** `formatPoints` in Vietnamese: a dot between thousands. */
const vnd = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

async function leave(page: Page): Promise<void> {
  await roomHeader(page).getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

/** The tray's height on screen: one row of `size="md"` buttons with its 8 / 12 px padding is at most 64 px. */
async function expectOneRowTray(page: Page, state: string): Promise<void> {
  const box = await tray(page).boundingBox()
  expect(box, `${state}: the tray has a box`).not.toBeNull()
  expect(box!.height, `${state}: the tray is one row (${Math.round(box!.height)} px)`).toBeLessThanOrEqual(64)
}

/** Every one of my cards is at least 52 px wide — `offsetWidth`, the card's own width: a rotated card's box is wider. */
async function expectBigCards(page: Page, count: number, state: string): Promise<void> {
  await expect(fanCards(page), `${state}: my cards are fanned`).toHaveCount(count)
  const widths = await fanCards(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetWidth))
  for (const [i, width] of widths.entries()) expect(width, `${state}: my card ${i + 1} is at least 52 px wide`).toBeGreaterThanOrEqual(52)
}

interface Box {
  label: string
  top: number
  bottom: number
  left: number
  right: number
}

async function boxesOf(locator: Locator, kind: string): Promise<Box[]> {
  const raw = await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
  return raw.map((r, i) => ({ label: `${kind} ${i + 1}`, top: r.top, bottom: r.bottom, left: r.left, right: r.right }))
}

const meets = (p: Box, q: Box): boolean => p.bottom > q.top + 0.5 && p.top < q.bottom - 0.5 && p.right > q.left + 0.5 && p.left < q.right - 0.5
const fmt = (box: Box): string => `${box.label} [${Math.round(box.left)},${Math.round(box.top)} → ${Math.round(box.right)},${Math.round(box.bottom)}]`

/** The pot is clear of my fanned cards and of every opponent's chip. */
async function expectPotClear(page: Page, state: string): Promise<void> {
  const [pot] = await boxesOf(potBox(page), 'the pot')
  expect(pot, `${state}: the pot is on the felt`).toBeDefined()
  const others = [...(await boxesOf(fanCards(page), 'my card')), ...(await boxesOf(opponentChips(page), 'an opponent’s chip'))]
  expect(others.length, `${state}: there is something to measure the pot against`).toBeGreaterThan(0)
  const problems = others.filter((box) => meets(pot!, box)).map((box) => `${fmt(pot!)} meets ${fmt(box)}`)
  expect(problems, `${state}:\n  ${problems.join('\n  ')}`).toEqual([])
}

test('M-06 the phone table: one-row tray, fanned cards, the bet panel and the header menu @mobile', async ({ page, context, browser }) => {
  test.setTimeout(420_000)
  expect(page.viewportSize(), 'the mobile project’s phone').toEqual(PHONE_SCREEN)
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'a touch screen').toBeGreaterThan(0)
  // The project's own phone is the host; a second account (also at 375 × 812) makes the Hold'em hand, which bots never join.
  const me: Player = { who: account('Dien'), context, page }
  await registerPatiently(page, me.who)
  let them: Player | undefined
  try {
    them = await newPlayer(browser, 'Thoai', PHONE_SCREEN)

    // ── 1. Hold'em heads-up: the header menu, the dock, the one-row tray and the bet panel ──────────────────────────────
    const code = await createHoldemRoom(page, { name: unique('Bàn M06 '), tier: '100/200', timer: '60 giây' })
    await joinByCode(them.page, code)
    await expect(them.page).toHaveURL(/#\/room$/)
    await takeSeat(page, 0, undefined, { via: 'menu' })
    await takeSeat(them.page, 1, undefined, { via: 'menu' })
    await expect(page.locator('[data-layout="stack"]').first(), 'the phone takes the stack layout').toBeVisible()

    // Between hands: no row of controls under the felt — "Đứng dậy" lives in the header's menu, with Tạm nghỉ and the
    // host's Quản lý bàn — and the dock holds Sẵn sàng and Bắt đầu.
    await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'no "Đứng dậy" button outside the menu').toHaveCount(0)
    const menu = await openRoomMenu(page)
    await expect(menu.getByRole('menuitem', { name: 'Đứng dậy', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ', exact: true })).toHaveAttribute('aria-checked', 'false')
    await expect(menu.getByRole('menuitem', { name: 'Quản lý bàn', exact: true })).toBeVisible()
    await shot(page, 'phone-M06-menu')
    await closeRoomMenu(page)
    await expect(page.locator('footer[data-dock]').getByRole('group', { name: 'Điều khiển bàn' })).toBeVisible()
    await expect(dock(page).getByRole('button', { name: 'Sẵn sàng', exact: true })).toBeVisible()
    await expect(dock(page).getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible()
    await expectRoomFits(page, 'phone, Hold’em, waiting', [PHONE_SCREEN])
    await expectNoTextOverlapAt(page, 'phone, Hold’em, waiting')

    await ready(page)
    await ready(them.page)
    await start(page)

    // Heads-up, the dealer posts the small blind and acts first: whoever is offered "Tố" now.
    await expect.poll(async () => (await raiseButton(page).count()) + (await raiseButton(them!.page).count()), { message: 'someone’s turn' }).toBe(1)
    const [actor, other] = (await raiseButton(page).count()) === 1 ? [page, them.page] : [them.page, page]

    // The turn's tray: one row — Bỏ bài · Theo 100 · Tố ▴ — the panel shut, one raise button named "Tố" alone.
    const actorTray = tray(actor)
    await expect(actorTray).toHaveAttribute('data-layout', 'stack')
    await expect(actorTray).toHaveAttribute('data-panel', 'closed')
    await expect(raiseButton(actor)).toHaveCount(1)
    await expect(raiseButton(actor)).toHaveAccessibleName('Tố')
    await expect(actorTray.getByRole('button', { name: 'Bỏ bài', exact: true })).toBeVisible()
    await expectOneRowTray(actor, 'Hold’em, my turn')
    await settled(myHand(actor))
    await expectBigCards(actor, 2, 'Hold’em, my turn')
    await expectPotClear(actor, 'Hold’em, my turn')
    await shot(actor, 'phone-M06-turn')
    await expectRoomFits(actor, 'phone, Hold’em, my turn', [PHONE_SCREEN])
    await expectNoTextOverlapAt(actor, 'phone, Hold’em, my turn')

    // "Tố ▴" opens the panel: four chips over the slider, Hủy and the confirm in place of the row (Bỏ bài and Theo go).
    const slider = await openBetPanel(actor)
    const panel = actorTray.getByRole('group', { name: 'Chọn mức cược' })
    await expect(panel).toBeVisible()
    const chips = panel.getByRole('group', { name: 'Mức cược' })
    for (const name of ['Min', '½ pot', 'Pot', 'Tất tay']) await expect(chips.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', /^(true|false)$/)
    await expect(actorTray.getByRole('button', { name: 'Bỏ bài', exact: true }), 'the row is gone under the panel').toHaveCount(0)
    await expect(actor.getByRole('spinbutton'), 'no number field').toHaveCount(0)
    await expect(raiseButton(actor), 'still one raise button: the panel’s confirm').toHaveCount(1)
    await expect(raiseButton(actor)).toHaveAccessibleName('Tố 400')

    // End is all in: the slider reaches its maximum exactly, and the confirm names that amount (Review Focus 1).
    const top = await setBet(actor, 'max')
    const max = Number(await slider.getAttribute('max'))
    expect(top, 'the slider’s last cell is its maximum').toBe(vnd(max))
    await expect(chips.getByRole('button', { name: 'Tất tay', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(raiseButton(actor)).toHaveAccessibleName(`Tố ${top}`)
    // The four chips stay inside the tray's padding at 375 px: "Tất tay" ran about 13 px past it (BP-31 final wave).
    const fit = await actorTray.evaluate((el, chipsLabel) => {
      const style = getComputedStyle(el)
      const inner = el.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
      const row = el.querySelector(`[role="group"][aria-label="${chipsLabel}"]`)!
      const last = row.lastElementChild!.getBoundingClientRect().right
      return { inner, last }
    }, 'Mức cược')
    test.info().annotations.push({ type: 'last chip', description: `right edge ${fit.last.toFixed(1)} px, tray content box ${fit.inner.toFixed(1)} px` })
    expect(fit.last, 'the last chip ends inside the tray’s content box').toBeLessThanOrEqual(fit.inner + 0.5)
    // The overlap check above turned motion back on, which deals the cards from the deck again: the shot waits for them.
    await settled(myHand(actor))
    await shot(actor, 'phone-M06-panel')
    await expectRoomFits(actor, 'phone, Hold’em, the bet panel open', [PHONE_SCREEN])
    await expectNoTextOverlapAt(actor, 'phone, Hold’em, the bet panel open')

    // Hủy folds the panel back into the row; the amount is not sent.
    await actorTray.getByRole('button', { name: 'Hủy', exact: true }).click()
    await expect(actorTray).toHaveAttribute('data-panel', 'closed')
    await expect(raiseButton(actor)).toHaveAccessibleName('Tố')
    await expect(actorTray.getByRole('button', { name: 'Bỏ bài', exact: true })).toBeVisible()
    await expectOneRowTray(actor, 'Hold’em, the panel closed again')

    // Open again, two steps over the minimum (400 → 600), and the confirm raises by what it names.
    await openBetPanel(actor)
    expect(await setBet(actor, 2)).toBe('600')
    await raiseButton(actor).click()
    await expect(tray(other).getByRole('button', { name: /^Theo [\d.]+$/ }), 'the raise reached the table').toHaveAccessibleName('Theo 400')
    await tray(other).getByRole('button', { name: 'Bỏ bài', exact: true }).click()
    await expect(resultCard(page)).toBeVisible({ timeout: 15_000 })
    await leave(them.page)
    await leave(page)

    // ── 2. A full Blind table — me and seven bots, three rows of chips: the cards stay big and nothing scrolls ──────────
    await createBlind(page, { name: unique('Bàn M06 Blind '), bots: 7, maxPlayers: 8, mode: 'Chơi hoặc bỏ', timer: '30 giây' })
    await takeSeat(page, 0, undefined, { via: 'menu' })
    const blindMenu = await openRoomMenu(page)
    await expect(blindMenu.getByRole('menuitem', { name: 'Đứng dậy', exact: true })).toBeVisible()
    await expect(blindMenu.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ', exact: true })).toBeVisible()
    await closeRoomMenu(page)
    await expect(opponentChips(page)).toHaveCount(7)
    await expectRoomFits(page, 'phone, Blind, eight seats, waiting', [PHONE_SCREEN])
    await expectNoTextOverlapAt(page, 'phone, Blind, eight seats, waiting')

    await ready(page)
    await start(page)
    const play = tray(page).locator('button:not([aria-pressed])').filter({ hasText: /^Chơi/ })
    await expect(play).toBeVisible()
    // Measured once every bot has chosen: "Đã chọn" is the longest tag a chip carries.
    await expect(opponentChips(page).filter({ hasText: 'Đã chọn' }), 'every bot has chosen').toHaveCount(7, { timeout: 30_000 })
    await settled(myHand(page))
    await expectOneRowTray(page, 'Blind, eight seats, my decision')
    await expectBigCards(page, 2, 'Blind, eight seats, my decision')
    await expectPotClear(page, 'Blind, eight seats, my decision')
    await shot(page, 'phone-M06-blind-eight')
    await expectRoomFits(page, 'phone, Blind, eight seats, my decision', [PHONE_SCREEN])
    await expectNoTextOverlapAt(page, 'phone, Blind, eight seats, my decision')

    // Sit out from the menu, then play: the bots alone deal no hand, so the result card stays on the felt.
    const sitOutMenu = await openRoomMenu(page)
    await sitOutMenu.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await play.click()
    const card = resultCard(page)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(dock(page).getByRole('button', { name: 'Bắt đầu', exact: true }), 'bots alone deal no hand').toBeVisible({ timeout: 15_000 })
    // An achievement the hand unlocked ("Đạt thành tựu mới: Thùng") is a slip over the dock: closed first, for the shot.
    const slips = page.getByRole('region', { name: 'Thông báo', exact: true }).getByRole('button', { name: 'Đóng', exact: true })
    while ((await slips.count()) > 0) await slips.first().click()
    await shot(page, 'phone-M06-blind-result')
    // After the hand a dense chip trades its badge row for its hand's name (and the winner's payout), and a sat-out host's
    // strip drops its crown so the bet stays on the first line (BP-31 final wave): the stage fits, card up or closed.
    // The dock's labels wrap inside their 44 px buttons rather than being cut.
    const dockLabelsFit = async (state: string): Promise<void> => {
      const labels = await page.locator('footer[data-dock] button').evaluateAll((els) =>
        els.map((el) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          const lines = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top))).size
          return { text: el.textContent ?? '', scroll: el.scrollWidth, client: el.clientWidth, lines }
        }),
      )
      test.info().annotations.push({ type: 'dock labels', description: `${state}: ${labels.map((l) => `${l.text} ${l.scroll}/${l.client} px, ${l.lines} line(s)`).join(' · ')}` })
      expect(labels.filter((l) => l.scroll > l.client + 1).map((l) => l.text), `${state}: no dock label is cut`).toEqual([])
      expect(labels.filter((l) => l.lines > 2).map((l) => l.text), `${state}: no dock label runs past two lines`).toEqual([])
    }
    const stageAnnotate = async (state: string): Promise<void> => {
      const stage = await page.evaluate(() => {
        const main = document.querySelector('main')!
        return main.scrollHeight - main.clientHeight
      })
      test.info().annotations.push({ type: 'stage scroll', description: `${state}: ${stage} px at 375×812` })    }
    await stageAnnotate('Blind, eight seats, sat out, the result card')
    await expectRoomFits(page, 'phone, Blind, eight seats, sat out, the result card', [PHONE_SCREEN])
    await expectNoTextOverlapAt(page, 'phone, Blind, eight seats, the result card')
    await dockLabelsFit('the result card')
    await card.getByRole('button', { name: 'Đóng', exact: true }).click()
    await expect(card).toHaveCount(0)
    await stageAnnotate('Blind, eight seats, sat out, the card closed')
    await expectRoomFits(page, 'phone, Blind, eight seats, sat out, the card closed', [PHONE_SCREEN])
    await expectNoTextOverlapAt(page, 'phone, Blind, eight seats, the result card closed')
    await dockLabelsFit('the card closed')
    await leave(page)
  } finally {
    await closeAll([them])
  }
})
