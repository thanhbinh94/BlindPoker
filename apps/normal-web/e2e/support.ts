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

/** One card of a card grid, as the browser laid it out (`measureCardLayout`). */
export interface MeasuredCard {
  /** The card's accessible name, or the start of its text — only for the failure message. */
  name: string
  top: number
  bottom: number
  /** The bordered box's outer height. */
  height: number
  /** From the lowest text line inside the card (its last row: the rarity, a lock hint, a date) down to the card's own
   * bottom edge — equal across a row when every card's last row sits on the same line. Only a card with a rarity
   * (`data-rarity`) has such rows; the base portraits and the "Tự nhiên" swatch are a picture and a name, and are
   * `null` here. */
  tail: number | null
}

export interface CardLayout {
  /** Every grid whose items are bordered cards, split into visual rows (cards whose tops are within 2 px). */
  rows: MeasuredCard[][]
  /** Each `<h3>` in scope that has a card above it: the space between the last card above and the heading's top. */
  headings: { text: string; gap: number }[]
}

/**
 * Measures the card grids inside `scope`: the wardrobe's item, colour, word and base cards (a tab's grid, or the two
 * grids of "Danh hiệu & Huy hiệu") and the inventory's owned cards. A grid counts when every item draws a border —
 * itself, or through its first child (`.cardCell`, `<li>`) — so the wardrobe's other grids are not picked up. Nothing
 * here knows a CSS-module class name.
 */
export async function measureCardLayout(scope: Locator): Promise<CardLayout> {
  return scope.evaluate(async (root: HTMLElement): Promise<CardLayout> => {
    await document.fonts.ready
    const drawsBorder = (el: Element): boolean => parseFloat(getComputedStyle(el).borderBottomWidth) > 0
    const cardOf = (item: Element): HTMLElement | null => {
      if (drawsBorder(item)) return item as HTMLElement
      const inner = item.firstElementChild
      return inner !== null && drawsBorder(inner) ? (inner as HTMLElement) : null
    }
    const range = document.createRange()
    /** The lowest text line the card draws in the flow — its rarity, hint or date, whichever comes last. A stretched
     * wrapper is not a row (its box reaches the card's bottom whatever is in it), and neither is an absolutely
     * positioned "Đang mặc" pill. */
    const lowestTextOf = (card: HTMLElement): number => {
      let lowest = card.getBoundingClientRect().top
      for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        if (getComputedStyle(el).position === 'absolute') continue
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? '')) continue
          range.selectNodeContents(node)
          for (const r of Array.from(range.getClientRects())) lowest = Math.max(lowest, r.bottom)
        }
      }
      return lowest
    }
    const nameOf = (card: HTMLElement): string => card.getAttribute('aria-label') ?? card.querySelector('[aria-label]')?.getAttribute('aria-label') ?? (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)

    const all: HTMLElement[] = []
    const rows: MeasuredCard[][] = []
    for (const grid of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
      if (getComputedStyle(grid).display !== 'grid') continue
      const cards = Array.from(grid.children).map(cardOf)
      if (cards.length === 0 || cards.some((c) => c === null)) continue
      const placed = (cards as HTMLElement[])
        .map((card) => ({ card, box: card.getBoundingClientRect() }))
        .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
      let row: MeasuredCard[] = []
      let rowTop = Number.NEGATIVE_INFINITY
      for (const { card, box } of placed) {
        all.push(card)
        if (box.top - rowTop > 2) {
          row = []
          rows.push(row)
          rowTop = box.top
        }
        const graded = card.hasAttribute('data-rarity')
        row.push({ name: nameOf(card), top: box.top, bottom: box.bottom, height: box.height, tail: graded ? box.bottom - lowestTextOf(card) : null })
      }
    }

    const headings: { text: string; gap: number }[] = []
    for (const h of Array.from(root.querySelectorAll<HTMLElement>('h3'))) {
      const above = all.filter((card) => h.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING)
      if (above.length === 0) continue
      const lastBottom = Math.max(...above.map((card) => card.getBoundingClientRect().bottom))
      headings.push({ text: (h.textContent ?? '').trim(), gap: h.getBoundingClientRect().top - lastBottom })
    }
    return { rows, headings }
  })
}

const px = (n: number): string => `${Math.round(n * 10) / 10}`

/**
 * Review 2026-09-29, No8b: in every card grid the cards of one row are one height ("ô dài, ô ngắn" was a tall card
 * beside short ones) and their last text rows — rarity, lock hint, date — sit on one line. Height is the outer box,
 * ±1 px; the last text line's distance to the card bottom is ±3 px: a rarity (0.6875 rem), a hint (0.75 rem) and a date
 * (0.8125 rem) leave up to 2 px apart under their glyphs (measured), which is not a misaligned row. Cards without a
 * rarity (the base portraits, the "Tự nhiên" swatch) have no such row and are compared on height only. Returns what
 * it measured, for a caller that wants to report it.
 */
export async function expectEvenCardRows(scope: Locator, label: string): Promise<CardLayout> {
  const layout = await measureCardLayout(scope)
  const several = layout.rows.filter((row) => row.length > 1)
  expect(several.length, `${label}: at least one row of two or more cards was measured`).toBeGreaterThan(0)
  const problems: string[] = []
  for (const row of several) {
    const heights = row.map((c) => c.height)
    const graded = row.filter((c): c is MeasuredCard & { tail: number } => c.tail !== null)
    const tails = graded.map((c) => c.tail)
    const heightSpread = Math.max(...heights) - Math.min(...heights)
    const tailSpread = tails.length > 1 ? Math.max(...tails) - Math.min(...tails) : 0
    if (heightSpread > 1) {
      problems.push(`row at y=${px(row[0]!.top)}: heights differ by ${px(heightSpread)} px — ${row.map((c) => `${c.name} ${px(c.height)}`).join(' | ')}`)
    }
    if (tailSpread > 3) {
      problems.push(`row at y=${px(row[0]!.top)}: last rows sit ${px(tailSpread)} px apart — ${graded.map((c) => `${c.name} ${px(c.tail)}`).join(' | ')}`)
    }
  }
  // Soft: one run lists every tab's uneven rows, not just the first tab's.
  expect.soft(problems, `${label}: cards in a row share one height and one bottom line\n  ${problems.join('\n  ')}`).toEqual([])
  return layout
}

/** No11b: a group's heading keeps at least `min` px (16 by default) below the last card of the group above it. */
export async function expectHeadingsClearOfCards(scope: Locator, label: string, min = 16): Promise<CardLayout> {
  const layout = await measureCardLayout(scope)
  expect(layout.headings.length, `${label}: at least one heading with a card above it was measured`).toBeGreaterThan(0)
  const tight = layout.headings.filter((h) => h.gap < min)
  expect
    .soft(tight, `${label}: a heading sits under ${min} px from the card above it — ${tight.map((h) => `"${h.text}" ${px(h.gap)} px`).join(', ')}`)
    .toEqual([])
  return layout
}
