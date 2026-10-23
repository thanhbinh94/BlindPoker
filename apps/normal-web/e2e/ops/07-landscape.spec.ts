import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test'
import { shot } from '../support.js'
import {
  closeAll,
  closeRoomMenu,
  createBlind,
  createHoldemRoom,
  expectNoTextOverlapAt,
  expectRoomFits,
  IPHONE_LANDSCAPE,
  joinByCode,
  LANDSCAPE_SCREEN,
  newPlayer,
  openBetPanel,
  openRoomMenu,
  raiseButton,
  ready,
  resultCard,
  setBet,
  settled,
  SHORT_LANDSCAPE,
  start,
  takeSeat,
  touchDrag,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * Plan 26 (B8): the room on a phone held sideways — the `landscape` project, 915 × 412 with a touch screen, which the room
 * draws in its landscape frame (B1–B5): a one-line header with the seat's controls in its "Thêm" menu, Sẵn sàng and Bắt đầu
 * in a bottom-right dock, the hand's tray split into two corner docks — the left one turning into the bet panel (chips and
 * a slider, BP-31) once "Tố" is tapped — and a compact result card. Every case ends with the room fitting the screen
 * (neither the page nor the stage scrolls) and no text over text.
 */

test.describe.configure({ mode: 'serial' })

let a: Player
let b: Player

test.beforeAll(async ({ browser }) => {
  a = await newPlayer(browser, 'Ngang')
  b = await newPlayer(browser, 'Doc')
})

test.afterAll(async () => {
  await closeAll([a, b])
})

/** The room's own header — the one holding the room's code (the app's chrome has a `<header>` of its own elsewhere). */
const roomHeader = (page: Page) => page.locator('header').filter({ has: page.getByLabel('Mã phòng') })
/** The landscape dock in the bottom-right corner: Sẵn sàng, Bắt đầu, the ready count, the countdown between hands. */
const dock = (page: Page) => page.getByRole('group', { name: 'Điều khiển bàn' })
const tray = (page: Page) => page.getByRole('group', { name: 'Hành động' })
/** A real action in the tray, never a pre-action toggle of the same words (those carry `aria-pressed`). */
const action = (page: Page, name: RegExp) => tray(page).locator('button:not([aria-pressed])').filter({ hasText: name })
const winnerCard = (page: Page) => page.getByRole('group', { name: 'Người thắng', exact: true })

async function leave(page: Page): Promise<void> {
  await roomHeader(page).getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

interface Box {
  label: string
  top: number
  bottom: number
  left: number
  right: number
}

/** The boxes of every element `locator` matches, each labelled by `kind` and the seat it belongs to (or its index). */
async function boxesOf(locator: Locator, kind: string): Promise<Box[]> {
  const raw = await locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      const seat = el.closest('[data-seat]')?.getAttribute('data-seat')
      return { seat: seat ?? null, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }),
  )
  return raw.map(({ seat, ...box }, i) => ({ label: seat === null ? `${kind} ${i}` : `${kind} of seat ${Number(seat) + 1}`, ...box }))
}

const meets = (p: Box, q: Box): boolean => p.bottom > q.top + 0.5 && p.top < q.bottom - 0.5 && p.right > q.left + 0.5 && p.left < q.right - 0.5
const fmt = (box: Box): string => `${box.label} [${Math.round(box.left)},${Math.round(box.top)} → ${Math.round(box.right)},${Math.round(box.bottom)}]`

/** Every box lies whole inside the viewport, no two of `boxes` meet, and none meets any of `clear`. All problems named at once. */
function expectLaidOut(where: string, viewport: { width: number; height: number }, boxes: Box[], clear: Box[] = []): void {
  const problems: string[] = []
  for (const box of boxes) {
    if (box.left < -0.5 || box.top < -0.5 || box.right > viewport.width + 0.5 || box.bottom > viewport.height + 0.5) problems.push(`${fmt(box)} leaves the screen`)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (meets(boxes[i]!, boxes[j]!)) problems.push(`${fmt(boxes[i]!)} meets ${fmt(boxes[j]!)}`)
    for (const other of clear) if (meets(boxes[i]!, other)) problems.push(`${fmt(boxes[i]!)} meets ${fmt(other)}`)
  }
  expect(problems, `${where} at ${viewport.width}×${viewport.height}:\n  ${problems.join('\n  ')}`).toEqual([])
}

