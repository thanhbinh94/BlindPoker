/**
 * The download budget for the Normal web bundle (spec §24).
 *
 * Nothing else can check this. Every other test in this app runs against modules, not against the
 * artefact, so a dependency that quietly doubles the first paint — or a lazy screen that stops being
 * lazy because something in the entry started importing it — is invisible until a player on a phone
 * connection waits for it.
 *
 * The numbers measured are gzip, because that is what the wire carries: Caddy compresses this
 * directory in front of the server, and the raw byte counts vite prints are not what anyone
 * downloads. Four budgets, and the split between the first two is the point:
 *
 *   entry     what the browser must have before the sign-in card or the lobby can paint
 *   total     the entry plus every lazy chunk — the whole app, eventually
 *   css       one stylesheet, loaded with the entry
 *   avatar3d  three.js and the portrait renderer, downloaded only by a browser that draws one
 *
 * Like Lite's, every block skips with a warning when `dist/` is missing, so `pnpm test` on a fresh
 * checkout stays green and says what it had nothing to measure.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

/** `apps/normal-web`, resolved from this file rather than from the working directory. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = resolve(PACKAGE_ROOT, 'dist')
const ASSETS = join(DIST, 'assets')
const INDEX = join(DIST, 'index.html')

/**
 * Headroom, not targets. At the time of writing the entry is ~109 KB and the whole app ~119 KB gzip,
 * so these are roughly four times what is spent — deliberately, because the job of this test is to
 * catch a *step change* (a chart library, a moment.js, a locale bundle that stopped being split) and
 * not to fail on the kilobyte a feature legitimately costs.
 */
const MAX_ENTRY_GZIP = 500 * 1024
const MAX_TOTAL_GZIP = 900 * 1024
const MAX_CSS_GZIP = 60 * 1024

/**
 * three.js, `GLTFLoader`, the meshopt decoder and the portrait renderer, together (avatar-3d §7).
 *
 * This one *is* a target rather than headroom: it is roughly 25 % over what the graph costs today, and
 * the thing it is guarding against is somebody importing a control, a post-processing pass or a loader
 * for a format nothing uses. Everything under it is downloaded only by a browser that actually draws a
 * portrait, which is why it is allowed to be larger than the entry chunk at all.
 */
const MAX_AVATAR3D_GZIP = 200 * 1024

/**
 * A string that survives minification and cannot come from anywhere but three.
 *
 * `THREE.REVISION` does not survive — it is a `const` and the minifier inlines it — but three prefixes
 * every one of its own console messages with `THREE.<Class>:`, and those are string literals.
 */
const THREE_MARKER = 'THREE.WebGLRenderer'

/** vite names a dynamic chunk after the module that was split; `portraits.ts` is the avatar3d entry. */
const AVATAR3D_CHUNK = /^portraits-[\w-]+\.js$/

/** `App.tsx`'s six `React.lazy` screens; vite names each chunk after the module it split. */
const LAZY_SCREENS = ['ProfileScreen', 'AvatarScreen', 'InventoryScreen', 'AchievementsScreen', 'DailyScreen', 'SettingsScreen']

const hasDist = existsSync(ASSETS) && existsSync(INDEX)
if (!hasDist) {
  console.warn(`[footprint] skipping web-bundle checks: ${DIST} is missing — run \`pnpm --filter @bp/normal-web build\` first`)
}

const gzipOf = (file: string): number => gzipSync(readFileSync(file), { level: 9 }).length
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/** Every emitted asset with the given extension, as absolute paths. */
function assets(ext: string): string[] {
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => join(ASSETS, name))
}

/**
 * The entry chunk, read off `index.html` rather than guessed from the file names.
 *
 * Vite hashes every chunk and the lazy ones are named after their screen, so "the biggest one" or
 * "the one called index-*" would both be assumptions about the bundler's naming. The document's own
 * `<script type="module">` is the definition of what the browser fetches first.
 */
