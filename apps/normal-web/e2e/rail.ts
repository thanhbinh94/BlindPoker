import { expect, type Page } from '@playwright/test'
import { expectNoSidewaysScroll } from './support.js'

/**
 * Bug 8 (2026-09-27): the account rail — mark, four tabs, balance, language switch — overran its row. On a
 * phone the nav scrolled "Cài đặt" out of sight; around 900 px "Tiếng Việt" wrapped onto two lines and the
 * page scrolled sideways. The rail now sheds items one width at a time and turns its tabs into icons over
 * small labels under 640 px (`normal.module.css`). This check holds it to that on `/daily`, a page whose rail carries the balance.
 * It lives in the wardrobe layout spec's tests rather than a spec of its own because every spec that registers
 * costs one of the server's ten sign-ups a minute (§19.2), and the suite is already at nine.
 */
export async function expectRailFits(page: Page, width: number): Promise<void> {
  await page.goto('/#/daily')
  await expect(page.getByRole('heading', { name: 'Điểm danh hằng ngày' })).toBeVisible()
  await expectNoSidewaysScroll(page)

  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  const overflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow, `the nav does not scroll at ${width} px`).toBeLessThanOrEqual(0)

  // Every tab is whole on screen — the bug was a tab scrolled half out of view, not a missing one.
  for (const name of ['Sảnh chờ', 'Điểm danh', 'Hồ sơ', 'Cài đặt']) {
    const box = await nav.getByRole('link', { name }).boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.x, `${name} starts on screen at ${width} px`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${name} ends on screen at ${width} px`).toBeLessThanOrEqual(width)
  }

  // Where the language switch is shown, each of its buttons stays on one line.
  for (const button of await page.locator('header').getByRole('button', { name: /Tiếng Việt|English/ }).all()) {
    if (!(await button.isVisible())) continue
    const lineHeight = await button.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20)
    const box = await button.boundingBox()
    expect(box!.height, `language button on one line at ${width} px`).toBeLessThan(lineHeight * 2)
  }
}
