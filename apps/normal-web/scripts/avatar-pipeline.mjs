#!/usr/bin/env node
/**
 * The 2D avatar asset pipeline (spec §6, D01, D02).
 *
 *   node scripts/avatar-pipeline.mjs placeholder
 *       Draw the whole stage-1 set as labelled stand-ins and write both copies of the manifest. Names
 *       the manifest already marks `real: true` are left alone, so this is safe to re-run at any point
 *       in the hand-over from stand-ins to art. Every item also gets its inventory icon: a stand-in's is
 *       redrawn, a real item's is kept (or, if it has none yet, cut from its layer on disk). Idempotent.
 *
 *   node scripts/avatar-pipeline.mjs ingest <png> --as base:f01 | expr:f01:happy | item:head:tophat01
 *                                              | item:aura:fire01 | item:frame:gold | bot:3 | bot:3:happy
 *       One generated picture in, its layers at @1x and @2x out, plus their manifest entries. A base is a
 *       flat AI picture and writes four: L30 (the figure), face_neutral L50 (its head region, less the torso
 *       column under y 236), L60 (a strand of hair above the head top, if the picture has one, else empty) and
 *       an empty L20, the empty ones marked `empty: true`. The strand's rows go to L60 only. An expression
 *       keeps only the face region (as face_neutral).
 *       An aura or a frame is a square picture, the effect in a ring: placed by its ink box — an aura fitted to
 *       400 and centred on (192, 240), running off the frame's sides; a frame fitted to the 260 ring round the
 *       crop centre (192, 144), and refused unless its middle is empty — and written with its icon.
 *       A bot (`bot:<n>`, n 0–7) is cut like a base on f01's stored transform: bot_<n>_L30 (the whole figure)
 *       and bot_<n>_face_neutral_L50, with the other five faces written as copies of it (`copyOf`); a face
 *       already real is kept. `bot:<n>:happy` cuts only that face from its own picture. Options:
 *         --dry-run             measure the picture against D02 §8 and print a verdict; write nothing
 *         --base <id>           which base an item or expression belongs to (default f01)
 *         --variant <f|m>       cut this picture as the per-wear variant of an item that already exists,
 *                               `item_<slot>_<code>_<wear>_L<n>` — e.g. a male dealer01:
 *                                 --as item:outfit:dealer01 --base m01 --variant m
 *                               The wear must be the wear of `--base`, or the cut is refused.
 *         --tolerance <n>       how wide the background key is (default 40)
 *         --white               the background is white rather than #00FF00; no despill
 *         --lock-scale <n>      force a scale instead of reading the base's stored one
 *         --transform-from <id> a new base drawn from base <id> (same body, same canvas) takes <id>'s transform;
 *                               a bot takes f01's unless this names another base
 *         --hides-hair-front    record D01 §4.3's hide rules on a head item
 *         --hides-hair-back
 *         --color-tol <n>       an item: how far (RGB distance) a pixel must be from every base pixel near it
 *                               to count as the item (default: DIFF_DEFAULTS in extract.mjs)
 *         --min-region <n>      an item: the smallest connected region kept, in @1x pixels
 *         --max-hole <n>        an item: the largest enclosed hole filled, in @1x pixels
 *         --tint-seed <x,y>     a tintable item: the point (1x frame coords) `masks`/tint-sheet later cuts
 *                               its colour region from; stored on the item's manifest entry
 *       An item is registered on its base first (the offset is logged), cut down to only itself, and written
 *       with its inventory icon, item_<slot>_<code>_icon (96 × 96 at @1x, 192 × 192 at @2x). `ingest` masks
 *       whatever it just wrote that `masks` would (spec §4.1), so art ingested after this needs no separate
 *       `masks` run.
 *
 *   node scripts/avatar-pipeline.mjs masks [<name>...] [--tint-seed <x,y> --as item:<slot>:<code>]
 *       Cut hair, eye, tint and skin masks (spec §4.1; Plan 19 §5.5) for the named layers, or — with none
 *       named — every real base L30/L60, base face and tintable item, and every real v4 body (skin), body face
 *       (eyes, then skin clear of them; never hair — the head is bald) and hair layer (its ink). A hand-drawn
 *       `assets/avatar-src/masks/<name>_<kind>mask.png` wins over the cut. `--tint-seed` (with `--as`) records
 *       a tint seed on an item already in the manifest before masking it.
 *
 *   node scripts/avatar-pipeline.mjs colours <name>... [--dir <layers>]
 *       Print the colour each mask of the named layers covers, one line per mask: `<name> <kind> #rrggbb` —
 *       the alpha-weighted mean of the layer under the mask, an eye mask by its iris alone (`maskColour`). A
 *       hair layer's line adds its hairstyle's `naturalColour` from items.json, once it has one, and the
 *       distance to it: `natural #rrggbb ΔE n.n`. How the style gate records the drawn cream and irises, and
 *       how a hairstyle is held to its natural colour (Plan 19, phases B and C).
 *
 *   node scripts/avatar-pipeline.mjs check [<name>...] [--skip C6]
 *       Run D01 §10's ten criteria, C11 (masks), C12 (a v4 body's head stays on F01's) and C13 (a hairstyle's
 *       two layers split cleanly) over every layer (or the named ones), print the table, exit 1 on any failure.
 *       `--skip` may be repeated.
 *
 *   node scripts/avatar-pipeline.mjs sheet [--dir <layers>] [--out <png>]
 *       Compose every item on both bases into docs/avatar-2d-sheet.png — the style gate of spec §9.
 *
 *   node scripts/avatar-pipeline.mjs tint-sheet [--dir <layers>] [--out <png>]
 *       Compose docs/avatar-2d-tint-sheet.png (Plan 13 spec §4.2): every masked base in three hair × three
 *       eye colours, plus one card per `items.json` entry with `asset.tint` set — the eyeballed check for
 *       recolouring before C11 or the client ever draws one.
 *
 * `placeholder`, `ingest` and `masks` take `--out <dir>`; `check`, `colours`, `sheet` and `tint-sheet` read `--dir <dir>`. Pointing
 * either at a directory that is not `public/avatar/` also stops the server's copy of the manifest from being
 * written, which is what makes the whole pipeline testable without touching the committed artefact.
 *
 * The work is in `scripts/avatar-pipeline/`, one module per stage — `png` (pixels), `frame` (the frame
 * and the stand-in art), `extract` (cutting a layer out of a picture), `masks` (spec §4.1's hair/eye/tint
 * cuts, Plan 19's skin, and the colours they cover), `hair` (Plan 19's front/back hair split), `checks` (D01 §10,
 * C11–C13), `sheet`, `manifest` (names and the file). This file only reads the command line.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { anyFailed, formatChecks, runChecks } from './avatar-pipeline/checks.mjs'
import { ingest } from './avatar-pipeline/extract.mjs'
import { describeColours, maskTargets, writeMasks } from './avatar-pipeline/masks.mjs'
import { buildSheet } from './avatar-pipeline/sheet.mjs'
import { buildTintSheet } from './avatar-pipeline/tint-sheet.mjs'
import {
  ITEMS_FILE,
  MANIFEST_NAME,
  PUBLIC_DIR,
  SERVER_MANIFEST,
  SHEET_FILE,
  STAGE_ONE_ITEMS,
  SLOT_LAYER,
  TINT_SHEET_FILE,
  buildPlaceholders,
  itemFile,
  readManifest,
  writeManifest,
} from './avatar-pipeline/manifest.mjs'

const log = (message) => console.log(`[avatar-pipeline] ${message}`)

function die(message) {
  console.error(`[avatar-pipeline] ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const command = argv[0]

/** `--name value`, or `fallback`. */
function option(name, fallback = null) {
  const at = argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) die(`--${name} needs a value`)
  return value
}

