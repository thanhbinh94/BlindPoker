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
 *       already real is kept. `bot:<n>:happy` cuts only that face from its own picture.
 *
 *   node scripts/avatar-pipeline.mjs ingest <png> --as body:f | face:f:happy | hair:f_bob01      (Plan 19, v4)
 *       A v4 body (`body:<g>`) is cut like a bot, on f01's stored transform (or `--transform-from`'s, or the body's
 *       own when it is ingested again): body_<g>_L30 and body_<g>_face_neutral_L50, masked (skin; eyes on the face),
 *       and `bodies.<g>.transform` stored. `--dry-run` adds C12 for a cut into a temporary copy. `face:<g>:<expr>`
 *       cuts one of the body's faces on its transform. `hair:<code>` cuts a hairstyle drawn on its gender's bald
 *       body: the difference against the registered body, less the face the picture redrew (the hair face rule),
 *       split into item_hair_<code>_L60 (front, with `split`) and _L20 (back, `empty` when blank), both masked; a
 *       hand-drawn assets/avatar-src/masks/item_hair_<code>_frontmask.png splits it instead of the rule. An item
 *       cut with `--base f|m` is diffed against that body, and every item and bot layer records `cutOn`.
 *       Options, for every target:
 *         --dry-run             measure the picture against D02 §8 and print a verdict; write nothing
 *         --base <id>           which base an item or expression belongs to (default f01), or the body
 *                               (f or m) an item is cut on
 *         --variant <f|m>       cut this picture as the per-wear variant of an item that already exists,
 *                               `item_<slot>_<code>_<wear>_L<n>` — e.g. a male dealer01:
 *                                 --as item:outfit:dealer01 --base m01 --variant m
 *                               The wear must be the wear of `--base`, or the cut is refused; a body's is its
 *                               gender, so `--variant m` goes with `--base m`.
 *         --hair <code>         an item on a body: the hairstyle its picture was drawn over, so it is diffed
 *                               against the body wearing it (its L20 under, its L60 over) — a hat or glasses
 *         --anchor head         a body: place it by its eyes instead of f01's transform, onto HEAD_REFERENCE —
 *                               only on the user's word, when C12 fails on position or scale alone
 *         --recolour-to <hex>   a hairstyle: recolour both layers' hair to #rrggbb at each layer's own meanL and
 *                               record `recolouredTo` — only when `colours` shows it > 15 ΔE from its natural colour
 *         --tolerance <n>       how wide the background key is (default 40)
 *         --white               the background is white rather than #00FF00; no despill
 *         --lock-scale <n>      force a scale instead of reading the base's stored one
 *         --transform-from <id> a new base drawn from base <id> (same body, same canvas) takes <id>'s transform;
 *                               a bot takes f01's unless this names another base, or a body (f or m) — a bot
 *                               redrawn on a v4 body; a body takes f01's unless this names another
 *         --hides-hair-front    record D01 §4.3's hide rules on a head item
 *         --hides-hair-back
 *         --color-tol <n>       an item: how far (RGB distance) a pixel must be from every base pixel near it
 *                               to count as the item (default: DIFF_DEFAULTS in extract.mjs)
 *         --min-region <n>      an item: the smallest connected region kept, in @1x pixels
 *         --max-hole <n>        an item: the largest enclosed hole filled, in @1x pixels
 *         --tint-seed <x,y>     a tintable item: the point (1x frame coords) `masks`/tint-sheet later cuts
 *                               its colour region from; stored on the item's manifest entry. Without it, an
 *                               item ingested again keeps the seed its entry already had
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
 *   node scripts/avatar-pipeline.mjs sheet [--dir <layers>] [--hairs a,b] [--outfits a,b] [--out <png>] [--fit-out <png>]
 *       Compose docs/avatar-2d-sheet.png — the style gate of spec §9, rebuilt for v4 (Plan 19 §5.6): the v4 grid
 *       (each gender's hairstyles × casual01 and dealer01, the gender's cut where it exists × porcelain, natural
 *       and deep skin, the outer two read from items.json and drawn natural, with a caption saying so, while an
 *       item is missing), every outfit on both genders, every aura and frame, the six expressions per gender, the
 *       eight bots and the portrait at three sizes. `--hairs` and `--outfits` (comma lists of codes, with or
 *       without the `hair_`/`outfit_` prefix) narrow the v4 grid and nothing else. Also writes the fit sheet,
 *       docs/avatar-2d-fit-sheet.png (or `--fit-out`): every hat and every face item × the eight hairstyles, cut
 *       to the portrait, with the hide rules applied to the hair layers.
 *
 *   node scripts/avatar-pipeline.mjs hides <layer> --front on|off [--back on|off] [--out <dir>]
 *       Set a worn item's hide rules — a hat's, in practice (D01 §4.3: `hidesHairFront` drops a hairstyle's L60, `hidesHairBack` its
 *       L20) on that layer's entry in both manifests, or only in <dir>/avatar-manifest.json with `--out`. Either
 *       flag may be given alone. Prints every items.json id drawn with that layer, colour variants included,
 *       because the server refuses an item whose flags disagree with the manifest's (bug 7):
 *         remember items.json: head_beanie01, head_beanie_red01, … — same flags (bug 7)
 *
 *   node scripts/avatar-pipeline.mjs tint-sheet [--dir <layers>] [--out <png>]
 *       Compose docs/avatar-2d-tint-sheet.png (Plan 13 spec §4.2): every masked base in three hair × three
 *       eye colours, plus one card per `items.json` entry with `asset.tint` set — the eyeballed check for
 *       recolouring before C11 or the client ever draws one.
 *
 * `placeholder`, `ingest`, `masks` and `hides` take `--out <dir>`; `check`, `colours`, `sheet` and `tint-sheet` read `--dir <dir>`. Pointing
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
  FIT_SHEET_FILE,
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
  itemsOnLayer,
  parseName,
  readManifest,
  withHides,
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

