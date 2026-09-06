#!/usr/bin/env node
/**
 * A contact sheet of the avatar, rendered by the real thing: one PNG per item per body.
 *
 *   node scripts/avatar-shots.mjs after                    every item, both bodies, plus the two bodies bare
 *   node scripts/avatar-shots.mjs after bottom_jeans …     only the item ids named
 *
 * **Why this exists.** `scripts/avatar-map.json` is the only place a source mesh is named, and nothing
 * in it can be judged by reading it: whether `bottom_jeans` covers a leg or sinks into it, whether a
 * sleeve reaches the wrist, whether a shrinkwrap margin is enough to keep a thigh out of a skirt — all
 * of that is a *look*, and every unit test in this package replaces the renderer. So this drives the
 * app's own `createStage` out of the built `portraits-*.js` chunk, in headless Chromium on SwiftShader,
 * against the same `/avatar3d/` files the browser fetches. What comes out is what a player sees.
 *
 * It needs `pnpm build:normal` first (it serves `dist/` through `apps/normal-server/scripts/e2e-server.mjs`,
 * on its own port so it never collides with an e2e run) and Chromium (`pnpm exec playwright install chromium`).
 * Output goes to `e2e/screenshots/<phase>-<item>-<body>.png`, which is gitignored — the pictures are
 * evidence for a review, not project state. `<phase>` is yours to choose; `before`/`after` around a map
 * change is what `docs/avatar-assets.md` describes.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')
const DIST = join(PACKAGE_ROOT, 'dist')
const SHOTS = join(PACKAGE_ROOT, 'e2e/screenshots')
/** Not 8091: an e2e run may be holding that, and adopting somebody else's server is how runs get crossed. */
const PORT = process.env.SHOT_PORT ?? '8093'
const ORIGIN = `http://127.0.0.1:${PORT}`

const phase = process.argv[2] ?? 'shot'
const only = new Set(process.argv.slice(3))

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'public/avatar3d/manifest.json'), 'utf8'))
const chunk = readdirSync(join(DIST, 'assets')).find((name) => /^portraits-.*\.js$/.test(name))
if (chunk === undefined) throw new Error('no portraits-*.js in dist/assets — run `pnpm build:normal` first')

/** Every `<slot>/<id>/<body>` the manifest carries, grouped by item id. */
const items = new Map()
for (const key of Object.keys(manifest.nodes)) {
  const [slot, id, body] = key.split('/')
  if (slot === 'body') continue
  if (!items.has(id)) items.set(id, { slot, bodies: [] })
  items.get(id).bodies.push(body)
}

/** A configuration with nothing on it, so one item can be looked at on its own. */
const BARE = {
  v: 2,
  body: 'male',
  skin: '#e0b49a',
  eyes: '#3a2a1e',
  hairColor: '#2e2118',
  hair: 'hair_none',
  top: '',
  bottom: '',
  shoes: '',
}

/** …and one wearing the four default items, which is what a new account is dressed in. */
const DRESSED = { hair: 'hair_short', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers' }

const server = spawn(process.execPath, [join(REPO_ROOT, 'apps/normal-server/scripts/e2e-server.mjs')], {
  cwd: REPO_ROOT,
  env: { ...process.env, E2E_PORT: PORT },
  stdio: ['ignore', 'inherit', 'inherit'],
})

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${ORIGIN}/health`)).ok) return
    } catch {
      // still starting: it bundles the entry with esbuild and migrates a fresh PGlite first
    }
    await new Promise((settle) => setTimeout(settle, 1000))
  }
  throw new Error(`${ORIGIN}/health never answered`)
}

const report = []
try {
  mkdirSync(SHOTS, { recursive: true })
  await waitForServer()
  const browser = await chromium.launch({
    // Headless Chromium has no GPU here; ANGLE over SwiftShader is what gives it a WebGL2 context.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`))
  await page.goto(`${ORIGIN}/`)

  await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url)
    document.body.innerHTML = ''
    // A flat mid-grey behind a transparent canvas: light enough for a dark garment, dark enough for skin.
    document.body.style.cssText = 'margin:0;background:#2b3038'
    const canvas = document.createElement('canvas')
    canvas.id = 'figure'
    canvas.style.cssText = 'width:420px;height:820px;display:block'
    document.body.appendChild(canvas)
    const stage = module.createStage(canvas)
    stage.resize()
    window.__shots = stage
  }, `${ORIGIN}/assets/${chunk}`)

  const targets = [
    { id: 'bare', body: 'male' },
    { id: 'bare', body: 'female' },
    { id: 'dressed', body: 'male' },
    { id: 'dressed', body: 'female' },
  ]
  for (const [id, { slot, bodies }] of [...items].sort(([a], [b]) => a.localeCompare(b))) {
    if (only.size > 0 && !only.has(id)) continue
    for (const body of [...bodies].sort()) targets.push({ id, slot, body })
  }

  for (const { id, slot, body } of targets) {
    const config =
      id === 'bare' ? { ...BARE, body } : id === 'dressed' ? { ...BARE, ...DRESSED, body } : { ...BARE, body, hair: slot === 'hair' ? id : 'hair_none', [slot]: id }
    const ms = await page.evaluate(async (wanted) => {
      const started = performance.now()
      await window.__shots.setConfig(wanted)
      // The stage draws on a `requestAnimationFrame`; two of them is a frame that has certainly landed.
      await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)))
      return Math.round(performance.now() - started)
    }, config)
    const file = `${phase}-${id}-${body}.png`
    await page.locator('#figure').screenshot({ path: join(SHOTS, file) })
    report.push({ id, body, ms, file })
    console.log(`[avatar-shots] ${file.padEnd(44)} ${String(ms).padStart(4)} ms`)
  }

  await browser.close()
  writeFileSync(join(SHOTS, `${phase}-index.json`), `${JSON.stringify(report, null, 2)}\n`)
} finally {
  server.kill('SIGTERM')
}
console.log(`[avatar-shots] ${report.length} renders in ${dirname(join(SHOTS, 'x'))}`)
