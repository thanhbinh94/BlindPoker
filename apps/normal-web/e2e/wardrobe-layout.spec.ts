import { expect, test, type Page } from '@playwright/test'
import { expectNoTextOverlap } from './overlap.js'
import { expectRailFits } from './rail.js'
import { account, expectEvenCardRows, expectHeadingsClearOfCards, expectNoSidewaysScroll, goToWardrobeTab, register, SHOTS } from './support.js'

/**
 * The dressing-room layout itself (wardrobe redesign design §3, §8, §9): the group row and the active
 * group's sub-tab row must each render on one line at every breakpoint — no tab ever wraps onto a second
 * line, whether the row scrolls horizontally to fit (`.subTabs`/`.groupTabs`, `wardrobe.module.css`) or
 * simply has room for all of them. `WardrobeScreen.test.tsx` and `CategoryNav.test.tsx` already prove the
 * groups/tabs/counts under jsdom, which has no layout engine at all — this is the one place a real
 * browser lays the two tablists out and a wrap would actually show up.
 *
 * It also takes the rollout's own screenshots (design §9): one full page per breakpoint (desktop, tablet,
 * mobile) times theme (dark, light), for a human to compare against `docs/wardrobe-redesign/mockup-*.png`.
 * The theme comes from the app's own preference (`useThemePref`, `prefs.ts`) — visiting Settings and
 * picking "Sáng" — rather than poking `localStorage` directly, so this exercises the real switch too.
 *
 * Review 2026-09-29, No8b and No11b: every card grid (the wardrobe's tabs, the inventory) keeps the cards of one row
 * one height with their last rows on one line, a group heading keeps 16 px from the cards above it, and no visible text
 * overlaps other text (`expectNoTextOverlap` needs the reduced-motion media below, docs/ui-kit.md).
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const preview = (page: Page) => page.getByRole('img', { name: 'Phòng thay đồ' })

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', exact: true })).toBeVisible()
  await expect(preview(page)).toBeVisible()
}

/** Settings' own theme control (design §9's "light via the app's theme setting") — a device preference,
 * so it survives the navigation back to the wardrobe below without anything re-applying it. */
async function useLightTheme(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible()
  const light = page.getByRole('button', { name: 'Sáng', exact: true })
  await light.click()
  await expect(light).toHaveAttribute('aria-pressed', 'true')
}

/** Every `role="tab"` inside the named `tablist` must share one `offsetTop` — the row is one line,
 * whether every tab fits or the row scrolls sideways to hold them (never a second line). */
async function assertTablistOnOneLine(page: Page, tablistName: string): Promise<void> {
  const tops = await page
    .getByRole('tablist', { name: tablistName })
    .getByRole('tab')
    .evaluateAll((tabs: HTMLElement[]) => tabs.map((tab) => tab.offsetTop))
  expect(tops.length, `the "${tablistName}" tablist has tabs to check`).toBeGreaterThan(0)
  expect(new Set(tops).size, `every tab in "${tablistName}" shares one offsetTop (the row never wraps)`).toBe(1)
}

/**
 * The group row ("Phòng thay đồ", design §3.1's three groups) plus every group's own sub-tab row, ending back on
 * "Ngoại hình" — the default group and its default tab, "Thân nền" (design §5.3) — so the screenshot
 * taken right after always shows the same, mockup-matching view regardless of how many groups this walked
 * through first.
 */
async function assertNavNeverWraps(page: Page): Promise<void> {
  await assertTablistOnOneLine(page, 'Phòng thay đồ')
  await assertTablistOnOneLine(page, 'Ngoại hình')

  await goToWardrobeTab(page, 'Trang phục')
  await assertTablistOnOneLine(page, 'Trang phục')

  // "Danh hiệu & Huy hiệu" (design §4.4) is the longest sub-tab label in the whole screen — the one most
  // likely to force a wrap on a narrow phone.
  await goToWardrobeTab(page, 'Trang trí')
  await assertTablistOnOneLine(page, 'Trang trí')

  await goToWardrobeTab(page, 'Ngoại hình')
}

/** `expectNoTextOverlap` measures what is on screen, so a page taller than the window is walked in window-high steps
 * (100 px of overlap between two steps, so no line falls between them). Ends back at the top. */
async function expectNoTextOverlapDown(page: Page, label: string): Promise<void> {
  const view = page.viewportSize()?.height ?? 0
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; ; y += view - 100) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await expectNoTextOverlap(page, `${label}, scrolled to ${y} px`)
    if (y + view >= total) break
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * The card grids at the page's current viewport (No8b, No11b): the views of the user's screenshots — the inventory's
 * "Trang phục" group (No8-1), the wardrobe's hats (No8-2), "Danh hiệu & Huy hiệu" (No11-1) — and the other tabs that draw
 * cards. Fresh account: every card is the starter set, so all the words are locked and the hats carry colour dots,
 * which is where the rows were uneven. Ends in the inventory.
 */
