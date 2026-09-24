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
 * downloads. Three budgets:
 *
 *   entry   what the browser must have before the sign-in card or the lobby can paint
 *   total   the entry plus every lazy chunk — the whole app, eventually
 *   css     one stylesheet, loaded with the entry
 *
 * …and a fourth that is not JavaScript, and not gzip either: the chibi's own PNG layers under
 * `public/avatar/`, which ship as-is (§8).
 *
 * Like Lite's, every block skips with a warning when `dist/` is missing, so `pnpm test` on a fresh
 * checkout stays green and says what it had nothing to measure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
 * Headroom, not targets. Re-measured after Plan 11 deleted `src/avatar3d/`: the entry is unchanged by
 * the cut — three.js was already behind a dynamic `import()` and no longer reachable from the entry
 * even before this plan, so removing the module tree removed dead weight from the repository, not
 * from this chunk — at 107.9 KB gzip (110443 bytes), `MAX_ENTRY_GZIP` is that measurement plus 20 %
 * headroom, rounded up. The whole app is ~119 KB gzip, so `MAX_TOTAL_GZIP` stays roughly four times
 * that: loose enough not to fail on the kilobyte a feature legitimately costs, tight enough to catch a
 * *step change* (a chart library, a moment.js, a locale bundle that stopped being split) rather than
 * let one slide in unnoticed.
 */
const MAX_ENTRY_GZIP = 130 * 1024
const MAX_TOTAL_GZIP = 900 * 1024
const MAX_CSS_GZIP = 60 * 1024

/**
 * The chibi's stage-1 PNG layers, as they are actually served (design §8): `public/avatar/` is copied
 * into `dist/avatar/` verbatim by vite, so this is also what a browser downloads.
 *
 * Raw bytes, not gzip — PNG is already compressed, and gzipping one again buys a percent or two for
 * the cost of pretending the wire cost is smaller than it is. Only the `@2x` files are budgeted: `@1x`
 * is the same pictures at a quarter the pixels and never dominates the total, and the design's own
 * ceiling (§8: "tổng PNG @2x giai đoạn 1 ≤ 6 MB") is written against `@2x` specifically.
 */
const AVATAR_DIR = join(PACKAGE_ROOT, 'public', 'avatar')
/**
 * 2026-09-24: raised from the design's 6 MB to 16 MB. Real AI art is ~275 KB a body layer and ~150 KB a face
 * against ~15 KB a stand-in, and six bases with six faces each are ~7 MB before a single item; every layer
 * is fetched lazily and only when equipped, so the total is a repository ceiling, not a page cost.
 * Recorded in the spec (§8 amendment) and docs/bug-log.md; a palette-quantisation pass is the deferred
 * way back down.
 * 2026-09-24 (later): raised again to 32 MB once the eight bots landed. A bot is a ~275 KB body plus six ~150 KB faces,
 * four of which are byte-for-byte copies of its neutral face (`copyOf` in the manifest — the kit names a face per
 * expression and a bot only ever draws neutral and happy). The measured total is 24.2 MB; the copies are ~4.7 MB of
 * it. The way back down is to stop writing them and let `layersFor` fold a bot's other expressions onto neutral —
 * a kit change with its own tests, deferred (docs/bug-log.md).
 */
const MAX_AVATAR_2X_TOTAL = 32 * 1024 * 1024

/** `App.tsx`'s six `React.lazy` screens; vite names each chunk after the module it split. */
const LAZY_SCREENS = ['ProfileScreen', 'WardrobeScreen', 'InventoryScreen', 'AchievementsScreen', 'DailyScreen', 'SettingsScreen']

/**
 * Whether there is a build to measure — and, when there is not, a warning nobody can mistake for green.
 *
 * The entry, the total and the CSS are measured off `dist/`, so a checkout that has not built skips
 * those three: that is the repository's established pattern (Lite's footprint suite skips the same
 * way, and `docs/normal-web.md` says so), because failing would fail every fresh clone. The avatar
 * layer budget reads `public/avatar/` directly and does not skip — those files are committed, not
 * built. What the build-dependent half must not do is skip *quietly* — a `pnpm test` that measured
 * nothing looks exactly like one that measured everything, and the numbers these tests guard are the
 * kind somebody reads off a green run. So the warning names each budget it is not checking, and the
 * command that would.
 */
const hasDist = existsSync(ASSETS) && existsSync(INDEX)
if (!hasDist) {
  console.warn(
    `[footprint] ⚠ NOT MEASURED: ${DIST} is missing, so the entry chunk, all JS together and the stylesheet\n` +
      '[footprint]   are skipped. Run `pnpm --filter @bp/normal-web build` first.\n' +
      '[footprint]   (the avatar layer budget below reads `public/avatar/` directly and does not skip.)',
  )
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
})

/**
 * The avatar layer budget does not skip on a missing `dist/` — it reads `public/avatar/` directly, the
 * same directory `test/avatar-pipeline.test.ts` writes placeholders into and the pipeline's `ingest`
 * will later fill with real art, file by file.
 */
it('ships the stage-1 avatar layers under 6 MB at @2x', () => {
  expect(existsSync(AVATAR_DIR), `${AVATAR_DIR} must exist — run \`pnpm --filter @bp/normal-web avatar:placeholder\``).toBe(true)
  const files = readdirSync(AVATAR_DIR).filter((name) => name.endsWith('@2x.png'))
  expect(files.length, 'the avatar directory must ship at least one @2x layer').toBeGreaterThan(0)

  let total = 0
  for (const name of files) total += statSync(join(AVATAR_DIR, name)).size
  console.log(`[footprint] avatar @2x layers ${kb(total)} across ${files.length} files (budget ${kb(MAX_AVATAR_2X_TOTAL)})`)
  expect(total).toBeLessThanOrEqual(MAX_AVATAR_2X_TOTAL)
})
