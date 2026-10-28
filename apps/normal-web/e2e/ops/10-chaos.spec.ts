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
  promoteToGm,
  putApi,
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
 *
 * BP-39 (spec 2026-10-27), round two: every result of a chaos table carries "Bỏ qua", and F-13 presses it each hand. The
 * Galaxy S25's two sizes (projects `s25p` 360 × 780 and `s25l` 780 × 360) play the draft again (F-13b/c), a result as a strip
 * above the tray with "Bỏ qua" dealing at once (F-13d/e), and two cases that need the cards forced through the GM console —
 * eight seats firing at one reveal (F-13f) and a bonus card played with "Dùng" (F-13g). Those two run last and put the
 * console's chaos settings back in a `finally`.
 *
 * BP-41 (spec 2026-10-28), round three: the 86 cards are all in play for F-13…F-13e. F-14a/b force a Thần Bài — the GM rules
 * leave only Cá chép hóa rồng and two waiting cards in the diamond draft, and the pack's cards (`chaos-cards.ops.json`, set in
 * `ops.config.ts`) start Cá chép at 100 % energy, which the rules alone cannot (A-ops) — and check the herald, the crown and the
 * tray's "no fold" at the desktop and the S25's sizes; F-14c/d force Xúc xắc vận may kim cương the same way and watch the roll.
 * They run last, after F-13f/g, and put the console's diamond rules and settings back.
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
  /** Results this seat pressed "Bỏ qua" on (BP-39). */
  skips: number
}

/** A result's "Bỏ qua" (BP-39): the button, never the tally "Bỏ qua 0/1" beside it. */
const skipButton = (page: Page): Locator => resultCard(page).getByRole('button', { name: 'Bỏ qua', exact: true })

/** The "Thẻ đã dùng" line of the result on screen, read whole (each card's name is a button inside it), or null. */
async function usedLine(page: Page): Promise<string | null> {
  const line = resultCard(page).getByText(/^Thẻ đã dùng/)
  if ((await line.count()) === 0) return null
  return (await line.first().evaluate((el) => el.textContent?.trim() ?? '').catch(() => '')) || null
}

/**
 * Plays the table on: every draft that opens is answered with its first card, a result card with a "Thẻ đã dùng" line is
 * read, "Bỏ qua" is pressed on every result (the only voter at the table, so the next hand deals at once), and the seat is
 * kept in the game. Ends once two drafts have come (the second is the 5th hand's) and a card has been used, or after
 * `MAX_HANDS` hands. Pure luck: nothing else asks this player for a move.
 */
async function playOn(page: Page, seat: number, baseline: number, how: 'click' | 'tap'): Promise<Run> {
  const run: Run = { drafts: 1, used: null, hands: 0, skips: 0 }
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
    if (run.used === null) run.used = await usedLine(page)
    const skip = skipButton(page)
    if ((await skip.count()) > 0 && (await skip.isEnabled().catch(() => false))) {
      // Read the line first: the press ends this result.
      if (run.used === null) run.used = await usedLine(page)
      try {
        await (how === 'tap' ? skip.tap({ timeout: 3_000 }) : skip.click({ timeout: 3_000 }))
        run.skips++
      } catch {
        // The result ended between the look and the press (its own time ran out): the next one is pressed instead.
      }
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
    expect(run.skips, '"Bỏ qua" was pressed on the results (the desktop card has it in its head)').toBeGreaterThanOrEqual(3)
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
 * The upright phone and the phone on its side, from the draft to the result card, and on to the next cycle's draft (BP-40). The
 * draft is a bottom sheet (upright) or a compact row (landscape): all of it on screen and out of the tray's way, nothing scrolls,
 * no text over text — the second draft, which follows a result, as much as the first. `phones` are the
 * sizes the case is written for (the 375 × 812 / 915 × 412 projects, and since BP-39 the Galaxy S25's): the project's own
 * viewport must be one of them.
 */
async function draftFitsPhone({ id, who, phones, via }: { id: string; who: Player; phones: Screen[]; via: 'sheet' | 'row' }): Promise<void> {
  const page = who.page
  const screen = page.viewportSize()!
  expect(phones, 'this project’s phone').toContainEqual(screen)
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'a touch screen').toBeGreaterThan(0)

  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })
  await expect(roomHeader(page).getByText('Hỗn loạn', { exact: true })).toBeVisible()
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)

  const opened = await readDraft(page)
  await expectDraftFits(page, { id, label: 'the chaos draft', names: opened.names, via })
  await shot(page, `chaos-${id}-${test.info().project.name}-draft`)

  await pickFirst(page, 'tap')
  await expect(cardIcons(page).first(), 'a card icon on a seat').toBeVisible({ timeout: 20_000 })

  // The hand plays by itself (pure luck); its result is the other state that has to fit. On a phone it is the strip above the
  // tray (BP-39), and the viewer's own seat steps aside while it is up (upright and on its side alike): the strip's row carries
  // the name, so the name is checked whole there.
  await expect(winnerCard(page)).toBeVisible({ timeout: 90_000 })
  await expectNoSidewaysScroll(page)
  // Measured as it opens — the cards' toasts may still stand beside it — and again once they have left (4 s): neither scrolls
  // the stage (BP-39 final wave, I2).
  await expectRoomFits(page, `${id}, the chaos result as it opens`, [screen])
  await expect(passingToasts(page)).toHaveCount(0, { timeout: 10_000 })
  await expectRoomFits(page, `${id}, the chaos result`, [screen])
  const name = winnerCard(page).getByText(who.who.displayName, { exact: true })
  await expect(name, 'the viewer’s row on the result strip').toBeVisible()
  const { scroll, client } = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(scroll, `${id}: "${who.who.displayName}" is whole on the strip`).toBeLessThanOrEqual(client)
  await expectNoTextOverlapAt(page, `${id}, the chaos result`)
  await shot(page, `chaos-${id}-${test.info().project.name}-result`)

  // BP-40 (bug-log H10): the second draft comes after a result — upright, the strip hid the viewer's seat, and giving it back
  // dealt the last hand's cards again from the deck, which the draft measured in flight and stopped over the board; on its side
  // the last hand's fan and lines lift the seat. It must fit as the first did. "Bỏ qua" deals each hand at once.
  const deadline = Date.now() + 150_000
  while ((await draftCards(page).count()) === 0 && Date.now() < deadline) {
    const skip = skipButton(page)
    if ((await skip.count()) > 0 && (await skip.isEnabled().catch(() => false))) await skip.tap({ timeout: 3_000 }).catch(() => undefined)
    await keepPlaying(page, 0)
    await page.waitForTimeout(250)
  }
  const again = await readDraft(page)
  // Measured as it opens — the deal it once measured lasts under half a second — and again once everything has settled.
  await expectDraftFits(page, { id, label: 'the second chaos draft as it opens', names: again.names, via, settle: false })
  await expectDraftFits(page, { id, label: 'the second chaos draft', names: again.names, via })
  await shot(page, `chaos-${id}-${test.info().project.name}-draft2`)
  await leave(page)
}

