import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { account, expectNoTextOverlapAt, OVERLAP_SCREENS, parsePoints, PHONE_SCREEN, register, unique, type Account } from '../support.js'

/**
 * What the operation-test pack (`docs/operation-test-plan.md`) needs beyond `../support.js`: several players in
 * several browsers, rooms of every shape, the API as each player sees it, and a player that plays by itself.
 */

export { account, expectNoTextOverlapAt, OVERLAP_SCREENS, parsePoints, PHONE_SCREEN, register, unique, type Account }

export interface Player {
  who: Account
  context: BrowserContext
  page: Page
}

/**
 * Registers `who` and leaves the page in the lobby. The server allows ten sign-ups a minute from one address and
 * this pack makes more than that in a run, so a refusal that says "wait N seconds" is waited out and retried.
 */
export async function registerPatiently(page: Page, who: Account): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto('/#/register')
    await page.getByLabel('Email', { exact: true }).fill(who.email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
    await page.getByLabel('Tên hiển thị', { exact: true }).fill(who.displayName)
    // The app asks for today's reward once per sign-in and may then open /daily on its own: wait for that answer
    // (and the move it triggers) before walking to the lobby, or the nudge lands after us and takes us away.
    const asked = page.waitForResponse((r) => r.url().includes('/api/rewards/daily') && r.request().method() === 'GET', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
    const limited = page.getByText(/vui lòng đợi (\d+) giây/)
    const outcome = await Promise.race([
      asked.then(() => 'in' as const),
      limited.waitFor({ timeout: 20_000 }).then(() => 'limited' as const),
    ])
    if (outcome === 'in') {
      await page.waitForTimeout(500)
      await page.goto('/#/lobby')
      await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()
      return
    }
    const seconds = Number(/(\d+) giây/.exec(await limited.innerText())?.[1] ?? '30')
    await page.waitForTimeout((seconds + 1) * 1000)
  }
  throw new Error(`could not register ${who.displayName}`)
}

/** A fresh browser context, a fresh account, signed in and standing in the lobby. */
export async function newPlayer(browser: Browser, stem: string, viewport?: { width: number; height: number }): Promise<Player> {
  const context = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', colorScheme: 'dark', ...(viewport === undefined ? {} : { viewport }) })
  const page = await context.newPage()
  const who = account(stem)
  await registerPatiently(page, who)
  return { who, context, page }
}

/* ── the API, as one player sees it ──────────────────────────────────────────────────────────────── */

export async function balanceOf(page: Page): Promise<number> {
  const res = await page.request.get('/api/me')
  expect(res.ok(), `GET /api/me returned ${res.status()}`).toBeTruthy()
  return ((await res.json()) as { balance: number }).balance
}

/** Polls the balance until `settled` holds (or the time runs out) and returns the last reading. */
export async function balanceWhen(page: Page, settled: (n: number) => boolean, timeoutMs = 30_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let balance = await balanceOf(page)
  while (!settled(balance) && Date.now() < deadline) {
    await page.waitForTimeout(300)
    balance = await balanceOf(page)
  }
  return balance
}

export interface LedgerRow {
  amount: number
  reason: string
  refId: string | null
}

/** Every ledger row of this account, newest first, across pages. */
export async function ledgerOf(page: Page): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = []
  let before: number | null = null
  for (;;) {
    const url: string = before === null ? '/api/me/ledger?limit=100' : `/api/me/ledger?limit=100&before=${before}`
    const res = await page.request.get(url)
    expect(res.ok(), `GET ${url} returned ${res.status()}`).toBeTruthy()
    const body = (await res.json()) as { entries: LedgerRow[]; nextBefore: number | null }
    rows.push(...body.entries)
    if (body.nextBefore === null) return rows
    before = body.nextBefore
  }
}

