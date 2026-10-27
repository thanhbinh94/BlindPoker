import { expect, test, type Locator, type Page } from '@playwright/test'
import { shot } from '../support.js'
import {
  closeAll,
  createBlind,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  expectRoomFits,
  historyOf,
  keepPlaying,
  LANDSCAPE_SCREEN,
  newPlayer,
  PHONE_SCREEN,
  ready,
  resultCard,
  settled,
  start,
  takeSeat,
  unique,
  type Player,
} from './ops-helpers.js'

/**
 * Plan 37, "Poker hỗn loạn" (spec 2026-10-26): a Blind table whose seats draft chaos cards. One real player and three bots,
 * on a pure-luck table so that nobody has a decision to make but the draft: the host sees the "Hỗn loạn" badge and the
 * lobby's ticket, the draft stands over the felt with three cards, one pick is enough, the seats wear their cards as icons,
 * a hand that fires a card says so in its "Thẻ đã dùng" line (and in the history), and the draft comes back after the
 * 5th hand. The desktop, the upright phone and the phone on its side each play it; the last two look at the draft itself.
 *
 * Which cards fire is the table's luck, and a hand with no card in play proves nothing about "Thẻ đã dùng": the case plays on
 * (twelve hands at most) until a result card has the line, rather than ask the production server for a seed.
 */

test.describe.configure({ mode: 'serial' })

const MAX_HANDS = 12

/** The draft's three cards (a group that exists only while this seat has an offer) and its panel (also the watcher's). */
const draftCards = (page: Page): Locator => page.getByRole('group', { name: 'Ba thẻ để chọn' })
const draftPanel = (page: Page): Locator => page.getByRole('region', { name: /^(Chọn một thẻ (Bạc|Vàng|Kim cương)|Các tay chơi đang chọn thẻ)$/ })
/** A card as a seat wears it: the tier-framed icon (`role="img"` with the card's name, its tier and the hands it has left). */
const cardIcons = (page: Page): Locator => page.locator('[role="img"][data-tier]')
const winnerCard = (page: Page) => page.getByRole('group', { name: 'Người thắng', exact: true })
const roomHeader = (page: Page) => page.locator('header').filter({ has: page.getByLabel('Mã phòng') })

