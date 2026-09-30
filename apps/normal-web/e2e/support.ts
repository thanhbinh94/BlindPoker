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

/** The user's own screen (review 2026-09-29): 1920 × 1080 less the browser's chrome and the taskbar. */
export const USER_SCREEN = { width: 1920, height: 940 }

/**
 * Where the room must fit without a scrollbar (review 2026-09-29, No2): the user's screen, and the laptop sizes
 * below it — 1536 × 730 and 1280 × 720 (a 1080p and a 720p panel at 125 % and 100 % less the browser) and
 * 1366 × 768.
 */
export const ROOM_SCREENS = [USER_SCREEN, { width: 1536, height: 730 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }]

/** The laptop every screen's text-overlap check also runs at (review 2026-09-29, No11b), beside the user's own. */
export const LAPTOP_SCREEN = { width: 1366, height: 768 }

/** The two desktop sizes the text-overlap rule holds every screen to: the user's screen and a laptop's. */
export const OVERLAP_SCREENS = [USER_SCREEN, LAPTOP_SCREEN]

/** The phone the default e2e's mobile project runs at, for a desktop-sized page that is also read on a phone. */
export const PHONE_SCREEN = { width: 375, height: 812 }

/**
 * `expectNoTextOverlap` measures only what is on screen, so a page taller than the window is walked down in
 * window-high steps (100 px of overlap between two steps, so no line falls between them) and left back at the top.
 * A page that fits is measured once, as it stands. Only the document is walked: a screen whose own box scrolls (the
 * room's stage on a phone) scrolls that box itself and calls again. The window's height is the page's own (the
 * detector's viewport), so a context without an emulated viewport walks too; one 100 px tall or less cannot move a
 * step and fails rather than reading the top alone.
 */
