import { expect, test, type Locator, type Page } from '@playwright/test'
import { account, createBlindRoom, expectLobby, expectNoSidewaysScroll, lobbyAvatar, register, shot, signIn, sit, unique } from './support.js'

/**
 * The 3D avatar, rendered for real (avatar-3d design §8).
 *
 * Every other test of `src/avatar3d/` runs under jsdom with the renderer replaced by a double — which is
 * the right way to test framing arithmetic and a coalescing policy, and says nothing at all about whether
 * a picture comes out. This file is the other half: a real Chromium, a real WebGL2 context (SwiftShader in
 * headless), the real `.glb` bundles fetched from the same origin, and assertions on the pixels.
 *
 * Three properties, and each of them has failed at some point in this plan:
 *
 * - **A portrait is an image with content.** `data-portrait="ready"` says the pipeline believes it
 *   finished; `naturalWidth > 0` says the browser has pixels. A lost GL context produces the first
 *   without the second, and `usePortrait` is designed to make that the initial-letter fallback rather
 *   than a transparent square — so an empty image here means the fallback did not fire.
 * - **`data-hash` is the configuration's identity.** Two different outfits must not share one, and the
 *   *same* outfit must arrive at the same one in a different browser. That is what makes the cache safe
 *   and what makes "the face follows the account" true.
 * - **The stage is a stage.** A `role="img"` frame with a live `<canvas>` inside it, on the profile and
 *   in the wardrobe, on a phone as well as on a desktop.
 *
 * Two timings are asserted, and they are different claims. The **warm** one (§7, ≤ 2 s from joining a
 * room to every seat's face) is the ordinary path, with the chunk and the bundles already in hand. The
 * **cold** one (≤ 5 s to a fresh browser's first face) is the one a player waiting on a download feels,
 * and without it §7's ceiling would go on passing however slow a cold start became. Both are also logged,
 * because the number underneath a ceiling is what is worth watching from run to run.
 */

/** The eight `SKIN_TONES`/`HAIR_PRESETS`/six `EYE_COLORS` of `src/avatar3d/config.ts`, by position. */
const SKIN_AT = 5
const EYE_AT = 3
const HAIR_RED = '#c8323c'

/** The frame `AvatarStage` puts round its canvas: an image, by role, with the canvas inside it. */
const stage = (page: Page): Locator => page.locator('[role="img"]:has(canvas)')

/** Every portrait on the page that has finished rendering. */
const readyPortraits = (root: Page | Locator): Locator => root.locator('[data-portrait="ready"] img')

/**
 * The `data-hash` of a portrait that has actually produced pixels.
 *
 * Both halves matter and they are one assertion because they are one claim: an `<img>` with a hash and no
 * pixels is exactly the failure mode a lost context or a 404 on a `.glb` would produce, and it is
 * invisible to any assertion that only reads attributes.
 */
async function renderedHash(portrait: Locator, what: string): Promise<string> {
  const image = portrait.locator('img')
  await expect(image, `${what} must render a portrait image`).toHaveAttribute('data-hash', /^[0-9a-f]{8}$/, { timeout: 30_000 })
  const width = await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)
  expect(width, `${what} rendered an empty image — the picture is a transparent square`).toBeGreaterThan(0)
  return String(await image.getAttribute('data-hash'))
}

/** Waits for the lobby bar's face to be something other than `was`, and says how long it took. */
async function lobbyHashAfter(page: Page, was: string | null, what: string): Promise<{ hash: string; ms: number }> {
  const started = Date.now()
  const face = lobbyAvatar(page)
  if (was !== null) {
    await expect(face.locator('img'), `${what} must not still be the previous face`).not.toHaveAttribute('data-hash', was, { timeout: 30_000 })
  }
  const hash = await renderedHash(face, what)
  const ms = Date.now() - started
  console.log(`[avatar3d] ${what}: ${hash} in ${ms} ms`)
  return { hash, ms }
}

/** The radio inputs of one wardrobe group, in the order the screen lays them out. */
const group = (page: Page, name: string): Locator => page.locator(`input[name="wardrobe-${name}"]`)

/**
 * Back to the lobby by the wordmark in the header.
 *
 * A *click*, not `page.goto`: the module-level avatar cache and the `forceFresh` mark that `invalidate`
 * leaves behind live in the document, and a reload would throw both away — after which the lobby bar
 * would be served the face this test just replaced, out of the browser's own 60-second HTTP cache.
 */
async function toLobby(page: Page): Promise<void> {
  await page.locator('header a[href="#/lobby"]').first().click()
  await expectLobby(page)
}

async function openWardrobe(page: Page): Promise<void> {
  await page.goto('/#/avatar')
  await expect(page.getByRole('heading', { name: 'Trang phục', exact: true })).toBeVisible()
  // The stage is `React.lazy` behind a `Portrait` fallback, so the canvas is the signal that the real
  // component has loaded and built its context — not the heading above it.
  await expect(stage(page), 'the wardrobe shows a turnable figure').toBeVisible({ timeout: 30_000 })
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lưu trang phục' }).click()
  await expect(page.getByText('Đã lưu trang phục.')).toBeVisible()
}