/**
 * The draft panel and its three cards sit whole inside the screen, above the tray (which covers the foot of the stage), and the
 * panel does not scroll inside: every card is all there to read. The upright phone stacks the table and draws the draft as a
 * sheet; the landscape frame is always the ring, with the row. `settle` (the default) waits for the panel's motion to end first.
 */
async function expectDraftFits(page: Page, { id, label, names, via, settle = true }: { id: string; label: string; names: string[]; via: 'sheet' | 'row'; settle?: boolean }): Promise<void> {
  const screen = page.viewportSize()!
  const panel = draftPanel(page)
  await expect(panel).toHaveAttribute('data-layout', via === 'sheet' ? 'stack' : 'ring')
  await expect(panel).toHaveAttribute('data-frame', via === 'sheet' ? 'desktop' : 'landscape')
  if (settle) await settled(panel)
  const tray = (await page.locator('footer').last().boundingBox())!
  const parts: [string, Locator][] = [['the panel', panel]]
  for (let i = 0; i < 3; i++) parts.push([`card ${i + 1} (${names[i]})`, draftCards(page).getByRole('button').nth(i)])
  for (const [part, locator] of parts) {
    const box = await locator.boundingBox()
    expect(box, `${id}, ${label}: ${part} has a box`).not.toBeNull()
    expect(box!.x, `${id}, ${label}: ${part} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.y, `${id}, ${label}: ${part} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${id}, ${label}: ${part} ends inside the screen`).toBeLessThanOrEqual(screen.width)
    expect(box!.y + box!.height, `${id}, ${label}: ${part} ends inside the screen and above the tray`).toBeLessThanOrEqual(Math.min(screen.height, tray.y > 0 ? tray.y + 1 : screen.height))
  }
  // No scroll inside the panel, and each card inside the panel's own box (a card cut at its foot was half of H10).
  const inside = await panel.evaluate((el) => {
    const p = el.getBoundingClientRect()
    const cards = Array.from(el.querySelectorAll('[aria-label="Ba thẻ để chọn"] button'), (card) => card.getBoundingClientRect())
    return { scroll: el.scrollHeight - el.clientHeight, cut: cards.filter((c) => c.top < p.top - 0.5 || c.bottom > p.bottom + 0.5).length }
  })
  expect(inside.cut, `${id}, ${label}: no card is cut by the panel's edge`).toBe(0)
  expect(inside.scroll, `${id}, ${label}: the panel does not scroll inside`).toBeLessThanOrEqual(1)
  if (settle) {
    await expectNoSidewaysScroll(page)
    await expectRoomFits(page, `${id}, ${label}`, [screen])
    await expectNoTextOverlapAt(page, `${id}, ${label}`)
  }
}

test('F-13b: @mobile @s25p the chaos draft fits a phone — a sheet of three cards above the tray, then the result card', async ({ browser }) => {
  test.setTimeout(420_000)
  // A one-letter stem on purpose: the viewer's strip also holds the host badge, a card icon and the bet chip, and a name of more than
  // about eight characters is cut with an ellipsis there (known-limitations); the rule 'the name whole' is for the names the pack uses.
  const phone = await newPlayer(browser, 'K')
  try {
    await draftFitsPhone({ id: 'F13b', who: phone, phones: [PHONE_SCREEN, S25_UPRIGHT], via: 'sheet' })
  } finally {
    await closeAll([phone])
  }
})

test('F-13c: @landscape @s25l the chaos draft fits a phone on its side — the compact row of three cards, then the result card', async ({ browser }) => {
  test.setTimeout(420_000)
  const phone = await newPlayer(browser, 'Cl')
  try {
    await draftFitsPhone({ id: 'F13c', who: phone, phones: [LANDSCAPE_SCREEN, S25_SIDEWAYS], via: 'row' })
  } finally {
    await closeAll([phone])
  }
})

/* ── BP-39: the Galaxy S25, the result strip, "Bỏ qua", the toasts and the bonus hand ───────────────────────────────── */

type Screen = { width: number; height: number }

/** The Galaxy S25 in CSS pixels, upright and on its side: the `s25p` and `s25l` projects. */
const S25_UPRIGHT: Screen = { width: 360, height: 780 }
const S25_SIDEWAYS: Screen = { width: 780, height: 360 }

/** The cards' toast band (`ChaosToasts`) and, in it, the "+N thẻ khác" toast's button. */
const toastBand = (page: Page): Locator => page.locator('[data-chaos-toasts]')
const cardToasts = (page: Page): Locator => toastBand(page).locator('[data-chaos-toast]')
/**
 * The toasts that leave by themselves, 4 s after they came: every card toast and "+N", but not "Thế giới đảo ngược"'s note, which is
 * pinned for the whole hand by design (BP-39) and so stands beside the result until the next hand. With 15 % diamond drafts since
 * BP-41 a table meets that card often enough that a wait for "no toast at all" ran into the next hand's (BP-41 Task 11).
 */
const passingToasts = (page: Page): Locator => toastBand(page).locator('[data-chaos-toast]:not([data-chaos-note])')

/** What `watchChaos` saw, frame by frame, until `readWatch`. */
interface Watch {
  frames: number
  /** Frames in which the result was on screen and still: the hit checks below had a result to check (P6). */
  resultFrames: number
  /** Frames in which the result and at least one toast were both on screen and still. */
  both: number
  /** The most card toasts on screen at once ("+N" and the reverse note not counted). */
  maxCards: number
  /** Each "+N thẻ khác" toast's text, as it changed. */
  mores: string[]
  /** Each card toast's text. */
  texts: string[]
  /** Boxes that met: "toast × result", "toast × board", "toast × tray", "result × board", "result × tray". */
  hits: string[]
}

/**
 * Watches the room on every animation frame until `readWatch`: the toasts, the result (strip or card), the board ("Bài chung")
 * and the tray ("Hành động" — its corners' own children when it hangs over the stage on its side; the footer bar upright). A
 * toast lives 4 s and the result opens up to 2.2 s after it (the reveal hold), so a look now and then could miss the moment
 * the two share the screen; this does not. A box still sliding in is skipped until it stands.
 */
async function watchChaos(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = { frames: 0, resultFrames: 0, both: 0, maxCards: 0, mores: [] as string[], texts: [] as string[], hits: [] as string[], stop: false }
    Object.assign(window, { __chaosWatch: w })
    const shown = (el: Element): boolean => el.checkVisibility() && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    const still = (el: Element): boolean => el.getAnimations().length === 0
    const meet = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const box = (r: DOMRect): string => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`
    const hit = (label: string, a: DOMRect, b: DOMRect): void => {
      const line = `${label}: ${box(a)} / ${box(b)}`
      if (w.hits.length < 20 && !w.hits.includes(line)) w.hits.push(line)
    }
    const add = (list: string[], text: string): void => {
      if (text !== '' && list.length < 60 && !list.includes(text)) list.push(text)
    }
    const tick = (): void => {
      if (w.stop) return
      w.frames += 1
      const result = Array.from(document.querySelectorAll('[role="group"][aria-labelledby]')).find((g) => {
        const title = document.getElementById((g.getAttribute('aria-labelledby') ?? '').split(' ')[0] ?? '')
        return /^(Người thắng|Ván bị hủy)$/.test(title?.textContent?.trim() ?? '')
      })
      const board = document.querySelector('[role="group"][aria-label="Bài chung"]')
      const tray = document.querySelector('[role="group"][aria-label="Hành động"]')
      const trayParts: DOMRect[] = []
      if (tray !== null && tray.getBoundingClientRect().width > 0) {
        if (getComputedStyle(tray).position === 'static' && tray.getBoundingClientRect().height === 0) {
          for (const part of Array.from(tray.querySelectorAll(':scope > div > *'))) if (shown(part)) trayParts.push(part.getBoundingClientRect())
        } else if (shown(tray)) trayParts.push(tray.getBoundingClientRect())
      }
      const footer = document.querySelector('[data-layout="stack"] footer')
      if (footer !== null && shown(footer)) trayParts.push(footer.getBoundingClientRect())

      const toasts = Array.from(document.querySelectorAll('[data-chaos-toasts] [data-chaos-toast]')).filter(shown)
      const cards = toasts.filter((t) => !t.hasAttribute('data-more') && !t.hasAttribute('data-chaos-note'))
      w.maxCards = Math.max(w.maxCards, cards.length)
      for (const t of cards) add(w.texts, t.textContent?.trim() ?? '')
      for (const t of toasts) if (t.hasAttribute('data-more')) add(w.mores, t.querySelector('button')?.textContent?.trim() ?? '')

      const standing = toasts.filter(still).map((t) => t.getBoundingClientRect())
      const boardBox = board !== null && shown(board) ? board.getBoundingClientRect() : null
      for (const t of standing) {
        if (boardBox !== null && meet(t, boardBox)) hit('toast × board', t, boardBox)
        for (const part of trayParts) if (meet(t, part)) hit('toast × tray', t, part)
      }
      if (result !== undefined && shown(result) && still(result)) {
        const r = result.getBoundingClientRect()
        w.resultFrames += 1
        if (standing.length > 0) w.both += 1
        for (const t of standing) if (meet(t, r)) hit('toast × result', t, r)
        if (boardBox !== null && meet(r, boardBox)) hit('result × board', r, boardBox)
        for (const part of trayParts) if (meet(r, part)) hit('result × tray', r, part)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function readWatch(page: Page): Promise<Watch> {
  return page.evaluate(() => {
    const w = (window as unknown as { __chaosWatch: Watch & { stop: boolean } }).__chaosWatch
    w.stop = true
    return { frames: w.frames, resultFrames: w.resultFrames, both: w.both, maxCards: w.maxCards, mores: w.mores, texts: w.texts, hits: w.hits }
  })
}

/** The page itself never scrolls, either way (the stage is `expectRoomFits`' business). */
async function expectNoPageScroll(page: Page, label: string): Promise<void> {
  const { down, across } = await page.evaluate(() => {
    const root = document.documentElement
    return { down: root.scrollHeight - root.clientHeight, across: root.scrollWidth - root.clientWidth }
  })
  expect({ down: Math.max(0, down), across: Math.max(0, across) }, `${label}: the page does not scroll`).toEqual({ down: 0, across: 0 })
}

/**
 * "Bỏ qua" with one human at the table (bots never vote): the tally reads "Bỏ qua 0/1", and a press deals the next hand at
 * once instead of at the countdown's end. Pressed on a result whose countdown still has 5 s or more, so "at once" is told
 * apart from the wait running out; a result already near its end is let go and the next one is used.
 */
async function skipDealsAtOnce(page: Page, how: 'click' | 'tap'): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const card = resultCard(page)
    await expect(card).toBeVisible({ timeout: 90_000 })
    const left = Number(/sau\s*(\d+)\s*giây/.exec(await card.innerText())?.[1] ?? '0')
    if (left >= 5) {
      await expect(card.getByText('Bỏ qua 0/1', { exact: true }), 'one voter, none has pressed').toBeVisible()
      const at = Date.now()
      await (how === 'tap' ? skipButton(page).tap() : skipButton(page).click())
      await expect(card, 'the next hand deals at once').toHaveCount(0, { timeout: 3_000 })
      expect(Date.now() - at, `"Bỏ qua" ended the wait well before its ${left} s`).toBeLessThan((left - 1) * 1000)
      return
    }
    await expect(card).toHaveCount(0, { timeout: 20_000 })
  }
  throw new Error('no result came with 5 s or more left on its countdown')
}

/**
 * F-13d / F-13e: a chaos table at the S25's size plays a hand to its result — the strip above the tray (upright) or at the
 * stage's foot (sideways) — and nothing scrolls, no text lies over text, the strip meets no toast, the board or the tray (in
 * every frame, `watchChaos`), the viewer's name is whole on its row; then "Bỏ qua" deals the next hand at once.
 */
async function stripAtS25({ id, who, screen }: { id: string; who: Player; screen: Screen }): Promise<void> {
  const page = who.page
  expect(page.viewportSize(), 'the S25 project').toEqual(screen)
  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })
  await expect(roomHeader(page).getByText('Không giới hạn').first(), 'a chaos table has no table limit').toBeVisible()
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)
  await readDraft(page)
  await watchChaos(page)
  await pickFirst(page, 'tap')

  await expect(resultCard(page)).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('[data-result-strip="open"]'), 'a phone shows the result as a strip').toHaveCount(1)
  await expect(resultCard(page).getByRole('button', { name: 'Đóng', exact: true }), 'the strip has no "Đóng"').toHaveCount(0)
  await shot(page, `chaos-${id}-strip`)
  await expectNoPageScroll(page, `${id}, the chaos result`)
  // The strip always carries the viewer's row (the winners and the viewer): it must be there, and whole (P6).
  const name = winnerCard(page).getByText(who.who.displayName, { exact: true })
  await expect(name, `${id}: the viewer's row is on the strip`).toBeVisible()
  const { scroll, client } = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(scroll, `${id}: "${who.who.displayName}" is whole on the strip`).toBeLessThanOrEqual(client)
  await expectNoTextOverlapAt(page, `${id}, the chaos result`)
  // The stage fits with the cards' toasts still up beside the strip, and again once they have left (BP-39 final wave, I2).
  await expectRoomFits(page, `${id}, the chaos result as it opens`, [screen])
  await expect(passingToasts(page)).toHaveCount(0, { timeout: 10_000 })
  await expectRoomFits(page, `${id}, the chaos result`, [screen])

  await skipDealsAtOnce(page, 'tap')
  const watch = await readWatch(page)
  expect(watch.frames, 'the room was watched').toBeGreaterThan(30)
  expect(watch.resultFrames, 'the result was on screen in the frames watched (or the hit checks proved nothing)').toBeGreaterThan(0)
  expect(watch.hits, `${id}: the strip meets no toast, board or tray, and no toast meets the board or tray`).toEqual([])
  await leave(page)
}

test('F-13d: @s25p a chaos result on the Galaxy S25 upright (360 × 780) — the strip above the tray, nothing overlaps, "Bỏ qua" deals at once', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Sp')
  try {
    await stripAtS25({ id: 'F13d', who: phone, screen: S25_UPRIGHT })
  } finally {
    await closeAll([phone])
  }
})

test('F-13e: @s25l a chaos result on the Galaxy S25 on its side (780 × 360) — the strip at the stage’s foot, nothing overlaps, "Bỏ qua" deals at once', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Sl')
  try {
    await stripAtS25({ id: 'F13e', who: phone, screen: S25_SIDEWAYS })
  } finally {
    await closeAll([phone])
  }
})