/**
 * The rows written since the ledger held `countBefore` of them. A hand can unlock an achievement ("Thùng", "Ba ván
 * liền tay"…) whose reward lands beside the buy_in / cash_out rows, so a money check compares the balance with all
 * of these rows, never with the buy_in and cash_out alone.
 */
export async function ledgerSince(page: Page, countBefore: number): Promise<LedgerRow[]> {
  await page.waitForTimeout(800) // the achievement subscriber writes just after the settlement
  const rows = await ledgerOf(page)
  return rows.slice(0, rows.length - countBefore)
}

export const sumOf = (rows: LedgerRow[], reason?: string): number =>
  rows.filter((row) => reason === undefined || row.reason === reason).reduce((sum, row) => sum + row.amount, 0)

/**
 * A write the way the web client makes it: from inside the page, same origin, with the `x-requested-with` header
 * the CSRF guard asks for. `page.request` would carry the cookie but not the page's origin.
 */
export async function postApi(page: Page, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-requested-with': 'bind-poker' },
        body: JSON.stringify(body ?? {}),
      })
      const text = await res.text()
      return { status: res.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> }
    },
    { path, body },
  )
}

export interface HistoryHand {
  handId: string
  roomId: string
  roomName: string | null
  mode: string
  net: number
  cancelled: boolean
  players: { playerId: string | null; label: string; seat: number; isBot: boolean; net: number; won: boolean }[]
}

/** This player's hand history, newest first. */
export async function historyOf(page: Page, limit = 50): Promise<HistoryHand[]> {
  const res = await page.request.get(`/api/me/history?limit=${limit}`)
  expect(res.ok(), `GET /api/me/history returned ${res.status()}`).toBeTruthy()
  return (await res.json()) as HistoryHand[]
}

export async function statsOf(page: Page): Promise<Record<string, number>> {
  const res = await page.request.get('/api/me/stats')
  expect(res.ok(), `GET /api/me/stats returned ${res.status()}`).toBeTruthy()
  return (await res.json()) as Record<string, number>
}

/* ── rooms ───────────────────────────────────────────────────────────────────────────────────────── */

export interface HoldemRoomOptions {
  name: string
  maxPlayers?: number
  timer?: '15 giây' | '30 giây' | '45 giây' | '60 giây'
  /** The blind tier's label, e.g. `100/200`. */
  tier?: string
  minBB?: number
  maxBB?: number
  password?: string
  autoStart?: boolean
}