test('L-01 @landscape a Hold’em room while waiting: one-line header with the code, Đứng dậy / Tạm nghỉ / Quản lý bàn in the Thêm menu, Sẵn sàng and Bắt đầu in the bottom-right dock, Rời phòng visible', async () => {
  test.setTimeout(180_000)
  const page = a.page
  expect(page.viewportSize(), 'the landscape project’s phone').toEqual(LANDSCAPE_SCREEN)
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'a touch screen').toBeGreaterThan(0)

  // A switch on the page's socket, for the reconnect banner below: the route forwards the socket to the server untouched
  // until `cut` is set, then closes it and every socket the page reopens, so the room stays on "Mất kết nối" until the
  // switch is put back. A route only takes the sockets opened after it (hence the reload, in the lobby) and stays for the
  // life of the page; forwarding is transparent to the later cases.
  let cut = false
  const live: { page: WebSocketRoute; server: WebSocketRoute }[] = []
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (cut) {
      void ws.close()
      return
    }
    live.push({ page: ws, server: ws.connectToServer() })
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()

  const code = await createHoldemRoom(page, { name: unique('Bàn L01 '), tier: '100/200' })
  await joinByCode(b.page, code) // someone to manage: "Quản lý bàn" is offered only with another player in the room
  await expect(b.page).toHaveURL(/#\/room$/)
  await takeSeat(page, 0, undefined, { via: 'menu' })

  // The header: the room's code and "Rời phòng" on one line, in the top-right.
  const header = roomHeader(page)
  await expect(header.getByLabel('Mã phòng')).toHaveText(code)
  const leaveButton = header.getByRole('button', { name: 'Rời phòng' })
  await expect(leaveButton).toBeVisible()
  const headerBox = (await header.boundingBox())!
  const leaveBox = (await leaveButton.boundingBox())!
  expect(leaveBox.x + leaveBox.width / 2, 'Rời phòng sits on the right').toBeGreaterThan(LANDSCAPE_SCREEN.width / 2)
  expect(leaveBox.y, 'Rời phòng sits at the top').toBeLessThan(LANDSCAPE_SCREEN.height / 4)
  const headerLines = await header.evaluate((el) => {
    // One line: every visible text run of the header shares one band (a wrapped header would put a run under another).
    const tops: number[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue
      // A visually hidden run (the page's `h1`, a screen reader's extra words) lives in a 1 px box and is not a line.
      const holder = node.parentElement?.getBoundingClientRect()
      if (holder === undefined || holder.width <= 1 || holder.height <= 1) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) if (rect.width > 1 && rect.height > 1) tops.push(rect.top + rect.height / 2)
    }
    return { spread: Math.max(...tops) - Math.min(...tops) }
  })
  expect(headerLines.spread, `the header is one line (${Math.round(headerBox.height)} px tall)`).toBeLessThan(16)

  // No control row under the felt: "Đứng dậy" is in the menu, not in a row of buttons.
  await expect(dock(page).getByRole('button', { name: 'Đứng dậy' }), 'no desktop control row').toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true }), 'no "Đứng dậy" button outside the menu').toHaveCount(0)

  // The "Thêm" menu holds the seat's three controls.
  const menu = await openRoomMenu(page)
  await expect(menu.getByRole('menuitem', { name: 'Đứng dậy', exact: true })).toBeVisible()
  const sitOut = menu.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ', exact: true })
  await expect(sitOut).toBeVisible()
  await expect(sitOut).toHaveAttribute('aria-checked', 'false')
  await expect(menu.getByRole('menuitem', { name: 'Quản lý bàn', exact: true })).toBeVisible()
  await shot(page, 'landscape-L01-menu')
  await closeRoomMenu(page)

  // The dock, bottom-right: Sẵn sàng and Bắt đầu (the host's, off until someone is ready).
  await expect(dock(page).getByRole('button', { name: 'Sẵn sàng', exact: true })).toBeVisible()
  await expect(dock(page).getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible()
  const dockBox = (await dock(page).boundingBox())!
  expect(dockBox.x + dockBox.width / 2, 'the dock sits on the right').toBeGreaterThan(LANDSCAPE_SCREEN.width / 2)
  expect(dockBox.y + dockBox.height / 2, 'the dock sits at the bottom').toBeGreaterThan(LANDSCAPE_SCREEN.height / 2)
  await shot(page, 'landscape-L01-waiting')

  // Spec B2: the reconnect banner lies over the felt under the header and pushes nothing — every seat stays where it was.
  const seatBoxes = () => boxesOf(page.locator('[data-seat]'), 'the seat')
  const seatsBefore = await seatBoxes()
  expect(seatsBefore.length, 'the ring has seats to measure').toBeGreaterThan(0)
  cut = true
  for (const { page: side, server } of live.splice(0)) {
    await server.close().catch(() => undefined)
    await side.close().catch(() => undefined)
  }
  const banner = page.getByText('Mất kết nối — đang kết nối lại…')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await shot(page, 'landscape-L01-reconnecting')
  expect(await seatBoxes(), 'the banner moves no seat').toEqual(seatsBefore)
  const bannerBox = (await banner.boundingBox())!
  expect(bannerBox.y + bannerBox.height, 'the banner stays on screen').toBeLessThanOrEqual(LANDSCAPE_SCREEN.height)
  expect(bannerBox.y, 'the banner sits under the header').toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 0.5)
  // Over the felt, but clear of every seat: the top seat's plate is still whole to read and to tap.
  expectLaidOut('the reconnect banner vs the seats', LANDSCAPE_SCREEN, await boxesOf(banner, 'the banner'), seatsBefore)
  cut = false
  await expect(banner, 'the room reconnects once the socket is back').toBeHidden({ timeout: 45_000 })
  await expect(dock(page).getByRole('button', { name: 'Sẵn sàng', exact: true })).toBeVisible()

  await expectRoomFits(page, 'landscape, Hold’em, waiting', [LANDSCAPE_SCREEN])
  await expectNoTextOverlapAt(page, 'landscape, Hold’em, waiting')
  await leave(b.page)
  await leave(page)
})

