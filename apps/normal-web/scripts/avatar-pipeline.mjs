#!/usr/bin/env node
/**
 * The 2D avatar asset pipeline (spec §6, D01, D02).
 *
 *   node scripts/avatar-pipeline.mjs placeholder
 *       Draw the whole stage-1 set as labelled stand-ins and write both copies of the manifest. Names
 *       the manifest already marks `real: true` are left alone, so this is safe to re-run at any point
 *       in the hand-over from stand-ins to art. Idempotent.
 *
 *   node scripts/avatar-pipeline.mjs ingest <png> --as base:f01 | expr:f01:happy | item:head:tophat01
 *       One generated picture in, one layer at @1x and @2x out, plus its manifest entry. Options:
 *         --dry-run             measure the picture against D02 §8 and print a verdict; write nothing
 *         --base <id>           which base an item or expression belongs to (default f01)
 *         --tolerance <n>       how wide the background key is (default 40)
 *         --white               the background is white rather than #00FF00; no despill
 *         --lock-scale <n>      force a scale instead of reading the base's stored one
 *         --hides-hair-front    record D01 §4.3's hide rules on a head item
 *         --hides-hair-back
 *
 *   node scripts/avatar-pipeline.mjs check [<name>...] [--skip C6]
 *       Run D01 §10's ten criteria over every layer (or the named ones), print the table, exit 1 on any
 *       failure. `--skip` may be repeated.
 *
 *   node scripts/avatar-pipeline.mjs sheet [--dir <layers>] [--out <png>]
 *       Compose every item on both bases into docs/avatar-2d-sheet.png — the style gate of spec §9.
 *
 * `placeholder` and `ingest` take `--out <dir>`; `check` and `sheet` read `--dir <dir>`. Pointing either
 * at a directory that is not `public/avatar/` also stops the server's copy of the manifest from being
 * written, which is what makes the whole pipeline testable without touching the committed artefact.
 *
 * The work is in `scripts/avatar-pipeline/`, one module per stage — `png` (pixels), `frame` (the frame
 * and the stand-in art), `extract` (cutting a layer out of a picture), `checks` (D01 §10), `sheet`,
 * `manifest` (names and the file). This file only reads the command line.
 */
import { resolve } from 'node:path'
import { anyFailed, formatChecks, runChecks } from './avatar-pipeline/checks.mjs'
import { ingest } from './avatar-pipeline/extract.mjs'
import { buildSheet } from './avatar-pipeline/sheet.mjs'
import {
  MANIFEST_NAME,
  PUBLIC_DIR,
  SERVER_MANIFEST,
  SHEET_FILE,
  STAGE_ONE_ITEMS,
  buildPlaceholders,
  readManifest,
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

/** `base:f01`, `expr:f01:happy`, `item:head:tophat01`. */
function parseTarget(spec) {
  if (!spec) die('ingest needs --as base:f01 | expr:f01:happy | item:head:tophat01')
  const [kind, first, second] = spec.split(':')
  if (kind === 'base' && first) return { kind: 'base', base: first }
  if (kind === 'expr' && first && second) return { kind: 'expr', base: first, expr: second }
  if (kind === 'item' && first && second) {
    if (!STAGE_ONE_ITEMS[first]) die(`unknown slot ${first} — one of ${Object.keys(STAGE_ONE_ITEMS).join(', ')}`)
    return { kind: 'item', slot: first, code: second }
  }
  return die(`cannot read --as ${spec}`)
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
      tolerance: Number(option('tolerance', '40')),
      white: flag('white'),
      dryRun: flag('dry-run'),
      lockScale: lockScale === null ? null : Number(lockScale),
      hides: { ...(flag('hides-hair-front') ? { hidesHairFront: true } : {}), ...(flag('hides-hair-back') ? { hidesHairBack: true } : {}) },
      log,
    })
    if (flag('dry-run') && !report.ok) process.exitCode = 1
  } else if (command === 'check') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const rows = await runChecks({ dir, manifest, names: positionals(), skip: options('skip') })
    console.log(formatChecks(rows))
    if (anyFailed(rows)) process.exitCode = 1
  } else if (command === 'sheet') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const out = option('out') ? resolve(process.cwd(), option('out')) : SHEET_FILE
    await buildSheet({ dir, manifest, out, log })
  } else {
    die(`unknown command ${command ?? '(none)'} — one of placeholder, ingest, check, sheet`)
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}