async function openCreate(page: Page): Promise<Locator> {
  await page.goto('/#/lobby')
  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function finishCreate(page: Page, dialog: Locator): Promise<string> {
  await dialog.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(page).toHaveURL(/#\/room$/)
  return (await page.locator('header').getByLabel('Mã phòng').innerText()).trim()
}

/** Creates a Hold'em room from the lobby and returns its code. */
export async function createHoldemRoom(page: Page, o: HoldemRoomOptions): Promise<string> {
  const dialog = await openCreate(page)
  await dialog.getByRole('button', { name: 'Texas Hold’em' }).or(dialog.getByRole('button', { name: "Texas Hold'em" })).first().click()
  await dialog.getByLabel('Tên phòng').fill(o.name)
  if (o.maxPlayers !== undefined) await dialog.getByLabel('Số người tối đa').selectOption({ label: String(o.maxPlayers) })
  if (o.timer !== undefined) await dialog.getByLabel('Thời gian mỗi lượt').selectOption({ label: o.timer })
  if (o.tier !== undefined) await dialog.getByLabel('Mức cược').selectOption({ label: o.tier })
  if (o.minBB !== undefined) await dialog.getByLabel('Buy-in tối thiểu').fill(String(o.minBB))
  if (o.maxBB !== undefined) await dialog.getByLabel('Buy-in tối đa').fill(String(o.maxBB))
  if (o.password !== undefined) {
    await dialog.getByLabel('Phòng riêng tư').check()
    await dialog.getByLabel('Mật khẩu phòng').fill(o.password)
  }
  if (o.autoStart === true) await dialog.getByLabel('Tự động bắt đầu').check()
  return finishCreate(page, dialog)
}

export interface BlindRoomOptions {
  name: string
  bots: number
  maxPlayers?: number
  cards?: 2 | 3
  mode?: 'Hoàn toàn may rủi' | 'Chơi hoặc bỏ'
  /** The fixed wager's label, e.g. `1.000`. */
  wager?: string
  /** Ignored with `squeeze`: a squeeze table's round is a fixed 20 s, and the form shows it instead of the select. */
  timer?: '10 giây' | '15 giây' | '30 giây'
  /** A squeeze table ("Nặn bài"): the cards are turned by hand, over a 20 s round that ends when everyone has turned. */
  squeeze?: boolean
  password?: string
  autoStart?: boolean
}

/** Creates a Blind Poker room from the lobby and returns its code. */
export async function createBlind(page: Page, o: BlindRoomOptions): Promise<string> {
  const dialog = await openCreate(page)
  await dialog.getByRole('button', { name: 'Blind Poker' }).click()
  await dialog.getByLabel('Tên phòng').fill(o.name)
  if (o.maxPlayers !== undefined) await dialog.getByLabel('Số người tối đa').selectOption({ label: String(o.maxPlayers) })
  if (o.squeeze !== true) await dialog.getByLabel('Thời gian mỗi lượt').selectOption({ label: o.timer ?? '15 giây' })
  await dialog.getByLabel('Số lá mỗi người').selectOption({ label: `${o.cards ?? 2} lá` })
  await dialog.getByLabel('Cách chơi').selectOption({ label: o.mode ?? 'Chơi hoặc bỏ' })
  if (o.squeeze === true) await dialog.getByLabel('Nặn bài').check()
  await dialog.getByLabel('Mức cược cố định').selectOption({ label: o.wager ?? '1.000' })
  await dialog.getByLabel('Số lượng bot').selectOption({ label: String(o.bots) })
  if (o.password !== undefined) {
    await dialog.getByLabel('Phòng riêng tư').check()
    await dialog.getByLabel('Mật khẩu phòng').fill(o.password)
  }
  if (o.autoStart === true) await dialog.getByLabel('Tự động bắt đầu').check()
  return finishCreate(page, dialog)
}

/** Joins by code from the lobby's join card. */
export async function joinByCode(page: Page, code: string, password?: string): Promise<void> {
  await page.goto('/#/lobby')
  const form = page.getByPlaceholder('Nhập mã phòng').locator('xpath=ancestor::form')
  await form.getByLabel('Mã phòng').fill(code)
  if (password !== undefined) await form.getByLabel('Mật khẩu').fill(password)
  await form.getByRole('button', { name: 'Vào phòng' }).click()
}

/** Takes a seat; a Hold'em seat asks how much to bring, and `buyIn` answers (the minimum when omitted). */
export async function takeSeat(page: Page, seat: number, buyIn?: number): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: /Ngồi vào bàn/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Chọn số điểm mang vào bàn' })
  if (await dialog.isVisible().catch(() => false)) {
    if (buyIn !== undefined) await dialog.getByLabel('Buy-in').fill(String(buyIn))
    await dialog.getByRole('button', { name: 'Ngồi vào bàn' }).click()
  }
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
}

export async function ready(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sẵn sàng', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hủy sẵn sàng', exact: true })).toBeVisible()
}

export async function start(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Bắt đầu', exact: true })
  await expect(button).toBeEnabled()
  await button.click()
}

/* ── the hand ────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The result card dealt over the felt once a hand completes: a group named by its title (review round 2, R2-4). Its
 * live region is an inner `status` holding the title and the rows, so this is the card as a whole — footer included,
 * where the fee and the uncalled return are printed.
 */
export function resultCard(page: Page): Locator {
  return page.getByRole('group', { name: /^(Người thắng|Ván bị hủy)$/ })
}