test('L-02 @landscape eight seats at 915×355: every seat plate on screen, no two plates intersect, no seat box meets the dock or tray, and an empty seat’s Ngồi vào bàn button is 44 px', async () => {
  test.setTimeout(240_000)
  const page = a.page
  // Blind allows eight players at most, and Hold'em has no bots (P22): eight occupied plates come from a Blind table with
  // seven bots. A nine-seat Hold'em room can hold nine people, but filling it takes nine accounts; this case measures its
  // nine empty seats instead, and nine occupied plates stay a known limitation.
  await page.setViewportSize(SHORT_LANDSCAPE)
  try {
    await createBlind(page, { name: unique('Bàn L02 '), bots: 7, maxPlayers: 8, mode: 'Chơi hoặc bỏ', timer: '30 giây' })
    await takeSeat(page, 0, undefined, { via: 'menu' })
    const seats = page.locator('[data-seat]')
    const plates = page.locator('[data-plate]')
    await expect(seats).toHaveCount(8)
    await expect(plates).toHaveCount(8)

    // Waiting: the plates apart and on screen, every seat clear of the dock.
    await expect(dock(page)).toBeVisible()
    expectLaidOut('eight plates, waiting', SHORT_LANDSCAPE, await boxesOf(plates, 'the plate'))
    expectLaidOut('eight seats vs the dock, waiting', SHORT_LANDSCAPE, await boxesOf(seats, 'the seat'), await boxesOf(dock(page), 'the dock'))
    await shot(page, 'landscape-L02-eight-waiting')
    await expectRoomFits(page, 'landscape, eight seats, waiting', [SHORT_LANDSCAPE, LANDSCAPE_SCREEN])
    await expectNoTextOverlapAt(page, 'landscape, eight seats, waiting')

    // In the hand: the same, and every seat clear of the tray's two corner docks.
    await ready(page)
    await start(page)
    await expect(action(page, /^Chơi/)).toBeVisible()
    // The tray's two corners by their class (CSS modules keep the local name inside the hashed one): the tray group itself
    // spans the stage's foot, and only the corners hold anything.
    const corners = tray(page).locator('[class*="_trayLeft_"], [class*="_trayRight_"]')
    await expect(corners).toHaveCount(2)
    expectLaidOut('eight plates, in the hand', SHORT_LANDSCAPE, await boxesOf(plates, 'the plate'))
    expectLaidOut('eight seats vs the tray, in the hand', SHORT_LANDSCAPE, await boxesOf(seats, 'the seat'), await boxesOf(corners, 'a tray corner'))
    await shot(page, 'landscape-L02-eight-in-hand')
    await expectRoomFits(page, 'landscape, eight seats, in the hand', [SHORT_LANDSCAPE, LANDSCAPE_SCREEN])
    await expectNoTextOverlapAt(page, 'landscape, eight seats, in the hand')
    await action(page, /^Bỏ bài$/).click()
    await expect(resultCard(page)).toBeVisible({ timeout: 60_000 })
    await leave(page)

    // Nine empty seats: each "Ngồi vào bàn" a full 44 px tap, on screen, apart from the others and from the dock.
    await createHoldemRoom(page, { name: unique('Bàn L02 chín '), maxPlayers: 9, tier: '100/200' })
    const sitButtons = page.getByRole('button', { name: /Ngồi vào bàn/ })
    await expect(sitButtons).toHaveCount(9)
    // The dock must be there to be measured against: an empty match would make the check below vacuous.
    await expect(dock(page)).toBeVisible()
    const sitBoxes = await boxesOf(sitButtons, 'Ngồi vào bàn')
    for (const box of sitBoxes) {
      expect(box.bottom - box.top, `${fmt(box)} is at least 44 px tall`).toBeGreaterThanOrEqual(44)
      expect(box.right - box.left, `${fmt(box)} is at least 44 px wide`).toBeGreaterThanOrEqual(44)
    }
    expectLaidOut('nine Ngồi vào bàn buttons vs the dock', SHORT_LANDSCAPE, sitBoxes, await boxesOf(dock(page), 'the dock'))
    await shot(page, 'landscape-L02-nine-empty')
    await expectRoomFits(page, 'landscape, nine empty seats', [SHORT_LANDSCAPE, LANDSCAPE_SCREEN])
    await expectNoTextOverlapAt(page, 'landscape, nine empty seats')
    await leave(page)
  } finally {
    await page.setViewportSize(LANDSCAPE_SCREEN)
  }
})

