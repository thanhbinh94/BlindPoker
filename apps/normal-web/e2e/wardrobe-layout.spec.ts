import { expect, test, type Page } from '@playwright/test'
import { expectRailFits } from './rail.js'
import {
  account,
  expectDotTarget,
  expectEvenCardRows,
  expectHeadingsClearOfCards,
  expectNoSidewaysScroll,
  expectNoTextOverlapAt,
  expectNoTextOverlapDown,
  goToWardrobeTab,
  register,
  SHOTS,
  USER_SCREEN,
} from './support.js'

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
 * Review 2026-09-29, No8b and No11b: every card grid (the wardrobe's tabs) keeps the cards of one row one height,
 * the rarity line directly under the name (so on one line for names as tall) and the footer — hint, colour dots —
 * ending on the card's bottom line; a group heading keeps 16 px from the cards above it; and no visible
 * text overlaps other text (`expectNoTextOverlap` needs the reduced-motion media below, docs/ui-kit.md).
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const preview = (page: Page) => page.getByRole('img', { name: 'Phòng thay đồ' })

/** Review 2026-09-29, No11a: the box that also lists what the account does not own yet — unticked whenever the
 * wardrobe opens, hidden on "Nhân vật". Ticked with `check()` (idempotent), never `click()`: a `page.goto` to the
 * URL the page is already on keeps the document, and with it the wardrobe's state. */
const showLockedBox = (page: Page) => page.getByRole('checkbox', { name: 'Hiện cả món chưa có' })

/** What a tab says in place of its grid when the box is unticked and nothing in it is owned (No11a). */
const EMPTY_OWNED = 'Bạn chưa có món nào ở mục này.'

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', exact: true })).toBeVisible()
  await expect(preview(page)).toBeVisible()
}

/** The wardrobe as a new visit finds it (default tab, box unticked): `openWardrobe` alone is a no-op when the page is
 * already on `#/avatar`, so this comes from Settings, the lightest screen, which unmounts it. */
async function openWardrobeFresh(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible()
  await openWardrobe(page)
}

/** Settings' own theme control (design §9's "light via the app's theme setting") — a device preference,
 * so it survives the navigation back to the wardrobe below without anything re-applying it. */