export async function expectNoTextOverlapDown(page: Page, label: string): Promise<void> {
  const { view, total } = await page.evaluate(() => ({ view: document.documentElement.clientHeight, total: document.documentElement.scrollHeight }))
  if (total <= view + 1) {
    await expectNoTextOverlap(page, label)
    return
  }
  if (view <= 100) throw new Error(`${label}: a window ${view} px tall is too short to walk the page down in steps`)
  const step = view - 100
  for (let y = 0; ; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await expectNoTextOverlap(page, `${label}, scrolled to ${y} px`)
    if (y + view >= total) break
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Review 2026-09-29, No11b — the text-overlap rule (docs/ui-kit.md) on the screen as it stands, at each of `viewports`
 * (the page's own when omitted), each walked down whole (`expectNoTextOverlapDown`); the label gets the size. The
 * page's own viewport comes back afterwards, and so does its motion: the rule measures under reduced motion, and a
 * test that was not running under it is not left there.
 */
export async function expectNoTextOverlapAt(page: Page, label: string, viewports?: { width: number; height: number }[]): Promise<void> {
  const original = page.viewportSize()
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  try {
    for (const viewport of viewports ?? [original]) {
      if (viewports !== undefined && viewport !== null) await page.setViewportSize(viewport)
      const size = page.viewportSize()
      await expectNoTextOverlapDown(page, `${label}, ${size?.width ?? '?'}×${size?.height ?? '?'}`)
    }
  } finally {
    if (!reduced) await page.emulateMedia({ reducedMotion: null })
    if (viewports !== undefined && original !== null) await page.setViewportSize(original)
  }
}

/** How far the page and the room's stage (the room's one `<main>`, the felt between the header and the tray) scroll. */
async function overflowOf(page: Page): Promise<{ page: number; stage: number | null }> {
  return page.evaluate(async () => {
    // Two frames: a resize re-runs the table's container queries before anything is worth measuring.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const root = document.documentElement
    const stage = document.querySelector('main')
    return { page: root.scrollHeight - root.clientHeight, stage: stage === null ? null : stage.scrollHeight - stage.clientHeight }
  })
}

/** No vertical scroll on the page at `viewport` (the page's own when omitted): `scrollHeight − clientHeight ≤ 1`. */
export async function expectPageFits(page: Page, label: string, viewport?: { width: number; height: number }): Promise<void> {
  if (viewport !== undefined) await page.setViewportSize(viewport)
  const size = page.viewportSize()
  const { page: overflow } = await overflowOf(page)
  expect(overflow, `${label} at ${size?.width ?? '?'}×${size?.height ?? '?'}: the page scrolls ${overflow} px`).toBeLessThanOrEqual(1)
}

/**
 * Review 2026-09-29, No2: the room fits the screen. At each of `viewports`, in the state the room is in now, neither
 * the page nor the room's stage scrolls (`scrollHeight − clientHeight ≤ 1` for both). Every size is measured before
 * anything fails, so one run names them all; the page's own viewport comes back afterwards.
 */
export async function expectRoomFits(page: Page, state: string, viewports = ROOM_SCREENS): Promise<void> {
  const original = page.viewportSize()
  const problems: string[] = []
  try {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      const { page: overflow, stage } = await overflowOf(page)
      if (overflow > 1 || stage === null || stage > 1) {
        problems.push(`${viewport.width}×${viewport.height}: the page scrolls ${overflow} px, the stage ${stage ?? '(no <main>)'} px`)
      }
    }
  } finally {
    if (original !== null) await page.setViewportSize(original)
  }
  expect(problems, `the room (${state}) scrolls:\n  ${problems.join('\n  ')}`).toEqual([])
}

/**
 * Review 2026-09-29, No2: the viewer's own seat block keeps to two lines of text under its plate on a desktop screen —
 * the badges with the bet, then the hand's name with the payout. The plate is the seat's first bordered box around
 * its name; a line is every text run whose top sits within 3 px of another's.
 */
export async function expectMySeatLines(page: Page, who: string, state: string): Promise<void> {
  const seat = page.getByRole('group', { name: /^Ghế \d+$/ }).filter({ has: page.getByText(who, { exact: true }) })
  await expect(seat).toHaveCount(1)
  const lines = await seat.evaluate((root: HTMLElement, name: string) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const runs: { text: string; top: number; bottom: number }[] = []
    let plate: Element | null = null
    const range = document.createRange()
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim()
      if (text === '' || node.parentElement?.closest('svg, [role="img"], [aria-hidden="true"]') !== null) continue
      if (text === name && plate === null) {
        for (let el: Element | null = node.parentElement; el !== null && el !== root; el = el.parentElement) {
          if (parseFloat(getComputedStyle(el).borderTopWidth) > 0) {
            plate = el
            break
          }
        }
      }
      range.selectNodeContents(node)
      for (const r of Array.from(range.getClientRects())) runs.push({ text, top: r.top, bottom: r.bottom })
    }
    const floor = plate === null ? Number.POSITIVE_INFINITY : plate.getBoundingClientRect().bottom
    const under = runs.filter((r) => r.top >= floor - 1).sort((a, b) => a.top - b.top)
    // A line is a band of runs whose boxes overlap vertically: a 16 px payout beside a 12 px hand name is one line.
    let lines = 0
    let bandBottom = Number.NEGATIVE_INFINITY
    for (const run of under) {
      if (run.top >= bandBottom - 2) {
        lines += 1
        bandBottom = run.bottom
      } else bandBottom = Math.max(bandBottom, run.bottom)
    }
    return { found: plate !== null, lines, texts: under.map((r) => r.text) }
  }, who)
  expect(lines.found, `${state}: the viewer's plate was found`).toBe(true)
  expect(lines.lines, `${state}: the viewer's seat runs ${lines.lines} lines under its plate — ${lines.texts.join(' | ')}`).toBeLessThanOrEqual(2)
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
  /** The card's `data-rarity`; `null` for the base portraits, the "Tự nhiên" swatch and a row the catalogue lost. */
  rarity: string | null
  /** The rarity line's top edge, measured from the card's own top; `null` when the card has no rarity line — which,
   * for a card with a `rarity`, is a line the measure could not find. */
  rarityTop: number | null
  /** The height of what stands directly above the rarity line — the card's name, one line or several. Two cards whose
   * names are as tall put their rarity lines on one line. */
  nameHeight: number | null
  /** The card's footer, measured from the bottom edge of its lowest row (a lock hint, a date, a colour-dot row) to the
   * card's own bottom edge; `null` for a card with nothing under its rarity line. Equal across a row when every
   * card's footer sits on the bottom line. */
  tail: number | null
}

export interface MeasuredGrid {
  /** The grid's cards split into visual rows (cards whose tops are within 2 px). */
  rows: MeasuredCard[][]
}

export interface CardLayout {
  /** Every grid whose items are bordered cards. */
  grids: MeasuredGrid[]
  /** Each `<h3>` in scope that has a card above it: the space between the last card above and the heading's top. */
  headings: { text: string; gap: number }[]
}

/** The rarity line's words, as the Vietnamese e2e reads them (`inventory.rarity.*`, uppercased by CSS only). */
const RARITY_WORDS = { common: 'Thường', rare: 'Hiếm', epic: 'Cực hiếm' }

