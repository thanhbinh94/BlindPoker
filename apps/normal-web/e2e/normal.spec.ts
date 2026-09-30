import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { expectNoTextOverlap } from './overlap.js'
import {
  account,
  createBlindRoom,
  expectCardClearsMySeat,
  expectCreateRoomKeepsItsHeight,
  expectLobby,
  expectMyNameWhole,
  expectMySeatLines,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  expectNoTextOverlapDown,
  expectPageFits,
  expectRoomFits,
  LAPTOP_SCREEN,
  lobbyAvatar,
  OVERLAP_SCREENS,
  parsePoints,
  PHONE_SCREEN,
  register,
  shot,
  signIn,
  sit,
  unique,
  USER_SCREEN,
  withBusyLobby,
  type Account,
} from './support.js'

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
 *
 * The avatar has a file of its own — `avatar2d.spec.ts` — because the wardrobe's flow (base, locked
 * items, saved outfits) is a story with several steps, not one more assertion to fold in here.
 */

/** The lowest `blindWagerTiers` entry (`@bp/core`'s `ECONOMY`), and the one the create dialog offers first. */
const WAGER = 1_000
/** The ante plus the play: what a hand costs a player who does not fold. */
const PLAY_COST = WAGER * 2
/**
 * The table limit (spec 2026-09-29): five wagers go from the balance to the table at sit-down, and the whole
 * stack comes home at stand-up. A hand moves the stack only, so the balance is read after leaving.
 */
const LIMIT = 5 * WAGER

/* ── the session ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Settings → sign out → confirm. The dialog is the kit's, so Escape and the focus trap come with it. On the way the
 * text-overlap rule (No11b) reads Settings and the confirm dialog at the desktop sizes it holds every screen to.
 */
async function signOut(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
  const signOutButton = page.getByRole('button', { name: 'Đăng xuất', exact: true })
  await expect(signOutButton).toBeVisible()
  await expectNoTextOverlapAt(page, 'settings', OVERLAP_SCREENS)
  await signOutButton.click()
  const confirm = page.getByRole('button', { name: 'Đăng xuất ngay' })
  await expect(confirm).toBeVisible()
  await expectNoTextOverlapAt(page, 'settings, the sign-out dialog', OVERLAP_SCREENS)
  await confirm.click()
  await expect(page.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
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
 * this young can have written — the opening credit, one buy-in and one cash-out — and the assertions below
 * say so.
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

/**
 * The result card dealt over the felt once a hand completes: a group named by its title (review round 2, R2-4). Its
 * live region is an inner `status` holding the title and the rows, so this is the card as a whole — footer included.
 */
function resultCard(page: Page): Locator {
  return page.getByRole('group', { name: /^(Người thắng|Những người thắng|Ván bị hủy)$/ })
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

/**
 * Review 2026-09-29, No2: "Ván tiếp theo sau N giây" is the result card's own last line — inside the card, outside
 * its live region (review round 2, R2-4: the region is the inner `status` with the title and the rows; the footer
 * follows it), so a tick never has the card re-announced — and in neither a player's row nor the fee line, which is
 * what the rows and the fee are read by.
 */
async function expectCountdownOnTheCard(card: Locator): Promise<void> {
  const next = card.getByText(/^Ván tiếp theo sau \d+ giây$/)
  await expect(next, 'the countdown is printed on the result card').toBeVisible()
  expect(
    await next.evaluate((el) => el.closest('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]') === null),
    'the countdown is outside every live region, so it does not re-announce the card every second',
  ).toBe(true)
  await expect(card.getByRole('listitem').filter({ hasText: 'Ván tiếp theo' }), 'the countdown is no player’s row').toHaveCount(0)
  const fee = card.getByText(/^Phí bàn/)
  if ((await fee.count()) > 0) expect(await fee.innerText(), 'the fee line is the fee alone').not.toContain('Ván tiếp theo')
}

/**
 * Sits out while the hand is on, then plays it. The table is left with bots only, which cannot start a hand of their
 * own, so once this one is over the room goes back to taking seats and the result card stays on the felt — the
 * result state, held still for as long as a check needs.
 */
async function sitOutAndPlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ngồi ngoài', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Vào lại', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Chơi\b/ }).click()
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

/**
 * Register on a fresh page, capturing the sign-in card and the lobby on the way. The card is held to the text-overlap
 * rule (No11b) on both its tabs at `authViewports` — the page's own when omitted — before the account exists.
 */
async function tourStart(context: BrowserContext, who: Account, suffix: string, authViewports?: { width: number; height: number }[]): Promise<Page> {
  const page = await context.newPage()
  await page.goto('/#/register')
  await expect(page.getByLabel('Tên hiển thị', { exact: true })).toBeVisible()
  // Layout audit L3: another screen's `.card` rule used to squeeze the sign-in card into a centred column
  // too narrow for "Đăng nhập", which broke onto two lines. One line box per tab label, at any width.
  for (const tab of await page.getByRole('navigation', { name: 'Blind Luck Poker' }).getByRole('link').all()) {
    const lines = await tab.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top))).size
    })
    expect(lines, `"${await tab.textContent()}" stays on one line`).toBe(1)
  }
  await expectNoTextOverlapAt(page, 'sign-in card, create an account', authViewports)
  await shot(page, `auth-${suffix}`)
  await page.getByRole('navigation', { name: 'Blind Luck Poker' }).getByRole('link', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
  await expectNoTextOverlapAt(page, 'sign-in card, sign in', authViewports)
  await register(page, who)
  // The chibi is there from the first paint — it is a stack of same-origin PNGs, not a render, so there is
  // no fallback state to race.
  await expect(lobbyAvatar(page)).toBeVisible()
  await shot(page, `lobby-${suffix}`)
  return page
}

