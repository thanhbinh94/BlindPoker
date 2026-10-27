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
 * The upright phone and the phone on its side, from the draft to the result card. The draft is a bottom sheet (upright) or a
 * compact row (landscape): all of it on screen and out of the tray's way, nothing scrolls, no text over text. `phones` are the
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
  await shot(page, `chaos-${id}-${test.info().project.name}-draft`)

  await pickFirst(page, 'tap')
  await expect(cardIcons(page).first(), 'a card icon on a seat').toBeVisible({ timeout: 20_000 })

  // The hand plays by itself (pure luck); its result is the other state that has to fit. On a phone it is the strip above the
  // tray (BP-39), and the viewer's own seat steps aside while it is up (upright and on its side alike): the strip's row carries
  // the name, so the name is checked whole there.
  await expect(winnerCard(page)).toBeVisible({ timeout: 90_000 })
  await expectNoSidewaysScroll(page)
  // Measured once the cards' toasts have left (4 s): see `stripAtS25` for the stage while they stand.
  await expect(cardToasts(page)).toHaveCount(0, { timeout: 10_000 })
  await expectRoomFits(page, `${id}, the chaos result`, [screen])
  const name = winnerCard(page).getByText(who.who.displayName, { exact: true })
  await expect(name, 'the viewer’s row on the result strip').toBeVisible()
  const { scroll, client } = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(scroll, `${id}: "${who.who.displayName}" is whole on the strip`).toBeLessThanOrEqual(client)
  await expectNoTextOverlapAt(page, `${id}, the chaos result`)
  await shot(page, `chaos-${id}-${test.info().project.name}-result`)
  await leave(page)
}