/** Every `--name value` pair, for options that may be repeated. */
function options(name) {
  const values = []
  for (let at = 0; at < argv.length; at++) if (argv[at] === `--${name}`) values.push(argv[at + 1])
  return values.filter((value) => value !== undefined && !value.startsWith('--'))
}

/** The options that take no value, so that `--white picture.png` does not eat the picture. */
const BOOLEANS = new Set(['dry-run', 'white', 'hides-hair-front', 'hides-hair-back'])

const flag = (name) => argv.includes(`--${name}`)

/** Positional arguments: everything after the command that is not an option or an option's value. */
function positionals() {
  const values = []
  for (let at = 1; at < argv.length; at++) {
    if (argv[at].startsWith('--')) {
      if (!BOOLEANS.has(argv[at].slice(2)) && argv[at + 1] !== undefined && !argv[at + 1].startsWith('--')) at++
      continue
    }
    values.push(argv[at])
  }
  return values
}

/** Where layers live, and where the manifest goes. See the header on why a custom path unhooks the server. */
function destinations(name) {
  const given = option(name)
  const dir = given ? resolve(process.cwd(), given) : PUBLIC_DIR
  const targets = dir === PUBLIC_DIR ? [resolve(PUBLIC_DIR, MANIFEST_NAME), SERVER_MANIFEST] : [resolve(dir, MANIFEST_NAME)]
  return { dir, targets }
}

