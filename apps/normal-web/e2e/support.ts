import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'
import { expectNoTextOverlap } from './overlap.js'

/**
 * What both Normal specs need: an account, the cookie session, the lobby, a room, and the two chrome
 * assertions that are about the *viewport* rather than about any one screen.
 *
 * It lives here rather than in `normal.spec.ts` because `avatar2d.spec.ts` drives the same app through
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

/**
 * Where a sign-in lands: the lobby — or, once a day while today's reward is unclaimed, the daily page the app
 * opens on its own. A fresh account always has a reward waiting, so the first sign-in of every test goes there;
 * this walks back to the lobby, which is what every caller is about to use.
 */
async function settleAfterSignIn(page: Page, submit: () => Promise<void>): Promise<void> {
  // The reminder asks `/api/rewards/daily` once per sign-in and only then decides where to send the player;
  // the lobby is on screen while it waits, so "lobby visible" alone would be a race the reminder then loses.
  const shownBefore = await page.evaluate(() => localStorage.getItem('bp.dailyNudge'))
  const asked = page.waitForResponse((r) => r.url().includes('/api/rewards/daily') && r.request().method() === 'GET')
  await submit()
  const status = (await (await asked).json()) as { claimable: boolean; nextResetAt: number }
  // Once per day per browser: a second sign-in on the same day stays in the lobby even with the reward unclaimed.
  if (status.claimable && shownBefore !== String(status.nextResetAt)) {
    await expect(page).toHaveURL(/#\/daily$/)
    await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('bp.dailyNudge')), 'the reminder recorded the day it opened').toBe(String(status.nextResetAt))
    await page.goto('/#/lobby')
  }
  await expectLobby(page)
}

/** Registers `who` and waits for the lobby. The cookie the server sets is the only credential involved. */
export async function register(page: Page, who: Account): Promise<void> {
  await page.goto('/#/register')
  await expect(page.getByRole('heading', { name: 'Blind Luck Poker' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(who.displayName)
  await settleAfterSignIn(page, () => page.getByRole('button', { name: 'Tạo tài khoản' }).click())
}

export async function signIn(page: Page, who: Account): Promise<void> {
  await page.goto('/#/login')
  await page.getByLabel('Email', { exact: true }).fill(who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
  await settleAfterSignIn(page, () => page.getByRole('button', { name: 'Vào sảnh' }).click())
}

/** The chibi hung on the lobby's player bar — the same face the seat plates draw. */
export function lobbyAvatar(page: Page): Locator {
  return page.locator('a[href="#/avatar"] [data-chibi-hash]')
}

/** The `data-chibi-hash` of a chibi that has actually reached the DOM — a stable identity for its configuration. */
export async function chibiHash(chibi: Locator): Promise<string> {
  await expect(chibi).toHaveAttribute('data-chibi-hash', /^[0-9a-f]+$/)
  return String(await chibi.getAttribute('data-chibi-hash'))
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

/**
 * The create-room dialog is one box. "Texas Hold'em" and "Blind Poker" bring different fields, and the dialog must
 * not grow or shrink when the host flips between them (review 2026-09-29, No12). Opens the dialog from the lobby,
 * measures its outer box in both modes at `viewport` (the page's own when omitted), runs the text-overlap rule on
 * each mode and closes the dialog again.
 *
 * Reduced motion is emulated while it runs — the dialog's entrance animation scales it, so an unsettled box is not
 * its size — and switched off again after, so the rest of the caller's test runs as it always did.
 */
export async function expectCreateRoomKeepsItsHeight(page: Page, viewport?: { width: number; height: number }): Promise<void> {
  const original = page.viewportSize()
  if (viewport !== undefined) await page.setViewportSize(viewport)
  const size = page.viewportSize()
  const where = `${size?.width ?? '?'}×${size?.height ?? '?'}`
  await page.emulateMedia({ reducedMotion: 'reduce' })
  try {
    await page.getByRole('button', { name: 'Tạo phòng' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const heights: number[] = []
    for (const mode of ["Texas Hold'em", 'Blind Poker']) {
      const choice = dialog.getByRole('button', { name: mode })
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'true')
      const box = await dialog.boundingBox()
      expect(box, `${mode}: the dialog has a box`).not.toBeNull()
      heights.push(box!.height)
      await expectNoTextOverlap(page, `create-room dialog, ${mode}, ${where}`)
    }
    const [holdem, blind] = heights as [number, number]
    expect(
      Math.abs(holdem - blind),
      `the create-room dialog changed height with the mode at ${where}: Texas Hold'em ${holdem} px, Blind Poker ${blind} px`,
    ).toBeLessThanOrEqual(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally {
    await page.emulateMedia({ reducedMotion: null })
    if (viewport !== undefined && original !== null) await page.setViewportSize(original)
  }
}

/** Takes the given seat; the index is explicit so nothing ever races the bot for one. */
export async function sit(page: Page, seat: number): Promise<void> {
  await page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: 'Ngồi vào bàn' }).click()
  await expect(page.getByRole('button', { name: 'Đứng dậy', exact: true })).toBeVisible()
}

/**
 * The wardrobe's two nested `tablist`s (design §3.1, §7): the three groups, then the active group's own
 * sub-tabs. A sub-tab's accessible name carries an "owned/total" count right after the label with no
 * separating space (`CategoryNav`'s `.tabCount`), so a caller can no longer match most of them with a
 * bare exact label — this clicks the group by its own tablist (labelled "Phòng thay đồ"), then, if given, the
 * sub-tab by a name *prefix* within that group's own tablist (labelled with the group's name), mirroring
 * `WardrobeScreen.test.tsx`'s own `goTo` helper under jsdom. Shared by every spec that drives the
 * wardrobe, so a markup change here is one update rather than three.
 */
export async function goToWardrobeTab(page: Page, group: 'Ngoại hình' | 'Trang phục' | 'Trang trí', subTab?: string): Promise<void> {
  const groupList = page.getByRole('tablist', { name: 'Phòng thay đồ' })
  await groupList.getByRole('tab', { name: group }).click()
  if (subTab === undefined) return
  const subList = page.getByRole('tablist', { name: group })
  await subList.getByRole('tab', { name: new RegExp(`^${subTab}`) }).click()
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width)
}