/* ── the tests ───────────────────────────────────────────────────────────────────────────────────── */

test.describe('Blind Luck Poker Normal', () => {
  test('một tài khoản chơi trọn một ván Blind với bot', async ({ context }) => {
    const who = account('An')
    const page = await tourStart(context, who, 'desktop', OVERLAP_SCREENS)

    // --- 1. the cookie session: out, and back in ------------------------------------------------------
    await signOut(page)
    // Signed out means signed out on this device: the lobby is unreachable until the cookie comes back.
    await page.goto('/#/lobby')
    await expect(page.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
    await expectNoTextOverlapAt(page, 'sign-in card, after signing out', OVERLAP_SCREENS)
    await signIn(page, who)

    const start = await readBalance(page)
    expect(start, 'a new account can afford a hand').toBeGreaterThan(PLAY_COST)

    // --- 1b. the create-room dialog keeps its height across modes, at the size of the player's screen --
    // (and a laptop's, where the text-overlap rule reads it too)
    await expectCreateRoomKeepsItsHeight(page, { width: 1920, height: 940 })
    await expectCreateRoomKeepsItsHeight(page, LAPTOP_SCREEN)

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
    await shot(page, 'hand-result-desktop')

    // Out before the five-second timer deals the next hand: the numbers above must stay the final word. Leaving
    // is also what brings the stack home — until then the balance is the start less the table limit.
    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)
    let end = await balanceWhen(page, (n) => n !== start - LIMIT)

    // A flush or better unlocks a paid achievement ("Thùng", +3.000 …), written by a subscriber just after the
    // settlement — so on any one read the balance may hold that reward or not yet, and the ledger likewise. The two
    // are read together until they agree, and the reward rows are taken out of the move before it is compared with
    // the hand (as ops 04-blind does): the card says nothing about achievements.
    let entries: { amount: number; reason: string }[] = []
    await expect
      .poll(
        async () => {
          end = await readBalance(page)
          entries = await readLedger(page)
          return entries.reduce((sum, e) => sum + e.amount, 0) - end
        },
        { message: 'the ledger sums to the balance', timeout: 10_000 },
      )
      .toBe(0)
    const rewards = entries.filter((e) => e.reason === 'achievement').reduce((sum, e) => sum + e.amount, 0)

    // The ledger, from two independent readings: what the database now holds, and what the card told the
    // player. Playing costs the ante plus the play; anything won or handed back comes off that.
    expect(end - start - rewards, 'the balance is the stake, less the payout and anything returned').toBe(payout + returned - PLAY_COST)

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

    // The third source, and the one that would catch a buy-in or cash-out moving a balance without writing a row
    // for it (§18.4 rests on this): the ledger. Its rows sum to the balance the account now holds (polled above),
    // and the sit-down and the leave — the only rows a Blind seat writes — must together be the move the result
    // card described.
    const buyIns = entries.filter((e) => e.reason === 'buy_in')
    const cashOuts = entries.filter((e) => e.reason === 'cash_out')
    expect(buyIns.map((e) => e.amount), 'sitting down took the table limit').toEqual([-LIMIT])
    expect(cashOuts, 'leaving took the stack home, once').toHaveLength(1)
    expect(buyIns[0]!.amount + cashOuts[0]!.amount, 'and together they are the move the result card described').toBe(payout + returned - PLAY_COST)

    // --- 5. the hand reached the progression ---------------------------------------------------------
    expect(await blindHandsPlayed(page, 1), 'the settlement wrote the blind hand counter').toBe(1)
    await page.goto('/#/achievements')
    // `exact` matters: without it the substring also names "Mười ván Blind Poker thắng", the wins counter.
    const blindHands = page.getByRole('progressbar', { name: 'Mười ván Blind Poker', exact: true })
    await expect(blindHands).toHaveAttribute('aria-valuenow', '1')
    await expect(blindHands).toHaveAttribute('aria-valuetext', '1 trên 10')
    await shot(page, 'achievements-desktop')
    // No11b: the achievements, and the profile with a hand in its history and rows in its ledger, text clear of text.
    await expectNoTextOverlapAt(page, 'achievements', OVERLAP_SCREENS)
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Ván gần đây' }).getByRole('listitem')).not.toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Lịch sử điểm' }).getByRole('listitem')).not.toHaveCount(0)
    await expectNoTextOverlapAt(page, 'profile, one hand played', OVERLAP_SCREENS)

    // --- 6. the lobby and a full room fit the player's screen (review 2026-09-29, No2, No11b) -------------
    // After the money on purpose: this second hand must not be the one the counters above read. Six seats — five
    // bots — in the room's three states: taking seats, a hand in play with the tray up, and the result card, first
    // counting down to the next deal and then held still (`sitOutAndPlay`). No text over text in any of them, on the
    // player's screen and on a 1366 × 768 laptop — the count-down one included: its five seconds outlast both reads.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(USER_SCREEN)
    await page.goto('/#/lobby')
    await expectLobby(page)
    await expectPageFits(page, 'the lobby')
    await expectNoTextOverlapAt(page, 'lobby', OVERLAP_SCREENS)
    await createBlindRoom(page, unique('Bàn '), 5)
    await sit(page, 0)
    await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    await expect(page.getByText('6/6 sẵn sàng')).toBeVisible()
    await expectRoomFits(page, 'taking seats')
    await expectNoTextOverlapAt(page, 'room, taking seats', OVERLAP_SCREENS)

    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Chơi\b/ })).toBeVisible()
    await expectRoomFits(page, 'in hand, the tray up')
    await expectMySeatLines(page, who.displayName, 'in hand')
    // Review round 2, R2-3: the viewer's own name is whole on its plate at every size.
    await expectMyNameWhole(page, who.displayName, 'in hand')
    await expectNoTextOverlapAt(page, 'room, in hand', OVERLAP_SCREENS)

    await sitOutAndPlay(page)
    const card = resultCard(page)
    await expect(card).toBeVisible()
    await expectCountdownOnTheCard(card)
    await expectNoTextOverlapAt(page, 'room, result card counting down', OVERLAP_SCREENS)
    await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true }), 'bots alone deal no hand: the room is taking seats').toBeVisible({ timeout: 15_000 })
    await expect(card, 'the card stays on the felt').toBeVisible()
    await expectRoomFits(page, 'the result card')
    await expectMySeatLines(page, who.displayName, 'the result card')
    // R2-3: and the held card stops above that seat on every desktop size, still tall enough to read.
    await expectMyNameWhole(page, who.displayName, 'the result card')
    await expectCardClearsMySeat(page, card, who.displayName)
    await expectNoTextOverlapAt(page, 'room, result card', OVERLAP_SCREENS)
    await shot(page, 'room-result-desktop')

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)

    // --- 7. a busy lobby: six rooms of every kind (review round 2, R2-1) ---------------------------------
    // Last, because the socket route that `withBusyLobby` sets up stays on the page. A room with only bots in it closes at
    // once, so the lobby above held none or one; here the server's `ROOM_LIST` is answered with `BUSY_LOBBY` — Hold'em and
    // Blind, open, in a hand and closing, a lock, two names that wrap — and the lobby must still fit the player's screen
    // with no text over text.
    await withBusyLobby(page)
    const tickets = page.getByRole('button', { name: /^Vào phòng — / })
    await expect(tickets, 'the six fixture rooms are six tickets').toHaveCount(6)
    // The tickets arrive over the socket after the page's own text: any face they ask for first must land before the fit.
    await page.evaluate(() => document.fonts.ready)
    await expectPageFits(page, 'a lobby of six rooms', USER_SCREEN)
    for (const ticket of await tickets.all()) await expect(ticket, `${await ticket.getAttribute('aria-label')} is whole on screen`).toBeInViewport({ ratio: 1 })
    await shot(page, 'lobby-busy-desktop')
    await expectNoTextOverlapAt(page, 'lobby, six rooms', OVERLAP_SCREENS)
    // A phone holds them in one column, taller than the window: it scrolls down, never sideways, and is read all the way.
    await page.setViewportSize(PHONE_SCREEN)
    await expectNoSidewaysScroll(page)
    await expectNoTextOverlapDown(page, 'lobby, six rooms, 375×812')
    await shot(page, 'lobby-busy-mobile')
    await page.emulateMedia({ reducedMotion: null })
  })

  test('điểm danh hằng ngày', async ({ context }) => {
    const who = account('Binh')
    const page = await tourStart(context, who, 'daily')

    // --- 0. the reminder: registering opened /daily once on its own (checked in `register`); the tab keeps the dot
    const rail = page.getByRole('navigation', { name: 'Điều hướng chính' })
    await expect(rail.getByText('Có quà chưa nhận'), 'the Daily tab carries the dot while the reward waits').toBeAttached()

    // --- 1. the daily claim, and what it paid --------------------------------------------------------
    const before = await readBalance(page)
    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    const claim = page.getByRole('button', { name: 'Nhận thưởng' })
    await expect(claim).toBeEnabled()
    // No11b: the page before the claim and with its receipt, on the player's screen and a laptop's.
    await expectNoTextOverlapAt(page, 'daily, the reward waiting', OVERLAP_SCREENS)
    await claim.click()

    const receipt = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Đã nhận thưởng ngày \d+$/ }) })
    await expect(receipt).toBeVisible()
    await expectNoTextOverlapAt(page, 'daily, the receipt', OVERLAP_SCREENS)
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
    // Claimed: the dot goes on this page, at once (finding T1), and leaving the page re-reads the status too.
    await expect(rail.getByText('Có quà chưa nhận'), 'the claim itself puts the dot out').toHaveCount(0)
    await page.goto('/#/lobby')
    await expectLobby(page)
    await expect(rail.getByText('Có quà chưa nhận')).toHaveCount(0)

    // --- 2. bug 4: a deploy removed the chunk this tab would load (simulated: the Profile chunk answers 404).
    //        The tab reloads itself once for the new version, and when that cannot help it says so — never a
    //        blank page. Rides on this test's account: the server allows ten sign-ups a minute and the suite
    //        already uses nine.
    await page.route('**/assets/ProfileScreen-*.js', (route) => route.fulfill({ status: 404, body: '' }))
    let loads = 0
    page.on('load', () => {
      loads += 1
    })
    await rail.getByRole('link', { name: 'Hồ sơ' }).click()
    await expect.poll(() => loads, { message: 'the tab reloads itself for the new version' }).toBe(1)
    await expect(page.getByRole('alert').filter({ hasText: 'Đã có phiên bản mới của trò chơi.' })).toBeVisible()
    expect(loads, 'one automatic reload, not a loop').toBe(1)
    await expect(page.getByRole('button', { name: 'Tải lại' })).toBeVisible()
    await page.unroute('**/assets/ProfileScreen-*.js')
  })

  test('@mobile sảnh, bàn chơi và hồ sơ trên màn hình điện thoại', async ({ context }) => {
    const who = account('Dung')
    const page = await tourStart(context, who, 'mobile')

    // The rail carries four tabs and the page under it never scrolls sideways; and no text lands on other text (No11b)
    // on any page this phone visits, walked down whole.
    await page.goto('/#/daily')
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nhận thưởng' })).toBeEnabled()
    await expectRailFits(page)
    await expectNoTextOverlapAt(page, 'daily, the reward waiting')
    await shot(page, 'daily-mobile')
    await page.getByRole('button', { name: 'Nhận thưởng' }).click()
    await expect(page.getByRole('heading', { name: /^Đã nhận thưởng ngày \d+$/ })).toBeVisible()
    await expectNoTextOverlapAt(page, 'daily, the receipt')

    // The profile is titled like every other page, and the player's name heads the card under that title.
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: who.displayName, exact: true })).toBeVisible()
    await expectRailFits(page)
    await expect(page.getByRole('list', { name: 'Lịch sử điểm' }).getByRole('listitem')).not.toHaveCount(0)
    await expectNoTextOverlapAt(page, 'profile')
    await shot(page, 'profile-mobile')

    await page.goto('/#/achievements')
    await expect(page.getByRole('progressbar', { name: 'Mười ván Blind Poker', exact: true })).toBeVisible()
    await expectNoTextOverlapAt(page, 'achievements')
    await page.goto('/#/settings')
    const signOutButton = page.getByRole('button', { name: 'Đăng xuất', exact: true })
    await expect(signOutButton).toBeVisible()
    await expectNoTextOverlapAt(page, 'settings')
    // The sign-out dialog too — opened, read, and closed again with Escape: this test stays signed in.
    await signOutButton.click()
    const confirm = page.getByRole('button', { name: 'Đăng xuất ngay' })
    await expect(confirm).toBeVisible()
    await expectNoTextOverlapAt(page, 'settings, the sign-out dialog')
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()

    // (The wardrobe at this width is `avatar2d.spec.ts`'s `@mobile` test.)

    // The table on a phone is the stack layout: opponents in a strip, my own plate under the felt. The
    // `Người chơi` group is what the ring layout does not have. A full table — five bots, so the strip runs
    // two rows and the host's roster has five names — is the tallest this screen gets before a hand.
    await page.goto('/#/lobby')
    await expectLobby(page)
    await expectNoTextOverlapAt(page, 'lobby')
    // The create-room dialog on a phone: the same outer box in both modes (it scrolls inside, it does not jump).
    await expectCreateRoomKeepsItsHeight(page)
    await createBlindRoom(page, unique('Bàn '), 5)
    await sit(page, 0)
    await expect(page.getByRole('region', { name: 'Bàn', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Người chơi', exact: true }), 'the phone gets the stack layout').toBeVisible()
    await expectNoSidewaysScroll(page)
    // Layout audit L1: my own plate — name, stack, cards — sits whole on screen, above the tray, without the
    // player scrolling the table to find it.
    const mine = page.locator('[data-seat="0"]')
    const [seatBox, trayBox] = [await mine.boundingBox(), await page.locator('footer').last().boundingBox()]
    expect(seatBox, 'my seat has a box').not.toBeNull()
    expect(trayBox, 'the tray has a box').not.toBeNull()
    expect(seatBox!.y, 'my seat starts on screen').toBeGreaterThanOrEqual(0)
    expect(seatBox!.y + seatBox!.height, 'my seat ends above the tray').toBeLessThanOrEqual(trayBox!.y + 1)
    await shot(page, 'room-mobile')

    // Review 2026-09-29, No2 and No11b: on a phone too, no text lands on other text in any of the room's three states —
    // taking seats, a hand in play with the tray up, and the result card (counting down, then held still).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expectNoTextOverlap(page, 'room, taking seats, 375×812')
    await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Chơi\b/ })).toBeVisible()
    await expectNoTextOverlap(page, 'room, in hand, 375×812')
    await sitOutAndPlay(page)
    const card = resultCard(page)
    await expect(card).toBeVisible()
    await expectCountdownOnTheCard(card)
    await expectNoTextOverlap(page, 'room, result card counting down, 375×812')
    await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible({ timeout: 15_000 })
    await expectNoTextOverlap(page, 'room, result card, 375×812')
    await shot(page, 'room-result-mobile')
    // With the card up the phone's stage scrolls (by design — the page itself does not): its foot, my own plate among
    // it, is read too.
    const stage = page.locator('main')
    await stage.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expectNoTextOverlap(page, 'room, result card, 375×812, the stage scrolled to its foot')
    await stage.evaluate((el) => el.scrollTo(0, 0))
    await page.emulateMedia({ reducedMotion: null })

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)

    // No11b: the profile once more, now that the hand above is in its history — the "Ván gần đây" rows on a phone.
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Ván gần đây' }).getByRole('listitem')).not.toHaveCount(0)
    await expectNoTextOverlapAt(page, 'profile, one hand played')
  })
})