test.describe('Just a Normal Poker Normal — nhân vật 3D', () => {
  test('chân dung dựng ở máy người chơi, và vòng đời của trình chỉnh trang phục', async ({ context, browser }) => {
    const who = account('Cuong')
    const page = await context.newPage()
    await register(page, who)

    // --- 1. the lobby draws a picture, not a letter ---------------------------------------------------
    const { hash: first } = await lobbyHashAfter(page, null, 'lobby portrait, straight after registering')
    await shot(page, 'avatar3d-lobby-desktop')

    // --- 2. the stage, on the profile ------------------------------------------------------------------
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: who.displayName, exact: true })).toBeVisible()
    const figure = stage(page)
    await expect(figure, 'the profile header shows a turnable figure').toBeVisible({ timeout: 30_000 })
    // Named and described: an unnamed `role="img"` is worse than no image, and the arrow keys that turn
    // it have to be announced by something.
    await expect(figure).toHaveAttribute('aria-roledescription', 'nhân vật xoay được')
    await expect(figure.locator('canvas')).toBeAttached()
    await shot(page, 'avatar3d-profile-desktop')

    // --- 3. the wardrobe: a second outfit, saved --------------------------------------------------------
    //
    // Body, skin and both colours are what a *new* account can change: it owns exactly one item per
    // required slot (the four `isDefault` rows of `data/items.json`) and the first item it can win arrives
    // on day 7 of the calendar. Which is enough — every one of these is part of the hash.
    await openWardrobe(page)
    await group(page, 'body').nth(1).check()
    await group(page, 'skinTone').nth(SKIN_AT).check()
    await page.getByRole('button', { name: `Màu có sẵn ${HAIR_RED}` }).click()
    await shot(page, 'avatar3d-wardrobe-desktop')
    await save(page)

    // In-app navigation, not a reload: `GET /api/players/:id/avatar` is `private, max-age=60`, and the
    // wardrobe's `invalidate` is what makes the very next fetch skip the browser's own cache. A reload
    // throws that away and would be reading a minute-old face (see docs/normal-web.md).
    await toLobby(page)
    const { hash: second } = await lobbyHashAfter(page, first, 'lobby portrait after switching body, skin and hair colour')

    // --- 4. a third outfit, so three configurations have three hashes -----------------------------------
    await openWardrobe(page)
    await group(page, 'eyeColor').nth(EYE_AT).check()
    await save(page)
    await toLobby(page)
    const { hash: third } = await lobbyHashAfter(page, second, 'lobby portrait after changing eye colour')
    expect(new Set([first, second, third]).size, 'three configurations must be three pictures').toBe(3)

    // --- 5. a seat at a table shows the same face -------------------------------------------------------
    //
    // The caches are warm by now — the chunk, the five `.glb` bundles and this face's own blob in
    // IndexedDB — which is the ordinary case: a player reaches a table through the lobby, and the lobby
    // has already drawn them. The cold number is the second device's, at the end.
    await toLobby(page)
    await createBlindRoom(page, unique('Bàn '), 1)
    // From the room, not from the create dialog: six selects filled by a robot are not a load time.
    const joinedAt = Date.now()
    await sit(page, 0)

    // Every seat that has a portrait at all must have finished it — the bot's seat carries an SVG mark
    // and no portrait, so this is one picture at a one-bot table and would be nine at a full one.
    const seats = page.locator('[data-seat] [data-portrait]')
    await expect(seats).toHaveCount(1, { timeout: 30_000 })
    const mine = await renderedHash(seats.first(), 'the seat plate')
    const ready = Date.now() - joinedAt
    console.log(`[avatar3d] room join → every seat portrait ready: ${ready} ms (1 human, 1 bot)`)
    // Design §7: nine faces inside two seconds. **This is the warm path** — the lazy chunk, the five
    // `.glb` bundles and this face's own blob in IndexedDB are all in hand by now, so what it measures
    // is a blob lookup plus a seat round-trip, not a portrait pipeline. It is the ordinary case and it
    // is worth a ceiling, but a green tick here is not coverage of §7's cold nine-seat claim: the cold
    // number is asserted separately at the end, and the nine-seat case is not covered at all
    // (docs/known-limitations.md).
    expect(ready, 'the table must not sit faceless while the assets arrive').toBeLessThanOrEqual(2_000)
    expect(mine, 'the seat draws the same face as the lobby bar').toBe(third)
    await shot(page, 'avatar3d-seat-desktop')

    await page.getByRole('button', { name: 'Rời phòng' }).click()
    await expect(page).toHaveURL(/#\/lobby$/)

    // --- 6. …and the editor loads what was saved --------------------------------------------------------
    //
    // A full reload, which is the point: the draft, the module-level avatar cache and everything else this
    // session was holding go away, and what comes back has to come back from the server. (It is also why
    // this is *after* the table: a reload drops the `invalidate` mark too, and the lobby bar and the seat
    // plates then draw whatever the browser's own 60-second cache still holds for `/api/players/:id/avatar`
    // — a documented staleness, see docs/normal-web.md, and not something to assert a fresh face through.)
    await page.reload()
    await openWardrobe(page)
    await expect(group(page, 'body').nth(1), 'the saved body is what the editor loads').toBeChecked()
    await expect(group(page, 'skinTone').nth(SKIN_AT), 'the saved skin tone is what the editor loads').toBeChecked()
    await expect(group(page, 'eyeColor').nth(EYE_AT), 'the saved eye colour is what the editor loads').toBeChecked()
    await expect(page.getByLabel('Màu tự chọn'), 'the saved hair colour is what the editor loads').toHaveValue(HAIR_RED)

    // --- 7. the face follows the account, not the browser -----------------------------------------------
    //
    // A fresh context has none of this one's caches — not the portrait's IndexedDB, not the HTTP one — so
    // it fetches the saved configuration and renders it for itself. Arriving at the same hash is what
    // makes the cache key a *configuration* identity rather than a per-browser accident. Its own timing
    // is the cold one: the lazy chunk, the manifest, the `.glb` bundles and the render, from nothing.
    //
    // Last, and not by accident: the gateway holds one live session per account, so signing in over here
    // drops the first page's socket. Everything that needs a connected lobby has happened by now.
    const elsewhere = await browser.newContext()
    const other = await elsewhere.newPage()
    // A fresh context starts with empty storage, and this asserts it rather than assuming it: if a future
    // Playwright reused a profile the number below would quietly become a second warm measurement.
    await other.goto('/')
    const held = await other.evaluate(async () => {
      const databases = await indexedDB.databases()
      for (const { name } of databases) if (name) indexedDB.deleteDatabase(name)
      return databases.length
    })
    expect(held, 'a fresh browser context must have no portrait cache to start from').toBe(0)
    await signIn(other, who)
    const { hash: away, ms: cold } = await lobbyHashAfter(other, null, 'lobby portrait on a second device, cold')
    expect(away, 'the second device draws exactly what was saved').toBe(third)
    // The cold path, asserted as well as logged: three.js' 150 KB gzip chunk, the manifest, up to five
    // `.glb` bundles and a first render, from nothing, on a software rasteriser. It measures 3.0–3.5 s
    // here, so the ceiling is 5 s — loose enough not to flake on a slow runner, tight enough that
    // doubling the download or losing the IndexedDB cache turns this red instead of only slow. Until it
    // finishes, the face is the player's initial on a disc, which is the designed fallback.
    expect(cold, 'a cold browser must reach its first drawn face inside five seconds').toBeLessThanOrEqual(5_000)
    await elsewhere.close()
  })

  test('@mobile trình chỉnh trang phục trên màn hình điện thoại', async ({ context }) => {
    const who = account('Duyen')
    const page = await context.newPage()
    await register(page, who)
    await openWardrobe(page)

    // The whole point of the phone layout: the stage is pinned above the groups, and neither of them
    // pushes the page sideways.
    const figure = stage(page)
    await expect(figure).toBeInViewport()
    const box = await figure.boundingBox()
    expect(box, 'the figure has a box').not.toBeNull()
    expect(box!.width, 'the figure fits the phone').toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(box!.height, 'the figure is tall enough to be a figure').toBeGreaterThan(150)
    await expectNoSidewaysScroll(page)
    await shot(page, 'avatar3d-wardrobe-mobile')

    // Save has to be *reachable* — scrolled to, on screen, and big enough for a thumb (`--tap`, 44 px).
    const saveButton = page.getByRole('button', { name: 'Lưu trang phục' })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeInViewport()
    const tap = await saveButton.boundingBox()
    expect(tap, 'the save button has a box').not.toBeNull()
    expect(tap!.height, 'the save button is a 44 px target').toBeGreaterThanOrEqual(44)
    await expectNoSidewaysScroll(page)

    // …and it still saves, from down here.
    await page.getByRole('button', { name: `Màu có sẵn ${HAIR_RED}` }).click()
    await save(page)

    // Every tile that finished drawing drew something: the wardrobe is the one screen that renders many
    // portraits at once, and it is where an exhausted context or a stuck queue would show first.
    // Retrying, like every other assertion in this file: a tile reaches `ready` only after the lazy
    // chunk, the manifest, the `.glb` bundles and its turn in the render queue, so a one-shot `count()`
    // here would go red on a cold runner that was still drawing — a flake, not a regression.
    const tiles = readyPortraits(page)
    await expect(tiles, 'the wardrobe previews the items it offers').not.toHaveCount(0, { timeout: 30_000 })
    for (const tile of await tiles.all()) {
      expect(await tile.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
  })
})
