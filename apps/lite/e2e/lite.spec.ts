import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { defaultChibi } from '../../../packages/ui-kit/src/avatar2d/defaults.js'
import type { Gender } from '../../../packages/ui-kit/src/avatar2d/types.js'

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
/** The ante plus the play: what a hand costs a player with a full stack who does not fold. */
const PLAY_COST = WAGER * 2
/**
 * The table limit (spec 2026-09-29; five until BP-31): ten wagers go from the balance to the table at sit-down, and
 * the whole stack comes home at stand-up. A hand moves the stack only, so the balances are read after leaving.
 */
const LIMIT = 10 * WAGER
const TOKEN_KEY = 'bp.lite.token'

/** Display names must be unique for the life of the server, and this file creates several per run. */
let seq = 0
const unique = (stem: string): string => `${stem}${(Date.now() % 100_000).toString(36)}${seq++}`

/**
 * A unique display name whose chibi is of `gender`. A Lite seat's figure is `defaultChibi(displayName)` — the gender by
 * the parity of the name's FNV-1a hash — so a random name decides it, and a run could seat two of one gender and never
 * load the other's files. Asking the kit's own rule picks names that seat one of each, every run.
 */
function nameOf(stem: string, gender: Gender): string {
  for (;;) {
    const name = unique(stem)
    if (defaultChibi(name).body.gender === gender) return name
  }
}

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

/**
 * Fills the create-room dialog for a Blind table and returns the room code from the room header. A `squeeze` table
 * ("Nặn bài") has a fixed 20 s round, so the timer's select is left alone: ticking the box turns it into a read-only cell.
 */
async function createBlindRoom(page: Page, roomName: string, bots: number, squeeze = false): Promise<string> {
  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Blind Poker' }).click()
  await dialog.getByLabel('Tên phòng').fill(roomName)
  if (!squeeze) await dialog.getByLabel('Thời gian mỗi lượt').selectOption({ label: '30 giây' })
  await dialog.getByLabel('Số lá mỗi người').selectOption({ label: '2 lá' })
  await dialog.getByLabel('Cách chơi').selectOption({ label: 'Chơi hoặc bỏ' })
  await dialog.getByLabel('Mức cược cố định').selectOption({ label: '1.000' })
  await dialog.getByLabel('Số lượng bot').selectOption({ label: String(bots) })
  if (squeeze) {
    await dialog.getByLabel('Nặn bài', { exact: true }).check()
    await expect(dialog.getByRole('combobox', { name: 'Thời gian mỗi lượt' }), 'the timer select is hidden while the box is ticked').toHaveCount(0)
    await expect(dialog.getByLabel('Thời gian mỗi lượt'), 'the timer reads the fixed round').toHaveValue('20 giây · nặn bài')
  }
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()

  await expect(page).toHaveURL(/#\/room$/)
  const code = (await roomCode(page).innerText()).trim()
  expect(code, 'the room header must show a join code').toMatch(/^[A-Z0-9]{4,8}$/)
  return code
}

/**
 * Takes the given seat; the seat index is explicit so two players never race for the same one. On the upright phone
 * (BP-31, `via: 'menu'`) "Đứng dậy" is an item of the header's "Thêm" menu: it is opened, read and closed again.
 */
async function sit(page: Page, seat: number, opts?: { via?: 'menu' }): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: 'Ngồi vào bàn' }).click()
  if (opts?.via !== 'menu') {
    await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
    return
  }
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Thêm' })
  try {
    await expect(menu.getByRole('menuitem', { name: 'Đứng dậy', exact: true })).toBeVisible()
  } finally {
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
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

/** The `src` every chibi layer on one seat resolved to, back to front. */
function chibiLayers(page: Page, seat: number): Promise<string[]> {
  return page.locator(`[data-seat="${seat}"] [data-chibi-hash] img`).evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).currentSrc))
}

/**
 * Every chibi layer on the table has loaded and decoded (`complete` with a width — a 404 leaves `naturalWidth` at 0).
 * Polled, because the images load after the seat plate is already visible. A table with no chibi layers yet counts as
 * not ready rather than as passing, so the poll cannot pass on an empty list.
 */
async function expectChibisDecode(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const layers = await page
          .locator('[data-seat] [data-chibi-hash] img')
          .evaluateAll((imgs) => imgs.map((img) => ({ src: (img as HTMLImageElement).currentSrc, ok: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0 })))
        if (layers.length === 0) return 'no chibi layers yet'
        const broken = layers.filter((layer) => !layer.ok).map((layer) => layer.src.split('/avatar/')[1] ?? layer.src)
        return broken.length === 0 ? 'every layer decodes' : `not decoded: ${broken.join(', ')}`
      },
      { message: 'every chibi layer on the table decodes' },
    )
    .toBe('every layer decodes')
}

/** The join code in the room header. The lobby's room list prints codes too, so the header is named explicitly. */
function roomCode(page: Page): Locator {
  return page.locator('header').getByLabel('Mã phòng')
}

/**
 * The result card that is dealt over the felt once a hand completes: a group named by its title (review round 2,
 * R2-4). Its live region is an inner `status` holding the title and the rows, so this is the card as a whole — footer
 * included, where the fee and the uncalled return are printed.
 */
