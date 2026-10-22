import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import {
  account,
  balanceOf,
  balanceWhen,
  closeAll,
  createBlind,
  grantReputation,
  ledgerOf,
  newPlayer,
  parsePoints,
  playerIdOf,
  postApi,
  promoteToGm,
  registerPatiently,
  takeSeat,
  unique,
  type Account,
  type Player,
} from './ops-helpers.js'

/**
 * Operation test plan §5.P (Plan 27): the Cửa hàng, reputation and the wardrobe that feeds them, each title starting with
 * its case id. P-01 the welcome gift (spec 2026-10-21 §4 C1, C3); P-02 a purchase and the rank lock (§3 B2, B3); P-03 the
 * rank beside the name (§2 A4); P-04 and P-05 the wardrobe's loading (§6 Phần E, K5, R12): the Phòng thay đồ asks only
 * for the pictures near the screen (lazy figures and icons, a tint queue of four), and on a "fast 3G" line it has the
 * stage and the first row of cards drawn within two seconds.
 */

/** Every context here looks like the pack's own players: Vietnamese, Hà Nội time, dark. */
const LOOK = { locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', colorScheme: 'dark' } as const
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, deviceScaleFactor: 2 } as const
const LAPTOP = { viewport: { width: 1366, height: 768 } } as const

/** The stage's figure: the one `Chibi` the wardrobe labels with its own title. */
const STAGE = '[role="img"][aria-label="Phòng thay đồ"]'
/** How far from the screen a lazy figure or icon starts loading (`useInView`'s 200 px). */
const LAZY_MARGIN = 200
/** The most `/avatar/` requests one figure or one card may cost: a layer, its tint's layer and mask, the head mask. */
const PER_FIGURE = 8

/**
 * A fresh account whose welcome gift is already taken, so no dialog sits over the wardrobe; returns its cookies for
 * contexts of any shape. The first context is closed — every measured one starts with an empty HTTP cache.
 */
async function playerState(browser: Browser, stem: string): Promise<{ who: Account; state: Awaited<ReturnType<BrowserContext['storageState']>> }> {
  const context = await browser.newContext(LOOK)
  const page = await context.newPage()
  const who = account(stem)
  await registerPatiently(page, who)
  const welcome = await page.request.get('/api/welcome')
  if (welcome.ok()) {
    const status = (await welcome.json()) as { claimed?: boolean; choices?: { itemId: string; owned: boolean }[] }
    if (status.claimed !== true) await postApi(page, '/api/welcome/claim', { itemId: status.choices?.find((c) => !c.owned)?.itemId ?? null })
  }
  const state = await context.storageState()
  await context.close()
  return { who, state }
}

/* ── P-01 to P-03: the welcome gift, a purchase, the rank ─────────────────────────────────────────── */

const points = (n: number): string => new Intl.NumberFormat('vi-VN').format(n)

/** Every item's Vietnamese name, read from the app's own locale file so a rename cannot drift from this test. */
const ITEM_NAMES = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../src/locales/vi/normal.json', import.meta.url)), 'utf8')) as { items: Record<string, string> }
).items

/** One GM per worker, made on first use: reputation is never bought, so P-02 and P-03 have a GM grant it. */
let gm: Player | undefined
async function gmPage(browser: Browser): Promise<Page> {
  if (gm === undefined) {
    gm = await newPlayer(browser, 'ShopGM')
    await promoteToGm(gm.page, gm.who.email)
  }
  return gm.page
}
test.afterAll(async () => {
  await closeAll([gm])
  gm = undefined
})

/**
 * Lifts `page`'s player to Cao thủ (rank 3 at 400 reputation, `DEFAULT_RANKS`) and reloads, so every screen reads it;
 * `beforeReload` runs between the grant and the reload.
 */
async function makeCaoThu(browser: Browser, page: Page, beforeReload?: () => Promise<void>): Promise<void> {
  const standing = await grantReputation(await gmPage(browser), await playerIdOf(page), 400)
  expect(standing.rank, 'a fresh account with 400 reputation is Cao thủ').toBe(3)
  await beforeReload?.()
  await page.reload()
}

/** The shop's shelf of one rarity ("Theo độ hiếm"); the page opens on Thường. */
async function shelf(page: Page, rarity: 'Thường' | 'Hiếm' | 'Cực hiếm'): Promise<Locator> {
  await page.getByRole('group', { name: 'Theo độ hiếm' }).getByRole('button', { name: rarity, exact: true }).click()
  const key = rarity === 'Thường' ? 'common' : rarity === 'Hiếm' ? 'rare' : 'epic'
  return page.locator(`[data-shelf="${key}"]`)
}

