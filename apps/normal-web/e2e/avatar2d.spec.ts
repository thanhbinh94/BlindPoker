import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  account,
  chibiHash,
  createBlindRoom,
  expectLobby,
  expectNoSidewaysScroll,
  goToWardrobeTab,
  lobbyAvatar,
  register,
  shot,
  sit,
  unique,
} from './support.js'

/**
 * The chibi wardrobe and its faces around the app, driven for real (avatar-chibi-ai design §7, §8).
 *
 * `packages/ui-kit/src/avatar2d/Chibi.test.tsx` proves the layering, the hide rules and the head crop
 * under jsdom, against a hand-built config — which says nothing about whether the *app* wires a saved
 * choice back into the lobby bar, a seat plate and a second wardrobe visit consistently. That is what
 * this file is for, on the placeholder layers `avatar:placeholder` writes: a chibi is a same-origin
 * `<img>` stack, so nothing here needs a GPU or a real render, unlike the 3D `avatar3d.spec.ts` this
 * file replaced.
 *
 * `data-chibi-hash` is a configuration's identity (`hashChibi`, `packages/ui-kit/src/avatar2d/layers.ts`):
 * two different configurations must not share one, and the *same* configuration must arrive at the same
 * one wherever it is drawn — the lobby bar, a seat plate, an outfit-bar tile. That equality, not any one
 * picture, is what every assertion below is really checking.
 */

/** The wardrobe's own preview: the one `Chibi` on the screen with an accessible name, so it is reachable
 * by role rather than by a CSS module class a production build hashes away. */
const preview = (page: Page): Locator => page.getByRole('img', { name: 'Phòng thay đồ' })

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', exact: true })).toBeVisible()
  await expect(preview(page)).toBeVisible()
}

/** Back to the lobby by the wordmark in the header — present on every account route, hidden only in the room. */
async function toLobby(page: Page): Promise<void> {
  await page.locator('header a[href="#/lobby"]').first().click()
  await expectLobby(page)
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lưu trang phục' }).click()
  await expect(page.getByText('Đã lưu trang phục.')).toBeVisible()
}

/** Waits for the lobby bar's hash to be something other than `was`, and returns the new one. */
async function barHashAfter(page: Page, was: string): Promise<string> {
  await expect(lobbyAvatar(page), 'the bar must pick up the saved change').not.toHaveAttribute('data-chibi-hash', was)
  return chibiHash(lobbyAvatar(page))
}