/* ── Forced through the GM console: these change the server's chaos settings, so they run last and put them back ────── */

/** Three gold cards that all fire at the reveal, and do so whatever the hand: every seat holding one fires at once. */
const REVEAL_GOLD = ['g_borrow', 'g_steal_all', 'g_redeal_board_1']
const REVEAL_GOLD_NAMES = ['Mượn lá', 'Rút lá cả bàn', 'Chia lại lá chung']

interface ChaosRule {
  enabled: boolean
  weight: number
  startsAt: number | null
  endsAt: number | null
}
interface GmChaos {
  cards: { id: string; tier: string; rule: ChaosRule | null }[]
  config: Record<string, unknown>
}

/** The chaos settings as the GM console reads them (`GET /api/gm/chaos`), to put back afterwards. */
async function readChaos(page: Page): Promise<GmChaos> {
  const res = await page.request.get('/api/gm/chaos')
  expect(res.ok(), `GET /api/gm/chaos returned ${res.status()}`).toBe(true)
  return (await res.json()) as GmChaos
}

const GM_REASON = 'ops F-13: chỉ ba thẻ vàng lúc lật bài'

/**
 * Only `REVEAL_GOLD` can be drawn: gold is the only tier drafted (`{ silver: 0, gold: 100, diamond: 0 }`) and every other gold
 * card is off — three left, the least a tier may keep. `config` adds to the settings (a points threshold, a result time).
 */