function entryChunk(): string {
  const html = readFileSync(INDEX, 'utf8')
  const hit = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)
  expect(hit, 'index.html must load a module script — that is the entry chunk').not.toBeNull()
  const file = join(DIST, hit![1]!.replace(/^\//, ''))
  expect(existsSync(file), `${file} is named by index.html but was not emitted`).toBe(true)
  return file
}

describe.skipIf(!hasDist)('normal-web bundle', () => {
  it('keeps the entry chunk inside the first-paint budget', () => {
    const size = gzipOf(entryChunk())
    console.log(`[footprint] entry chunk ${kb(size)} gzip (budget ${kb(MAX_ENTRY_GZIP)})`)
    expect(size).toBeLessThanOrEqual(MAX_ENTRY_GZIP)
  })

  it('keeps every chunk together inside the total budget', () => {
    const files = assets('.js')
    expect(files.length, 'the build must emit JavaScript').toBeGreaterThan(0)
    const total = files.reduce((sum, file) => sum + gzipOf(file), 0)
    console.log(`[footprint] ${files.length} JS chunks, ${kb(total)} gzip total (budget ${kb(MAX_TOTAL_GZIP)})`)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_GZIP)
  })

  it('keeps the stylesheet inside its budget', () => {
    const total = assets('.css').reduce((sum, file) => sum + gzipOf(file), 0)
    console.log(`[footprint] CSS ${kb(total)} gzip (budget ${kb(MAX_CSS_GZIP)})`)
    expect(total).toBeLessThanOrEqual(MAX_CSS_GZIP)
  })

  it('splits the account screens out of the entry chunk', () => {
    // The six lazy screens are `App.tsx`'s only `import()`s, and the reason the entry stays small. Counting
    // chunks is not enough — one stray lazy import satisfies "more than one" while five screens sit in the
    // entry — so this names them. Vite derives a lazy chunk's name from the module it split, so a screen
    // that rejoined the entry is a chunk that stopped being emitted under its own name.
    //
    // The entry is still identified the only reliable way, out of `index.html`; asserting its *name* on top
    // of that is what lets the loop below tell an entry chunk from a screen chunk by name alone.
    expect(basename(entryChunk()), 'the entry chunk is vite’s `index` input').toMatch(/^index-[\w-]+\.js$/)

    const names = assets('.js').map((file) => basename(file))
    for (const screen of LAZY_SCREENS) {
      expect(
        names.filter((name) => name.startsWith(`${screen}-`)),
        `${screen} must be a chunk of its own — something in the entry has started importing it eagerly`,
      ).toHaveLength(1)
    }
    expect(names.length, 'the entry plus the six screens, at least').toBeGreaterThanOrEqual(1 + LAZY_SCREENS.length)
  })

  it('keeps three.js out of the entry chunk entirely', () => {
    // The whole shape of `avatar3d/` — one dynamic `import()` in `usePortrait`, and the three.js graph
    // reachable through nothing else — exists for this assertion. A static import anywhere in
    // `Portrait`, `usePortrait`, `hash` or `portrait-cache` would put 150 KB gzip in front of the
    // sign-in card, and the entry budget above is four times too loose to notice.
    const entry = readFileSync(entryChunk(), 'utf8')
    expect(entry, `the entry chunk contains ${THREE_MARKER} — something outside avatar3d/ imports three`).not.toContain(THREE_MARKER)
  })

  it('keeps the whole 3D graph in one lazy chunk, inside its own budget', () => {
    const chunks = assets('.js').filter((file) => AVATAR3D_CHUNK.test(basename(file)))
    expect(chunks, 'the portrait renderer must be split out under its own name').toHaveLength(1)

    const chunk = chunks[0]!
    // Named after `portraits.ts`, and holding the thing that module exists to drive — so this cannot
    // quietly start measuring some other chunk that happens to match the name.
    expect(readFileSync(chunk, 'utf8')).toContain(THREE_MARKER)

    const size = gzipOf(chunk)
    console.log(`[footprint] avatar3d chunk ${kb(size)} gzip (budget ${kb(MAX_AVATAR3D_GZIP)})`)
    expect(size).toBeLessThanOrEqual(MAX_AVATAR3D_GZIP)
  })
})