test('L-03 @landscape the result card at 915×412 and 844×390: no text overlap, Đóng at least 44 px and hit-testable at its top edge, the countdown whole, and the live region clips its overflow', async () => {
  test.setTimeout(180_000)
  const page = a.page
  await createBlind(page, { name: unique('Bàn L03 '), bots: 1, mode: 'Chơi hoặc bỏ', timer: '30 giây' })
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)
  const play = action(page, /^Chơi/)
  await expect(play).toBeVisible()
  // Sit out (from the menu), then play: the table is left with the bot alone, which deals no hand, so once this one is
  // over the room goes back to taking seats and the card stays on the felt — first counting down, then held still.
  const menu = await openRoomMenu(page)
  await menu.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await play.click()

  const card = winnerCard(page)
  const countdown = card.getByText(/^Ván tiếp theo sau \d+ giây$/)
  await expect(countdown).toBeVisible({ timeout: 30_000 })
  // The countdown lasts a few seconds: its two reads come first, one per phone, each a box inside the card's.
  for (const size of [LANDSCAPE_SCREEN, IPHONE_LANDSCAPE]) {
    await page.setViewportSize(size)
    const [line, whole] = await Promise.all([countdown.boundingBox(), card.boundingBox()])
    expect(line, `the countdown has a box at ${size.width}×${size.height}`).not.toBeNull()
    const where = `at ${size.width}×${size.height}`
    expect(line!.x, `the countdown starts inside the card ${where}`).toBeGreaterThanOrEqual(whole!.x - 0.5)
    expect(line!.y, `the countdown starts inside the card ${where}`).toBeGreaterThanOrEqual(whole!.y - 0.5)
    expect(line!.x + line!.width, `the countdown ends inside the card ${where}`).toBeLessThanOrEqual(whole!.x + whole!.width + 0.5)
    expect(line!.y + line!.height, `the countdown ends inside the card ${where}`).toBeLessThanOrEqual(whole!.y + whole!.height + 0.5)
    expect(line!.y + line!.height, `the countdown is on screen ${where}`).toBeLessThanOrEqual(size.height)
  }
  await page.setViewportSize(LANDSCAPE_SCREEN)
  await shot(page, 'landscape-L03-counting-down')

  // Held still: the bot alone deals nothing, the dock offers Bắt đầu again, and the card stays.
  await expect(dock(page).getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(card).toBeVisible()
  const close = card.getByRole('button', { name: 'Đóng', exact: true })
  for (const size of [LANDSCAPE_SCREEN, IPHONE_LANDSCAPE]) {
    await page.setViewportSize(size)
    const where = `at ${size.width}×${size.height}`
    expect(await card.getByRole('status').evaluate((el) => getComputedStyle(el).overflow), `the live region clips its overflow ${where}`).toBe('hidden')
    const box = (await close.boundingBox())!
    expect(box.height, `Đóng is at least 44 px tall ${where}`).toBeGreaterThanOrEqual(44)
    expect(box.width, `Đóng is at least 44 px wide ${where}`).toBeGreaterThanOrEqual(44)
    const hit = await close.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + 1)
      return at !== null && el.contains(at)
    })
    expect(hit, `a tap on Đóng’s top edge lands on Đóng ${where}`).toBe(true)
    await shot(page, `landscape-L03-result-${size.width}x${size.height}`)
    await expectRoomFits(page, `landscape, the result card, ${size.width}×${size.height}`, [size])
    await expectNoTextOverlapAt(page, 'landscape, the result card')
  }
  await page.setViewportSize(LANDSCAPE_SCREEN)
  await close.click()
  await expect(card).toHaveCount(0)
  await leave(page)
})