async function forceRevealGold(page: Page, before: GmChaos, config: Record<string, number> = {}): Promise<void> {
  const changes = before.cards
    .filter((c) => c.tier === 'gold')
    .map((c) => ({ cardId: c.id, enabled: REVEAL_GOLD.includes(c.id), weight: REVEAL_GOLD.includes(c.id) ? 1 : 0, startsAt: null, endsAt: null }))
  const rules = await putApi(page, '/api/gm/chaos/rules', { changes, reason: GM_REASON })
  expect(rules.status, `PUT /api/gm/chaos/rules: ${JSON.stringify(rules.body)}`).toBe(200)
  const set = await putApi(page, '/api/gm/chaos/config', { config: { ...before.config, tierWeights: { silver: 0, gold: 100, diamond: 0 }, ...config }, reason: GM_REASON })
  expect(set.status, `PUT /api/gm/chaos/config: ${JSON.stringify(set.body)}`).toBe(200)
}

/** Puts back what `readChaos` read: each card's rule of `tier` — the tier the case changed — (none → cleared) and the settings. */
async function restoreChaos(page: Page, before: GmChaos, tier: string): Promise<void> {
  const changes = before.cards.filter((c) => c.tier === tier).map((c) => (c.rule === null ? { cardId: c.id, clear: true } : { cardId: c.id, ...c.rule }))
  const rules = await putApi(page, '/api/gm/chaos/rules', { changes, reason: 'ops F-13: trả lại như cũ' })
  const set = await putApi(page, '/api/gm/chaos/config', { config: before.config, reason: 'ops F-13: trả lại như cũ' })
  expect([rules.status, set.status], `the chaos settings are put back: ${JSON.stringify([rules.body, set.body])}`).toEqual([200, 200])
  const after = await readChaos(page)
  expect(after.config, 'the settings are as they were').toEqual(before.config)
}

/**
 * The forced cases' clean-up: the settings go back, then the players' contexts close — the close runs even when the restore
 * fails, and a restore that fails after the case itself has failed is logged rather than thrown, so the case's own error is
 * the one reported (P6).
 */
async function restoreAndClose(page: Page, before: GmChaos | null, players: Player[], failed: boolean, tier = 'gold'): Promise<void> {
  try {
    if (before !== null) await restoreChaos(page, before, tier)
  } catch (err) {
    if (!failed) throw err
    console.error('ops F-13: the chaos settings could not be put back after the case failed', err)
  } finally {
    await closeAll(players)
  }
}

/**
 * F-13f: eight seats — one human, seven bots, pure luck so nobody folds — each holding one of `REVEAL_GOLD`, so all eight fire at
 * the first reveal and arrive in one batch with the settlement. The band shows its cap (3 upright, 2 sideways) and puts the rest
 * under "+N thẻ khác"; in no frame does a toast meet the result strip (nor the board or the tray).
 */
async function burstAtS25({ id, who, screen, cap }: { id: string; who: Player; screen: Screen; cap: number }): Promise<void> {
  const page = who.page
  expect(page.viewportSize(), 'the S25 project').toEqual(screen)
  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 7, maxPlayers: 8, mode: 'Hoàn toàn may rủi', chaos: 5 })
  await takeSeat(page, 0, undefined, { via: 'menu' })
  await ready(page)
  await start(page)
  const opened = await readDraft(page)
  expect(opened.title).toBe('Chọn một thẻ Vàng')
  expect([...opened.names].sort(), 'only the three reveal cards are drawn').toEqual([...REVEAL_GOLD_NAMES].sort())
  await watchChaos(page)
  await pickFirst(page, 'tap')

  await expect(toastBand(page).locator('[data-more] button'), 'the burst overflows into "+N thẻ khác"').toBeVisible({ timeout: 90_000 })
  await expect(resultCard(page)).toBeVisible({ timeout: 30_000 })
  await shot(page, `chaos-${id}-burst`)
  await expectNoPageScroll(page, `${id}, eight cards at one reveal`)
  await expectNoTextOverlapAt(page, `${id}, eight cards at one reveal`)
  // Watch until the batch has left (4 s from its arrival), so every frame the toasts shared with the strip is counted.
  await expect(passingToasts(page)).toHaveCount(0, { timeout: 10_000 })
  const watch = await readWatch(page)

  expect(watch.maxCards, `at most ${cap} card toasts at once (${watch.texts.join(' | ')})`).toBeLessThanOrEqual(cap)
  expect(watch.maxCards, 'the band showed toasts').toBeGreaterThanOrEqual(1)
  expect(watch.mores.every((text) => /^\+\d+ thẻ khác$/.test(text)), `"+N thẻ khác": ${watch.mores.join(' | ')}`).toBe(true)
  const more = Math.max(...watch.mores.map((text) => Number(/\d+/.exec(text)?.[0] ?? '0')))
  // Every one of the eight seats fires at least one card (a steal-all one per target): the toasts and "+N" hold them all (P6).
  expect(watch.maxCards + more, 'the toasts and "+N" account for all eight seats').toBeGreaterThanOrEqual(8)
  expect(watch.resultFrames, 'the result was on screen in the frames watched').toBeGreaterThan(0)
  expect(watch.both, 'the toasts and the strip shared the screen (or the check proved nothing)').toBeGreaterThan(0)
  expect(watch.hits, `${id}: no toast meets the strip, the board or the tray`).toEqual([])
  await leave(page)
}