function resultCard(page: Page): Locator {
  return page.getByRole('group', { name: /^(Người thắng|Ván bị hủy)$/ })
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
  const line = card.getByText(/^Hoàn cược dư cho/)
  if ((await line.count()) === 0) return { who: '', amount: 0 }
  const hit = /^Hoàn cược dư cho\s+(.*?)\s+([\d.,]+)$/.exec((await line.innerText()).replace(/\s+/g, ' ').trim())
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

test.describe('Blind Luck Poker Lite', () => {
  test('hai người chơi và một bot chơi trọn một ván Blind', async ({ browser }) => {
    // One female and one male figure at the table, so both genders' bodies and hairstyles load (Plan 19 final review).
    const nameA = nameOf('An', 'f')
    const nameB = nameOf('Bình', 'm')

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
    // The chibi Lite bundles for itself (the v4 `body_*`, `bot_*`, the two default hairs and the default outfit, copied
    // into the build — `apps/lite/scripts/avatar-files.mjs`, spec §6.4) draws from the same seat plate as Normal's.
    // This is the one place Lite checks it does not ship faceless, bald or bodiless: every layer of every chibi on the
    // table must decode in a real browser, and each human seat must be standing on its v4 body in its gender's default
    // hairstyle — seat 0 the female body and the bob, seat 1 the male body and the tousled cut, so both genders' files
    // are among the layers that decode.
    await expect(pageA.locator('[data-seat="0"] [data-chibi-hash]')).toBeVisible()
    await expect(pageA.locator('[data-seat="1"] [data-chibi-hash]')).toBeVisible()
    await expectChibisDecode(pageA)
    const figures = { 0: { body: 'body_f_L30', hair: 'item_hair_f_bob01' }, 1: { body: 'body_m_L30', hair: 'item_hair_m_tousled01' } } as const
    for (const [seat, { body, hair }] of Object.entries(figures)) {
      const layers = await chibiLayers(pageA, Number(seat))
      for (const file of [body, `${hair}_L20`, `${hair}_L60`]) {
        expect(layers, `seat ${seat} draws ${file}`).toEqual(expect.arrayContaining([expect.stringContaining(`/${file}@`)]))
      }
    }
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
    await shot(pageA, 'hand-result-desktop')

    // Out before the five-second timer deals the next hand: the numbers above must stay the final word. Leaving is
    // also what brings each stack home — until then a balance is the start less the table limit.
    await pageB.getByRole('button', { name: 'Rời phòng' }).click()
    await pageA.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(pageB).toHaveURL(/#\/lobby$/)
    await expect(pageA).toHaveURL(/#\/lobby$/)
    const endB = await balanceWhen(pageB, tokenB, (n) => n !== startB - LIMIT)
    const endA = await balanceWhen(pageA, tokenA, (n) => n !== startA - LIMIT)

    const deltaA = endA - startA
    const deltaB = endB - startB
    const payoutA = payoutOf(rows, nameA)

    expect(deltaB, 'folding costs exactly the ante').toBe(-WAGER)
    expect(deltaA, 'playing costs two wagers, less anything paid or handed back').toBe(payoutA + returnedTo(nameA) - PLAY_COST)

    // Conservation, from two independent readings: the balances the database now holds, and what the result
    // card told the players. The pot is what was paid out plus any fee (none since plan 27); add back any uncalled
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
    expect(fee, 'Blind takes no table fee (plan 27)').toBe(0)

    await contextA.close()
    await contextB.close()
  })

  test('bàn nặn bài: huy hiệu "Nặn bài", vòng 20 giây thay ô giờ, và nút Lật mở các lá úp', async ({ page }) => {
    await signIn(page, unique('Giang'))

    await createBlindRoom(page, unique('Bàn '), 1, true)
    await expect(page.locator('header').getByText('Nặn bài', { exact: true }), 'the room header badges the squeeze table').toBeVisible()

    // One human and a bot (turned from the deal): a hand deals the viewer's two cards face down, and Lật turns both.
    await sit(page, 0)
    await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
    const mine = page.locator('[data-me="true"] [data-peel]')
    await expect(mine).toHaveCount(2)
    await expect(mine.first()).toHaveAttribute('data-face', 'down')
    await page.getByRole('button', { name: 'Lật', exact: true }).click()
    await expect(page.locator('[data-me="true"] [data-peel][data-face="up"]')).toHaveCount(2)
    await shot(page, 'room-squeeze-desktop')

    // The hand plays out from there: the decision of a play-or-fold table (the bot's may be either), then the result.
    await page.getByRole('button', { name: 'Bỏ bài', exact: true }).click()
    await expect(resultCard(page)).toBeVisible()

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)
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
    await sit(page, 0, { via: 'menu' })
    // Between hands the phone's dock (BP-31) holds Sẵn sàng, under the same name as the desktop's row.
    await expect(page.getByRole('group', { name: 'Điều khiển bàn' }).getByRole('button', { name: 'Sẵn sàng', exact: true })).toBeVisible()
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