async function expectCardGrids(page: Page): Promise<void> {
  const size = page.viewportSize()
  const where = `${size?.width ?? '?'}×${size?.height ?? '?'}`
  await openWardrobe(page)
  const panel = page.getByRole('tabpanel')

  // The default tab: the base cards — one of the three tabs measured for overlap, with the hats and the words below.
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Thân nền, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Ngoại hình, ${where}`)

  await goToWardrobeTab(page, 'Ngoại hình', 'Màu tóc')
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Màu tóc, ${where}`)
  await goToWardrobeTab(page, 'Ngoại hình', 'Màu mắt')
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Màu mắt, ${where}`)

  await goToWardrobeTab(page, 'Trang phục', 'Mũ')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Mũ, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Trang phục → Mũ, ${where}`)
  await goToWardrobeTab(page, 'Trang phục', 'Phụ kiện mặt')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Phụ kiện mặt, ${where}`)
  await goToWardrobeTab(page, 'Trang phục', 'Trang phục')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Trang phục, ${where}`)

  await goToWardrobeTab(page, 'Trang trí', 'Hào quang')
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Hào quang, ${where}`)
  await goToWardrobeTab(page, 'Trang trí', 'Khung')
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Khung, ${where}`)

  // "Tay nóng" ended a row of its own and "Huy hiệu" printed straight under it (No11-1).
  await goToWardrobeTab(page, 'Trang trí', 'Danh hiệu')
  await expect(page.getByRole('heading', { name: 'Huy hiệu', level: 3 })).toBeVisible()
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`)
  await expectHeadingsClearOfCards(panel, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`)

  await page.goto('/#/inventory')
  await expect(page.getByRole('heading', { name: 'Kho đồ', exact: true })).toBeVisible()
  await expect(page.locator('main ul li').first()).toBeVisible()
  const inventory = page.locator('main')
  await expectEvenCardRows(inventory, `inventory, ${where}`)
  await expectHeadingsClearOfCards(inventory, `inventory, ${where}`)
  await expectNoTextOverlapDown(page, `inventory, ${where}`)
}

/** Fills the naming dialog's default name and saves — the empty-slot flow (design §3.1 item 4): a click on
 * an empty portrait opens the dialog straight away, no menu first. */