test('F-13f: @s25p @s25l eight seats fire their cards at one reveal on the Galaxy S25 — toasts up to the cap, the rest under "+N thẻ khác", none over the strip', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Bu')
  const page = phone.page
  let before: GmChaos | null = null
  let failed = true
  try {
    await promoteToGm(page, phone.who.email)
    before = await readChaos(page)
    await forceRevealGold(page, before)
    const sideways = page.viewportSize()!.width > page.viewportSize()!.height
    // Two either way: sideways the band's own cap, upright an eight-seat table's (BP-39 final wave, I2).
    await burstAtS25({ id: `F13f-${sideways ? '780x360' : '360x780'}`, who: phone, screen: sideways ? S25_SIDEWAYS : S25_UPRIGHT, cap: 2 })
    failed = false
  } finally {
    await restoreAndClose(page, before, [phone], failed)
  }
})

test('F-13g: @s25p a bonus card earned at the table — tap it, "Dùng", and it fires in the next hand', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Th')
  const page = phone.page
  const me = phone.who.displayName
  let before: GmChaos | null = null
  let failed = true
  try {
    await promoteToGm(page, phone.who.email)
    before = await readChaos(page)
    // A point is a bonus card, and every hand gives one or two; the result waits 15 s, time to read the card and play it.
    await forceRevealGold(page, before, { pointsThreshold: 1, resultMs: 15_000 })
    await createBlind(page, { name: unique('Bàn F13g '), bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })
    await takeSeat(page, 0, undefined, { via: 'menu' })
    await ready(page)
    await start(page)
    await readDraft(page)
    await pickFirst(page, 'tap')

    // Hand 1 ends: the bonus hand ("Thẻ thưởng") shows its cards, by the felt's left edge, under the result strip.
    await expect(resultCard(page)).toBeVisible({ timeout: 90_000 })
    const bonus = page.getByRole('group', { name: 'Thẻ thưởng', exact: true })
    const first = bonus.getByRole('button').first()
    await expect(first, 'a bonus card was earned').toBeVisible({ timeout: 15_000 })
    const label = (await first.getAttribute('aria-label')) ?? ''
    expect(label, 'the card is named with its tier').toMatch(/^.+ \(Vàng\)/)
    const cardName = label.replace(/ \(.*$/, '')
    expect(REVEAL_GOLD_NAMES).toContain(cardName)
    const uid = await first.locator('[data-uid]').getAttribute('data-uid')

    // A tap reads it — the popup, a small dialog named by the card while it offers "Dùng", says what it does — and only "Dùng"
    // plays it.
    await first.tap()
    const tip = page.getByRole('dialog', { name: cardName, exact: true })
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(cardName)
    await shot(page, 'chaos-F13g-bonus-popup')
    await tip.getByRole('button', { name: 'Dùng', exact: true }).tap()
    const armed = bonus.locator(`[data-uid="${uid}"][data-armed="true"]`)
    await expect(armed, 'the card is set to play ("Đã đặt dùng")').toHaveCount(1)
    // Pressed between hands at a pure-luck table, it applies to the next hand, and says so (M3).
    await expect(bonus.getByRole('button', { name: new RegExp(`^${cardName} \\(Vàng\\) · Đã đặt dùng · ván sau$`) })).toHaveCount(1)
    await shot(page, 'chaos-F13g-armed')

    // Hand 2: the card fires at its reveal — the result's "Thẻ đã dùng" names it after the viewer, and it has left the hand.
    await watchChaos(page)
    await expect(resultCard(page), 'the next hand is dealt').toHaveCount(0, { timeout: 20_000 })
    await expect(resultCard(page)).toBeVisible({ timeout: 90_000 })
    const line = await usedLine(page)
    expect(line, `the result names the card (${line ?? 'no line'})`).toMatch(new RegExp(`(^|; |: )${me} — [^;]*${cardName}`))
    await expect(bonus.locator(`[data-uid="${uid}"]`), 'the played card has left the bonus hand').toHaveCount(0)
    const watch = await readWatch(page)
    expect(watch.resultFrames, 'the result was on screen in the frames watched').toBeGreaterThan(0)
    expect(watch.hits, 'no toast meets the strip, the board or the tray').toEqual([])
    await shot(page, 'chaos-F13g-fired')
    await leave(page)
    failed = false
  } finally {
    await restoreAndClose(page, before, [phone], failed)
  }
})

/* ── BP-41, round three: a Thần forced on the table, and the dice of fortune (spec 2026-10-28 §4.5, §5) ─────────────── */

/** Two diamond cards that only wait in the hand: neither fires unless a debuff or a bust comes, and none can come from the three. */
const DIAMOND_WAITERS = [
  { id: 'd_mirror', name: 'Gương phản chiếu' },
  { id: 'd_rescue', name: 'Cấp cứu kim cương' },
]
const CARP = { id: 'd_carp', name: 'Cá chép hóa rồng' }
const DIAMOND_DICE = { id: 'd_dice', name: 'Xúc xắc vận may kim cương' }

/**
 * Only `card` and `DIAMOND_WAITERS` can be drawn: diamond is the only tier drafted (`{ silver: 0, gold: 0, diamond: 100 }`) and
 * every other diamond card is off — three, the least a tier may keep — so every draft offers exactly those three. The rule
 * turns `card` on even where the pack's cards ship it off: Cá chép, which `chaos-cards.ops.json` starts at 100 % energy
 * (A-ops), so the seat holding it becomes the Thần at the first hand it is dealt.
 */
async function forceDiamond(page: Page, before: GmChaos, card: string): Promise<void> {
  const keep = [card, ...DIAMOND_WAITERS.map((c) => c.id)]
  const changes = before.cards
    .filter((c) => c.tier === 'diamond')
    .map((c) => ({ cardId: c.id, enabled: keep.includes(c.id), weight: keep.includes(c.id) ? 1 : 0, startsAt: null, endsAt: null }))
  const reason = `ops F-14: chỉ ba thẻ kim cương (${card})`
  const rules = await putApi(page, '/api/gm/chaos/rules', { changes, reason })
  expect(rules.status, `PUT /api/gm/chaos/rules: ${JSON.stringify(rules.body)}`).toBe(200)
  const set = await putApi(page, '/api/gm/chaos/config', { config: { ...before.config, tierWeights: { silver: 0, gold: 0, diamond: 100 } }, reason })
  expect(set.status, `PUT /api/gm/chaos/config: ${JSON.stringify(set.body)}`).toBe(200)
}