/**
 * Measures the card grids inside `scope`: the wardrobe's item, colour, word and base cards (a tab's grid, or the two
 * grids of "Danh hiệu & Huy hiệu") and the inventory's owned cards. A grid counts when every item draws a border —
 * itself, or through its first child (`.cardCell`, `<li>`) — so the wardrobe's other grids are not picked up. Nothing
 * here knows a CSS-module class name.
 */
export async function measureCardLayout(scope: Locator): Promise<CardLayout> {
  return scope.evaluate(async (root: HTMLElement, words: Record<string, string>): Promise<CardLayout> => {
    await document.fonts.ready
    const drawsBorder = (el: Element): boolean => parseFloat(getComputedStyle(el).borderBottomWidth) > 0
    const cardOf = (item: Element): HTMLElement | null => {
      if (drawsBorder(item)) return item as HTMLElement
      const inner = item.firstElementChild
      return inner !== null && drawsBorder(inner) ? (inner as HTMLElement) : null
    }
    const range = document.createRange()
    /** The card's rarity line: the leaf element that says the rarity in words (`data-rarity` names which). */
    const rarityLineOf = (card: HTMLElement): HTMLElement | null => {
      const word = words[card.getAttribute('data-rarity') ?? '']
      if (word === undefined) return null
      return Array.from(card.querySelectorAll<HTMLElement>('*')).find((el) => el.childElementCount === 0 && (el.textContent ?? '').trim() === word) ?? null
    }
    /** The bottom edge of the lowest thing the card draws in the flow under `below` (a y position): text line boxes and
     * empty boxes (a colour dot, the spacer that holds a dot row's place). A stretched wrapper is not a row (its box
     * reaches the card's bottom whatever is in it), and neither is an absolutely positioned "Đang mặc" pill. `null`
     * when nothing is that low. */
    const footerBottomOf = (card: HTMLElement, below: number): number | null => {
      let lowest: number | null = null
      const note = (top: number, bottom: number): void => {
        if (top >= below - 1) lowest = Math.max(lowest ?? bottom, bottom)
      }
      for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        if (getComputedStyle(el).position === 'absolute') continue
        let hasText = false
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? '')) continue
          hasText = true
          range.selectNodeContents(node)
          for (const r of Array.from(range.getClientRects())) note(r.top, r.bottom)
        }
        const inFlow = Array.from(el.children).filter((c) => getComputedStyle(c).position !== 'absolute')
        if (!hasText && inFlow.length === 0) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) note(r.top, r.bottom)
        }
      }
      return lowest
    }
    const nameOf = (card: HTMLElement): string => card.getAttribute('aria-label') ?? card.querySelector('[aria-label]')?.getAttribute('aria-label') ?? (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)

    const all: HTMLElement[] = []
    const grids: MeasuredGrid[] = []
    for (const grid of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
      if (getComputedStyle(grid).display !== 'grid') continue
      const cards = Array.from(grid.children).map(cardOf)
      if (cards.length === 0 || cards.some((c) => c === null)) continue
      const placed = (cards as HTMLElement[])
        .map((card) => ({ card, box: card.getBoundingClientRect() }))
        .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
      const rows: MeasuredCard[][] = []
      let row: MeasuredCard[] = []
      let rowTop = Number.NEGATIVE_INFINITY
      for (const { card, box } of placed) {
        all.push(card)
        if (box.top - rowTop > 2) {
          row = []
          rows.push(row)
          rowTop = box.top
        }
        const rarityLine = rarityLineOf(card)
        const rarityBox = rarityLine?.getBoundingClientRect() ?? null
        const footer = rarityBox === null ? null : footerBottomOf(card, rarityBox.bottom)
        row.push({
          name: nameOf(card),
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          rarity: card.getAttribute('data-rarity'),
          rarityTop: rarityBox === null ? null : rarityBox.top - box.top,
          nameHeight: rarityLine?.previousElementSibling?.getBoundingClientRect().height ?? null,
          tail: footer === null ? null : box.bottom - footer,
        })
      }
      grids.push({ rows })
    }

    const headings: { text: string; gap: number }[] = []
    for (const h of Array.from(root.querySelectorAll<HTMLElement>('h3'))) {
      const above = all.filter((card) => h.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING)
      if (above.length === 0) continue
      const lastBottom = Math.max(...above.map((card) => card.getBoundingClientRect().bottom))
      headings.push({ text: (h.textContent ?? '').trim(), gap: h.getBoundingClientRect().top - lastBottom })
    }
    return { grids, headings }
  }, RARITY_WORDS)
}

