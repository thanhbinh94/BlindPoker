import { expect, test, type Locator, type Page } from '@playwright/test'
import { account, chibiHash, createBlindRoom, expectLobby, register, sit, unique } from './support.js'

/**
 * Hair-colour tinting end to end (avatar-tint design §7): picking a colour swatch in the wardrobe
 * redraws the chibi with a canvas-tinted layer — a same-origin `<img src="blob:…">` rather than a
 * plain asset — and the choice survives a save through to the chibi the rest of the app draws for
 * this player. `Chibi.test.tsx` (ui-kit) and `tinted.test.ts` already prove the canvas painting and
 * the layering under jsdom; this file is the one place that proves the *browser* actually renders a
 * `<canvas>`-derived blob URL and that the wardrobe, the lobby bar and a seat all agree on the result,
 * mirroring how `avatar2d.spec.ts` checks the base/head flow it was modelled on.
 */

/** The wardrobe's own preview: the one `Chibi` on the screen with an accessible name. */
const preview = (page: Page): Locator => page.getByRole('img', { name: 'Tủ đồ' })

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Tủ đồ', exact: true })).toBeVisible()
  await expect(preview(page)).toBeVisible()
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lưu tủ đồ' }).click()
  await expect(page.getByText('Đã lưu tủ đồ.')).toBeVisible()
}

test.describe('Just a Normal Poker Normal — màu tóc, màu mắt', () => {
  test('chọn màu tóc đỏ tô lại chibi bằng canvas và giữ nguyên khi lưu', async ({ page }) => {
    const who = account('Lan')
    await register(page, who)

    await openWardrobe(page)
    const beforePick = await chibiHash(preview(page))

    await page.getByRole('tab', { name: 'Màu tóc', exact: true }).click()
    const tabpanel = page.getByRole('tabpanel')
    // haircolor_red01 is `free`+`common` (design §3.2) — every account owns it without a grant.
    const redSwatch = tabpanel.getByRole('button', { name: 'Tóc đỏ' })
    await redSwatch.click()
    await expect(redSwatch, 'the swatch it just picked reflects the choice').toHaveAttribute('aria-pressed', 'true')

    // The hash changes immediately (a synchronous config update); the tinted `<img src="blob:…">`
    // lands a beat later, once the canvas render resolves (design §5.2).
    const afterPick = await chibiHash(preview(page))
    expect(afterPick, 'picking a hair colour redraws the preview').not.toBe(beforePick)
    await expect(preview(page).locator('img[src^="blob:"]').first(), 'the tinted hair layer renders as a canvas blob').toBeVisible({ timeout: 5000 })

    await save(page)

    // A table seat draws this player's own chibi (not a bot's) — the same door avatar2d.spec.ts
    // uses to prove a saved wardrobe choice reaches somewhere other than the wardrobe screen itself.
    await page.locator('header a[href="#/lobby"]').first().click()
    await expectLobby(page)
    await createBlindRoom(page, unique('Bàn '), 2)
    await sit(page, 0)

    const mySeat = page.locator('[data-seat="0"] [data-chibi-hash]')
    expect(await chibiHash(mySeat), 'the seat draws the same coloured configuration as the wardrobe').toBe(afterPick)
    await expect(mySeat.locator('img[src^="blob:"]').first(), 'the seat also renders the tinted hair layer').toBeVisible({ timeout: 5000 })
  })
})