test('L-04 @landscape the bet panel: chips and a slider in the left corner, Tố N on the right, no number field', async () => {
  test.setTimeout(240_000)
  const code = await createHoldemRoom(a.page, { name: unique('Bàn L04 '), tier: '100/200', timer: '60 giây' })
  await joinByCode(b.page, code)
  await takeSeat(a.page, 0, undefined, { via: 'menu' })
  await takeSeat(b.page, 1, undefined, { via: 'menu' })
  await ready(a.page)
  await ready(b.page)
  await start(a.page)

  // Heads-up, the dealer posts the small blind and acts first: whoever is offered "Tố" now.
  // Not `\b`: a JS word boundary knows no Vietnamese letters, so `/^Tố\b/` never matches "Tố" (ố is no `\w`).
  const raise = (page: Page) => tray(page).getByRole('button', { name: /^Tố( |$)/ })
  await expect.poll(async () => (await raise(a.page).count()) + (await raise(b.page).count()), { message: 'someone’s turn' }).toBe(1)
  const [me, them] = (await raise(a.page).count()) === 1 ? [a, b] : [b, a]
  const page = me.page

  // One row until asked (BP-31, R6): the tray is shut, and the right corner's single "Tố" (its ▴ is decoration) opens the
  // bet panel in the left corner — four chips over a slider, with Hủy — while the same button turns into "Tố N".
  const panelTray = tray(page)
  await expect(panelTray).toHaveAttribute('data-panel', 'closed')
  await expect(raise(page)).toHaveAccessibleName('Tố')
  await expect(page.getByRole('slider'), 'no slider before the panel opens').toHaveCount(0)
  await raise(page).click()
  await expect(panelTray).toHaveAttribute('data-panel', 'open')
  const left = panelTray.locator('[class*="_trayLeft_"]')
  const panel = left.getByRole('group', { name: 'Chọn mức cược' })
  await expect(panel, 'the panel takes the left corner').toBeVisible()
  const chips = panel.getByRole('group', { name: 'Mức cược' })
  for (const name of ['Min', '½ pot', 'Pot', 'Tất tay']) {
    // Every chip says whether it names the amount (and `autopilot`, which presses `button:not([aria-pressed])`, never takes one).
    await expect(chips.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', /^(true|false)$/)
  }
  await expect(chips.getByRole('button', { name: 'Min', exact: true }), 'the panel opens at the minimum').toHaveAttribute('aria-pressed', 'true')
  const slider = panel.getByRole('slider', { name: 'Thanh trượt mức cược' })
  await expect(slider).toBeVisible()
  await expect(page.locator('input[type="range"]'), 'one slider, in the panel').toHaveCount(1)
  await expect(page.getByRole('spinbutton'), 'no number field').toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Hủy', exact: true })).toBeVisible()
  // Still one raise button, on the right, and it now names the minimum raise: 400 at the 100/200 tier preflop.
  await expect(raise(page)).toHaveCount(1)
  await expect(raise(page)).toHaveAccessibleName('Tố 400')
  await expect(panelTray.locator('[class*="_trayRight_"]').getByRole('button', { name: /^Tố( |$)/ })).toHaveCount(1)
  await shot(page, 'landscape-L04-panel')
  await expectRoomFits(page, 'landscape, Hold’em, my turn, the bet panel open', [LANDSCAPE_SCREEN])
  await expectNoTextOverlapAt(page, 'landscape, Hold’em, my turn, the bet panel open')

  // The slider by the keyboard (P8): Home is the minimum raise to 400, and two steps of the small blind make it 600 — a
  // raise that leaves the big blind 400 to call.
  expect(await setBet(page, 2)).toBe('600')

  // The right corner's button raises, by the amount it now names.
  await expect(raise(page)).toHaveAccessibleName('Tố 600')
  await raise(page).click()
  const call = tray(them.page).getByRole('button', { name: /^Theo [\d.]+$/ })
  await expect(call, 'the raise reached the table: the big blind has 400 to call').toHaveAccessibleName('Theo 400')
  await shot(them.page, 'landscape-L04-facing-the-raise')
  await expectRoomFits(them.page, 'landscape, Hold’em, facing a raise', [LANDSCAPE_SCREEN])
  await expectNoTextOverlapAt(them.page, 'landscape, Hold’em, facing a raise')

  await action(them.page, /^Bỏ bài$/).click()
  await expect(resultCard(page)).toBeVisible({ timeout: 15_000 })
  await leave(them.page)
  await leave(page)
})

test('L-05 @landscape a squeeze table: a touch peel turns a card, Lật turns the rest, the round ends, and Rời phòng from the header leaves', async () => {
  test.setTimeout(180_000)
  const page = a.page
  await createBlind(page, { name: unique('Bàn L05 '), bots: 1, mode: 'Hoàn toàn may rủi', squeeze: true })
  await expect(roomHeader(page).getByText('Nặn bài', { exact: true })).toBeVisible()
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)

  const mine = page.locator('[data-me="true"] [data-peel]')
  const pill = page.getByRole('button', { name: 'Lật', exact: true })
  await expect(mine).toHaveCount(2)
  await expect(mine.first()).toHaveAttribute('data-face', 'down')
  await expect(pill).toBeVisible()
  await expect(page.getByText('Mời nặn bài')).toBeVisible()
  // Both cards in place before they are measured — and again after the text-overlap check, which replays the deal (`settled`).
  const bothSettled = async (): Promise<void> => {
    await settled(mine.first())
    await settled(mine.last())
  }
  await bothSettled()
  await shot(page, 'landscape-L05-dealt')
  await expectRoomFits(page, 'landscape, a squeeze table, dealt', [LANDSCAPE_SCREEN])
  await expectNoTextOverlapAt(page, 'landscape, a squeeze table, dealt')

  // One card by finger, from its bottom-left corner along the diagonal: it peels, then lies face up.
  await bothSettled()
  const box = (await mine.first().boundingBox())!
  const corner = { x: box.x + 4, y: box.y + box.height - 4 }
  const cdp = await a.context.newCDPSession(page)
  await touchDrag(cdp, corner, { x: corner.x + (box.width - 8) * 0.8, y: corner.y - (box.height - 8) * 0.8 }, async () => {
    await expect(mine.first()).toHaveAttribute('data-face', 'peeling', { timeout: 5_000 })
  })
  await expect(mine.first()).toHaveAttribute('data-face', 'up', { timeout: 5_000 })
  await expect(mine.last()).toHaveAttribute('data-face', 'down')

  // Lật, by tap, turns the other; with the bot's turned at once the round ends and the winner is out.
  await pill.tap()
  await expect(mine.last()).toHaveAttribute('data-face', 'up', { timeout: 5_000 })
  await expect(winnerCard(page)).toBeVisible({ timeout: 15_000 })
  await shot(page, 'landscape-L05-result')
  await expectRoomFits(page, 'landscape, a squeeze table, the result', [LANDSCAPE_SCREEN])
  await expectNoTextOverlapAt(page, 'landscape, a squeeze table, the result')

  // "Rời phòng" in the header takes the player back to the lobby.
  await leave(page)
  await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()
})

