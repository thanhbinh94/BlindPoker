import { test, type Page } from '@playwright/test'

/**
 * The text-overlap rule (review 2026-09-29, No11b): no visible text may be drawn over other visible text. The user
 * found it by eye on several screens — "Ván tiếp theo sau 6 giây" printed across the viewer's own seat plate (No2-1)
 * among them — so a screen's e2e now asserts it instead: `await expectNoTextOverlap(page, 'room, result card')`.
 * A spec that calls it also sets `test.use({ contextOptions: { reducedMotion: 'reduce' } })`; the helper emulates the
 * same media on the page, and then waits for fonts and for finite animations (never an infinite one), 2 s at most.
 *
 * What counts, and what deliberately does not (docs/ui-kit.md, "The text-overlap rule"):
 *
 * - **Text runs**, not elements: every non-blank text node's line boxes (`Range.getClientRects()`), so two labels
 *   in overlapping boxes that never touch are fine, and a long name that wraps is measured line by line. Text inside
 *   `svg`, `[role=img]` or `[aria-hidden=true]` is artwork (a card's rank, a suit glyph), and an element that fails
 *   `checkVisibility` is not on screen at all.
 * - **Only what is visible**: each line box is clipped by every ancestor that clips its overflow (an ellipsis, a
 *   scroll area) and by the viewport; what lies below the fold is not measured — scroll and call again.
 * - **Glyphs, not leading**: each line box is 20 % of its font size shorter (10 % off the top, 10 % off the bottom).
 *   A line box is the font's full height — about 1.25 em for the kit's Be Vietnam Pro and Fraunces — so the lines
 *   of a block set at `line-height: 1` overlap by about 0.25 em; after the shrink what is left stays inside the
 *   2 px tolerance for type under 40 px.
 * - **Layers**: a modal (`[role=dialog][aria-modal=true]`) and the toast stack are each compared only with
 *   themselves; everything else is one page layer.
 * - **Covered is not overlapped**: where two runs intersect by more than 2 px both ways, the lower one is hidden —
 *   and fine — when an opaque box (≥ 0.9 alpha) that is not its own ancestor is painted over it at the centre of the
 *   intersection: a card over the felt, a sticky footer over the fields it scrolls over.
 * - **By design**: text inside `[data-overlap-ok="<reason>"]` is skipped. The reason is required (an empty attribute
 *   exempts nothing) and it is for the rare deliberate case, never to silence a layout bug.
 *
 * Everything is measured in one `page.evaluate` and comes back as data; the message is built here.
 */

export interface OverlapOptions {
  /** CSS selectors whose subtrees are not measured at all — for rare, documented cases (prefer `data-overlap-ok`). */
  ignore?: string[]
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface TextRun {
  text: string
  box: Box
  path: string
}

interface Overlap {
  a: TextRun
  b: TextRun
  /** The intersection of the two measured boxes. */
  width: number
  height: number
}

interface MeasureArgs {
  ignore: string[]
  /** Fraction of the font size taken off every line box's height — half at the top, half at the bottom. */
  shrink: number
  /** Intersections this size or smaller, in either axis, are touching rather than overlapping. */
  tolerance: number
  /** Background alpha (times the element's effective opacity) from which a box hides what is under it. */
  opaqueAlpha: number
  /** The longest the helper waits for finite animations and transitions to finish. */
  animationCapMs: number
}

const TUNING: Omit<MeasureArgs, 'ignore'> = { shrink: 0.2, tolerance: 2, opaqueAlpha: 0.9, animationCapMs: 2_000 }

/**
 * Fails (throws) when visible text overlaps other visible text on `page`, listing every pair: both texts, their
 * boxes and a short CSS path. `label` names the screen and state in that message ("room, result card, 1920×940").
 */
export async function expectNoTextOverlap(page: Page, label: string, opts: OverlapOptions = {}): Promise<void> {
  await test.step(
    `no text overlap: ${label}`,
    async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const found = await page.evaluate(measureTextOverlaps, { ignore: opts.ignore ?? [], ...TUNING })
      if (found.length > 0) throw new Error(describeOverlaps(label, found))
    },
    { box: true },
  )
}

