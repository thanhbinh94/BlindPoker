import { expect, test, type Locator, type Page } from '@playwright/test'
import { account, chibiHash, createBlindRoom, expectLobby, goToWardrobeTab, register, sit, unique } from './support.js'

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
const preview = (page: Page): Locator => page.getByRole('img', { name: 'Phòng thay đồ' })

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', exact: true })).toBeVisible()
  await expect(preview(page)).toBeVisible()
}

/**
 * Every `<img>` in `chibi` is a picture the browser actually decoded (`complete && naturalWidth > 0` — a blocked
 * or failed load is `complete` with a width of 0), and at least `minBlobs` of them are recoloured `blob:` layers.
 * Polled, because the canvas render resolves a beat after the click; the poll's value is the list of problems so
 * a failure names the layers instead of saying "false".
 */
async function expectEveryLayerDecoded(chibi: Locator, minBlobs: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const layers = await chibi.locator('img').evaluateAll((imgs) =>
          imgs.map((img) => ({ src: (img as HTMLImageElement).getAttribute('src') ?? '', decoded: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0 })),
        )
        const problems = layers.filter((l) => !l.decoded).map((l) => `not decoded: ${l.src}`)
        const blobs = layers.filter((l) => l.src.startsWith('blob:')).length
        if (layers.length === 0) problems.push('no layers drawn')
        if (blobs < minBlobs) problems.push(`only ${blobs} blob layers of ${layers.length}, wanted at least ${minBlobs}`)
        return problems
      },
      { message: 'every layer of the preview decodes, and the recoloured ones are blob: images', timeout: 15_000 },
    )
    .toEqual([])
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lưu trang phục' }).click()
  await expect(page.getByText('Đã lưu trang phục.')).toBeVisible()
}

test.describe('Blind Luck Poker Normal — màu tóc, màu mắt', () => {
  test('chọn màu tóc đỏ tô lại chibi bằng canvas và giữ nguyên khi lưu', async ({ page }) => {
    const who = account('Lan')
    await register(page, who)

    await openWardrobe(page)
    const beforePick = await chibiHash(preview(page))

    await goToWardrobeTab(page, 'Ngoại hình', 'Màu tóc')
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

    // An eye colour and a coloured outfit ("Áo phông đỏ" is `free`+`common`, the same file as the default
    // casual outfit painted red) are tinted layers too. All three go through the same `blob:` door.
    await goToWardrobeTab(page, 'Ngoại hình', 'Màu mắt')
    const greenEyes = page.getByRole('tabpanel').getByRole('button', { name: 'Mắt xanh lá' })
    await greenEyes.click()
    await expect(greenEyes, 'the eye colour it just picked reflects the choice').toHaveAttribute('aria-pressed', 'true')

    await goToWardrobeTab(page, 'Trang phục', 'Trang phục')
    const redTee = page.getByRole('tabpanel').getByRole('button', { name: 'Áo phông đỏ', exact: true })
    await redTee.click()
    await expect(redTee, 'the coloured outfit it just picked reflects the choice').toHaveAttribute('aria-pressed', 'true')

    // `toBeVisible` says yes to an `<img>` the browser refused to load, so it proves nothing here: the
    // Content-Security-Policy `img-src` without `blob:` once left every tinted layer broken (No15, No16) while
    // this test stayed green. What proves it is that each layer decoded, and that at least three of them (the
    // hair, the eyes and the outfit each recolour a layer of their own; four blobs were measured) are really
    // the recoloured images and not the plain fallback.
    await expectEveryLayerDecoded(preview(page), 3)
    const finalHash = await chibiHash(preview(page))
    expect(finalHash, 'the eye colour and the outfit redraw the preview too').not.toBe(afterPick)

    await save(page)

    // A table seat draws this player's own chibi (not a bot's) — the same door avatar2d.spec.ts
    // uses to prove a saved wardrobe choice reaches somewhere other than the wardrobe screen itself.
    await page.locator('header a[href="#/lobby"]').first().click()
    await expectLobby(page)
    await createBlindRoom(page, unique('Bàn '), 2)
    await sit(page, 0)

    const mySeat = page.locator('[data-seat="0"] [data-chibi-hash]')
    expect(await chibiHash(mySeat), 'the seat draws the same coloured configuration as the wardrobe').toBe(finalHash)
    await expect(mySeat.locator('img[src^="blob:"]').first(), 'the seat also renders the tinted hair layer').toBeVisible({ timeout: 5000 })
  })
})