/** BP-28: the user's Android in landscape with Chrome's bars showing (bug log §10, E1/E2) — a 255 px stage. */
const PHONE_WITH_BARS = { width: 855, height: 319 }
const board = (page: Page) => page.getByRole('group', { name: 'Bài chung' })
const FACE_UP = /^(\d+|Bồi|Đầm|Già|Át) (chuồn|rô|cơ|bích)$/

/**
 * Every seat's box against every other one, the board and the viewer's own cards; and every seat against the dock, the
 * tray's corners and the full-screen nudge, whichever are showing. All named at once (`expectLaidOut`).
 */
async function expectTableClear(page: Page, where: string): Promise<void> {
  const seats = await boxesOf(page.locator('[data-seat]'), 'the seat')
  const mine = await boxesOf(page.locator('[data-me="true"] [class*="_seatCards_"]'), 'my cards')
  const corners = tray(page).locator('[class*="_trayLeft_"], [class*="_trayRight_"]')
  const clear = [
    ...(await boxesOf(board(page), 'the board')),
    ...(await boxesOf(dock(page), 'the dock')),
    ...(await boxesOf(corners, 'a tray corner')),
    ...(await boxesOf(page.locator('[class*="_nudge_"]').first(), 'the nudge')),
  ].filter((box) => box.right - box.left > 0 && box.bottom - box.top > 0)
  expectLaidOut(where, PHONE_WITH_BARS, seats, clear)
  // My cards lie inside my own seat's box; against everyone else's seat they are measured on their own.
  const myLabel = mine[0]?.label.replace('my cards', 'the seat')
  expectLaidOut(`${where}, my cards`, PHONE_WITH_BARS, mine, seats.filter((box) => box.label !== myLabel))
}