/** `base:f01`, `expr:f01:happy`, `item:head:tophat01`, `item:aura:fire01`, `item:frame:gold`, `bot:3`, `bot:3:happy`. */
function parseTarget(spec) {
  if (!spec) die('ingest needs --as base:f01 | expr:f01:happy | item:head:tophat01 | bot:3 | bot:3:happy')
  const [kind, first, second] = spec.split(':')
  if (kind === 'base' && first) return { kind: 'base', base: first }
  if (kind === 'expr' && first && second) return { kind: 'expr', base: first, expr: second }
  if (kind === 'item' && first && second) {
    if (!STAGE_ONE_ITEMS[first]) die(`unknown slot ${first} — one of ${Object.keys(STAGE_ONE_ITEMS).join(', ')}`)
    return { kind: 'item', slot: first, code: second }
  }
  if (kind === 'bot' && /^\d+$/.test(first ?? '')) return { kind: 'bot', bot: Number(first), expr: second ?? 'neutral' }
  return die(`cannot read --as ${spec}`)
}

/** `--tint-seed x,y` (1x frame coords), or `null` when the option is absent. */
function tintSeedOption() {
  const value = option('tint-seed')
  if (value === null) return null
  const [x, y] = value.split(',').map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) die(`--tint-seed needs x,y, got ${value}`)
  return { x, y }
}

try {
  if (command === 'placeholder') {
    const { dir, targets } = destinations('out')
    await buildPlaceholders({ dir, targets, log })
    log(`manifest written to ${targets.length} place${targets.length === 1 ? '' : 's'}`)
  } else if (command === 'ingest') {
    const [file] = positionals()
    if (!file) die('ingest needs a path to a PNG')
    const { dir, targets } = destinations('out')
    const lockScale = option('lock-scale')
    const { report } = await ingest({
      file: resolve(process.cwd(), file),
      target: parseTarget(option('as')),
      dir,
      targets,
      baseId: option('base', 'f01'),
      variant: option('variant'),
      tolerance: Number(option('tolerance', '40')),
      white: flag('white'),
      dryRun: flag('dry-run'),
      lockScale: lockScale === null ? null : Number(lockScale),
      transformFrom: option('transform-from'),
      hides: { ...(flag('hides-hair-front') ? { hidesHairFront: true } : {}), ...(flag('hides-hair-back') ? { hidesHairBack: true } : {}) },
      diff: {
        ...(option('color-tol') === null ? {} : { colorTol: Number(option('color-tol')) }),
        ...(option('min-region') === null ? {} : { minRegion: Number(option('min-region')) }),
        ...(option('max-hole') === null ? {} : { maxHole: Number(option('max-hole')) }),
      },
      tintSeed: tintSeedOption(),
      log,
    })
    if (flag('dry-run') && !report.ok) process.exitCode = 1
  } else if (command === 'masks') {
    const { dir, targets } = destinations('out')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const seed = tintSeedOption()
    if (seed) {
      const target = parseTarget(option('as'))
      if (target.kind !== 'item') die('--tint-seed needs --as item:<slot>:<code>')
      const name = itemFile(target.slot, target.code, SLOT_LAYER[target.slot])
      if (!manifest.files[name]) die(`no layer ${name} in the manifest — ingest it first`)
      manifest.files[name].tintSeed = seed
    }
    const names = positionals().length ? positionals() : maskTargets(manifest)
    await writeMasks({ dir, manifest, names, log })
    await writeManifest(manifest, targets)
    log(`${names.length} layer${names.length === 1 ? '' : 's'} masked`)
  } else if (command === 'check') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const rows = await runChecks({ dir, manifest, names: positionals(), skip: options('skip') })
    console.log(formatChecks(rows))
    if (anyFailed(rows)) process.exitCode = 1
  } else if (command === 'colours') {
    const names = positionals()
    if (!names.length) die('colours needs the layers to measure, e.g. colours body_f_L30 body_f_face_neutral_L50')
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const items = existsSync(ITEMS_FILE) ? JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) : []
    for (const line of await describeColours({ dir, manifest, names, items, log })) console.log(line)
  } else if (command === 'sheet') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const out = option('out') ? resolve(process.cwd(), option('out')) : SHEET_FILE
    await buildSheet({ dir, manifest, out, log })
  } else if (command === 'tint-sheet') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const out = option('out') ? resolve(process.cwd(), option('out')) : TINT_SHEET_FILE
    const items = existsSync(ITEMS_FILE) ? JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) : []
    await buildTintSheet({ dir, manifest, items, out, log })
  } else {
    die(`unknown command ${command ?? '(none)'} — one of placeholder, ingest, check, colours, sheet, masks, tint-sheet`)
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}