/** The draft's card named `name` (its own name part, not the button's longer label), pressed; waits for the draft to close. */
async function pickNamed(page: Page, name: string, how: 'click' | 'tap'): Promise<void> {
  const card = draftCards(page).getByRole('button').filter({ has: page.locator('[data-part="name"]').getByText(name, { exact: true }) })
  await expect(card, `"${name}" is on offer`).toHaveCount(1)
  await (how === 'tap' ? card.tap() : card.click())
  await expect(draftCards(page), 'the draft is over once this seat has chosen').toHaveCount(0, { timeout: 10_000 })
}

/** What `watchMoments` saw of the room's moment layer (the herald and the dice, `RoomScreen`'s `.moments`), frame by frame. */
interface Moments {
  /** Each herald line's text, as it showed. */
  heralds: string[]
  heraldFrames: number
  /** Each roll's row by name: whether its dice were seen tumbling, then the faces they landed on and the result, in words. */
  rolls: { name: string; tumbled: boolean; faces: string; result: string }[]
  diceFrames: number
  /** The herald's band or the dice panel reaching past the screen's edge: "<part>: <box>". */
  outside: string[]
  /** The most the page scrolled, either way, while a herald or the dice were up. */
  scroll: { down: number; across: number }
  /** The page's clock (`performance.now()`) at the first and the last frame the herald's band, or the dice panel, stood. */
  heraldSpan: { first: number; last: number } | null
  diceSpan: { first: number; last: number } | null
  /**
   * What told a roll while its dice still tumbled (Rulings 20b, 22): a 6-6-6 band, or a card toast naming the roller with its
   * faces. Empty when nothing gave the roll away.
   */
  spoilers: string[]
}

/**
 * Watches the moment layer on every animation frame until `readMoments`. A herald and a roll stand 3 s each, too short to look
 * at only now and then; this keeps what they said, whether the dice tumbled before they landed, and whether either reached
 * past the screen or made the page scroll while it stood.
 */
