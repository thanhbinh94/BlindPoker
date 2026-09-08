import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * What both Normal specs need: an account, the cookie session, the lobby, a room, and the two chrome
 * assertions that are about the *viewport* rather than about any one screen.
 *
 * It lives here rather than in `normal.spec.ts` because `avatar3d.spec.ts` drives the same app through
 * the same door — registering, signing in, sitting down — and two copies of `register()` are two things
 * to update when the sign-in card changes its words. Everything that is about the *money* stays in
 * `normal.spec.ts`, because nothing else has any business reading a ledger.
 *
 * Every selector is a user-visible one: a role and its accessible name, in Vietnamese, the language the
 * app boots in.
 */

/** Playwright collects `*.spec.ts`; this file is a module the specs import, and is never run as a test. */

export const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

export const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false })

/** Display names and emails must be unique for the life of the server, and a run creates several. */
let seq = 0
export const unique = (stem: string): string => `${stem}${(Date.now() % 100_000).toString(36)}${seq++}`

export interface Account {
  email: string
  password: string
  displayName: string
}

export function account(stem: string): Account {
  const displayName = unique(stem)
  return { email: `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}@e2e.test`, password: 'a good e2e password', displayName }
}

/** `formatPoints` prints `1.000` in Vietnamese; every digit group is one number. */
export const parsePoints = (text: string): number => Number(text.replace(/\D/g, ''))

/** The lobby is "signed in": it only renders once the gate's probe has come back with an account. */
export async function expectLobby(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible()
}

/** Registers `who` and waits for the lobby. The cookie the server sets is the only credential involved. */
export async function register(page: Page, who: Account): Promise<void> {
  await page.goto('/#/register')
  await expect(page.getByRole('heading', { name: 'Just a Normal Poker' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(who.displayName)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expectLobby(page)
}

export async function signIn(page: Page, who: Account): Promise<void> {
  await page.goto('/#/login')
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Vào sảnh' }).click()
  await expectLobby(page)
}

/** The portrait hung on the lobby's player bar — the same face the seat plates draw. */
export function lobbyAvatar(page: Page): Locator {
  return page.locator('a[href="#/avatar"] [data-portrait]')
}

/** Fills the create-room dialog for a Blind table and returns the join code from the room header. */
export async function createBlindRoom(page: Page, roomName: string, bots: number): Promise<string> {
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
export async function sit(page: Page, seat: number): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: 'Ngồi vào bàn' }).click()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width)
}