test('L-06 @landscape a short landscape phone (855×319): after every bot has chosen, no seat box meets another, the community cards or my cards, and the waiting hint sits in the corner panel', async () => {
  test.setTimeout(300_000)
  const page = a.page
  try {
    // A Blind play-or-fold table, six bots and me: the user's table (bug log §10, ảnh 1–4), one bot more. The room is made
    // at the project's 915 × 412 (the lobby's create dialog is not this case's subject), and the phone shrinks to the
    // 855 × 319 its browser bars leave once the player is in it.
    await createBlind(page, { name: unique('Bàn L06 '), bots: 6, maxPlayers: 7, cards: 3, mode: 'Chơi hoặc bỏ', timer: '30 giây' })
    await page.setViewportSize(PHONE_WITH_BARS)
    await takeSeat(page, 0, undefined, { via: 'menu' })
    const table = page.getByRole('region', { name: 'Bàn' })
    await expect(table, 'a 255 px stage takes the short tier').toHaveAttribute('data-tier', 'short')
    await expect(page.locator('[data-seat]')).toHaveCount(7)

    // Waiting: the hint is the dock's second line, under the ready count — not on the felt (R2).
    const hint = 'Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một người chơi thật.'
    await expect(dock(page).getByText(hint, { exact: true })).toBeVisible()
    await expect(table.getByText(hint, { exact: true })).toHaveCount(0)
    await expect(dock(page).getByText('6/7 sẵn sàng', { exact: true })).toBeVisible()
    await expectTableClear(page, 'Blind, seven seats, waiting')
    await shot(page, 'landscape-L06-blind-waiting')
    await expectRoomFits(page, 'landscape 855×319, Blind, waiting', [PHONE_WITH_BARS])
    await expectNoTextOverlapAt(page, 'landscape 855×319, Blind, waiting')

    // The decision, measured once every bot has chosen: "Bot · Đã chọn · 1.000" is the longest line a seat carries.
    await ready(page)
    await start(page)
    await expect(action(page, /^Chơi/)).toBeVisible()
    const chosen = page.locator('[data-seat]').filter({ hasText: 'Đã chọn' })
    await expect(chosen, 'every bot has chosen').toHaveCount(6, { timeout: 30_000 })
    await expect(page.locator('[data-me="true"]').getByRole('img', { name: FACE_UP })).toHaveCount(3)
    await settled(page.locator('[data-me="true"]'))
    await expectTableClear(page, 'Blind, seven seats, every bot chosen')
    await shot(page, 'landscape-L06-blind-chosen')
    await expectRoomFits(page, 'landscape 855×319, Blind, every bot chosen', [PHONE_WITH_BARS])
    await expectNoTextOverlapAt(page, 'landscape 855×319, Blind, every bot chosen')
    await action(page, /^Bỏ bài$/).click()
    await expect(resultCard(page)).toBeVisible({ timeout: 60_000 })
    await leave(page)

    // A Hold'em table of eight seats, two of us, on the flop: the board's three cards against every seat.
    await page.setViewportSize(LANDSCAPE_SCREEN)
    const code = await createHoldemRoom(page, { name: unique('Bàn L06 HE '), maxPlayers: 8, tier: '100/200', timer: '60 giây' })
    await joinByCode(b.page, code)
    await expect(b.page).toHaveURL(/#\/room$/)
    await page.setViewportSize(PHONE_WITH_BARS)
    await b.page.setViewportSize(PHONE_WITH_BARS)
    await takeSeat(page, 0, undefined, { via: 'menu' })
    await takeSeat(b.page, 4, undefined, { via: 'menu' })
    await ready(page)
    await ready(b.page)
    await start(page)
    // Heads-up: the button calls, the big blind checks, and the flop comes. Whoever is offered a plain Xem or Theo presses it.
    const move = async (): Promise<void> => {
      for (const p of [page, b.page]) {
        const plain = tray(p).locator('button:not([aria-pressed])').filter({ hasText: /^(Xem|Theo[\d.\s]*)$/ })
        if ((await plain.count()) > 0 && (await plain.first().isEnabled({ timeout: 500 }).catch(() => false))) {
          await plain.first().click({ timeout: 2_000 }).catch(() => undefined)
          return
        }
      }
    }
    await expect
      .poll(
        async () => {
          await move()
          return board(page).getByRole('img', { name: FACE_UP }).count()
        },
        { message: 'the flop is on the felt', timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(3)
    await expect(table).toHaveAttribute('data-tier', 'short')
    await settled(board(page))
    // My cards, not my whole seat: when the flop's first turn is mine, the seat's clock ring animates through it.
    await settled(page.locator('[data-me="true"] [class*="_seatCards_"]'))
    await expectTableClear(page, 'Hold’em, eight seats, the flop')
    await shot(page, 'landscape-L06-holdem-flop')
    await expectRoomFits(page, 'landscape 855×319, Hold’em, the flop', [PHONE_WITH_BARS])
    await expectNoTextOverlapAt(page, 'landscape 855×319, Hold’em, the flop')

    // BP-31 §3.3: whoever is to act opens the bet panel on this short stage. The compact panel (32 px chips, a 36 px slider
    // row) fills the left corner and stays clear of every seat, the board and the actor's own cards.
    await expect.poll(async () => (await raiseButton(page).count()) + (await raiseButton(b.page).count()), { message: 'someone is to act' }).toBe(1)
    const actor = (await raiseButton(page).count()) === 1 ? page : b.page
    await openBetPanel(actor)
    const panel = tray(actor).locator('[class*="_trayLeft_"]').getByRole('group', { name: 'Chọn mức cược' })
    await expect(panel).toHaveAttribute('data-compact', 'true')
    const panelBox = (await panel.boundingBox())!
    expect(panelBox.height, `the compact panel is short (${Math.round(panelBox.height)} px)`).toBeLessThanOrEqual(80)
    await expect(raiseButton(actor), 'one raise button, naming the amount').toHaveAccessibleName(/^(Tố|Cược) [\d.]+$/)
    // The cards, not the whole seat: on the actor's turn the seat's clock ring animates for as long as the turn lasts.
    await settled(actor.locator('[data-me="true"] [class*="_seatCards_"]'))
    await expectTableClear(actor, 'Hold’em, eight seats, the flop, the bet panel open')
    const panelBoxes = await boxesOf(panel, 'the bet panel')
    expectLaidOut('the bet panel vs my cards, the board and the dock', PHONE_WITH_BARS, panelBoxes, [
      ...(await boxesOf(actor.locator('[data-me="true"] [class*="_seatCards_"]'), 'my cards')),
      ...(await boxesOf(board(actor), 'the board')),
      ...(await boxesOf(dock(actor), 'the dock')),
    ])
    await shot(actor, 'landscape-L06-holdem-panel')
    await expectRoomFits(actor, 'landscape 855×319, Hold’em, the bet panel open', [PHONE_WITH_BARS])
    await expectNoTextOverlapAt(actor, 'landscape 855×319, Hold’em, the bet panel open')
    await tray(actor).getByRole('button', { name: 'Hủy', exact: true }).click()
    await expect(tray(actor)).toHaveAttribute('data-panel', 'closed')
    await leave(b.page)
    await leave(page)
  } finally {
    await page.setViewportSize(LANDSCAPE_SCREEN)
    await b.page.setViewportSize(LANDSCAPE_SCREEN)
  }
})
