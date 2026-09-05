import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * The Normal edition, driven through a real browser against the real server (`src/e2e-entry.ts`: the
 * production `buildApp` on a throwaway PGlite, serving `apps/normal-web/dist` from the same origin).
 *
 * Every selector is a *user-visible* one — a role and its accessible name, in Vietnamese, the language the
 * app boots in. That is the point: it fails when the thing a player reaches for stops being reachable, not
 * when a class name changes.
 *
 * Two things here are the reason the suite exists at all.
 *
 * **The money.** Balances are read from `GET /api/me` — the database's own answer, over the cookie session
 * this browser holds — while the payout and the table fee are read off the result card, which is what the
 * player is told. A settlement that quietly created or destroyed points fails here even though both halves
 * would look consistent on their own.
 *
 * **The session.** There is no token in this edition: `credentials: 'same-origin'` and an `HttpOnly` cookie
 * are the whole story, which is why registering, signing out and signing back in is the first test and why
 * `page.request` (which shares the context's cookie jar) is what reads the API.
 */

const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

/** The lowest `blindWagerTiers` entry (`@bp/core`'s `ECONOMY`), and the one the create dialog offers first. */
const WAGER = 1_000
/** The ante plus the play: what a hand costs a player who does not fold. */
const PLAY_COST = WAGER * 2

/** Display names and emails must be unique for the life of the server, and this file creates several per run. */
let seq = 0
const unique = (stem: string): string => `${stem}${(Date.now() % 100_000).toString(36)}${seq++}`

interface Account {
  email: string
  password: string
  displayName: string
}

function account(stem: string): Account {
  const displayName = unique(stem)
  return { email: `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}@e2e.test`, password: 'a good e2e password', displayName }
}

/** `formatPoints` prints `1.000` in Vietnamese; every digit group is one number. */
const parsePoints = (text: string): number => Number(text.replace(/\D/g, ''))

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false })

/* ── the session ─────────────────────────────────────────────────────────────────────────────────── */