/** Buys the item on `card` through its "Mua · N" button and the confirm dialog; resolves the price the button named. */
async function buyFrom(page: Page, card: Locator, name: string): Promise<number> {
  const buy = card.getByRole('button', { name: /^Mua · / })
  const price = parsePoints(await buy.innerText())
  expect(price, `${name} has a price`).toBeGreaterThan(0)
  await buy.click()
  const confirm = page.getByRole('dialog', { name: 'Mua món này?' })
  await expect(confirm).toContainText(`Mua ${name} với ${points(price)} điểm?`)
  await confirm.getByRole('button', { name: 'Mua', exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'đã vào tủ đồ' })).toHaveText(`${name} đã vào tủ đồ`)
  await expect(card).toContainText('✓ Đã có')
  return price
}

test('P-01 the welcome gift offers three rare items, the pick is worn, and a later sign-in with a reward waiting still opens Điểm danh', async ({
  browser,
}) => {
  // `newPlayer` closed the dialog with "Để sau": the gift waits behind the lobby's button, today's reward unclaimed.
  const player = await newPlayer(browser, 'Quà')
  const { page, who } = player
  let later: BrowserContext | undefined
  try {
    const face = page.getByRole('link', { name: 'Ảnh đại diện của bạn' }).locator('[data-chibi-hash]')
    await expect(face).toBeVisible()
    const before = await face.getAttribute('data-chibi-hash')

    await page.getByRole('button', { name: '🎁 Quà chào mừng' }).click()
    const dialog = page.getByRole('dialog', { name: 'Chào mừng đến Blind Luck Poker' })
    await expect(dialog.getByRole('list', { name: 'Quà chào mừng' }).getByRole('listitem')).toHaveCount(3)
    const claim = dialog.getByRole('button', { name: 'Nhận', exact: true })
    await expect(claim, 'nothing is picked yet').toBeDisabled()
    const pick = dialog.getByRole('button', { name: /Đồng phục chia bài/ })
    await pick.click()
    await expect(pick).toHaveAttribute('aria-pressed', 'true')
    await claim.click()
    await expect(dialog.getByRole('status')).toHaveText('Đồng phục chia bài đã vào tủ đồ, +100 danh vọng')
    await dialog.getByRole('button', { name: 'Vào chơi' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: '🎁 Quà chào mừng' }), 'the gift is taken: its button goes').toHaveCount(0)
    // The pick is worn at once: the lobby's own figure is redrawn in it.
    await expect.poll(() => face.getAttribute('data-chibi-hash'), { message: 'the lobby figure wears the pick' }).not.toBe(before)

    // The Phòng thay đồ lists it as owned (only owned cards show while "Hiện cả món chưa có" is off) and worn.
    await page.goto('/#/avatar?item=outfit_dealer01')
    const card = page.getByRole('button', { name: /^Đồng phục chia bài, / })
    await expect(card).toHaveAttribute('aria-label', /, Đang dùng$/)
    await expect(card).not.toHaveAttribute('aria-label', /Chưa có/)

    // A later sign-in from another browser: the gift is taken (no dialog), today's reward is not, so the app still opens
    // Điểm danh by itself — the only case left that walks the daily jump.
    later = await browser.newContext(LOOK)
    const again = await later.newPage()
    await again.goto('/#/login')
    await again.getByLabel('Email', { exact: true }).fill(who.email)
    await again.getByLabel('Mật khẩu', { exact: true }).fill(who.password)
    await again.getByRole('button', { name: 'Vào sảnh' }).click()
    await expect(again).toHaveURL(/#\/daily$/)
    await expect(again.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
    await expect(again.getByRole('button', { name: 'Nhận thưởng' })).toBeEnabled()
    await expect(again.getByRole('dialog', { name: 'Chào mừng đến Blind Luck Poker' })).toHaveCount(0)
  } finally {
    await later?.close()
    await closeAll([player])
  }
})

test('P-02 a common buys at rank 1, a rare needs Cao thủ, and the balance drops once @mobile', async ({ browser }) => {
  const player = await newPlayer(browser, 'Mua')
  const { page } = player
  try {
    await page.getByRole('navigation', { name: 'Phòng thay đồ và cửa hàng' }).getByRole('link', { name: 'Cửa hàng' }).click()
    await expect(page.getByRole('heading', { name: 'Cửa hàng', level: 1 })).toBeVisible()
    const start = await balanceOf(page)
    await expect(page.getByText(`Số dư: ${points(start)} điểm`)).toBeVisible()

    // A common sells at rank 1: Mũ len, from the Thường shelf.
    const commons = await shelf(page, 'Thường')
    const beanie = commons.locator('[data-item="head_beanie01"]')
    const beaniePrice = await buyFrom(page, beanie, 'Mũ len')
    expect(beaniePrice, 'a common is seeded at 10.000').toBe(10_000)
    expect(await balanceWhen(page, (n) => n === start - beaniePrice), 'the price leaves the balance').toBe(start - beaniePrice)
    await expect(page.getByText(`Số dư: ${points(start - beaniePrice)} điểm`)).toBeVisible()

    // A rare needs Cao thủ: its card names the rank and has no Mua.
    const rares = await shelf(page, 'Hiếm')
    const locked = rares.locator('[data-item]').filter({ hasText: '🔒 cần Cao thủ' }).first()
    await expect(locked).toBeVisible()
    const rareId = (await locked.getAttribute('data-item')) ?? ''
    expect(rareId).not.toBe('')
    await expect(locked.getByRole('button', { name: /^Mua · / })).toHaveCount(0)
    const refused = await postApi(page, '/api/shop/buy', { itemId: rareId, purchaseId: randomUUID() })
    expect((refused.body.error as { code?: string } | undefined)?.code, `the server refuses it too (${refused.status})`).toBe('RANK_TOO_LOW')

    // A GM grants 400 reputation: Cao thủ, and the rare buys.
    await makeCaoThu(browser, page)
    await expect(page.getByRole('heading', { name: 'Cửa hàng', level: 1 })).toBeVisible()
    const rare = (await shelf(page, 'Hiếm')).locator(`[data-item="${rareId}"]`)
    const rareName = ITEM_NAMES[rareId] ?? ''
    expect(rareName, `${rareId} has a Vietnamese name`).not.toBe('')
    const rarePrice = await buyFrom(page, rare, rareName)
    const end = start - beaniePrice - rarePrice
    expect(await balanceWhen(page, (n) => n === end)).toBe(end)

    // Once each: two purchase rows in the ledger, for the two prices, and nothing else charged.
    const purchases = (await ledgerOf(page)).filter((row) => row.reason === 'shop_purchase')
    expect(purchases.map((row) => row.amount).sort((a, b) => a - b)).toEqual([-beaniePrice, -rarePrice].sort((a, b) => a - b))
    await page.goto('/#/profile')
    await expect(page.getByRole('list', { name: 'Lịch sử điểm' }).getByRole('listitem').filter({ hasText: 'Mua ở Cửa hàng' })).toHaveCount(2)
  } finally {
    await closeAll([player])
  }
})

/** P-03 in either frame: a Cao thủ's profile reads the rank, then a seat at a bot table carries it beside the name. */
async function rankOnSeat(browser: Browser, stem: string, landscape: boolean): Promise<void> {
  const player = await newPlayer(browser, stem)
  const { page, who } = player
  try {
    // The lobby already read this player's avatar, rank 1 in it, and the browser keeps that answer for 60 s
    // (`private, max-age=60` on `GET /api/players/:id/avatar`). The grant's `RANK_UP` makes the app ask again past that
    // cache and write the new answer back: the lobby bar reads Cao thủ with no reload, and the reload after it reads the
    // same, never a Tân binh.
    await makeCaoThu(browser, page, () =>
      expect(page.locator('header [data-rank="3"]'), 'the lobby bar takes the rank-up at once').toHaveText('Cao thủ'),
    )
    await page.goto('/#/profile')
    await expect(page.locator('[data-reputation]')).toContainText('Danh vọng 400 · Cao thủ · còn 1.400 tới Bậc thầy')

    await createBlind(page, { name: unique('Bàn P03 '), bots: 1 })
    await takeSeat(page, 0, undefined, landscape ? { via: 'menu' } : undefined)
    const plate = page.locator('[data-seat="0"] [data-plate]')
    await expect(plate).toContainText(who.displayName)
    if (!landscape) {
      await expect(plate.locator('[data-rank="3"]'), 'the word beside the name, or after the stack').toHaveText('Cao thủ')
      return
    }
    // Held sideways the plate is narrow: the numeral in a pill, named for a screen reader, on the stack's line.
    const pill = plate.getByRole('img', { name: 'Cao thủ' })
    await expect(pill).toHaveText('III')
    await expect(pill).toHaveAttribute('data-rank', '3')
    const line = await pill.evaluate((el) => (el.parentElement?.textContent ?? '').trim())
    expect(line, 'the pill sits on the stack line, after the stack').toMatch(/^[\d.]+\s*III$/)
  } finally {
    await closeAll([player])
  }
}

test('P-03 the rank label stands beside the name on the seat and the profile', async ({ browser }) => {
  await rankOnSeat(browser, 'Bac', false)
})

test('P-03b the rank shows as the numeral III in a pill on the stack line of a narrow plate @landscape', async ({ browser }) => {
  await rankOnSeat(browser, 'BacNgang', true)
})

/** Counts every request for an avatar picture — a plain `<img>` and a tint render's `new Image()` alike. */
function avatarRequests(page: Page): { readonly count: number; readonly inFlight: number; reset: () => void } {
  let count = 0
  let inFlight = 0
  const isAvatar = (url: string): boolean => url.startsWith('http') && new URL(url).pathname.startsWith('/avatar/')
  page.on('request', (r) => {
    if (!isAvatar(r.url())) return
    count++
    inFlight++
  })
  const done = (r: { url: () => string }): void => {
    if (isAvatar(r.url())) inFlight--
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return {
    get count() {
      return count
    },
    get inFlight() {
      return inFlight
    },
    reset: () => {
      count = 0
    },
  }
}

/** Waits until no avatar request is in flight and none has started for `quietMs`. */
async function settle(page: Page, requests: { count: number; inFlight: number }, quietMs = 1_000): Promise<void> {
  let last = -1
  while (requests.count !== last || requests.inFlight > 0) {
    last = requests.count
    await page.waitForTimeout(quietMs)
  }
}

/** The figures and card pictures within the lazy margin of the screen (and shown at all: a closed `<details>`
 * hides its content), and how many of each the page holds in all. */
async function picturesNear(page: Page): Promise<{ near: number; all: number }> {
  return page.evaluate((margin) => {
    const pictures = Array.from(document.querySelectorAll<HTMLElement>('[data-chibi-hash], [data-item-icon], [data-icon-pending]'))
    const near = pictures.filter((el) => {
      const r = el.getBoundingClientRect()
      const shown = el.checkVisibility() && r.width + r.height > 0
      return shown && r.bottom > -margin && r.top < innerHeight + margin && r.right > -margin && r.left < innerWidth + margin
    })
    return { near: near.length, all: pictures.length }
  }, LAZY_MARGIN)
}

/** Opens the Phòng thay đồ in a fresh context and counts the avatar requests up to the first quiet second, then across
 * a switch to Mũ (every hat, the box ticked) and back. `eager` takes `IntersectionObserver` away, which is how every
 * picture loaded before plan 27: the baseline. */
async function measureWardrobe(browser: Browser, state: Awaited<ReturnType<BrowserContext['storageState']>>, eager: boolean) {
  const context = await browser.newContext({ ...LOOK, ...PHONE, storageState: state })
  const page = await context.newPage()
  if (eager) await page.addInitScript(() => Reflect.deleteProperty(window, 'IntersectionObserver'))
  const requests = avatarRequests(page)

  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', level: 1 })).toBeVisible()
  await expect(page.locator(STAGE).locator('img').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await settle(page, requests)
  const open = { requests: requests.count, ...(await picturesNear(page)) }

  // Every hat, owned or not: "Hiện cả món chưa có" lists the whole catalogue's Mũ tab.
  requests.reset()
  await page.getByRole('checkbox', { name: 'Hiện cả món chưa có' }).check()
  await page.getByRole('tablist', { name: 'Phòng thay đồ' }).getByRole('tab', { name: 'Trang phục' }).click()
  await expect(page.getByRole('tablist', { name: 'Trang phục' }).getByRole('tab', { name: /^Mũ/ })).toHaveAttribute('aria-selected', 'true')
  await settle(page, requests)
  const hats = { requests: requests.count, ...(await picturesNear(page)) }

  requests.reset()
  await page.getByRole('tablist', { name: 'Phòng thay đồ' }).getByRole('tab', { name: 'Ngoại hình' }).click()
  await expect(page.getByRole('tablist', { name: 'Ngoại hình' }).getByRole('tab', { name: /^Kiểu tóc/ })).toHaveAttribute('aria-selected', 'true')
  await settle(page, requests)
  const back = { requests: requests.count, ...(await picturesNear(page)) }

  await context.close()
  return { open, hats, back }
}

test('P-04 the wardrobe asks only for the figures on screen: ≤ (visible cards + stage) × 8 avatar requests before any scroll @mobile', async ({
  browser,
}) => {
  const { state } = await playerState(browser, 'Lazy')

  const lazy = await measureWardrobe(browser, state, false)
  const eager = await measureWardrobe(browser, state, true)
  // The numbers the report quotes (docs/normal-web.md → Wardrobe loading).
  console.log(`P-04 lazy  ${JSON.stringify(lazy)}`)
  console.log(`P-04 eager ${JSON.stringify(eager)}`)

  expect(lazy.open.requests, 'opening: the stage and the cards near the screen, no more').toBeLessThanOrEqual(lazy.open.near * PER_FIGURE)
  expect(lazy.hats.requests, 'Mũ with every hat listed: only the cards near the screen').toBeLessThanOrEqual(lazy.hats.near * PER_FIGURE)
  expect(lazy.hats.near, 'the Mũ tab holds more cards than one screen shows').toBeLessThan(lazy.hats.all)
  expect(lazy.back.requests, 'back to Kiểu tóc: no request storm').toBeLessThanOrEqual(lazy.back.near * PER_FIGURE)
  expect(lazy.hats.requests, 'fewer requests than when every card loaded').toBeLessThan(eager.hats.requests)
})

/**
 * In the page, whether the wardrobe has drawn as far as `need`: `'shown'` once every layer of the stage has loaded and
 * the panel's first row of cards is on screen (each card's box laid out, its picture loading or not); `'drawn'` once
 * the pictures of that row have loaded too.
 */
function wardrobeHasDrawn({ stage, need }: { stage: string; need: 'shown' | 'drawn' }): boolean {
  const loaded = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth > 0
  const figure = document.querySelector(stage)
  const stageImgs = figure === null ? [] : Array.from(figure.querySelectorAll('img'))
  if (stageImgs.length === 0 || !stageImgs.every(loaded)) return false
  const panel = document.querySelector('[role="tabpanel"]')
  if (panel === null) return false
  const cards = Array.from(panel.querySelectorAll('button')).filter((b) => b.querySelector('[data-item-icon], [data-icon-pending], [data-chibi-hash]') !== null)
  if (cards.length === 0) return false
  const top = cards[0]!.getBoundingClientRect().top
  if (top >= innerHeight) return false
  if (need === 'shown') return true
  const row = cards.filter((b) => Math.abs(b.getBoundingClientRect().top - top) < 4)
  return row.every((card) => {
    const imgs = Array.from(card.querySelectorAll('img'))
    return imgs.length > 0 && imgs.every(loaded)
  })
}

test('P-05 on a 3G profile the wardrobe draws the stage and the first row within 2 s at 1366×768 and 375×812', async ({ browser }) => {
  const { state } = await playerState(browser, 'Slow')

  for (const [name, shape] of [
    ['1366×768', LAPTOP],
    ['375×812', PHONE],
  ] as const) {
    // The app is already open, as when a player taps Phòng thay đồ; the wardrobe has never been opened. The profile, not
    // the lobby: a deep link is not steered to today's reward (`daily-nudge.ts`), and it draws the player's own figure.
    const context = await browser.newContext({ ...LOOK, ...shape, storageState: state })
    const page = await context.newPage()
    await page.goto('/#/profile')
    await expect(page.locator('[data-chibi-hash] img').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/#\/profile$/)

    // "Fast 3G": 1.6 Mbps down, 750 kbps up, 150 ms round trip.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 })

    const started = Date.now()
    await page.evaluate(() => {
      window.location.hash = '#/avatar'
    })
    await page.waitForFunction(wardrobeHasDrawn, { stage: STAGE, need: 'shown' as const }, { polling: 'raf', timeout: 30_000 })
    const shownMs = Date.now() - started
    await page.waitForFunction(wardrobeHasDrawn, { stage: STAGE, need: 'drawn' as const }, { polling: 'raf', timeout: 30_000 })
    const drawnMs = Date.now() - started
    console.log(`P-05 ${name}: stage drawn and first row on screen in ${shownMs} ms, first row's pictures in ${drawnMs} ms`)

    expect(shownMs, `${name}: the stage and the first row of cards within 2 s on fast 3G`).toBeLessThanOrEqual(2_000)
    // The first row's pictures are in time at both sizes: a 72 px hairstyle portrait on a DPR-2 phone loads its layers @1x
    // (Ruling 16), where @2x made the row ≈ 440 KB and 3.2 s.
    expect(drawnMs, `${name}: the first row's pictures within 2 s on fast 3G`).toBeLessThanOrEqual(2_000)

    await context.close()
  }
})