async function useLightTheme(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible()
  const light = page.getByRole('button', { name: 'Sáng', exact: true })
  await light.click()
  await expect(light).toHaveAttribute('aria-pressed', 'true')
  // No11b: Settings itself, in the light theme, at this test's viewport (desktop, tablet, phone).
  const size = page.viewportSize()
  await expectNoTextOverlapDown(page, `settings, light theme, ${size?.width ?? '?'}×${size?.height ?? '?'}`)
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
 * "Ngoại hình" — the default group and its default tab, "Nhân vật" (design §5.3) — so the screenshot
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

/**
 * The card grids at the page's current viewport (No8b, No11b): the views of the user's screenshots — the old
 * inventory's "Trang phục" group (No8-1; the inventory has since folded into the wardrobe, No5, whose "Quần áo" tab
 * is that view now), the wardrobe's hats (No8-2), "Danh hiệu & Huy hiệu" (No11-1) — and the other tabs that draw
 * cards. Fresh account: every card is the starter set, so all the words are locked and the hats carry colour dots,
 * which is where the rows were uneven. The grids are measured with "Hiện cả món chưa có" ticked (No11a): unticked, a
 * fresh account's hats, faces, auras, frames and words are one line each, not a grid.
 */
async function expectCardGrids(page: Page): Promise<void> {
  const size = page.viewportSize()
  const where = `${size?.width ?? '?'}×${size?.height ?? '?'}`
  // A fresh visit every time, so a second viewport does not start where the first one ended.
  await openWardrobeFresh(page)
  const panel = page.getByRole('tabpanel')

  // The default tab: the base cards — one of the four tabs measured for overlap, with the hats, the clothes and the
  // words below.
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Nhân vật, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Ngoại hình, ${where}`)

  await goToWardrobeTab(page, 'Ngoại hình', 'Màu tóc')
  // The box stays ticked for every tab below (it keeps its value across tab changes).
  await showLockedBox(page).check()
  await expect(showLockedBox(page)).toBeChecked()
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Màu tóc, ${where}`)
  await goToWardrobeTab(page, 'Ngoại hình', 'Màu mắt')
  await expectEvenCardRows(panel, `wardrobe, Ngoại hình → Màu mắt, ${where}`)

  await goToWardrobeTab(page, 'Trang phục', 'Mũ')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Mũ, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Trang phục → Mũ, ${where}`)
  await goToWardrobeTab(page, 'Trang phục', 'Phụ kiện mặt')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Phụ kiện mặt, ${where}`)
  await goToWardrobeTab(page, 'Trang phục', 'Quần áo')
  await expectEvenCardRows(panel, `wardrobe, Trang phục → Quần áo, ${where}`)
  // The view of the user's No8 screenshot (the old inventory's "Trang phục" group): its colour dots and lock hints.
  await expectNoTextOverlapDown(page, `wardrobe, Trang phục → Quần áo, ${where}`)

  await goToWardrobeTab(page, 'Trang trí', 'Hào quang')
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Hào quang, ${where}`)
  await goToWardrobeTab(page, 'Trang trí', 'Khung')
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Khung, ${where}`)

  // "Tay nóng" ended a row of its own and "Huy hiệu" printed straight under it (No11-1).
  await goToWardrobeTab(page, 'Trang trí', 'Danh hiệu')
  await expect(page.getByRole('heading', { name: 'Huy hiệu', level: 3 })).toBeVisible()
  await expectEvenCardRows(panel, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`, 2)
  await expectHeadingsClearOfCards(panel, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`)
  await expectNoTextOverlapDown(page, `wardrobe, Trang trí → Danh hiệu & Huy hiệu, ${where}`)
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
 * so this reads the parent shared by every one of its buttons — "Mặc bộ này" is always the first — rather
 * than adding a hook nothing else in this file needs. */
function outfitMenuBox(page: Page) {
  return page.getByRole('button', { name: 'Mặc bộ này' }).locator('xpath=..')
}

/** The expression stepper under the stage (review 2026-09-29 round 2, No10): `‹  Vui  ›`, one row at every width,
 * the name between the two buttons, inside the column. Desktop keeps the row as short as the six chips it replaced
 * (30 px; the left column must keep fitting a 900 px window); a phone's two buttons are each a `--tap` (44 px)
 * square. Steps through all six faces, each name shown whole — not cut by the ellipsis (final fix wave, B5) — and back
 * once, so both buttons are proven to act in a real browser, and ends where it began. */
