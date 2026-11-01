import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { shot } from '../support.js'
import {
  closeAll,
  createBlind,
  equipTitle,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  expectRoomFits,
  expectSeated,
  grantItem,
  joinByCode,
  newPlayer,
  openRoomMenu,
  playerIdOf,
  promoteToGm,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * BP-42 Part A (spec 2026-10-31, plan 2026-11-01): a Thần title's entrance, seen by the whole room. A GM gives Alice the Thần
 * Bài title (`POST /api/gm/players/:id/items`) and she puts it on; Bob opens a Blind room with one bot and does not sit, so no
 * hand is dealt and no reveal hold can delay the band (A11); Carol watches from a tab that says it is hidden. When Alice sits,
 * all three see "Thần Bài {Alice} đã giáng lâm!" once — on screen, over no text, scrolling nothing, gone within 4 s — and each
 * page asks for the `entrance.god` stinger once: Alice's and Bob's answer is not "muted" or "hidden" (a page that has had a
 * click gets a running AudioContext in headless Chromium), Carol's is "hidden". Alice stands and sits again inside the room's
 * ten minutes: no band and no second stinger. Bob presses "Tắt tiếng", the button reads "Bật tiếng", and it still does after
 * F5.
 *
 * Every page records the engine's `bp:sound` events (`window.__sounds`) from an init script set on its context before its
 * first page opens (`newPlayer`'s `prepare`). Carol's page also forces `document.hidden` true, so the engine's own check
 * answers "hidden" — the same `play` call the others make, not a fake.
 *
 * F-15 runs in the `desktop` project (1440 × 900), F-15b in the Galaxy S25 upright `s25p` (360 × 780, touch), where the band
 * stands over the felt's middle (Ruling 13).
 */

interface Heard {
  id: string
  outcome: string
}

declare global {
  interface Window {
    __sounds?: Heard[]
  }
}

/** Every `bp:sound` the page's engine emits, in order, from the document's first script on. */
async function recordSounds(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.__sounds = []
    window.addEventListener('bp:sound', (event) => {
      const detail = (event as CustomEvent<Heard>).detail
      window.__sounds?.push({ id: detail.id, outcome: detail.outcome })
    })
  })
}

/** A tab the browser reports as hidden: `document.hidden` and `visibilityState` say so in every document. */
async function hideTab(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'hidden' })
  })
}

const heard = (page: Page, id: string): Promise<Heard[]> => page.evaluate((wanted) => (window.__sounds ?? []).filter((s) => s.id === wanted), id)

const band = (page: Page): Locator => page.locator('button[data-herald="entrance"]')
const roomHeader = (page: Page): Locator => page.locator('header').filter({ has: page.getByLabel('Mã phòng') })
const sitButtons = (page: Page): Locator => page.locator('[data-seat]').getByRole('button', { name: /Ngồi vào bàn/ })