/**
 * `base:f01`, `expr:f01:happy`, `item:head:tophat01`, `item:aura:fire01`, `item:frame:gold`, `bot:3`, `bot:3:happy` —
 * and (Plan 19) `body:f`, `face:f:happy`, `hair:f_bob01`.
 */
function parseTarget(spec) {
  if (!spec) die('ingest needs --as body:f | face:f:happy | hair:f_bob01 | item:head:tophat01 | bot:3 | bot:3:happy | base:f01 | expr:f01:happy')
  const [kind, first, second] = spec.split(':')
  if (kind === 'base' && first) return { kind: 'base', base: first }
  if (kind === 'expr' && first && second) return { kind: 'expr', base: first, expr: second }
  if (kind === 'body' && first && second === undefined) return { kind: 'body', gender: first }
  if (kind === 'face' && first && second) return { kind: 'bodyFace', gender: first, expr: second }
  if (kind === 'hair' && first && second === undefined) return { kind: 'hair', code: first }
  if (kind === 'item' && first && second) {
    if (!STAGE_ONE_ITEMS[first]) die(`unknown slot ${first} — one of ${Object.keys(STAGE_ONE_ITEMS).join(', ')}`)
    return { kind: 'item', slot: first, code: second }
  }
  if (kind === 'bot' && /^\d+$/.test(first ?? '')) return { kind: 'bot', bot: Number(first), expr: second ?? 'neutral' }
  return die(`cannot read --as ${spec}`)
}

/** `--name a,b,c` as a list, or `null` when the option is absent. */
function listOption(name) {
  const value = option(name)
  return value === null ? null : value.split(',').map((part) => part.trim()).filter(Boolean)
}

/** `--name on|off` as `true`/`false`, or `null` when the option is absent. */
function onOffOption(name) {
  const value = option(name)
  if (value === null) return null
  if (value !== 'on' && value !== 'off') die(`--${name} takes on or off, got ${value}`)
  return value === 'on'
}

/** items.json, or nothing when it is not there (a test's own directory). */
const readItems = () => (existsSync(ITEMS_FILE) ? JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) : [])

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
    const { report, head } = await ingest({
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
      hair: option('hair'),
      anchor: option('anchor'),
      recolourTo: option('recolour-to'),
      log,
    })
    // A body's dry run also says whether C12 would pass (Plan 19).
    if (flag('dry-run') && (!report.ok || head?.ok === false)) process.exitCode = 1
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
    for (const line of await describeColours({ dir, manifest, names, items: readItems(), log })) console.log(line)
  } else if (command === 'sheet') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const out = option('out') ? resolve(process.cwd(), option('out')) : SHEET_FILE
    const fitOut = option('fit-out') ? resolve(process.cwd(), option('fit-out')) : FIT_SHEET_FILE
    await buildSheet({ dir, manifest, items: readItems(), hairs: listOption('hairs'), outfits: listOption('outfits'), out, fitOut, log })
  } else if (command === 'hides') {
    const [layer] = positionals()
    if (!layer) die('hides needs a layer, e.g. hides item_head_beanie01_L80 --front off')
    const front = onOffOption('front')
    const back = onOffOption('back')
    if (front === null && back === null) die('hides needs --front on|off, --back on|off, or both')
    const { dir, targets } = destinations('out')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const entry = manifest.files[layer]
    if (!entry) die(`no layer ${layer} in ${resolve(dir, MANIFEST_NAME)}`)
    if (parseName(layer)?.kind !== 'item') die(`${layer} is not an item layer: only a worn item hides hair`)
    manifest.files[layer] = withHides(entry, { front, back })
    const written = await writeManifest(manifest, targets)
    const now = manifest.files[layer]
    const state = (on) => (on ? 'on' : 'off')
    log(`${layer}: hidesHairFront ${state(now.hidesHairFront)}, hidesHairBack ${state(now.hidesHairBack)} — ${written.length ? `written to ${written.length} of ${targets.length} manifest${targets.length === 1 ? '' : 's'}` : 'no change'}`)
    const ids = itemsOnLayer(readItems(), layer)
    log(ids.length ? `remember items.json: ${ids.join(', ')} — same flags (bug 7)` : `no items.json entry is drawn with ${layer}`)
  } else if (command === 'tint-sheet') {
    const { dir } = destinations('dir')
    const manifest = readManifest(resolve(dir, MANIFEST_NAME))
    const out = option('out') ? resolve(process.cwd(), option('out')) : TINT_SHEET_FILE
    await buildTintSheet({ dir, manifest, items: readItems(), out, log })
  } else {
    die(`unknown command ${command ?? '(none)'} — one of placeholder, ingest, check, colours, sheet, hides, masks, tint-sheet`)
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}