/** The fee printed on a result card, 0 when the card prints none. */
export async function feeOn(card: Locator): Promise<number> {
  const line = card.getByText(/^Phí bàn/)
  return (await line.count()) === 0 ? 0 : parsePoints(await line.innerText())
}

export type Move = 'check' | 'call' | 'fold' | 'allIn' | 'play'

/**
 * Plays whatever this player's turn allows, by preference, until `until()` says stop. Returns how many moves it
 * made. "Check" and "Call" are one preference each: the first available one in `prefer` is pressed.
 */
export async function autopilot(page: Page, prefer: Move[], until: () => Promise<boolean>, timeoutMs = 120_000): Promise<number> {
  const bar = page.getByRole('group', { name: 'Hành động' })
  // Only the real action buttons: the pre-action toggles ("Xem/Bỏ", "Theo mọi mức", "Bỏ bài", "Tự động chơi") share
  // words with them but are toggles, so they carry `aria-pressed` and the actions do not. Pressing a toggle here
  // would arm a move for the *next* turn — which is exactly how an "idle" player stops timing out.
  const action = (text: RegExp): Locator => bar.locator('button:not([aria-pressed])', { hasText: text })
  const buttons: Record<Move, Locator> = {
    check: action(/^Xem$/),
    call: action(/^Theo( [\d.]+)?$/),
    fold: action(/^Bỏ bài$/),
    allIn: action(/^Tất tay$/),
    play: action(/^Chơi( [\d.]+)?$/),
  }
  const deadline = Date.now() + timeoutMs
  let moves = 0
  while (!(await until())) {
    if (Date.now() > deadline) throw new Error('autopilot: timed out')
    let moved = false
    for (const kind of prefer) {
      const button = buttons[kind]
      if ((await button.count()) > 0 && (await button.first().isEnabled().catch(() => false))) {
        await button.first().click().catch(() => undefined)
        moves++
        moved = true
        break
      }
    }
    await page.waitForTimeout(moved ? 600 : 300)
  }
  return moves
}

/** Resolves once a result card is on screen. */
export const handOver = (page: Page) => async (): Promise<boolean> => (await resultCard(page).count()) > 0

/**
 * Spec 2026-09-29 (Blind table limit): a seat that spends its limit is stood up after the hand. A test that needs many
 * hands calls this inside its poll: sit back down (a fresh buy-in), re-arm Ready/Start when the table fell back to
 * waiting, and turn auto-play on again (it ends with the seat). Every step is a no-op when it does not apply, and every
 * click gives up after a few seconds — a control that went away between the look and the press is the next poll's job,
 * not a reason to hang the test.
 */
export async function keepPlaying(page: Page, seat: number): Promise<void> {
  const sit = page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: /Ngồi vào bàn/ })
  if (await sit.isVisible().catch(() => false)) await takeSeat(page, seat)
  const readyButton = page.getByRole('button', { name: 'Sẵn sàng', exact: true })
  if (await readyButton.isVisible().catch(() => false)) await readyButton.click({ timeout: 5_000 }).catch(() => undefined)
  const startButton = page.getByRole('button', { name: 'Bắt đầu', exact: true })
  if ((await startButton.count()) > 0 && (await startButton.isEnabled().catch(() => false))) await startButton.click({ timeout: 5_000 }).catch(() => undefined)
  // The toggle carries `aria-pressed` (ActionBar); it is only there while this seat has a hand to show.
  const auto = page.getByRole('button', { name: 'Tự động chơi' })
  if ((await auto.count()) > 0 && (await auto.getAttribute('aria-pressed', { timeout: 5_000 }).catch(() => null)) === 'false') {
    await auto.click({ timeout: 5_000 }).catch(() => undefined)
  }
}

/** Closes every player's context. */
export async function closeAll(players: (Player | undefined)[]): Promise<void> {
  for (const p of players) if (p !== undefined) await p.context.close().catch(() => undefined)
}