async function watchMoments(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = {
      heralds: [] as string[], heraldFrames: 0, rolls: [] as { name: string; tumbled: boolean; faces: string; result: string }[], diceFrames: 0, outside: [] as string[], scroll: { down: 0, across: 0 },
      heraldSpan: null as { first: number; last: number } | null, diceSpan: null as { first: number; last: number } | null, spoilers: [] as string[], stop: false,
    }
    const span = (was: { first: number; last: number } | null, at: number) => (was === null ? { first: at, last: at } : { first: was.first, last: at })
    const spoil = (what: string): void => {
      if (w.spoilers.length < 10 && !w.spoilers.includes(what)) w.spoilers.push(what)
    }
    Object.assign(window, { __moments: w })
    const root = document.documentElement
    const measure = (part: string, el: Element): void => {
      const r = el.getBoundingClientRect()
      if (r.left < -0.5 || r.top < -0.5 || r.right > root.clientWidth + 0.5 || r.bottom > root.clientHeight + 0.5) {
        const line = `${part}: ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`
        if (w.outside.length < 20 && !w.outside.includes(line)) w.outside.push(line)
      }
      w.scroll.down = Math.max(w.scroll.down, root.scrollHeight - root.clientHeight)
      w.scroll.across = Math.max(w.scroll.across, root.scrollWidth - root.clientWidth)
    }
    const tick = (): void => {
      if (w.stop) return
      const at = performance.now()
      const band = document.querySelector('button[data-herald]')
      // The band's own shake is clipped by the layer (`overflow: hidden`): measured once it stands.
      if (band !== null && band.getBoundingClientRect().height > 0) {
        w.heraldFrames += 1
        w.heraldSpan = span(w.heraldSpan, at)
        for (const line of Array.from(band.querySelectorAll('[data-kind]'))) {
          const text = line.textContent?.trim() ?? ''
          if (text !== '' && !w.heralds.includes(text)) w.heralds.push(text)
        }
        if (band.getAnimations().length === 0) measure('the herald', band)
      }
      const panel = document.querySelector('section[aria-label="Xúc xắc vận may"]')
      if (panel !== null) {
        w.diceFrames += 1
        w.diceSpan = span(w.diceSpan, at)
        measure('the dice', panel)
        // The panel is one button, a row in it per roll.
        for (const row of Array.from(panel.querySelectorAll(':scope > button > span'))) {
          const name = row.querySelector('strong')?.textContent?.trim() ?? ''
          let seen = w.rolls.find((r) => r.name === name)
          if (seen === undefined) {
            seen = { name, tumbled: false, faces: '', result: '' }
            w.rolls.push(seen)
          }
          if (row.getAttribute('data-rolling') === 'true') {
            seen.tumbled = true
            // Nothing tells this roll while it tumbles: not a 6-6-6 band, not a toast of the roller's card with faces in it.
            if (band?.querySelector('[data-kind="dice"]') != null) spoil(`the 6-6-6 band while ${name}'s dice tumbled`)
            for (const toast of Array.from(document.querySelectorAll('[data-chaos-toasts] [data-chaos-toast], [data-chaos-toasts] li'))) {
              const text = toast.textContent ?? ''
              if (text.startsWith(`${name} dùng`) && text.includes('Xúc xắc: ')) spoil(`a toast while ${name}'s dice tumbled: ${text}`)
            }
          } else {
            seen.faces = row.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
            seen.result = row.querySelector('[role="status"]')?.textContent?.trim() ?? ''
          }
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function readMoments(page: Page): Promise<Moments> {
  return page.evaluate(() => {
    const w = (window as unknown as { __moments: Moments & { stop: boolean } }).__moments
    w.stop = true
    return {
      heralds: w.heralds, heraldFrames: w.heraldFrames, rolls: w.rolls, diceFrames: w.diceFrames, outside: w.outside, scroll: w.scroll,
      heraldSpan: w.heraldSpan, diceSpan: w.diceSpan, spoilers: w.spoilers,
    }
  })
}

/**
 * Whether the text-overlap rule's last measurement fell while `part` stood: the rule stamps the page's clock when it reads the
 * boxes (`overlap.ts`), and `watchMoments` keeps the first and last frame each part stood, so the answer comes from the page's own
 * clock, however long the round trips to the test took (BP-41 fix wave: a `toHaveCount(1, { timeout: 100 })` afterwards failed
 * whenever the machine was slow, though the rule had measured the herald).
 */
async function measuredWhileUp(page: Page, part: 'herald' | 'dice'): Promise<{ at: number | null; span: { first: number; last: number } | null }> {
  return page.evaluate((which) => {
    const w = window as unknown as { __overlapMeasuredAt?: number; __moments: Moments }
    return { at: w.__overlapMeasuredAt ?? null, span: which === 'herald' ? w.__moments.heraldSpan : w.__moments.diceSpan }
  }, part)
}

/** Asserts the overlap rule measured while `part` stood (one frame's slack after its last frame). */
async function expectMeasuredWhileUp(page: Page, part: 'herald' | 'dice', label: string): Promise<void> {
  const { at, span } = await measuredWhileUp(page, part)
  expect(at, `${label}: the overlap rule stamped its measurement`).not.toBeNull()
  expect(span, `${label}: the frame record saw it`).not.toBeNull()
  expect(at! >= span!.first && at! <= span!.last + 50, `${label}: measured at ${Math.round(at!)} ms, stood ${Math.round(span!.first)}–${Math.round(span!.last)} ms`).toBe(true)
}

/** `text` as a regular expression that matches it literally. */
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const GOD_HERALD = /^Cảnh báo: (.+) đã tích luỹ đủ năng lượng và trở thành Thần Bài!$/

/**
 * F-14a / F-14b: a "Chơi hoặc bỏ" table of one human and three bots where every draft offers Cá chép hóa rồng at 100 % energy
 * (`forceDiamond`). The human takes it — a bot may too, and then any of them may win the throne, so the herald's name is read,
 * not assumed. Before the first hand the herald crosses the screen with the spec's words (§4.5) and makes nothing scroll or
 * overlap; the Thần's seat wears the crown with its hands left, and is the seat the herald named; while it reigns nobody may
 * fold (G11): where "Bỏ bài" stands, the tray says "Không được bỏ bài ván này", and "Chơi" plays the hand.
 *
 * Under reduced motion from the start: the herald stands 3 s, and the text-overlap rule (which measures under reduced motion
 * anyway) must not first wait out its entrance. The motion itself is the ui-kit's tests' (`ChaosHerald.test.tsx`).
 */
async function godReigns({ id, who, phone }: { id: string; who: Player; phone: boolean }): Promise<void> {
  const page = who.page
  const screen = page.viewportSize()!
  const how = phone ? 'tap' : 'click'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // 30 s a decision: time to measure the tray before the clock plays the hand for the seat.
  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 3, mode: 'Chơi hoặc bỏ', timer: '30 giây', chaos: 5 })
  await takeSeat(page, 0, undefined, phone ? { via: 'menu' } : undefined)
  await ready(page)
  await start(page)
  const opened = await readDraft(page)
  expect(opened.title).toBe('Chọn một thẻ Kim cương')
  expect([...opened.names].sort(), 'only Cá chép and the two waiting cards are drawn').toEqual([CARP.name, ...DIAMOND_WAITERS.map((c) => c.name)].sort())
  await watchMoments(page)
  await pickNamed(page, CARP.name, how)

  // The herald, before the first hand: the spec's words, a name in them.
  const herald = page.locator('button[data-herald="god"]')
  await expect(herald, 'the Thần’s herald crosses the screen').toBeVisible({ timeout: 30_000 })
  await expectNoPageScroll(page, `${id}, the Thần's herald`)
  await expectNoTextOverlapAt(page, `${id}, the Thần's herald`)
  await expectMeasuredWhileUp(page, 'herald', 'the herald stood when the overlap rule measured')
  await shot(page, `chaos-${id}-herald`)
  const line = (await herald.locator('[data-kind="god"]').first().textContent())?.trim() ?? ''
  const godName = GOD_HERALD.exec(line)?.[1]
  expect(godName, `the herald reads "Cảnh báo: … trở thành Thần Bài!" (${line})`).toBeDefined()

  // The crown on the Thần's seat, with the hands left of its five, and it is the seat the herald named.
  const god = page.locator('[data-seat][data-reign="god"]')
  await expect(god, 'one seat reigns').toHaveCount(1, { timeout: 15_000 })
  await expect(god.getByRole('img', { name: /^Thần Bài · còn [1-5] ván$/ }), 'the crown with the hands left').toBeVisible()
  expect(await god.evaluate((el) => el.textContent ?? ''), 'the crowned seat is the one the herald named').toContain(godName!)

  // No fold while the Thần reigns: the tray's note where "Bỏ bài" stood, and "Chơi" beside it.
  const note = page.locator('[data-no-fold]')
  await expect(note, 'the decision comes, without "Bỏ bài"').toBeVisible({ timeout: 60_000 })
  await expect(note).toHaveText('Không được bỏ bài ván này')
  await expect(page.locator('button:not([aria-pressed])').filter({ hasText: /^Bỏ bài$/ }), 'no "Bỏ bài" to press').toHaveCount(0)
  const play = page.locator('[data-no-fold] + button')
  await expect(play, '"Chơi" stands beside the note').toBeEnabled()
  await expect(god, 'the Thần still reigns over this decision').toHaveCount(1)
  await expectNoPageScroll(page, `${id}, the decision under the Thần`)
  await expectRoomFits(page, `${id}, the decision under the Thần`, [screen])
  await expectNoTextOverlapAt(page, `${id}, the decision under the Thần`)
  await shot(page, `chaos-${id}-no-fold`)
  await (how === 'tap' ? play.tap() : play.click())
  await expect(note, 'the seat has played').toHaveCount(0, { timeout: 10_000 })

  await expect(resultCard(page), 'the hand is played to its result').toBeVisible({ timeout: 90_000 })
  const moments = await readMoments(page)
  expect(moments.heraldFrames, 'the herald was watched').toBeGreaterThan(0)
  expect(moments.heralds.filter((text) => GOD_HERALD.test(text)), `the Thần's herald, once (${moments.heralds.join(' | ')})`).toEqual([line])
  expect(moments.outside, `${id}: the herald stays inside the screen`).toEqual([])
  expect(moments.scroll, `${id}: nothing scrolled the page while the herald stood`).toEqual({ down: 0, across: 0 })
  await leave(page)
}

test('F-14a: a Thần Bài forced on a "Chơi hoặc bỏ" table — the herald across the screen, the crown on its seat, and nobody may fold while it reigns', async ({ browser }) => {
  test.setTimeout(300_000)
  const player = await newPlayer(browser, 'Ca')
  const page = player.page
  let before: GmChaos | null = null
  let failed = true
  try {
    await promoteToGm(page, player.who.email)
    before = await readChaos(page)
    await forceDiamond(page, before, CARP.id)
    await godReigns({ id: 'F14a', who: player, phone: false })
    failed = false
  } finally {
    await restoreAndClose(page, before, [player], failed, 'diamond')
  }
})

test('F-14b: @s25p @s25l a Thần Bài on the Galaxy S25 — the herald fits the phone, the crown shows, and the tray says nobody may fold', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Cp')
  const page = phone.page
  let before: GmChaos | null = null
  let failed = true
  try {
    expect([S25_UPRIGHT, S25_SIDEWAYS], 'an S25 project').toContainEqual(page.viewportSize())
    await promoteToGm(page, phone.who.email)
    before = await readChaos(page)
    await forceDiamond(page, before, CARP.id)
    const sideways = page.viewportSize()!.width > page.viewportSize()!.height
    await godReigns({ id: `F14b-${sideways ? '780x360' : '360x780'}`, who: phone, phone: true })
    failed = false
  } finally {
    await restoreAndClose(page, before, [phone], failed, 'diamond')
  }
})

/**
 * F-14c / F-14d: a pure-luck table where every draft offers Xúc xắc vận may kim cương; the human takes it, so it rolls at the
 * end of the first hand (Ruling 5). The dice panel names the human, its three dice tumble ("Đang gieo…") and land on faces it
 * says in words, with what they gave; the panel stays inside the screen and scrolls nothing; and the roll's line joins the
 * cards' toasts — a toast of its own, or, since it comes after the settlement while the result is open (BP-39), under
 * "+N thẻ khác", whose list names it. The line says "Đang gieo…" until the dice land and then the faces the panel landed on
 * (Ruling 22); no frame shows the faces in a toast, or a 6-6-6 band, while the dice still tumble (Ruling 20b).
 */
async function diceRoll({ id, who, phone }: { id: string; who: Player; phone: boolean }): Promise<void> {
  const page = who.page
  const me = who.who.displayName
  const how = phone ? 'tap' : 'click'
  await createBlind(page, { name: unique(`Bàn ${id} `), bots: 3, mode: 'Hoàn toàn may rủi', chaos: 5 })
  await takeSeat(page, 0, undefined, phone ? { via: 'menu' } : undefined)
  await ready(page)
  await start(page)
  const opened = await readDraft(page)
  expect(opened.title).toBe('Chọn một thẻ Kim cương')
  expect([...opened.names].sort(), 'only the diamond dice and the two waiting cards are drawn').toEqual([DIAMOND_DICE.name, ...DIAMOND_WAITERS.map((c) => c.name)].sort())
  await watchChaos(page)
  await watchMoments(page)
  await pickNamed(page, DIAMOND_DICE.name, how)

  // The roll at the hand's end, for the whole table: the panel with a row for this seat. It stands 3 s and the roll's toast 4 s,
  // so the page is measured first, then the toast is read, and what the panel showed is taken from `watchMoments` afterwards.
  const panel = page.getByRole('region', { name: 'Xúc xắc vận may', exact: true })
  await expect(panel, 'the dice roll at the end of the first hand').toBeVisible({ timeout: 90_000 })
  await expect(panel.locator(':scope > button > span').filter({ has: page.locator('strong').getByText(me, { exact: true }) }), `a row for ${me}`).toHaveCount(1)
  await expectNoPageScroll(page, `${id}, the dice`)
  // The overlap rule measures under reduced motion, which lands the dice at once: what it measures is the landed panel.
  await expectNoTextOverlapAt(page, `${id}, the dice`)
  await expectMeasuredWhileUp(page, 'dice', 'the panel stood when the overlap rule measured')
  await shot(page, `chaos-${id}-dice`)

  // The roll's line among the cards' toasts: its own toast, or "+N thẻ khác"'s list. The toast watch stops before the list
  // opens, since the open list is meant to lie over the room.
  const mineSaid = new RegExp(`^${escapeRe(me)} dùng ${DIAMOND_DICE.name}`)
  const own = cardToasts(page).filter({ hasText: mineSaid })
  const more = toastBand(page).locator('[data-more] button')
  await expect(own.or(more).first(), 'the roll is told among the cards').toBeVisible({ timeout: 5_000 })
  const watch = await readWatch(page)
  // The line says "Đang gieo…" until the dice land (Ruling 22), then the faces: read it once they are in.
  let line: string
  if ((await own.count()) > 0) {
    await expect(own.first(), 'the toast tells the faces once the dice have landed').toContainText('Xúc xắc: ', { timeout: 5_000 })
    line = (await own.first().textContent())?.trim() ?? ''
  } else {
    await (how === 'tap' ? more.tap() : more.click())
    const listed = toastBand(page).getByRole('list', { name: 'Các thẻ đã dùng ván này' }).getByRole('listitem').filter({ hasText: mineSaid })
    await expect(listed.first(), '"+N thẻ khác" lists the roll').toBeVisible()
    await expect(listed.first(), 'the list tells the faces once the dice have landed').toContainText('Xúc xắc: ', { timeout: 5_000 })
    line = (await listed.first().textContent())?.trim() ?? ''
    await shot(page, `chaos-${id}-dice-list`)
    await page.keyboard.press('Escape')
  }
  // On a phone the result is the strip, which keeps clear of the board and the tray too; the desktop's result is the card in
  // the felt's middle, over the board by design, so there only the toasts are held to it.
  const hits = phone ? watch.hits : watch.hits.filter((hit) => hit.startsWith('toast ×'))
  expect(hits, `${id}: no toast meets the result, the board or the tray`).toEqual([])

  const moments = await readMoments(page)
  const roll = moments.rolls.find((r) => r.name === me)
  expect(roll, `the panel's rows: ${JSON.stringify(moments.rolls)}`).toBeDefined()
  expect(roll!.tumbled, 'the dice tumbled before they landed').toBe(true)
  expect(roll!.faces, 'three dice, said in words').toMatch(/^Xúc xắc: [1-6]-[1-6]-[1-6]$/)
  expect(roll!.result, 'what the roll gave').toMatch(/\S/)
  expect(roll!.result).not.toBe('Đang gieo…')
  expect(moments.outside, `${id}: the dice panel stays inside the screen`).toEqual([])
  expect(moments.scroll, `${id}: nothing scrolled the page while the dice stood`).toEqual({ down: 0, across: 0 })
  // Nothing gave the roll away while the dice tumbled: no 6-6-6 band (Ruling 20b), no toast with the faces (Ruling 22).
  expect(moments.spoilers, `${id}: the roll told before the dice landed`).toEqual([])
  // Once shown, the toast tells the same roll as the panel landed on: its faces, then what it gave.
  const faces = roll!.faces.replace(/^Xúc xắc: /, '')
  expect(line, 'the roll told among the cards, with its faces and result').toMatch(new RegExp(`^${escapeRe(me)} dùng ${DIAMOND_DICE.name}( — .+)? · Xúc xắc: ${faces} · .+$`))
  await leave(page)
}

test('F-14c: the dice of fortune — a diamond dice drafted, three dice tumble for the table at the hand’s end, land, and the roll is told among the cards', async ({ browser }) => {
  test.setTimeout(300_000)
  const player = await newPlayer(browser, 'Xx')
  const page = player.page
  let before: GmChaos | null = null
  let failed = true
  try {
    await promoteToGm(page, player.who.email)
    before = await readChaos(page)
    await forceDiamond(page, before, DIAMOND_DICE.id)
    await diceRoll({ id: 'F14c', who: player, phone: false })
    failed = false
  } finally {
    await restoreAndClose(page, before, [player], failed, 'diamond')
  }
})

test('F-14d: @s25p @s25l the dice of fortune on the Galaxy S25 — the panel fits the phone and the roll is told', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Xp')
  const page = phone.page
  let before: GmChaos | null = null
  let failed = true
  try {
    expect([S25_UPRIGHT, S25_SIDEWAYS], 'an S25 project').toContainEqual(page.viewportSize())
    await promoteToGm(page, phone.who.email)
    before = await readChaos(page)
    await forceDiamond(page, before, DIAMOND_DICE.id)
    const sideways = page.viewportSize()!.width > page.viewportSize()!.height
    await diceRoll({ id: `F14d-${sideways ? '780x360' : '360x780'}`, who: phone, phone: true })
    failed = false
  } finally {
    await restoreAndClose(page, before, [phone], failed, 'diamond')
  }
})
