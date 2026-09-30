import { expect, test, type Page } from '@playwright/test'
import { expectNoTextOverlap, type OverlapOptions } from './overlap.js'

/**
 * The text-overlap detector's own proof (`overlap.ts`, review 2026-09-29 No11b). Every case is a static page handed
 * to `page.setContent` — no server state, no account — so it runs in the default desktop project beside the app's
 * specs without touching their economy. Each "passes" case that rests on one mechanism (the opaque cover, overflow
 * clipping, the layer split, the exemption) has a twin that fails once that mechanism is taken away, so none of them
 * passes by accident of geometry.
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const BASE_CSS = `
  body { margin: 0; font: 20px/1.4 Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  .at { position: absolute; margin: 0; white-space: nowrap; }
`

async function show(page: Page, body: string, css = ''): Promise<void> {
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`)
}

/** The helper's failure message, or `''` when it passed. */
async function reportOf(page: Page, label: string, opts?: OverlapOptions): Promise<string> {
  try {
    await expectNoTextOverlap(page, label, opts)
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

async function timed<T>(work: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now()
  const result = await work()
  return [result, Date.now() - started]
}

/** The felt: an opaque panel holding a line of text, with a box laid over that line whose background is `cover`. */
async function showCover(page: Page, cover: string, coverCss = ''): Promise<void> {
  await show(
    page,
    `<div class="felt at" style="left: 60px; top: 60px; width: 520px; height: 140px; background: #0c2226; color: #eee">
       <p class="at" style="left: 40px; top: 40px">Felt text beneath the card</p>
     </div>
     <div class="card at" style="left: 80px; top: 90px; width: 400px; height: 60px; padding: 6px; color: #fff; background: ${cover}; ${coverCss}">Card title on top</div>`,
  )
}

/** A scrolling form whose sticky footer (background `footer`) sits on "Field 6", with a note just under the form. */
async function showStickyFooter(page: Page, footer: string): Promise<void> {
  const fields = Array.from({ length: 10 }, (_, i) => `<label style="display: block; height: 40px; line-height: 40px">Field ${i + 1}</label>`).join('')
  await show(
    page,
    `<form class="at" style="left: 100px; top: 100px; width: 360px; height: 220px; overflow: auto">
       ${fields}
       <footer style="position: sticky; bottom: 0; height: 40px; line-height: 40px; padding: 0 8px; background: ${footer}">Save changes</footer>
     </form>
     <span class="at" style="left: 100px; top: 330px">Outside note</span>`,
  )
  // Twenty pixels down puts "Field 6"'s line on the footer's line, and "Field 7" (clipped away) on the note.
  await page.locator('form').evaluate((form) => {
    form.scrollTop = 20
  })
}

async function showEllipsis(page: Page, clipped: boolean): Promise<void> {
  const name = clipped ? 'overflow: hidden; text-overflow: ellipsis;' : 'overflow: visible;'
  await show(
    page,
    `<div class="at" style="left: 100px; top: 100px; display: flex; gap: 8px; width: 500px">
       <span style="flex: none; width: 150px; white-space: nowrap; ${name}">A very long player name that will not fit</span>
       <span>Neighbour</span>
     </div>`,
  )
}

test.describe('Phát hiện chữ đè chữ (overlap.ts)', () => {
  test('hai đoạn chữ đè lên nhau thì báo lỗi, kèm chữ, khung và đường dẫn CSS', async ({ page }) => {
    await show(
      page,
      `<div class="stage">
         <span class="alpha at" style="left: 100px; top: 100px">Alpha overlapping text that runs well past forty characters</span>
         <span class="beta at" style="left: 130px; top: 104px">Beta overlapping</span>
       </div>`,
    )
    const report = await reportOf(page, 'two spans')
    expect(report).toContain('Text overlaps text on "two spans" (1 pair)')
    // Both texts, the long one trimmed to forty characters; each run's box; a short CSS path.
    expect(report).toContain('"Alpha overlapping text that runs well p…"')
    expect(report).toContain('"Beta overlapping"')
    expect(report).toMatch(/\[\d+,\d+ \d+×\d+\] div\.stage > span\.alpha\.at/)
    expect(report).toMatch(/\[\d+,\d+ \d+×\d+\] div\.stage > span\.beta\.at/)
    expect(report).toMatch(/overlap \d+×\d+ px/)
  })

  test('hai đoạn chữ tách rời thì qua; các dòng của một đoạn văn không bị so với nhau', async ({ page }) => {
    await show(
      page,
      `<span class="at" style="left: 100px; top: 100px">Alpha</span>
       <span class="at" style="left: 100px; top: 160px">Beta</span>
       <p class="at" style="left: 400px; top: 100px; width: 220px; white-space: normal">A paragraph with <b>bold words</b> and <i>italic ones</i> that wraps across several lines.</p>`,
    )
    expect(await reportOf(page, 'separate spans')).toBe('')
  })

  test('chữ dưới lớp phủ trong suốt thì báo lỗi; khung đục của chính nó không che nó', async ({ page }) => {
    await showCover(page, 'rgba(0, 0, 0, 0.4)')
    const report = await reportOf(page, 'transparent overlay')
    expect(report).toContain('(1 pair)')
    expect(report).toContain('"Felt text beneath the card"')
    expect(report).toContain('"Card title on top"')
  })

  test('chữ của một thẻ đục không bị so với chữ nằm dưới thẻ', async ({ page }) => {
    await showCover(page, '#1b2340')
    expect(await reportOf(page, 'opaque card')).toBe('')
    // A seat plate's surface: a gradient over a transparent colour, every stop at 0.96.
    await showCover(page, 'linear-gradient(180deg, rgba(24, 32, 58, 0.96), rgba(8, 13, 26, 0.96))')
    expect(await reportOf(page, 'opaque gradient card')).toBe('')
    // The same solid card at half opacity hides nothing.
    await showCover(page, '#1b2340', 'opacity: 0.5')
    expect(await reportOf(page, 'faded card')).toContain('"Felt text beneath the card"')
  })

  test('chân biểu mẫu dính (sticky) che các ô đã cuộn qua thì qua; chữ bị cuộn khuất không tính', async ({ page }) => {
    await showStickyFooter(page, '#fff')
    expect(await reportOf(page, 'sticky footer')).toBe('')

    await showStickyFooter(page, 'rgba(255, 255, 255, 0.5)')
    const report = await reportOf(page, 'see-through footer')
    expect(report).toContain('(1 pair)')
    expect(report).toContain('"Field 6"')
    expect(report).toContain('"Save changes"')
    expect(report, 'the field scrolled out of the form is clipped, not compared with the note').not.toContain('Outside note')
  })

  test('tên dài bị cắt bằng dấu ba chấm cạnh chữ bên cạnh thì qua', async ({ page }) => {
    await showEllipsis(page, true)
    expect(await reportOf(page, 'ellipsis')).toBe('')

    await showEllipsis(page, false)
    const report = await reportOf(page, 'spilled name')
    expect(report).toContain('"A very long player name that will not f…"')
    expect(report).toContain('"Neighbour"')
  })

  test('chữ trong SVG, role="img" và aria-hidden đè lên một đoạn chữ thì qua', async ({ page }) => {
    await show(
      page,
      `<span class="at" style="left: 100px; top: 100px">Span under artwork</span>
       <svg class="at" style="left: 100px; top: 95px" width="300" height="40"><text x="10" y="28" font-size="20">SVG label</text></svg>
       <div class="at" role="img" aria-label="King of spades" style="left: 120px; top: 102px">K♠ card</div>
       <span class="at" aria-hidden="true" style="left: 140px; top: 98px">♣ decorative</span>`,
    )
    expect(await reportOf(page, 'artwork')).toBe('')
  })

  test('dòng chữ sát nhau (line-height 1) không bị tính là đè', async ({ page }) => {
    await show(
      page,
      `<p class="at" style="left: 100px; top: 100px; width: 260px; white-space: normal; font: 28px/1 Arial, sans-serif">
         Tight <b>heading</b> that <i>wraps</i> onto <b>several</b> lines here</p>
       <div class="stack at" style="left: 500px; top: 100px; font: 28px/1 Arial, sans-serif"><div>Stacked name</div><div>67.020</div><div>Chủ phòng</div></div>`,
    )
    // Not vacuous: the raw line boxes of the stacked rows do overlap, by more than the 2 px tolerance.
    const rawOverlap = await page.locator('.stack').evaluate((stack) => {
      const range = document.createRange()
      const [first, second] = Array.from(stack.children, (row) => {
        range.selectNodeContents(row)
        return range.getBoundingClientRect()
      })
      return first!.bottom - second!.top
    })
    expect(rawOverlap).toBeGreaterThan(2)
    expect(await reportOf(page, 'tight line-height')).toBe('')
  })

  test('data-overlap-ok có lý do, và ignore, thì bỏ qua; data-overlap-ok rỗng thì không', async ({ page }) => {
    const pair = (ok: string) =>
      show(
        page,
        `<span class="at" style="left: 100px; top: 100px">Seat name</span>
         <div ${ok}><span class="chip at" style="left: 110px; top: 104px">Dealer chip</span></div>`,
      )
    await pair('data-overlap-ok="the dealer chip rides on the plate by design"')
    expect(await reportOf(page, 'exempt by reason')).toBe('')

    await pair('data-overlap-ok=""')
    expect(await reportOf(page, 'empty reason')).toContain('"Dealer chip"')

    await pair('')
    expect(await reportOf(page, 'ignored selector', { ignore: ['.chip'] })).toBe('')
    expect(await reportOf(page, 'nothing ignored')).toContain('"Dealer chip"')
  })

  test('hộp thoại modal và vùng thông báo chỉ so với chính chúng', async ({ page }) => {
    const layers = (inDialog: string) =>
      show(
        page,
        `<p class="at" style="left: 100px; top: 100px">Lobby heading under the modal</p>
         <p class="at" style="left: 100px; top: 400px">Table name under a toast</p>
         <div class="at" style="inset: 0; background: rgba(0, 0, 0, 0.5)"></div>
         <div class="at" role="dialog" aria-modal="true" style="left: 90px; top: 95px; width: 400px; height: 120px; background: rgba(255, 255, 255, 0.6)">
           <span class="at" style="left: 10px; top: 4px">Dialog title</span>${inDialog}
         </div>
         <div class="at" role="region" aria-label="Notifications" style="left: 90px; top: 395px">
           <div role="status" style="padding: 4px; background: rgba(255, 240, 200, 0.6)">Toast message</div>
         </div>`,
      )
    await layers('')
    expect(await reportOf(page, 'modal and toast over the page')).toBe('')

    await layers('<span class="at" style="left: 30px; top: 8px">Dialog subtitle</span>')
    const report = await reportOf(page, 'overlap inside the modal')
    expect(report).toContain('(1 pair)')
    expect(report).toContain('"Dialog title"')
    expect(report).toContain('"Dialog subtitle"')
  })

  test('hoạt ảnh vô hạn trên trang: hàm trả về trong vòng 3 giây', async ({ page }) => {
    await show(
      page,
      `<div class="spinner at" style="left: 100px; top: 100px; width: 40px; height: 40px; border: 4px solid #333; border-top-color: transparent; border-radius: 50%"></div>
       <span class="pulse at" style="left: 200px; top: 106px">Loading tables</span>`,
      `@keyframes spin { to { transform: rotate(360deg); } }
       @keyframes pulse { 50% { opacity: 0.4; } }
       .spinner { animation: spin 1s linear infinite; }
       .pulse { animation: pulse 1.2s ease-in-out infinite; }`,
    )
    const [report, ms] = await timed(() => reportOf(page, 'infinite animation'))
    test.info().annotations.push({ type: 'timing', description: `infinite animation: ${ms} ms` })
    expect(report).toBe('')
    expect(ms, 'an infinite animation is never waited on').toBeLessThan(3_000)
  })

  test('hoạt ảnh hữu hạn: chờ nó xong (tối đa 2 giây) rồi mới đo', async ({ page }) => {
    await show(
      page,
      `<span class="at" style="left: 100px; top: 100px">Static label</span>
       <span class="slider at" style="left: 110px; top: 104px">Sliding label</span>
       <span class="drifter at" style="left: 600px; top: 100px">Slow drift</span>`,
      `@keyframes away { to { transform: translateY(80px); } }
       @keyframes drift { to { transform: translateX(20px); } }
       .slider.go { animation: away 900ms ease-out both; }
       .drifter.go { animation: drift 20s linear both; }`,
    )
    // Started now, so the slide is still over the static label when the helper is called: it passes only by waiting.
    await page.locator('.slider').evaluate((el) => el.classList.add('go'))
    const [slid, slideMs] = await timed(() => reportOf(page, 'finite slide'))
    expect(slid).toBe('')

    // A twenty-second animation is waited on for two seconds at most.
    await page.locator('.drifter').evaluate((el) => el.classList.add('go'))
    const [drifted, driftMs] = await timed(() => reportOf(page, 'long finite animation'))
    test.info().annotations.push({ type: 'timing', description: `finite slide: ${slideMs} ms; 20 s animation: ${driftMs} ms` })
    expect(drifted).toBe('')
    expect(driftMs, 'the wait for finite animations is capped at two seconds').toBeGreaterThanOrEqual(1_900)
    expect(driftMs).toBeLessThan(3_000)
  })
})
