import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * The Lite edition, driven through a real browser against the real `dist/server.cjs`.
 *
 * Every selector here is a *user-visible* one — a role and its accessible name, in Vietnamese, the language the
 * app boots in. That is the point of the check: it fails when the thing a player reaches for stops being
 * reachable, not when a class name changes.
 *
 * The money assertions are the reason this test exists at all. Balances are read from `GET /api/me` (the
 * database's own answer) and the fee and payouts are read from the result card (what the player is told), so a
 * settlement that quietly created or destroyed points fails here even though both halves would look fine alone.
 */

const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

const WAGER = 1_000
/** `blindRequiredStack`: the ante plus the play, which is what a hand costs a player who does not fold. */
const PLAY_COST = WAGER * 2
const TOKEN_KEY = 'bp.lite.token'

/** Display names must be unique for the life of the server, and this file creates several per run. */
let seq = 0
const unique = (stem: string): string => `${stem}${(Date.now() % 100_000).toString(36)}${seq++}`

/** `formatPoints` prints `1.000` in Vietnamese; every digit group is one number. */
const parsePoints = (text: string): number => Number(text.replace(/\D/g, ''))

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}${name}.png` })

/**
 * The rail must hold all three tabs at 375 px, entirely inside the viewport, with nothing pushing
 * the page sideways. It used to lose the last tab off the right edge once the balance was in there
 * too — which is why the balance moved into the page on `/daily` and `/settings`.
 */
async function expectRailFits(page: Page): Promise<void> {
  const links = page.locator('header nav a')
  await expect(links).toHaveCount(3)
  const width = page.viewportSize()?.width ?? 0
  for (const link of await links.all()) {
    await expect(link).toBeVisible()
    const label = (await link.textContent()) ?? '(unnamed tab)'
    const box = await link.boundingBox()
    expect(box, label).not.toBeNull()
    expect(box!.x, `${label} starts inside the viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label} ends inside the viewport`).toBeLessThanOrEqual(width)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width)
}

/** The name prompt, all the way to the lobby. Returns the session token the app stored for this device. */
async function signIn(page: Page, displayName: string): Promise<string> {
  await page.goto('/')
  await page.getByLabel('Tên hiển thị').fill(displayName)
  await page.getByRole('button', { name: 'Vào sảnh' }).click()
  await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)
  expect(token, 'the session token must be on the device after the name prompt').toBeTruthy()
  return token!
}

/** Fills the create-room dialog for a Blind table and returns the room code from the room header. */
async function createBlindRoom(page: Page, roomName: string, bots: number): Promise<string> {
  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Blind Poker' }).click()
  await dialog.getByLabel('Tên phòng').fill(roomName)
  await dialog.getByLabel('Thời gian mỗi lượt').selectOption({ label: '30 giây' })
  await dialog.getByLabel('Số lá riêng').selectOption({ label: '2 lá' })
  await dialog.getByLabel('Kiểu quyết định').selectOption({ label: 'Chơi hoặc bỏ' })
  await dialog.getByLabel('Mức cược cố định').selectOption({ label: '1.000' })
  await dialog.getByLabel('Số lượng bot').selectOption({ label: String(bots) })
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()

  await expect(page).toHaveURL(/#\/room$/)
  const code = (await roomCode(page).innerText()).trim()
  expect(code, 'the room header must show a join code').toMatch(/^[A-Z0-9]{4,8}$/)
  return code
}

/** Takes the given seat; the seat index is explicit so two players never race for the same one. */
async function sit(page: Page, seat: number): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: 'Ngồi vào bàn' }).click()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
}

async function readBalance(page: Page, token: string): Promise<number> {
  const res = await page.request.get('/api/me', { headers: { authorization: `Bearer ${token}` } })
  expect(res.ok(), `GET /api/me returned ${res.status()}`).toBeTruthy()
  return ((await res.json()) as { balance: number }).balance
}

/** Polls `/api/me` until the balance satisfies `settled`, then returns it (the last reading either way). */
async function balanceWhen(page: Page, token: string, settled: (n: number) => boolean, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let balance = await readBalance(page, token)
  while (!settled(balance) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    balance = await readBalance(page, token)
  }
  return balance
}

/** The join code in the room header. The lobby's room list prints codes too, so the header is named explicitly. */
function roomCode(page: Page): Locator {
  return page.locator('header').getByLabel('Mã phòng')
}

/** The result card that is dealt over the felt once a hand completes. */
function resultCard(page: Page): Locator {
  return page
    .locator('[role="status"]')
    .filter({ has: page.getByRole('heading', { name: /Người thắng|Những người thắng|Ván bị hủy/ }) })
}

const PAYOUT = /\+\s*([\d.,]+)/

/** `+1.234` inside the row that names `who`, or `0` when that player took nothing. */
function payoutOf(rows: string[], who: string): number {
  const row = rows.find((line) => line.includes(who))
  const hit = row === undefined ? null : PAYOUT.exec(row)
  return hit === null ? 0 : parsePoints(hit[1]!)
}

/**
 * What the result card says was handed back uncalled: `{ who, amount }`, or an empty name and `0`.
 *
 * A bet nobody could call goes straight back to its owner *before* the pots and the fee are computed
 * (`hand/common.ts`), so it never reaches the pot and must be added back when reconstructing what each seat
 * really staked. In this hand it happens whenever the two opponents both fold on the one player who paid to play.
 */
async function uncalledReturn(card: Locator): Promise<{ who: string; amount: number }> {
  const line = card.getByText(/^Hoàn lại phần cược dư/)
  if ((await line.count()) === 0) return { who: '', amount: 0 }
  const hit = /^Hoàn lại phần cược dư\s+(.*?)\s+([\d.,]+)$/.exec((await line.innerText()).replace(/\s+/g, ' ').trim())
  expect(hit, 'the uncalled-return line must name a player and an amount').not.toBeNull()
  return { who: hit![1]!, amount: parsePoints(hit![2]!) }
}

/** Name prompt → lobby, with the sign-in screen and the lobby captured on the way. */
async function tourStart(context: BrowserContext, name: string, suffix: string): Promise<{ page: Page; token: string }> {
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByLabel('Tên hiển thị')).toBeVisible()
  await shot(page, `prompt-${suffix}`)
  const token = await signIn(page, name)
  await shot(page, `lobby-${suffix}`)
  return { page, token }
}

test.describe('Bind Poker Lite', () => {
  test('hai người chơi và một bot chơi trọn một ván Blind', async ({ browser }) => {
    const nameA = unique('An')
    const nameB = unique('Bình')

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const { page: pageA, token: tokenA } = await tourStart(contextA, nameA, 'desktop')
    const pageB = await contextB.newPage()
    const tokenB = await signIn(pageB, nameB)

    const startA = await readBalance(pageA, tokenA)
    const startB = await readBalance(pageB, tokenB)
    expect(startA).toBeGreaterThan(PLAY_COST)
    expect(startB).toBeGreaterThan(PLAY_COST)

    // --- 2. a Blind room, joined by code -------------------------------------------------------------------
    const code = await createBlindRoom(pageA, unique('Bàn '), 1)
    await pageB.getByRole('textbox', { name: 'Mã phòng' }).fill(code)
    // `exact` matters: the public room list offers its own "Vào phòng — <tên bàn>" button for the same room.
    await pageB.getByRole('button', { name: 'Vào phòng', exact: true }).click()
    await expect(pageB).toHaveURL(/#\/room$/)
    await expect(roomCode(pageB)).toHaveText(code)

    await sit(pageA, 0)
    await sit(pageB, 1)
    await pageA.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    await pageB.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    // Three ready of three seated: the bot holds a seat of its own and is ready from the moment the room exists.
    await expect(pageA.getByText('3/3 sẵn sàng')).toBeVisible()
    await expect(pageA.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeEnabled()
    await shot(pageA, 'room-desktop')

    await pageA.getByRole('button', { name: 'Bắt đầu', exact: true }).click()

    // --- 3. the hand: both sides see the decision phase ----------------------------------------------------
    const playA = pageA.getByRole('button', { name: /^Chơi\b/ })
    const foldB = pageB.getByRole('button', { name: 'Bỏ bài', exact: true })
    await expect(playA).toBeVisible()
    await expect(foldB).toBeVisible()
    // Cards are out: the tray only offers play/fold once `CARDS_DEALT` and `DECISION_PHASE` have landed.
    await expect(pageA.getByRole('group', { name: 'Hành động' })).toBeVisible()

    // --- 4. a reload mid-hand keeps the seat (reconnect + the `roomStale` gate) -----------------------------
    await pageA.reload()
    await expect(pageA).toHaveURL(/#\/room$/)
    await expect(roomCode(pageA)).toHaveText(code)
    await expect(pageA.getByRole('button', { name: 'Đứng dậy', exact: true }), 'still in the seat it took').toBeVisible()
    await expect(playA, 'still in the hand, and still owing a decision').toBeVisible()

    await playA.click()
    await foldB.click()

    // --- 5. the result, and the money ----------------------------------------------------------------------
    const result = resultCard(pageA)
    await expect(result).toBeVisible()
    const rows = await result.getByRole('listitem').allInnerTexts()
    const feeLine = result.getByText(/^Phí bàn/)
    const fee = (await feeLine.count()) === 0 ? 0 : parsePoints(await feeLine.innerText())
    const uncalled = await uncalledReturn(result)
    const returnedTo = (who: string): number => (uncalled.who === who ? uncalled.amount : 0)

    // The folder's cost is fixed by the rules, so it is the reliable signal that the batch has been written.
    const endB = await balanceWhen(pageB, tokenB, (n) => n !== startB)
    const endA = await readBalance(pageA, tokenA)
    await shot(pageA, 'hand-result-desktop')

    // Out before the five-second timer deals the next hand: the numbers above must stay the final word.
    await pageB.getByRole('button', { name: 'Rời phòng' }).click()
    await pageA.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(pageA).toHaveURL(/#\/lobby$/)

    const deltaA = endA - startA
    const deltaB = endB - startB
    const payoutA = payoutOf(rows, nameA)

    expect(deltaB, 'folding costs exactly the ante').toBe(-WAGER)
    expect(deltaA, 'playing costs two wagers, less anything paid or handed back').toBe(payoutA + returnedTo(nameA) - PLAY_COST)

    // Conservation, from two independent readings: the balances the database now holds, and what the result
    // card told the players. The pot is what was paid out plus the fee skimmed off it; add back any uncalled
    // return and the humans' known stakes give the bot's, so all four numbers must cancel to the point.
    const paidOut = rows.reduce((sum, row) => {
      const hit = PAYOUT.exec(row)
      return hit === null ? sum : sum + parsePoints(hit[1]!)
    }, 0)
    const pot = paidOut + fee
    const botStake = pot + uncalled.amount - (PLAY_COST + WAGER)
    expect([WAGER, PLAY_COST], 'the bot either folded after its ante or paid to play').toContain(botStake)
    const botNet = payoutOf(rows, 'Bot 1') + returnedTo('Bot 1') - botStake
    expect(deltaA + deltaB + botNet + fee, 'no points are created or destroyed by a hand').toBe(0)
    expect(fee, 'the table fee is 2% of the pot').toBe(Math.floor(pot * 0.02))

    await contextA.close()
    await contextB.close()
  })

  test('điểm danh và cài đặt', async ({ page }) => {
    const name = unique('Cường')
    await signIn(page, name)

    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nhận thưởng' })).toBeVisible()
    await shot(page, 'daily-desktop')

    await page.goto('/#/settings')
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
    await expect(page.getByText(name, { exact: true })).toBeVisible()
    await shot(page, 'settings-desktop')
  })

  test('@mobile bàn chơi trên màn hình điện thoại', async ({ context }) => {
    const { page, token } = await tourStart(context, unique('Dung'), 'mobile')
    expect(await readBalance(page, token)).toBeGreaterThan(0)

    await createBlindRoom(page, unique('Bàn '), 1)
    await sit(page, 0)
    await expect(page.getByRole('button', { name: 'Sẵn sàng', exact: true })).toBeVisible()
    await shot(page, 'room-mobile')

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)

    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    await expectRailFits(page)
    await shot(page, 'daily-mobile')

    await page.goto('/#/settings')
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
    await expectRailFits(page)
    await shot(page, 'settings-mobile')
  })
})