async function expectStepper(page: Page, where: string, phone: boolean): Promise<void> {
  const group = page.getByRole('group', { name: 'Xem thử biểu cảm' })
  const name = group.getByRole('status')
  await expect(name, `${where}: the stepper names the current expression`).toBeVisible()
  const [row, prev, next, label] = await Promise.all([
    group.boundingBox(),
    group.getByRole('button', { name: 'Biểu cảm trước' }).boundingBox(),
    group.getByRole('button', { name: 'Biểu cảm sau' }).boundingBox(),
    name.boundingBox(),
  ])
  if (!row || !prev || !next || !label) throw new Error(`${where}: the stepper has no layout`)

  if (phone) {
    for (const [which, box] of [['previous', prev], ['next', next]] as const) {
      expect(box.width, `${where}: the ${which} button is at least 44 px wide`).toBeGreaterThanOrEqual(44)
      expect(box.height, `${where}: the ${which} button is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    }
  } else {
    expect(row.height, `${where}: the stepper row is no taller than the chips were (about 36 px at most)`).toBeLessThanOrEqual(36)
  }
  // One line: previous, name, next, left to right, centred on one y.
  expect(prev.x + prev.width, `${where}: the name starts after the previous button`).toBeLessThanOrEqual(label.x)
  expect(label.x + label.width, `${where}: the name ends before the next button`).toBeLessThanOrEqual(next.x)
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2
  expect(Math.abs(centre(prev) - centre(next)), `${where}: the buttons share a line`).toBeLessThan(1)
  expect(Math.abs(centre(prev) - centre(label)), `${where}: the name shares it`).toBeLessThan(4)
  expect(prev.x, `${where}: the row stays inside the column on the left`).toBeGreaterThanOrEqual(row.x - 0.5)
  expect(next.x + next.width, `${where}: the row stays inside the column on the right`).toBeLessThanOrEqual(row.x + row.width + 0.5)
  // The name is cut with an ellipsis rather than wrapped when the row is too narrow: it must not be cut at all.
  const whole = async (): Promise<{ text: string; scrollWidth: number; clientWidth: number }> =>
    name.evaluate((el) => ({ text: el.textContent ?? '', scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  const fits = (seen: { text: string; scrollWidth: number; clientWidth: number }): void =>
    expect(seen.scrollWidth, `${where}: "${seen.text}" is shown whole (${seen.scrollWidth} px in ${seen.clientWidth} px)`).toBeLessThanOrEqual(seen.clientWidth)

  // Every one of the six names, stepping next all the way round to where it began; then previous once and back.
  const nextButton = group.getByRole('button', { name: 'Biểu cảm sau' })
  const before = (await name.textContent()) ?? ''
  for (let i = 0; i < 6; i += 1) {
    const seen = await whole()
    fits(seen)
    await nextButton.click()
    await expect(name, `${where}: next moves on from "${seen.text}"`).not.toHaveText(seen.text)
  }
  await expect(name, `${where}: six steps come back round`).toHaveText(before)
  await group.getByRole('button', { name: 'Biểu cảm trước' }).click()
  await expect(name, `${where}: previous moves back`).not.toHaveText(before)
  await nextButton.click()
  await expect(name, `${where}: and next returns`).toHaveText(before)
}

/** The left column (stage, stepper, wearing list, saved outfits) holds all its rows in its own box — no inner
 * scroll — on a window as tall as `USER_SCREEN`'s or the 900 px one (the note on `.equippedRows`,
 * `wardrobe.module.css`). The 768 px laptop is not asked: its column has scrolled inside itself since before No10. */
async function expectColumnFits(page: Page, where: string): Promise<void> {
  const column = page.getByRole('group', { name: 'Xem thử biểu cảm' }).locator('xpath=../..')
  const { scrollHeight, clientHeight } = await column.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  expect(scrollHeight, `${where}: the left column fits its box (content ${scrollHeight} px, box ${clientHeight} px)`).toBeLessThanOrEqual(clientHeight)
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

    // No10: the expression stepper, and the left column it sits in, at this project's 1440 × 900 window.
    await expectStepper(page, 'wardrobe, desktop 1440×900', false)
    await expectColumnFits(page, 'wardrobe, desktop 1440×900')

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

    // Review 2026-09-29, No11a: the wardrobe opens on what the account owns. This mount came from Settings, so the box
    // is as every visit starts: unticked. A fresh account owns no hat — "Mũ" says so in one line, in its own panel.
    await goToWardrobeTab(page, 'Trang phục', 'Mũ')
    await expect(showLockedBox(page)).not.toBeChecked()
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText(EMPTY_OWNED)).toBeVisible()
    await expect(panel.getByRole('button')).toHaveCount(0)
    await expectNoTextOverlapAt(page, 'wardrobe, Trang phục → Mũ, nothing owned', [USER_SCREEN])
    // "Quần áo": the starter tee and its four free colours, and nothing locked. The dot row is the whole family, the
    // starter itself first as an untinted dot (No8a): five.
    await goToWardrobeTab(page, 'Trang phục', 'Quần áo')
    await expect(panel.getByRole('button', { name: /^Bộ thường ngày, / })).toBeVisible()
    await expect(panel.getByRole('group', { name: 'Bộ thường ngày' }).getByRole('button')).toHaveCount(5)
    await expect(panel.locator('[aria-disabled="true"]')).toHaveCount(0)
    // Ticked, the box shows the rest, and keeps showing it on the next tab.
    await showLockedBox(page).check()
    await expect(showLockedBox(page)).toBeChecked()
    await expect(panel.getByRole('button', { name: /^Bộ tuxedo, / })).toBeVisible()
    await goToWardrobeTab(page, 'Trang phục', 'Mũ')
    await expect(showLockedBox(page)).toBeChecked()
    await expect(panel.getByText(EMPTY_OWNED)).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /^Mũ chóp quý ông, / })).toBeVisible()

    // V-fix, 2026-09-27: `.tileIcon` (`wardrobe.module.css`) carries the wardrobe card's own breakpoint-driven size
    // only inside `.cardThumb`. (The read-only inventory grid that once drew the same icon at another size has
    // folded into the wardrobe, No5.) Reuses this test's own account (no server round trip is cheap here, but a
    // fresh registration is rate-limited, §19.2) rather than opening a whole new test for one more assertion.
    await goToWardrobeTab(page, 'Trang phục', 'Quần áo')
    const wardrobeIcon = page.locator('img[data-item-icon]').first()
    await expect(wardrobeIcon).toBeVisible()
    const wardrobeBox = await wardrobeIcon.boundingBox()
    expect(wardrobeBox, 'the wardrobe card icon has a bounding box').not.toBeNull()
    // `.cardThumb .tileIcon`, desktop viewport (≥768 px): 100 px tall.
    expect(Math.abs(wardrobeBox!.height - 100), 'the wardrobe card icon is the larger, card-scoped size').toBeLessThan(1)

    // No8b, No11b: even card rows, headings clear of the cards above, no text over text — at the user's screen
    // (1920×940, measured from their screenshots) and at a laptop's.
    for (const size of [
      { width: 1920, height: 940 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(size)
      await expectCardGrids(page)
      await expectStepper(page, `wardrobe, ${size.width}×${size.height}`, false)
      if (size.height >= 900) await expectColumnFits(page, `wardrobe, ${size.width}×${size.height}`)
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
    // No10: the 300 px tablet column, where the six chips had wrapped to two rows.
    await expectStepper(page, 'wardrobe, tablet 900×1100', false)
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
    // No10: two thumb-sized buttons either side of the name.
    await expectStepper(page, 'wardrobe, phone 375×812', true)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-light.png`, fullPage: true })

    // No8b, No11b: three columns of ~100 px on a phone, where names wrap to three lines and rows differed most.
    await expectCardGrids(page)
    await expectNoSidewaysScroll(page)
    await openWardrobeFresh(page)

    // Final fix wave (B1): under a finger every colour dot is a thumb-sized target, though it still draws 16 px — the
    // starter's own first of all, the one way back to "Bộ thường ngày" from a coloured tee.
    await goToWardrobeTab(page, 'Trang phục', 'Quần áo')
    const dots = page.getByRole('tabpanel').getByRole('group', { name: 'Bộ thường ngày' }).getByRole('button')
    await expect(dots).toHaveCount(5)
    for (const dot of await dots.all()) await expectDotTarget(dot, `wardrobe, Quần áo, the "${await dot.getAttribute('title')}" dot, phone`)

    // No11a on the phone: this mount came from Settings, so the box is unticked and "Mũ" — nothing owned on a
    // fresh account — is one line in place of the grid, clear of every other text on the page.
    await goToWardrobeTab(page, 'Trang phục', 'Mũ')
    await expect(showLockedBox(page)).not.toBeChecked()
    await expect(page.getByRole('tabpanel').getByText(EMPTY_OWNED)).toBeVisible()
    await expectNoSidewaysScroll(page)
    await expectNoTextOverlapAt(page, 'wardrobe, Trang phục → Mũ, nothing owned')

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