const px = (n: number): string => `${Math.round(n * 10) / 10}`

/** The spread (max − min) of `values`; 0 for fewer than two. */
const spreadOf = (values: number[]): number => (values.length < 2 ? 0 : Math.max(...values) - Math.min(...values))

/**
 * The cards of one row that name-wise stand alike: groups of two or more whose `nameHeight`s are within 1 px, each
 * with the cards' rarity offsets. A card whose name wraps to another line puts its rarity a line lower, and is a
 * group of its own.
 */
export function rarityGroups(row: MeasuredCard[]): MeasuredCard[][] {
  const rated = row.filter((c) => c.rarityTop !== null && c.nameHeight !== null).sort((a, b) => a.nameHeight! - b.nameHeight!)
  const groups: MeasuredCard[][] = []
  for (const card of rated) {
    const last = groups[groups.length - 1]
    if (last !== undefined && card.nameHeight! - last[0]!.nameHeight! <= 1) last.push(card)
    else groups.push([card])
  }
  return groups.filter((g) => g.length > 1)
}

/**
 * Review 2026-09-29, No8b: in every card grid the cards of one row are one height ("ô dài, ô ngắn" was a tall card
 * beside short ones), the rarity line sits directly under the name — so cards whose names are as tall have it on one
 * line (±3 px) — and the footer under it (lock hint, date, colour dots) ends on the card's bottom line (±3 px). Height
 * is the outer box, ±1 px. The 3 px is what a rarity (0.6875 rem), a hint (0.75 rem) and a date (0.8125 rem) leave
 * apart under their glyphs (measured up to 2 px); it is not a misaligned row. Cards with no rarity line (the base
 * portraits, the "Tự nhiên" swatch) are compared on height only, and one with nothing under its rarity has no footer.
 *
 * `grids` is how many grids `scope` must hold (a tab has one, "Danh hiệu & Huy hiệu" two, the inventory one per
 * group of items): a grid that could not be measured, or that measured no row, fails instead of passing unseen.
 * Returns what it measured, for a caller that wants to report it.
 */
export async function expectEvenCardRows(scope: Locator, label: string, grids = 1): Promise<CardLayout> {
  const layout = await measureCardLayout(scope)
  expect(layout.grids.length, `${label}: ${grids} card grid${grids === 1 ? '' : 's'} measured`).toBe(grids)
  const problems: string[] = []
  layout.grids.forEach((grid, index) => {
    const at = `grid ${index + 1}`
    const cards = grid.rows.reduce((n, row) => n + row.length, 0)
    if (grid.rows.length === 0) problems.push(`${at}: no row measured`)
    else if (cards > 1 && grid.rows.every((row) => row.length < 2)) problems.push(`${at}: ${cards} cards but no row holds two`)
    const blind = grid.rows.flat().filter((c) => c.rarity !== null && c.rarityTop === null)
    if (blind.length > 0) problems.push(`${at}: no rarity line found on ${blind.map((c) => c.name).join(' | ')}`)
    for (const row of grid.rows) {
      if (row.length < 2) continue
      const where = `${at}, row at y=${px(row[0]!.top)}`
      const heightSpread = spreadOf(row.map((c) => c.height))
      if (heightSpread > 1) {
        problems.push(`${where}: heights differ by ${px(heightSpread)} px — ${row.map((c) => `${c.name} ${px(c.height)}`).join(' | ')}`)
      }
      const footed = row.filter((c): c is MeasuredCard & { tail: number } => c.tail !== null)
      const tailSpread = spreadOf(footed.map((c) => c.tail))
      if (tailSpread > 3) {
        problems.push(`${where}: footers end ${px(tailSpread)} px apart — ${footed.map((c) => `${c.name} ${px(c.tail)}`).join(' | ')}`)
      }
      for (const group of rarityGroups(row)) {
        const raritySpread = spreadOf(group.map((c) => c.rarityTop!))
        if (raritySpread > 3) {
          problems.push(
            `${where}: rarity lines (names ${px(group[0]!.nameHeight!)} px tall) sit ${px(raritySpread)} px apart — ${group.map((c) => `${c.name} ${px(c.rarityTop!)}`).join(' | ')}`,
          )
        }
      }
    }
  })
  // Soft: one run lists every tab's uneven rows, not just the first tab's.
  expect.soft(problems, `${label}: cards in a row share one height, one rarity line and one bottom line\n  ${problems.join('\n  ')}`).toEqual([])
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