async function saveOutfitInEmptySlot(page: Page, slot: number): Promise<void> {
  await page.getByRole('button', { name: `Ô ${slot} trống` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Lưu vào đây' }).click()
  await expect(dialog).toBeHidden()
}

/** The outfit menu's own box: it carries no role or id of its own (a plain `<div>`, `SavedOutfits.tsx`),
 * so this reads the parent shared by every one of its buttons — "Áp dụng" is always the first — rather
 * than adding a hook nothing else in this file needs. */
function outfitMenuBox(page: Page) {
  return page.getByRole('button', { name: 'Áp dụng' }).locator('xpath=..')
}

async function assertOutfitMenuWithinViewport(page: Page): Promise<void> {
  const box = await outfitMenuBox(page).boundingBox()
  expect(box, 'the outfit menu is open and has a bounding box').not.toBeNull()
  const width = page.viewportSize()?.width ?? 0
  expect(box!.x, 'the outfit menu does not spill past the left edge').toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, 'the outfit menu does not spill past the right edge').toBeLessThanOrEqual(width)
}

test.describe('Blind Luck Poker Normal — bố cục tủ đồ (Kế hoạch 14)', () => {
  test('desktop: nhóm và tab con không gãy dòng; ảnh chụp tối và sáng', async ({ page }) => {
    const who = account('Hoa')
    await register(page, who)
    await openWardrobe(page)

    await assertNavNeverWraps(page)

    // The selected base card is ringed in gold without changing size: every card in the base grid is as tall
    // as its neighbours (a 2 px border on the selected one used to shrink it and nudge its portrait).
    const heights = await page.getByRole('tabpanel').getByRole('button', { pressed: undefined }).evaluateAll((cards) =>
      cards.filter((c) => c.hasAttribute('aria-pressed')).map((c) => `${c.clientWidth}x${c.clientHeight}`),
    )
    expect(heights.length, 'the base grid lists every base').toBeGreaterThanOrEqual(6)
    expect(new Set(heights).size, `base card content boxes ${heights.join(', ')}`).toBe(1)
    await page.screenshot({ path: `${SHOTS}wardrobe-desktop-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-desktop-light.png`, fullPage: true })

    // V-fix, 2026-09-27: `ItemPreview` (`ItemTab.tsx`) is shared between the wardrobe's own cards and the
    // read-only inventory grid, and `.tileIcon` (`wardrobe.module.css`) used to carry the wardrobe card's
    // own breakpoint-driven size, resizing the inventory's icon right along with it. Reuses this test's
    // own account (no server round trip is cheap here, but a fresh registration is rate-limited, §19.2)
    // rather than opening a whole new test for one more assertion.
    await goToWardrobeTab(page, 'Trang phục', 'Trang phục')
    const wardrobeIcon = page.locator('img[data-item-icon]').first()
    await expect(wardrobeIcon).toBeVisible()
    const wardrobeBox = await wardrobeIcon.boundingBox()
    expect(wardrobeBox, 'the wardrobe card icon has a bounding box').not.toBeNull()
    // `.cardThumb .tileIcon`, desktop viewport (≥768 px): 100 px tall.
    expect(Math.abs(wardrobeBox!.height - 100), 'the wardrobe card icon is the larger, card-scoped size').toBeLessThan(1)

    await page.goto('/#/inventory')
    await expect(page.getByRole('heading', { name: 'Kho đồ', exact: true })).toBeVisible()
    const inventoryIcon = page.locator('img[data-item-icon]').first()
    await expect(inventoryIcon).toBeVisible()
    const inventoryBox = await inventoryIcon.boundingBox()
    expect(inventoryBox, 'the inventory card icon has a bounding box').not.toBeNull()
    // Layout audit C3 (2026-09-28): the inventory draws the wardrobe's own card now (`OwnedCard`), picture
    // box included, so an item's icon is the same size on both screens.
    expect(Math.abs(inventoryBox!.height - wardrobeBox!.height), 'the inventory card icon matches the wardrobe card icon').toBeLessThan(1)
    // No8b, No11b: even card rows, headings clear of the cards above, no text over text — at the user's screen
    // (1920×940, measured from their screenshots) and at a laptop's.
    for (const size of [
      { width: 1920, height: 940 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(size)
      await expectCardGrids(page)
    }
    // Bug 8: the account rail fits one row at every desktop width that used to overflow.
    for (const width of [700, 900, 1100, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectRailFits(page, width)
    }
  })

  test('máy tính bảng (900×1100): nhóm và tab con không gãy dòng; ảnh chụp tối và sáng', async ({ page }) => {
    // No dedicated Playwright project for the tablet band (design §3.3) — this sets the viewport inside
    // the desktop project's own browser instead of adding a fourth project just for two screenshots.
    await page.setViewportSize({ width: 900, height: 1100 })
    const who = account('Lien')
    await register(page, who)
    await openWardrobe(page)

    await assertNavNeverWraps(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-tablet-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-tablet-light.png`, fullPage: true })

    // No8b, No11b, on this account (registration is rate-limited): the tablet's 130 px columns.
    await expectCardGrids(page)
  })

  test('@mobile điện thoại: không cuộn ngang, nhóm và tab con không gãy dòng; ảnh chụp tối và sáng', async ({ page }) => {
    const who = account('Yen')
    await register(page, who)
    // Bug 8: on a phone the four tabs are icons over small labels and all fit, none scrolled away.
    await expectRailFits(page, page.viewportSize()!.width)
    await openWardrobe(page)

    await expectNoSidewaysScroll(page)
    await assertNavNeverWraps(page)
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-light.png`, fullPage: true })

    // No8b, No11b: three columns of ~100 px on a phone, where names wrap to three lines and rows differed most.
    await expectCardGrids(page)
    await expectNoSidewaysScroll(page)
    await openWardrobe(page)

    // V-fix, 2026-09-27 (design §3.1 item 4): `.outfitMenu` used to centre under every slot's portrait —
    // fine for the three middle ones, but wide enough to spill past the viewport on the two end slots
    // (measured at 400 px: left edge −24 px on slot 1, right edge 409 px on slot 5). Reuses this test's
    // own account, after both screenshots (registration is rate-limited, §19.2, and a saved outfit would
    // otherwise show up as a filled slot in either mockup-comparison screenshot above). The saved-outfit
    // section is a closed `<details>` on phone, so it has to be opened before either slot is reachable.
    await page.locator('summary', { hasText: 'Bộ đồ đã lưu' }).click()

    await saveOutfitInEmptySlot(page, 1)
    await page.getByRole('button', { name: 'Bộ đồ Bộ 1' }).click()
    await assertOutfitMenuWithinViewport(page)
    await expectNoSidewaysScroll(page)

    await saveOutfitInEmptySlot(page, 5)
    await page.getByRole('button', { name: 'Bộ đồ Bộ 5' }).click()
    await assertOutfitMenuWithinViewport(page)
    await expectNoSidewaysScroll(page)
  })
})