test.describe('Blind Luck Poker Normal — nhân vật chibi', () => {
  test('tủ đồ, ghế và bộ outfit đều khớp một băm cấu hình', async ({ page }) => {
    const who = account('Mai')
    await register(page, who)

    // --- 1. the lobby bar draws a chibi from the first paint --------------------------------------------
    const first = await chibiHash(lobbyAvatar(page))
    await shot(page, 'avatar2d-lobby-desktop')

    // --- 2. the wardrobe: switch base to m01, save ------------------------------------------------------
    await openWardrobe(page)
    await expect(page.getByRole('tab', { name: 'Thân nền', exact: true })).toHaveAttribute('aria-selected', 'true')
    const previewBeforeBase = await chibiHash(preview(page))

    const tabpanel = page.getByRole('tabpanel')
    const m01Tile = tabpanel.getByRole('button', { name: 'Tóc rối' })
    await m01Tile.click()
    await expect(m01Tile, 'the tile it just picked reflects the choice').toHaveAttribute('aria-pressed', 'true')
    expect(await chibiHash(preview(page)), 'picking a base redraws the preview').not.toBe(previewBeforeBase)
    await shot(page, 'avatar2d-wardrobe-desktop')
    await save(page)

    await toLobby(page)
    const second = await barHashAfter(page, first)
    expect(second, 'saving a new base changes the bar').not.toBe(first)

    // --- 3. the Head tab: an epic tile a fresh account has not unlocked ----------------------------------
    //
    // A new account owns exactly one item, the default outfit — every head, face, aura and frame tile is
    // locked. `head_tophat01` is `epic`, never a starting grant, so it is locked on every account this
    // test could ever create.
    await openWardrobe(page)
    // "Mũ" is the "wear" group's own first tab (design §3.1), so this also proves the group tab alone
    // lands on it (`CategoryNav`'s group click selects the group's `tabs[0]`) — the `goToWardrobeTab`
    // helper still names the sub-tab explicitly, matching how every other jump in this file reads.
    await goToWardrobeTab(page, 'Trang phục', 'Mũ')
    const lockedTile = tabpanel.locator('button').filter({ hasText: 'Mũ chóp quý ông' })
    await expect(lockedTile).toHaveAttribute('aria-disabled', 'true')
    const previewBeforeClick = await chibiHash(preview(page))
    // `aria-disabled`, not the native `disabled` attribute — the tile stays in the tab order and announced,
    // so it can say *why* it is locked (design §7). Playwright's own actionability check treats
    // `aria-disabled="true"` as not-actionable and waits forever for it to change, which it never will; the
    // point of this assertion is that the click is a no-op, so it is forced through instead.
    await lockedTile.click({ force: true })
    expect(await chibiHash(preview(page)), 'a locked tile does not equip on click').toBe(previewBeforeClick)

    // --- 4. a table: my seat matches the bar, and draws the base layer named for m01 --------------------
    await toLobby(page)
    await createBlindRoom(page, unique('Bàn '), 2)
    await sit(page, 0)

    const mySeat = page.locator('[data-seat="0"] [data-chibi-hash]')
    expect(await chibiHash(mySeat), 'the seat draws the same configuration as the bar').toBe(second)
    await expect(page.locator('[data-seat="0"] img[src*="base_m01_L30"]'), 'the seat layers in the m01 body').toHaveCount(1)
    // Two bots, each drawing from the bot art rather than a wardrobe — the count is loose because a bot
    // chibi has two layers (body and face), not one image per seat.
    expect(await page.locator('[data-seat] img[src*="bot_"]').count(), 'both bot seats draw bot art').toBeGreaterThanOrEqual(2)
    await shot(page, 'avatar2d-seat-desktop')

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expectLobby(page)

    // --- 5. the outfit bar: a snapshot saved, another base tried, and the snapshot restored -------------
    await openWardrobe(page)
    // A fresh account's five saved-outfit slots are all empty; an empty slot's portrait opens the naming
    // dialog straight away, no menu in between (design §3.1 item 4) — unlike a filled slot, see "Áp dụng" below.
    await page.getByRole('button', { name: 'Ô 1 trống' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Tên bộ đồ').fill('Đi làm')
    await dialog.getByRole('button', { name: 'Lưu vào đây' }).click()
    await expect(dialog).toBeHidden()

    await tabpanel.getByRole('button', { name: 'Tóc bob' }).click()
    await save(page)
    await toLobby(page)
    const third = await barHashAfter(page, second)
    // Switching back to f01 with nothing else equipped is exactly the fresh account's own default
    // configuration, so `third` lands back on `first` — a hash is the configuration's identity, not a
    // record of the path taken to reach it, and this is the one step in the flow where that shows.
    expect(third, 'f01 with only the default outfit is the account it started as').toBe(first)

    await openWardrobe(page)
    // A filled slot's portrait opens a small menu instead (design §3.1 item 4: Áp dụng · Lưu đè vào đây ·
    // Đổi tên · Xoá) — the button's own accessible name is "Bộ đồ <name>" (`outfits.menu`).
    await page.getByRole('button', { name: 'Bộ đồ Đi làm' }).click()
    await page.getByRole('button', { name: 'Áp dụng' }).click()
    await toLobby(page)
    const restored = await barHashAfter(page, third)
    expect(restored, 'applying the saved slot returns exactly the m01 configuration').toBe(second)
  })

  test('@mobile tủ đồ trên màn hình điện thoại', async ({ page }) => {
    const who = account('Nga')
    await register(page, who)
    await openWardrobe(page)

    const figure = preview(page)
    await expect(figure).toBeInViewport()
    const box = await figure.boundingBox()
    expect(box, 'the preview has a box').not.toBeNull()
    expect(box!.width, 'the preview fits the phone').toBeLessThanOrEqual(page.viewportSize()!.width)
    await expectNoSidewaysScroll(page)
    await shot(page, 'avatar2d-wardrobe-mobile')

    // The phone header shortens "Lưu trang phục" to "Lưu" (design §3.2) — "Hoàn tác" becomes an icon-only
    // button beside it, but this test only cares about the save action.
    const saveButton = page.getByRole('button', { name: 'Lưu', exact: true })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeInViewport()
    const tap = await saveButton.boundingBox()
    expect(tap, 'the save button has a box').not.toBeNull()
    expect(tap!.height, 'the save button is a 44 px target').toBeGreaterThanOrEqual(44)

    // The head tab renders every tile at once — the screen most likely to overflow sideways.
    await goToWardrobeTab(page, 'Trang phục', 'Mũ')
    await expectNoSidewaysScroll(page)
    const tiles = page.getByRole('tabpanel').locator('img')
    await expect(tiles.first()).toBeVisible()
    expect(await tiles.count(), 'the head tab previews more than one tile').toBeGreaterThan(1)
  })
})