/** Into the room by its code, and the room's header is on screen. The press is also the page's first gesture: it unlocks the audio. */
async function join(page: Page, code: string): Promise<void> {
  await joinByCode(page, code)
  await expect(page).toHaveURL(/#\/room$/)
  await expect(roomHeader(page).getByLabel('Mã phòng')).toHaveText(code)
}

/** Presses a seat's "Ngồi vào bàn" (a Blind seat asks nothing more) and waits until the seat is this player's. */
async function sit(page: Page, seat: number, phone: boolean): Promise<void> {
  const button = page.locator(`[data-seat="${seat}"]`).getByRole('button', { name: /Ngồi vào bàn/ })
  await (phone ? button.tap() : button.click())
  await expect(page.locator(`[data-seat="${seat}"][data-me="true"]`), 'the seat is mine').toHaveCount(1)
}

/** "Đứng dậy": a button under the felt on the desktop, an item of the header's "Thêm" menu on the upright phone (BP-31, R11). */
async function standUp(page: Page, seat: number, phone: boolean): Promise<void> {
  if (phone) {
    const menu = await openRoomMenu(page)
    await menu.getByRole('menuitem', { name: 'Đứng dậy', exact: true }).tap()
  } else {
    await page.getByRole('button', { name: 'Đứng dậy', exact: true }).click()
  }
  await expect(page.locator(`[data-seat="${seat}"][data-me="true"]`), 'the seat is given up').toHaveCount(0)
}

/** The page itself never scrolls, either way (the stage is `expectRoomFits`' business). */
async function expectNoPageScroll(page: Page, label: string): Promise<void> {
  const { down, across } = await page.evaluate(() => {
    const root = document.documentElement
    return { down: root.scrollHeight - root.clientHeight, across: root.scrollWidth - root.clientWidth }
  })
  expect({ down: Math.max(0, down), across: Math.max(0, across) }, `${label}: the page does not scroll`).toEqual({ down: 0, across: 0 })
}

/** The band is inside the screen, whole. */
async function expectBandOnScreen(page: Page, label: string): Promise<void> {
  const box = await band(page).boundingBox()
  const screen = page.viewportSize()!
  expect(box, `${label}: the band has a box`).not.toBeNull()
  const inside = box!.x >= -1 && box!.y >= -1 && box!.x + box!.width <= screen.width + 1 && box!.y + box!.height <= screen.height + 1
  expect(inside, `${label}: the band (${JSON.stringify(box)}) lies inside ${screen.width}×${screen.height}`).toBe(true)
}

/** Time spent measuring each page while the band shows, for the report (`test.info().annotations`). */
const timings: string[] = []

async function entranceSeenOnce(browser: Browser, id: string): Promise<void> {
  const bob = await newPlayer(browser, 'Bo', undefined, recordSounds)
  const alice = await newPlayer(browser, 'An', undefined, recordSounds)
  const carol = await newPlayer(browser, 'Ce', undefined, async (context) => {
    await recordSounds(context)
    await hideTab(context)
  })
  const players: Player[] = [bob, alice, carol]
  try {
    const screen = bob.page.viewportSize()!
    const phone = screen.width < 768
    expect(await carol.page.evaluate(() => document.hidden), 'Carol’s tab says it is hidden').toBe(true)
    expect(await bob.page.evaluate(() => document.hidden), 'Bob’s tab is visible').toBe(false)

    // The title: a GM (Bob) gives it, Alice puts it on.
    await promoteToGm(bob.page, bob.who.email)
    await grantItem(bob.page, await playerIdOf(alice.page), 'title_god', `ops ${id}: Thần Bài cho màn ra mắt`)
    await equipTitle(alice.page, 'title_god')

    // Bob's room, Bob standing; Carol and Alice come in by the code, each with a press.
    const code = await createBlind(bob.page, { name: unique(`Bàn ${id} `), bots: 1, mode: 'Hoàn toàn may rủi' })
    await join(carol.page, code)
    await join(alice.page, code)
    for (const p of players) expect(await heard(p.page, 'entrance.god'), `${p.who.displayName}: no entrance before the sit`).toEqual([])
    const seatText = await sitButtons(alice.page).first().locator('xpath=ancestor::*[@data-seat][1]').getAttribute('data-seat')
    const seat = Number(seatText)
    expect(Number.isInteger(seat), `a free seat (${seatText})`).toBe(true)

    // Alice sits: the whole room sees the band, with her name, and her seat flashes on Bob's table.
    const words = `Thần Bài ${alice.who.displayName} đã giáng lâm!`
    await sit(alice.page, seat, phone)
    const seenAt = new Map<Page, number>()
    for (const p of [bob, alice, carol]) {
      await expect(band(p.page), `${p.who.displayName} sees the band`).toHaveText(words, { timeout: 10_000 })
      seenAt.set(p.page, Date.now())
      await expect(band(p.page)).toHaveAttribute('data-title', 'god')
    }
    await expect(bob.page.locator(`[data-seat="${seat}"][data-entrance="god"]`), 'Alice’s seat flashes on Bob’s table').toHaveCount(1)

    // While it shows: inside the screen, nothing scrolls, no text over text — on Bob's table and Alice's own. Measured under
    // reduced motion, as the text-overlap rule always is: the band's shake moves its full-width box a few px past the edges.
    for (const p of [bob, alice]) {
      const from = Date.now()
      const label = `${id}, ${p === bob ? 'Bob' : 'Alice'} while the band shows`
      await p.page.emulateMedia({ reducedMotion: 'reduce' })
      try {
        await expectBandOnScreen(p.page, label)
        await expectNoPageScroll(p.page, label)
        await expectNoSidewaysScroll(p.page)
        await expectRoomFits(p.page, label, [screen])
        await expectNoTextOverlapAt(p.page, label)
        await expect(band(p.page), `${label}: the band was still up when it was measured`).toHaveCount(1, { timeout: 0 })
      } finally {
        await p.page.emulateMedia({ reducedMotion: null })
      }
      timings.push(`${id} ${p === bob ? 'Bob' : 'Alice'}: measured in ${Date.now() - from} ms`)
    }
    await shot(bob.page, `entrance-${id}-${test.info().project.name}-band`)

    // Gone within 4 s of showing, on every page.
    for (const p of players) {
      const left = Math.max(0, seenAt.get(p.page)! + 4_000 - Date.now())
      await expect(band(p.page), `${p.who.displayName}: the band is gone within 4 s`).toHaveCount(0, { timeout: left })
    }

    // The stinger, asked for once on each page: Alice's and Bob's sound (their clicks unlocked the audio), Carol's hidden tab
    // answers "hidden".
    for (const p of [bob, alice]) {
      await expect.poll(async () => (await heard(p.page, 'entrance.god')).length, { message: `${p.who.displayName} asked for the stinger` }).toBe(1)
      const [one] = await heard(p.page, 'entrance.god')
      expect(one!.outcome, `${p.who.displayName}: the stinger's outcome`).toBe('played')
      test.info().annotations.push({ type: 'sound', description: `${id} ${p === bob ? 'Bob' : 'Alice'}: entrance.god → ${one!.outcome}` })
    }
    await expect.poll(() => heard(carol.page, 'entrance.god'), { message: 'Carol’s hidden tab' }).toEqual([{ id: 'entrance.god', outcome: 'hidden' }])

    // Alice stands and sits again inside the ten minutes: no band within 5 s, and no second stinger.
    await standUp(alice.page, seat, phone)
    await sit(alice.page, seat, phone)
    const quietUntil = Date.now() + 5_000
    while (Date.now() < quietUntil) {
      for (const p of players) expect(await band(p.page).count(), `${p.who.displayName}: no band for the second sit`).toBe(0)
      await bob.page.waitForTimeout(150)
    }
    for (const p of players) expect(await heard(p.page, 'entrance.god'), `${p.who.displayName}: one stinger in all`).toHaveLength(1)
    await expectSeated(alice.page, phone ? { via: 'menu' } : undefined)

    // Bob mutes: the button names what a press will do next, and the choice is still there after F5.
    const header = roomHeader(bob.page)
    const mute = header.getByRole('button', { name: 'Tắt tiếng', exact: true })
    await (phone ? mute.tap() : mute.click())
    await expect(header.getByRole('button', { name: 'Bật tiếng', exact: true })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Tắt tiếng', exact: true })).toHaveCount(0)
    expect(await bob.page.evaluate(() => localStorage.getItem('bp.sound.muted'))).toBe('1')
    await bob.page.reload()
    await expect(roomHeader(bob.page).getByLabel('Mã phòng')).toHaveText(code)
    await expect(roomHeader(bob.page).getByRole('button', { name: 'Bật tiếng', exact: true }), 'muted after F5').toBeVisible()
    await shot(bob.page, `entrance-${id}-${test.info().project.name}-muted`)
  } finally {
    for (const line of timings.splice(0)) test.info().annotations.push({ type: 'timing', description: line })
    await closeAll(players)
  }
}

test('F-15: a player wearing Thần Bài sits down and the whole room sees "đã giáng lâm!" once, with its stinger, and the mute button holds after F5', async ({ browser }) => {
  test.setTimeout(240_000)
  await entranceSeenOnce(browser, 'F15')
})

test('F-15b: a player wearing Thần Bài sits down and the whole room sees "đã giáng lâm!" once, with its stinger, and the mute button holds after F5 @s25p', async ({ browser }) => {
  test.setTimeout(240_000)
  expect(test.info().project.name, 'the Galaxy S25 upright').toBe('s25p')
  await entranceSeenOnce(browser, 'F15b')
})
