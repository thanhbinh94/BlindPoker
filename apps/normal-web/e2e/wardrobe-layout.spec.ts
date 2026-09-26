import { expect, test, type Page } from '@playwright/test'
import { account, expectNoSidewaysScroll, goToWardrobeTab, register, SHOTS } from './support.js'

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
 */

const preview = (page: Page) => page.getByRole('img', { name: 'Tủ đồ' })

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Tủ đồ', exact: true })).toBeVisible()
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
 * The group row ("Tủ đồ", design §3.1's three groups) plus every group's own sub-tab row, ending back on
 * "Ngoại hình" — the default group and its default tab, "Thân nền" (design §5.3) — so the screenshot
 * taken right after always shows the same, mockup-matching view regardless of how many groups this walked
 * through first.
 */
async function assertNavNeverWraps(page: Page): Promise<void> {
  await assertTablistOnOneLine(page, 'Tủ đồ')
  await assertTablistOnOneLine(page, 'Ngoại hình')

  await goToWardrobeTab(page, 'Trang phục')
  await assertTablistOnOneLine(page, 'Trang phục')

  // "Danh hiệu & Huy hiệu" (design §4.4) is the longest sub-tab label in the whole screen — the one most
  // likely to force a wrap on a narrow phone.
  await goToWardrobeTab(page, 'Trang trí')
  await assertTablistOnOneLine(page, 'Trang trí')

  await goToWardrobeTab(page, 'Ngoại hình')
}

test.describe('Just a Normal Poker Normal — bố cục tủ đồ (Kế hoạch 14)', () => {
  test('desktop: nhóm và tab con không gãy dòng; ảnh chụp tối và sáng', async ({ page }) => {
    const who = account('Hoa')
    await register(page, who)
    await openWardrobe(page)

    await assertNavNeverWraps(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-desktop-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-desktop-light.png`, fullPage: true })
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
  })

  test('@mobile điện thoại: không cuộn ngang, nhóm và tab con không gãy dòng; ảnh chụp tối và sáng', async ({ page }) => {
    const who = account('Yen')
    await register(page, who)
    await openWardrobe(page)

    await expectNoSidewaysScroll(page)
    await assertNavNeverWraps(page)
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-dark.png`, fullPage: true })

    await useLightTheme(page)
    await openWardrobe(page)
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: `${SHOTS}wardrobe-mobile-light.png`, fullPage: true })
  })
})