/** Registers `who` and waits for the lobby. The cookie the server sets is the only credential involved. */
async function register(page: Page, who: Account): Promise<void> {
  await page.goto('/#/register')
  await expect(page.getByRole('heading', { name: 'Bind Poker' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(who.displayName)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expectLobby(page)
}

async function signIn(page: Page, who: Account): Promise<void> {
  await page.goto('/#/login')
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Vào sảnh' }).click()
  await expectLobby(page)
}

/** Settings → sign out → confirm. The dialog is the kit's, so Escape and the focus trap come with it. */
async function signOut(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
  await page.getByRole('button', { name: 'Đăng xuất ngay' }).click()
  await expect(page.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
}

/** The lobby is "signed in": it only renders once the gate's probe has come back with an account. */
async function expectLobby(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()
}

/* ── the API, as this browser sees it ────────────────────────────────────────────────────────────── */

/** `GET /api/me` over the context's cookie jar — the database's own answer, not the screen's. */
async function readBalance(page: Page): Promise<number> {
  const res = await page.request.get('/api/me')
  expect(res.ok(), `GET /api/me returned ${res.status()}`).toBeTruthy()
  return ((await res.json()) as { balance: number }).balance
}

/** Polls `/api/me` until the balance satisfies `settled`, then returns it (the last reading either way). */
async function balanceWhen(page: Page, settled: (n: number) => boolean, timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let balance = await readBalance(page)
  while (!settled(balance) && Date.now() < deadline) {
    // 250 ms rather than a tight loop: reads are rate-limited per player (240/minute) and the app itself
    // is making some of them.
    await page.waitForTimeout(250)
    balance = await readBalance(page)
  }
  return balance
}

/**
 * This account's point transactions, newest first. One default page (20) covers everything an account
 * this young can have written — the opening credit and one settlement — and the assertions below say so.
 */
async function readLedger(page: Page): Promise<{ amount: number; reason: string }[]> {
  const res = await page.request.get('/api/me/ledger')
  expect(res.ok(), `GET /api/me/ledger returned ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { entries: { amount: number; reason: string }[]; nextBefore: number | null }
  expect(body.nextBefore, 'the whole history fits in one page at this point in the test').toBeNull()
  return body.entries
}

/** Polls `/api/me/stats` until the blind hand counter has been written by the settlement's subscribers. */
async function blindHandsPlayed(page: Page, atLeast: number, timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await page.request.get('/api/me/stats')
    expect(res.ok(), `GET /api/me/stats returned ${res.status()}`).toBeTruthy()
    const played = ((await res.json()) as { handsPlayedBlind: number }).handsPlayedBlind
    if (played >= atLeast || Date.now() > deadline) return played
    await page.waitForTimeout(250)
  }
}

/* ── the table ───────────────────────────────────────────────────────────────────────────────────── */

/** Fills the create-room dialog for a Blind table and returns the join code from the room header. */
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
  const code = (await page.locator('header').getByLabel('Mã phòng').innerText()).trim()
  expect(code, 'the room header must show a join code').toMatch(/^[A-Z0-9]{4,8}$/)
  return code
}

/** Takes the given seat; the index is explicit so nothing ever races the bot for one. */
async function sit(page: Page, seat: number): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: 'Ngồi vào bàn' }).click()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
}

/** The result card dealt over the felt once a hand completes. */
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
 * A bet nobody could call goes straight back to its owner before the pots and the fee are computed, so it
 * never reaches the pot and has to be added back when reconstructing what a seat really staked. Here it
 * happens whenever the bot folds on the player who paid to play.
 */
async function uncalledReturn(card: Locator): Promise<{ who: string; amount: number }> {
  const line = card.getByText(/^Hoàn lại phần cược dư/)
  if ((await line.count()) === 0) return { who: '', amount: 0 }
  const hit = /^Hoàn lại phần cược dư\s+(.*?)\s+([\d.,]+)$/.exec((await line.innerText()).replace(/\s+/g, ' ').trim())
  expect(hit, 'the uncalled-return line must name a player and an amount').not.toBeNull()
  return { who: hit![1]!, amount: parsePoints(hit![2]!) }
}

/* ── the chrome ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The rail must hold all four tabs at 375 px, entirely inside the viewport, with nothing pushing the page
 * sideways. Four is the ceiling the Shell was designed to — Avatar, Inventory and Achievements are reached
 * from Profile precisely so a fifth tab never has to fit.
 */
async function expectRailFits(page: Page): Promise<void> {
  // The Shell's rail by its accessible name, not by `header nav`: the profile page has a header and a nav of
  // its own (its three links into the wardrobe, the inventory and the achievements), and a positional
  // selector would silently measure those instead.
  const links = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link')
  await expect(links).toHaveCount(4)
  const width = page.viewportSize()?.width ?? 0
  for (const link of await links.all()) {
    await expect(link).toBeVisible()
    const label = (await link.textContent()) ?? '(unnamed tab)'
    const box = await link.boundingBox()
    expect(box, label).not.toBeNull()
    expect(box!.x, `${label} starts inside the viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label} ends inside the viewport`).toBeLessThanOrEqual(width)
  }
  await expectNoSidewaysScroll(page)
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width)
}

/** The avatar hung on the lobby's player bar — the same face the seat plates draw. */
function lobbyAvatar(page: Page): Locator {
  return page.locator('a[href="#/avatar"] svg')
}

/** Register on a fresh page, capturing the sign-in card and the lobby on the way. */
async function tourStart(context: BrowserContext, who: Account, suffix: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto('/#/register')
  await expect(page.getByLabel('Tên hiển thị', { exact: true })).toBeVisible()
  await shot(page, `auth-${suffix}`)
  await register(page, who)
  await expect(lobbyAvatar(page)).toHaveAttribute('data-avatar', 'config')
  await shot(page, `lobby-${suffix}`)
  return page
}

/* ── the tests ───────────────────────────────────────────────────────────────────────────────────── */

test.describe('Bind Poker Normal', () => {
  test('một tài khoản chơi trọn một ván Blind với bot', async ({ context }) => {
    const who = account('An')
    const page = await tourStart(context, who, 'desktop')

    // --- 1. the cookie session: out, and back in ------------------------------------------------------
    await signOut(page)
    // Signed out means signed out on this device: the lobby is unreachable until the cookie comes back.
    await page.goto('/#/lobby')
    await expect(page.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
    await signIn(page, who)

    const start = await readBalance(page)
    expect(start, 'a new account can afford a hand').toBeGreaterThan(PLAY_COST)

    // --- 2. a Blind room, one bot --------------------------------------------------------------------
    await createBlindRoom(page, unique('Bàn '), 1)
    await sit(page, 0)
    await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    // Two ready of two seated: the bot holds a seat of its own and is ready from the moment the room exists.
    await expect(page.getByText('2/2 sẵn sàng')).toBeVisible()
    const start_ = page.getByRole('button', { name: 'Bắt đầu', exact: true })
    await expect(start_).toBeEnabled()
    await shot(page, 'room-desktop')
    await start_.click()

    // --- 3. the hand ---------------------------------------------------------------------------------
    const play = page.getByRole('button', { name: /^Chơi\b/ })
    await expect(play).toBeVisible()
    // Cards are out: the tray only offers play/fold once `CARDS_DEALT` and `DECISION_PHASE` have landed.
    await expect(page.getByRole('group', { name: 'Hành động' })).toBeVisible()
    await play.click()

    // --- 4. the result, and the money ----------------------------------------------------------------
    const result = resultCard(page)
    await expect(result).toBeVisible()
    const rows = await result.getByRole('listitem').allInnerTexts()
    const feeLine = result.getByText(/^Phí bàn/)
    const fee = (await feeLine.count()) === 0 ? 0 : parsePoints(await feeLine.innerText())
    const uncalled = await uncalledReturn(result)
    const returned = uncalled.who === who.displayName ? uncalled.amount : 0
    const payout = payoutOf(rows, who.displayName)

    const end = await balanceWhen(page, (n) => n !== start)
    await shot(page, 'hand-result-desktop')

    // Out before the five-second timer deals the next hand: the numbers above must stay the final word.
    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)

    // The ledger, from two independent readings: what the database now holds, and what the card told the
    // player. Playing costs the ante plus the play; anything won or handed back comes off that.
    expect(end - start, 'the balance is the stake, less the payout and anything returned').toBe(payout + returned - PLAY_COST)

    // The card must also add up on its own. The pot is what was paid out plus the fee skimmed off it;
    // add back any uncalled return and this player's known stake leaves the bot's — which the rules allow
    // to be exactly two values, so a card that printed a payout or a fee the pot cannot account for lands
    // outside the pair.
    //
    // (Lite reconciles a third number here — a second *human*'s balance, read from the database. With one
    // human that sum reduces to `0 === 0`, because the bot's stake is derived from the same card figures
    // rather than measured, so it is not written: an assertion that cannot fail is worse than none.)
    const paidOut = rows.reduce((sum, row) => {
      const hit = PAYOUT.exec(row)
      return hit === null ? sum : sum + parsePoints(hit[1]!)
    }, 0)
    const pot = paidOut + fee
    expect([WAGER, PLAY_COST], 'the bot either folded after its ante or paid to play').toContain(pot + uncalled.amount - PLAY_COST)
    expect(fee, 'the table fee is 2% of the pot').toBe(Math.floor(pot * 0.02))

    // The third source, and the one that would catch a settlement crediting a balance it never wrote a row
    // for (§18.4 rests on this): the ledger. Its rows must sum to the balance the account now holds, and
    // its one settlement row must be the move the result card described.
    const entries = await readLedger(page)
    expect(entries.reduce((sum, e) => sum + e.amount, 0), 'the ledger sums to the balance').toBe(end)
    const settlements = entries.filter((e) => e.reason === 'settlement')
    expect(settlements, 'one hand writes exactly one settlement row').toHaveLength(1)
    expect(settlements[0]!.amount, 'and it is the move the result card described').toBe(payout + returned - PLAY_COST)

    // --- 5. the hand reached the progression ---------------------------------------------------------
    expect(await blindHandsPlayed(page, 1), 'the settlement wrote the blind hand counter').toBe(1)
    await page.goto('/#/achievements')
    // `exact` matters: without it the substring also names "Mười ván Bài Mù thắng", the wins counter.
    const blindHands = page.getByRole('progressbar', { name: 'Mười ván Bài Mù', exact: true })
    await expect(blindHands).toHaveAttribute('aria-valuenow', '1')
    await expect(blindHands).toHaveAttribute('aria-valuetext', '1 trên 10')
    await shot(page, 'achievements-desktop')
  })

  test('điểm danh và ảnh đại diện', async ({ browser }) => {
    const who = account('Binh')
    const context = await browser.newContext()
    const page = await tourStart(context, who, 'daily')

    // --- 1. the daily claim, and what it paid --------------------------------------------------------
    const before = await readBalance(page)
    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    const claim = page.getByRole('button', { name: 'Nhận thưởng' })
    await expect(claim).toBeEnabled()
    await claim.click()

    const receipt = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Đã nhận thưởng ngày \d+$/ }) })
    await expect(receipt).toBeVisible()
    const lines = await receipt.getByRole('listitem').allInnerTexts()
    const valueAfter = (title: string): number => {
      const row = lines.find((line) => line.replace(/\s+/g, ' ').trim().startsWith(title))
      expect(row, `the receipt must have a "${title}" row`).toBeDefined()
      return parsePoints(row!.slice(title.length))
    }
    const points = valueAfter('Điểm')
    expect(points, 'day one pays points').toBeGreaterThan(0)
    await shot(page, 'daily-desktop')

    // The receipt says what the balance became; `/api/me` says what it is. Both, or neither is trustworthy.
    expect(valueAfter('Số dư mới'), 'the receipt agrees with itself').toBe(before + points)
    expect(await readBalance(page), 'the claim credited exactly what the receipt promised').toBe(before + points)
    await expect(page.getByText('Hôm nay bạn đã điểm danh rồi. Hẹn gặp lại ngày mai.')).toBeVisible()

    // --- 2. the wardrobe -----------------------------------------------------------------------------
    //
    // Only the hair *colour* is changed, and that is a fact about the economy rather than a shortcut: a new
    // account owns exactly one item per layer (the four `isDefault` rows of `data/items.json`), and the
    // first item a player can win arrives on day 7 of the calendar. So the colour is the one thing this
    // account can actually change — and it is enough to prove the round trip: PUT, reload, and the same
    // face on the lobby bar, which is the face the seat plates draw.
    const RED = '#c8323c'
    await page.goto('/#/avatar')
    await expect(page.getByRole('heading', { name: 'Ảnh đại diện', exact: true })).toBeVisible()
    const preview = page.locator('svg[data-size="lg"]')
    // The catalogue's `assetKey` on the rendered layer: the wardrobe is drawing the item the account owns.
    await expect(preview.locator('g[data-part="hair/hair_short"]')).toHaveCount(1)

    await page.getByRole('button', { name: `Màu có sẵn ${RED}` }).click()
    await shot(page, 'avatar-desktop')
    await page.getByRole('button', { name: 'Lưu ảnh đại diện' }).click()
    await expect(page.getByText('Đã lưu ảnh đại diện.')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Ảnh đại diện', exact: true })).toBeVisible()
    await expect(page.getByLabel('Màu tự chọn'), 'the saved colour is what the editor loads').toHaveValue(RED)
    await expect(preview).toHaveAttribute('style', new RegExp(`--avatar-hair:\\s*${RED}`))

    // …and on the lobby bar of a *second device*, which is this edition's whole premise: the face follows
    // the account, not the browser. A fresh context is also the only honest way to check it today —
    // `GET /api/players/:id/avatar` answers `private, max-age=60`, so the browser that did the saving keeps
    // serving its own stale copy to the lobby bar for up to a minute (see docs/normal-web.md).
    const second = await browser.newContext()
    const elsewhere = await second.newPage()
    await signIn(elsewhere, who)
    const face = lobbyAvatar(elsewhere)
    await expect(face).toHaveAttribute('style', new RegExp(`--avatar-hair:\\s*${RED}`))
    // The catalogue's `assetKey` per layer: the same face the seat plates draw at a table.
    await expect(face.locator('g[data-part="hair/hair_short"]')).toHaveCount(1)
    await expect(face.locator('g[data-part]')).toHaveCount(4)

    await second.close()
    await context.close()
  })

  test('@mobile sảnh, bàn chơi và hồ sơ trên màn hình điện thoại', async ({ context }) => {
    const who = account('Dung')
    const page = await tourStart(context, who, 'mobile')

    // The rail carries four tabs and the page under it never scrolls sideways.
    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    await expectRailFits(page)
    await shot(page, 'daily-mobile')

    // The profile's own heading is the player's name — the page is about *them*, and the rail already
    // says which tab this is.
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: who.displayName, exact: true })).toBeVisible()
    await expectRailFits(page)
    await shot(page, 'profile-mobile')

    await page.goto('/#/avatar')
    await expect(page.getByRole('heading', { name: 'Ảnh đại diện', exact: true })).toBeVisible()
    await expectNoSidewaysScroll(page)
    await shot(page, 'avatar-mobile')

    // The table on a phone is the stack layout: opponents in a strip, my own plate under the felt. The
    // `Người chơi` group is what the ring layout does not have.
    await page.goto('/#/lobby')
    await expectLobby(page)
    await createBlindRoom(page, unique('Bàn '), 1)
    await sit(page, 0)
    await expect(page.getByRole('region', { name: 'Bàn', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Người chơi', exact: true }), 'the phone gets the stack layout').toBeVisible()
    await expectNoSidewaysScroll(page)
    await shot(page, 'room-mobile')

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)
  })
})