function describeOverlaps(label: string, found: Overlap[]): string {
  const clip = (text: string): string => {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat
  }
  const box = (b: Box): string => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}`
  const run = (r: TextRun): string => `"${clip(r.text)}" [${box(r.box)}] ${r.path}`
  const lines = found.map((o, i) => `  ${i + 1}. ${run(o.a)}\n     × ${run(o.b)}\n     overlap ${Math.round(o.width)}×${Math.round(o.height)} px`)
  return [
    `Text overlaps text on "${label}" (${found.length} pair${found.length === 1 ? '' : 's'}):`,
    ...lines,
    'Fix the layout; only a deliberate overlap may be marked data-overlap-ok="<reason>" (docs/ui-kit.md).',
  ].join('\n')
}

/**
 * The in-page half. Runs inside the browser, so it may use nothing from this module's scope: every helper it needs
 * is declared inside it.
 */
async function measureTextOverlaps(args: MeasureArgs): Promise<Overlap[]> {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  // --- 1. settle: fonts, the reduced-motion restyle, and finite animations only (an infinite one never ends) ------
  await document.fonts.ready
  await Promise.race([new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), sleep(100)])
  const finite = document.getAnimations().filter((a) => {
    if (a.playState !== 'running') return false
    const end = a.effect?.getComputedTiming().endTime
    return end !== undefined && Number.isFinite(Number(end))
  })
  if (finite.length > 0) {
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), sleep(args.animationCapMs)])
  }

  // --- 2. the visible text runs ------------------------------------------------------------------------------------
  const root = document.documentElement
  const viewport = { left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight }
  const LAYERS = '[role="dialog"][aria-modal="true"], [role="region"]:has(> [role="alert"], > [role="status"])'
  const ARTWORK = 'svg, [role="img"], [aria-hidden="true"]'

  interface Edges {
    left: number
    top: number
    right: number
    bottom: number
  }
  interface Rect extends Edges {
    node: number
    el: Element
    layer: Element | null
  }

  const exempt = (el: Element): boolean => {
    for (let e: Element | null = el; e !== null; e = e.parentElement) {
      if ((e.getAttribute('data-overlap-ok') ?? '').trim() !== '') return true
    }
    return false
  }

  /** What an element's overflow-clipping ancestors (and the viewport) leave visible of its content, in client px. */
  const clips = new Map<Element, Edges>()
  const clipOf = (el: Element): Edges => {
    const cached = clips.get(el)
    if (cached !== undefined) return cached
    const box = { ...viewport }
    // An absolutely positioned box escapes the clipping of every ancestor below its containing block, and a fixed one
    // the clipping of every ancestor unless one is its containing block (a transform, a filter, containment).
    let escaping: 'no' | 'absolute' | 'fixed' = 'no'
    for (let e: Element | null = el; e !== null && e !== document.body && e !== root; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const holdsFixed = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain)
      if (escaping === 'absolute' && (cs.position !== 'static' || holdsFixed)) escaping = 'no'
      else if (escaping === 'fixed' && holdsFixed) escaping = 'no'
      const clipsX = cs.overflowX !== 'visible'
      const clipsY = cs.overflowY !== 'visible'
      if (escaping === 'no' && (clipsX || clipsY) && cs.display !== 'inline' && cs.display !== 'contents') {
        const r = e.getBoundingClientRect()
        const left = r.left + e.clientLeft
        const top = r.top + e.clientTop
        if (clipsX) {
          box.left = Math.max(box.left, left)
          box.right = Math.min(box.right, left + e.clientWidth)
        }
        if (clipsY) {
          box.top = Math.max(box.top, top)
          box.bottom = Math.min(box.bottom, top + e.clientHeight)
        }
      }
      if (cs.position === 'absolute') escaping = 'absolute'
      else if (cs.position === 'fixed') escaping = 'fixed'
    }
    clips.set(el, box)
    return box
  }

  const texts: Text[] = []
  const rects: Rect[] = []
  const range = document.createRange()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const node = n as Text
    const el = node.parentElement
    if (el === null || !/\S/.test(node.data)) continue
    if (el.closest(ARTWORK) !== null || exempt(el) || args.ignore.some((sel) => el.closest(sel) !== null)) continue
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
    const inset = (parseFloat(getComputedStyle(el).fontSize) * args.shrink) / 2
    const clip = clipOf(el)
    const layer = el.closest(LAYERS)
    range.selectNodeContents(node)
    for (const r of Array.from(range.getClientRects())) {
      const left = Math.max(r.left, clip.left)
      const right = Math.min(r.right, clip.right)
      const top = Math.max(r.top + inset, clip.top)
      const bottom = Math.min(r.bottom - inset, clip.bottom)
      if (right - left <= 0 || bottom - top <= 0) continue
      rects.push({ left, top, right, bottom, node: texts.length, el, layer })
    }
    texts.push(node)
  }

  // --- 3. the pairs, and whether the lower of each is hidden under an opaque box -----------------------------------
  const alphaOf = (colour: string): number => {
    const c = colour.trim().toLowerCase()
    if (c === 'transparent') return 0
    const body = /\(([^()]*)\)\s*$/.exec(c)?.[1]
    if (body === undefined) return 1
    let alpha: string | undefined
    if (body.includes('/')) alpha = body.slice(body.lastIndexOf('/') + 1).trim()
    else if (body.split(',').length === 4) alpha = body.split(',')[3]!.trim()
    if (alpha === undefined) return 1
    return alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha)
  }
  const COLOUR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent/g
  const opaque = new Map<Element, boolean>()
  const isOpaque = (el: Element): boolean => {
    const cached = opaque.get(el)
    if (cached !== undefined) return cached
    const cs = getComputedStyle(el)
    let alpha = alphaOf(cs.backgroundColor)
    // A surface painted with a gradient over a transparent colour (the kit's seat plates) is as solid as its stops.
    if (alpha < args.opaqueAlpha && cs.backgroundImage.includes('gradient(') && !cs.backgroundImage.includes('url(')) {
      const stops = cs.backgroundImage.match(COLOUR) ?? []
      if (stops.length > 0 && stops.every((s) => alphaOf(s) >= args.opaqueAlpha)) alpha = 1
    }
    // Gradient text paints only its glyphs; it hides nothing around them.
    if (`${cs.backgroundClip} ${cs.getPropertyValue('-webkit-background-clip')}`.includes('text')) alpha = 0
    for (let e: Element | null = el; e !== null && alpha >= args.opaqueAlpha; e = e.parentElement) alpha *= parseFloat(getComputedStyle(e).opacity)
    const result = alpha >= args.opaqueAlpha
    opaque.set(el, result)
    return result
  }
  /** Index in the hit stack of `el`, or of its nearest ancestor there; -1 when neither is. */
  const depthOf = (stack: Element[], el: Element): number => {
    for (let e: Element | null = el; e !== null; e = e.parentElement) {
      const i = stack.indexOf(e)
      if (i >= 0) return i
    }
    return -1
  }
  const lowerIsCovered = (x: number, y: number, a: Element, b: Element): boolean => {
    const stack = document.elementsFromPoint(x, y)
    const [da, db] = [depthOf(stack, a), depthOf(stack, b)]
    const lower = da >= db ? a : b
    const depth = Math.max(da, db)
    // Everything painted above the lower run's element, except that element's own ancestors — its own card or plate
    // is behind its text, not over it.
    for (let i = 0; i < depth; i++) {
      const over = stack[i]!
      if (over.contains(lower)) continue
      if (isOpaque(over)) return true
    }
    return false
  }

  const pathOf = (el: Element): string => {
    const parts: string[] = []
    for (let e: Element | null = el; e !== null && e !== document.body && parts.length < 4; e = e.parentElement) {
      let part = e.tagName.toLowerCase()
      if (e.id !== '') {
        parts.unshift(`${part}#${e.id}`)
        break
      }
      const role = e.getAttribute('role')
      if (role !== null) part += `[role=${role}]`
      const classes = Array.from(e.classList).slice(0, 2)
      if (classes.length > 0) part += `.${classes.join('.')}`
      parts.unshift(part)
    }
    return parts.join(' > ')
  }
  const measured = (i: number, r: Rect): TextRun => ({ text: texts[i]!.data, box: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }, path: pathOf(r.el) })

  // Hit testing skips `pointer-events: none` (the room's overlay has it), which would hide a run's own element — and a
  // cover — from `elementsFromPoint`. Overridden for the measurement only, inside this one synchronous block.
  const hitAll = document.createElement('style')
  hitAll.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
  const found = new Map<string, Overlap>()
  document.head.append(hitAll)
  try {
    for (let i = 0; i < rects.length; i++) {
      const p = rects[i]!
      for (let j = i + 1; j < rects.length; j++) {
        const q = rects[j]!
        if (p.node === q.node || p.layer !== q.layer) continue
        const left = Math.max(p.left, q.left)
        const right = Math.min(p.right, q.right)
        const top = Math.max(p.top, q.top)
        const bottom = Math.min(p.bottom, q.bottom)
        if (right - left <= args.tolerance || bottom - top <= args.tolerance) continue
        // One entry per pair of text nodes: a wrapped run meets its neighbour on more than one line.
        const key = `${p.node}:${q.node}`
        if (found.has(key)) continue
        if (lowerIsCovered((left + right) / 2, (top + bottom) / 2, p.el, q.el)) continue
        found.set(key, { a: measured(p.node, p), b: measured(q.node, q), width: right - left, height: bottom - top })
      }
    }
  } finally {
    hitAll.remove()
  }
  return Array.from(found.values())
}