test('F-13b: @mobile @s25p the chaos draft fits a phone — a sheet of three cards above the tray, then the result card', async ({ browser }) => {
  test.setTimeout(240_000)
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
  test.setTimeout(240_000)
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

/** What `watchChaos` saw, frame by frame, until `readWatch`. */
interface Watch {
  frames: number
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
    const w = { frames: 0, both: 0, maxCards: 0, mores: [] as string[], texts: [] as string[], hits: [] as string[], stop: false }
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
    return { frames: w.frames, both: w.both, maxCards: w.maxCards, mores: w.mores, texts: w.texts, hits: w.hits }
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
  const name = winnerCard(page).getByText(who.who.displayName, { exact: true })
  if ((await name.count()) > 0) {
    const { scroll, client } = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(scroll, `${id}: "${who.who.displayName}" is whole on the strip`).toBeLessThanOrEqual(client)
  }
  await expectNoTextOverlapAt(page, `${id}, the chaos result`)
  // The stage's own fit once the toasts have left: while three two-line toasts stand upright at 360 × 780, the felt can run
  // up to ~24 px past the stage (known-limitations, BP-39); the page itself never scrolls (checked above, toasts up).
  await expect(cardToasts(page)).toHaveCount(0, { timeout: 10_000 })
  await expectRoomFits(page, `${id}, the chaos result`, [screen])

  await skipDealsAtOnce(page, 'tap')
  const watch = await readWatch(page)
  expect(watch.frames, 'the room was watched').toBeGreaterThan(30)
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

/** Puts back what `readChaos` read: each gold card's rule (none → cleared) and the settings. */
async function restoreChaos(page: Page, before: GmChaos): Promise<void> {
  const changes = before.cards.filter((c) => c.tier === 'gold').map((c) => (c.rule === null ? { cardId: c.id, clear: true } : { cardId: c.id, ...c.rule }))
  const rules = await putApi(page, '/api/gm/chaos/rules', { changes, reason: 'ops F-13: trả lại như cũ' })
  const set = await putApi(page, '/api/gm/chaos/config', { config: before.config, reason: 'ops F-13: trả lại như cũ' })
  expect([rules.status, set.status], `the chaos settings are put back: ${JSON.stringify([rules.body, set.body])}`).toEqual([200, 200])
  const after = await readChaos(page)
  expect(after.config, 'the settings are as they were').toEqual(before.config)
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
  await expect(cardToasts(page)).toHaveCount(0, { timeout: 10_000 })
  const watch = await readWatch(page)

  expect(watch.maxCards, `at most ${cap} card toasts at once (${watch.texts.join(' | ')})`).toBeLessThanOrEqual(cap)
  expect(watch.maxCards, 'the band showed toasts').toBeGreaterThanOrEqual(1)
  expect(watch.mores.every((text) => /^\+\d+ thẻ khác$/.test(text)), `"+N thẻ khác": ${watch.mores.join(' | ')}`).toBe(true)
  const more = Math.max(...watch.mores.map((text) => Number(/\d+/.exec(text)?.[0] ?? '0')))
  expect(watch.maxCards + more, 'the toasts and "+N" account for the burst').toBeGreaterThanOrEqual(cap + 1)
  expect(watch.both, 'the toasts and the strip shared the screen (or the check proved nothing)').toBeGreaterThan(0)
  expect(watch.hits, `${id}: no toast meets the strip, the board or the tray`).toEqual([])
  await leave(page)
}

test('F-13f: @s25p @s25l eight seats fire their cards at one reveal on the Galaxy S25 — toasts up to the cap, the rest under "+N thẻ khác", none over the strip', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Bu')
  const page = phone.page
  let before: GmChaos | null = null
  try {
    await promoteToGm(page, phone.who.email)
    before = await readChaos(page)
    await forceRevealGold(page, before)
    const sideways = page.viewportSize()!.width > page.viewportSize()!.height
    await burstAtS25({ id: `F13f-${sideways ? '780x360' : '360x780'}`, who: phone, screen: sideways ? S25_SIDEWAYS : S25_UPRIGHT, cap: sideways ? 2 : 3 })
  } finally {
    if (before !== null) await restoreChaos(page, before)
    await closeAll([phone])
  }
})

test('F-13g: @s25p a bonus card earned at the table — tap it, "Dùng", and it fires in the next hand', async ({ browser }) => {
  test.setTimeout(300_000)
  const phone = await newPlayer(browser, 'Th')
  const page = phone.page
  const me = phone.who.displayName
  let before: GmChaos | null = null
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

    // A tap reads it — the popup says what it does — and only "Dùng" plays it.
    await first.tap()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(cardName)
    await shot(page, 'chaos-F13g-bonus-popup')
    await tip.getByRole('button', { name: 'Dùng', exact: true }).tap()
    const armed = bonus.locator(`[data-uid="${uid}"][data-armed="true"]`)
    await expect(armed, 'the card is set to play ("Đã đặt dùng")').toHaveCount(1)
    await expect(bonus.getByRole('button', { name: new RegExp(`^${cardName} \\(Vàng\\) · Đã đặt dùng$`) })).toHaveCount(1)
    await shot(page, 'chaos-F13g-armed')

    // Hand 2: the card fires at its reveal — the result's "Thẻ đã dùng" names it after the viewer, and it has left the hand.
    await watchChaos(page)
    await expect(resultCard(page), 'the next hand is dealt').toHaveCount(0, { timeout: 20_000 })
    await expect(resultCard(page)).toBeVisible({ timeout: 90_000 })
    const line = await usedLine(page)
    expect(line, `the result names the card (${line ?? 'no line'})`).toMatch(new RegExp(`(^|; |: )${me} — [^;]*${cardName}`))
    await expect(bonus.locator(`[data-uid="${uid}"]`), 'the played card has left the bonus hand').toHaveCount(0)
    const watch = await readWatch(page)
    expect(watch.hits, 'no toast meets the strip, the board or the tray').toEqual([])
    await shot(page, 'chaos-F13g-fired')
    await leave(page)
  } finally {
    if (before !== null) await restoreChaos(page, before)
    await closeAll([phone])
  }
})