async function leave(page: Page): Promise<void> {
  await roomHeader(page).getByRole('button', { name: 'Rời phòng' }).click()
  await expect(page).toHaveURL(/#\/lobby$/)
}

interface Opened {
  title: string
  names: string[]
}

/** Takes the first draft's measure: its title and the three cards' names. The draft waits 15 s for this seat, so there is time to look. */
async function readDraft(page: Page): Promise<Opened> {
  await expect(draftCards(page)).toBeVisible()
  const buttons = draftCards(page).getByRole('button')
  await expect(buttons, 'three cards on offer').toHaveCount(3)
  const title = (await draftPanel(page).getByRole('heading').innerText()).trim()
  expect(title).toMatch(/^Chọn một thẻ (Bạc|Vàng|Kim cương)$/)
  // The name's own part (`data-part="name"`): the button's accessible name also carries the tier and the line under it.
  const names = await buttons.evaluateAll((els) => els.map((el) => el.querySelector('[data-part="name"]')?.textContent?.trim() ?? ''))
  expect(names.every((name) => name !== ''), `every card has a name (${names.join(' | ')})`).toBe(true)
  return { title, names }
}

/** Picks the first card by `how` (a click, or a tap on a touch screen) and waits for the draft to close: the bots had chosen at once. */
async function pickFirst(page: Page, how: 'click' | 'tap'): Promise<void> {
  const first = draftCards(page).getByRole('button').first()
  if (how === 'tap') await first.tap()
  else await first.click()
  await expect(draftCards(page), 'the draft is over once this seat has chosen').toHaveCount(0, { timeout: 10_000 })
}

interface Run {
  /** Drafts seen, the first included. */
  drafts: number
  /** The text of the first "Thẻ đã dùng" line a result card showed, or null. */
  used: string | null
  /** Hands the history gained while this ran. */
  hands: number
}

/**
 * Plays the table on: every draft that opens is answered with its first card, a result card with a "Thẻ đã dùng" line is
 * read, and the seat is kept in the game. Ends once two drafts have come (the second is the 5th hand's) and a card has been
 * used, or after `MAX_HANDS` hands. Pure luck: nothing else asks this player for a move.
 */
async function playOn(page: Page, seat: number, baseline: number, how: 'click' | 'tap'): Promise<Run> {
  const run: Run = { drafts: 1, used: null, hands: 0 }
  let inDraft = false
  let nextLook = 0
  const deadline = Date.now() + 420_000
  while (Date.now() < deadline && !(run.drafts >= 2 && run.used !== null) && run.hands < MAX_HANDS) {
    if ((await draftCards(page).count()) > 0) {
      if (!inDraft) {
        inDraft = true
        // The first draft was answered before this loop; any other is the next cycle's.
        if (run.hands > 0) run.drafts++
      }
      const first = draftCards(page).getByRole('button').first()
      // Once picked, the cards stay up (`aria-disabled`) until every seat has chosen: nothing more to press.
      if ((await first.getAttribute('aria-disabled').catch(() => 'gone')) === null) {
        try {
          await (how === 'tap' ? first.tap({ timeout: 3_000 }) : first.click({ timeout: 3_000 }))
        } catch (err) {
          // The draft may close between the look and the press (its deadline); a draft still open that refused it is a failure.
          if ((await draftCards(page).count()) > 0) throw err
        }
      }
    } else if ((await draftPanel(page).count()) === 0) {
      inDraft = false
    }
    if (run.used === null) {
      const line = resultCard(page).getByText(/^Thẻ đã dùng/)
      if ((await line.count()) > 0) run.used = (await line.first().innerText().catch(() => '')) || null
    }
    if (Date.now() >= nextLook) {
      nextLook = Date.now() + 4_000
      run.hands = (await historyOf(page)).length - baseline
      await keepPlaying(page, seat)
    }
    await page.waitForTimeout(250)
  }
  // The count above is taken every few seconds: read once more, so "five hands before the second draft" is judged on the history as it stands.
  run.hands = (await historyOf(page)).length - baseline
  return run
}

test('F-13: a Poker hỗn loạn table — the badge, a draft of three, icons on the seats, "Thẻ đã dùng" on a result card and in the history, and the draft again after the 5th hand', async ({ browser }) => {
  test.setTimeout(540_000)
  const host = await newPlayer(browser, 'Hon')
  const guest = await newPlayer(browser, 'Xem')
  try {
    const page = host.page
    const name = unique('Bàn F13 ')
    await createBlind(page, { name, bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })

    // The room's header names the mode, and another player's lobby lists the table with the same badge.
    await expect(roomHeader(page).getByText('Hỗn loạn', { exact: true })).toBeVisible()
    await guest.page.goto('/#/lobby')
    const ticket = guest.page.getByRole('listitem').filter({ has: guest.page.getByRole('heading', { name }) })
    await expect(ticket).toBeVisible()
    await expect(ticket.getByText('Hỗn loạn', { exact: true })).toBeVisible()

    await takeSeat(page, 0)
    await ready(page)
    const before = (await historyOf(page)).length
    await start(page)

    // The draft: three cards of one tier, the bots have chosen at once, nothing overlaps; one pick ends it.
    const opened = await readDraft(page)
    await expectNoTextOverlapAt(page, 'Blind chaos, the draft')
    await settled(draftPanel(page)) // the panel fades in; a picture of it half-way shows the seats through it
    await shot(page, 'chaos-F13-draft')
    await pickFirst(page, 'click')

    // The seats wear what they drafted (a "now" card such as Tích lũy leaves no icon, so any seat's icon will do), and the
    // hand is dealt.
    await expect(cardIcons(page).first(), `a card icon on a seat (the host drafted ${opened.names[0]})`).toBeVisible({ timeout: 20_000 })
    await shot(page, 'chaos-F13-seats')

    const run = await playOn(page, 0, before, 'click')
    expect(run.used, `a result card said "Thẻ đã dùng" within ${MAX_HANDS} hands (played ${run.hands})`).not.toBeNull()
    expect(run.used).toMatch(/^Thẻ đã dùng: .+ — .+/)
    expect(run.drafts, 'the draft came back for the 6th hand').toBeGreaterThanOrEqual(2)
    expect(run.hands, 'five hands were played before the second draft').toBeGreaterThanOrEqual(5)
    await shot(page, 'chaos-F13-after')

    // The history carries the same line, from the hand's own record: the API, then the profile page.
    const hands = await historyOf(page)
    const fired = hands.find((hand) => (hand.chaosUsed ?? []).length > 0)
    expect(fired, 'a hand in the history has chaosUsed').toBeDefined()
    for (const use of fired!.chaosUsed!) {
      expect(use.cardId).toMatch(/^[sgd]_/)
      expect(['applied', 'blocked', 'reflected', 'fizzled']).toContain(use.outcome)
    }
    await page.goto('/#/profile')
    const line = page.getByRole('list', { name: 'Ván gần đây' }).getByText('Thẻ đã dùng').first()
    await line.scrollIntoViewIfNeeded()
    await expect(line).toBeVisible({ timeout: 15_000 })
    await shot(page, 'chaos-F13-history')
  } finally {
    await closeAll([host, guest])
  }
})

/**
 * The upright phone and the phone on its side, from the draft to the result card. The draft is a bottom sheet (upright) or a
 * compact row (landscape): all of it on screen and out of the tray's way, nothing scrolls, no text over text.
 */
async function draftFitsPhone({ id, who, screen, via }: { id: string; who: Player; screen: { width: number; height: number }; via: 'sheet' | 'row' }): Promise<void> {
  const page = who.page
  expect(page.viewportSize(), 'this project’s phone').toEqual(screen)
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'a touch screen').toBeGreaterThan(0)

  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })
  await expect(roomHeader(page).getByText('Hỗn loạn', { exact: true })).toBeVisible()
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)

  const opened = await readDraft(page)
  const panel = draftPanel(page)
  // The upright phone stacks the table and draws the draft as a sheet; the landscape frame is always the ring, with the row.
  await expect(panel).toHaveAttribute('data-layout', via === 'sheet' ? 'stack' : 'ring')
  await expect(panel).toHaveAttribute('data-frame', via === 'sheet' ? 'desktop' : 'landscape')
  // The panel and its three cards sit whole inside the screen, above the tray (which covers the foot of the stage).
  const tray = (await page.locator('footer').last().boundingBox())!
  const parts: [string, Locator][] = [['the panel', panel]]
  for (let i = 0; i < 3; i++) parts.push([`card ${i + 1} (${opened.names[i]})`, draftCards(page).getByRole('button').nth(i)])
  for (const [label, part] of parts) {
    const box = await part.boundingBox()
    expect(box, `${label} has a box`).not.toBeNull()
    expect(box!.x, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.y, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label} ends inside the screen`).toBeLessThanOrEqual(screen.width)
    expect(box!.y + box!.height, `${label} ends inside the screen and above the tray`).toBeLessThanOrEqual(Math.min(screen.height, tray.y > 0 ? tray.y + 1 : screen.height))
  }
  await expectNoSidewaysScroll(page)
  await expectRoomFits(page, `${id}, the chaos draft`, [screen])
  await expectNoTextOverlapAt(page, `${id}, the chaos draft`)
  await settled(panel)
  await shot(page, `chaos-${id}-draft`)

  await pickFirst(page, 'tap')
  await expect(cardIcons(page).first(), 'a card icon on a seat').toBeVisible({ timeout: 20_000 })

  // The hand plays by itself (pure luck); its result is the other state that has to fit. On a phone it is the strip above the
  // tray (BP-39), and the viewer's own seat steps aside while it is up (upright and on its side alike): the strip's row carries
  // the name, so the name is checked whole there.
  await expect(winnerCard(page)).toBeVisible({ timeout: 90_000 })
  await expectNoSidewaysScroll(page)
  await expectRoomFits(page, `${id}, the chaos result`, [screen])
  const name = winnerCard(page).getByText(who.who.displayName, { exact: true })
  await expect(name, 'the viewer’s row on the result strip').toBeVisible()
  const { scroll, client } = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(scroll, `${id}: "${who.who.displayName}" is whole on the strip`).toBeLessThanOrEqual(client)
  await expectNoTextOverlapAt(page, `${id}, the chaos result`)
  await shot(page, `chaos-${id}-result`)
  await leave(page)
}

test('F-13b: @mobile the chaos draft fits a phone — a sheet of three cards above the tray, then the result card', async ({ browser }) => {
  test.setTimeout(240_000)
  // A one-letter stem on purpose: the viewer's strip also holds the host badge, a card icon and the bet chip, and a name of more than
  // about eight characters is cut with an ellipsis there (known-limitations); the rule 'the name whole' is for the names the pack uses.
  const phone = await newPlayer(browser, 'K')
  try {
    await draftFitsPhone({ id: 'F13b', who: phone, screen: PHONE_SCREEN, via: 'sheet' })
  } finally {
    await closeAll([phone])
  }
})

test('F-13c: @landscape the chaos draft fits a phone on its side — the compact row of three cards, then the result card', async ({ browser }) => {
  test.setTimeout(240_000)
  const phone = await newPlayer(browser, 'Cl')
  try {
    await draftFitsPhone({ id: 'F13c', who: phone, screen: LANDSCAPE_SCREEN, via: 'row' })
  } finally {
    await closeAll([phone])
  }
})
