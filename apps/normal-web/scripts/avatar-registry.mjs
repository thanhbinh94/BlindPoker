#!/usr/bin/env node
/**
 * The avatar asset registry and its generation loop (Plan 12, spec
 * `docs/superpowers/specs/2026-09-24-avatar-asset-registry-design.md`; procedure in `docs/avatar-2d.md`,
 * "Sổ tài sản và vòng lặp sinh ảnh").
 *
 *   node scripts/avatar-registry.mjs next [--limit n] [--json] [--only <id,…>]
 *       The assets ready to generate, in priority order: id, file, the reference picture's absolute path
 *       (or "none"), the attempt number, and the rendered prompt in a fenced block. `--only` (Plan 19, the
 *       style gate) hands out only those ids — each still only once it is ready — in the same order.
 *
 *   node scripts/avatar-registry.mjs status
 *       How many assets are in each status, and every blocked asset with its reasons.
 *
 *   node scripts/avatar-registry.mjs approve <id…> | --batch
 *       ok → approved, for the named ids or every ok asset. Only the user approves.
 *
 *   node scripts/avatar-registry.mjs reject <id…> [--reason style]
 *       The user's "<id> ng": the last attempt becomes `ng` (by the user) and the asset `rework-<n>`, or
 *       `blocked` after the third.
 *
 *   node scripts/avatar-registry.mjs collect <id> --chat <url> [--downloads <dir>] [--file <png>]
 *       Move the picture just downloaded from ChatGPT into assets/avatar-src/<file> (an older one there is
 *       kept as <name>.prev<k>.png), record the attempt, status → generated.
 *
 *   node scripts/avatar-registry.mjs verify [<id…>] [--keep-tmp]
 *   node scripts/avatar-registry.mjs verify --picture <png> --as <spec> [--reference <png>] [--base <id>] [--variant <f|m>]
 *                                           [--hair <code>] [--anchor head] [--recolour-to <#rrggbb>] [--transform-from <id>]
 *       Score every generated asset (or the named ones) against spec §5 and record ok / ng / blocked. The
 *       second form scores one file without touching the registry: the reference defaults to the owner's
 *       picture (`f01_candidate_1.png` for a base, a body or a bot; `body_<g>.png` for a body's face, a
 *       hairstyle or an item on a body), and `--transform-from` names a bot's or a body's transform source
 *       where the reference's name cannot (a v4 bot: `--transform-from f`). Never writes into public/avatar/.
 *
 *   node scripts/avatar-registry.mjs ingest [<id…>]
 *       Put every ok or approved asset not yet ingested into public/avatar/ with the real pipeline, and
 *       report what a new base still needs by hand.
 *
 * Every command takes `--registry <file>` (default assets/avatar-src/registry.json). The work is in
 * `scripts/avatar-registry/`; this file only reads the command line.
 */
import { dirname, resolve } from 'node:path'
import { GENDERS } from './avatar-pipeline/manifest.mjs'
import { DEFAULT_DOWNLOADS, collect } from './avatar-registry/collect.mjs'
import { ingestAssets } from './avatar-registry/ingest.mjs'
import { approve, describeNext, formatNext, formatStatus, nextAssets, reject } from './avatar-registry/queue.mjs'
import { REGISTRY_FILE, parseSpec, readRegistry, writeRegistry } from './avatar-registry/registry.mjs'
import { kindOfSpec, scorePicture, verifyAssets } from './avatar-registry/verify.mjs'

const argv = process.argv.slice(2)
const command = argv[0]

function die(message) {
  console.error(`[avatar-registry] ${message}`)
  process.exit(1)
}

/** The options that take no value. */
const BOOLEANS = new Set(['json', 'batch', 'keep-tmp', 'hides-hair-front', 'hides-hair-back', 'white'])

function option(name, fallback = null) {
  const at = argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) die(`--${name} needs a value`)
  return value
}

const flag = (name) => argv.includes(`--${name}`)

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

/** One scored picture: the verdict line, then every number and note. */
function formatScore(label, { verdict, reason, measure, notes }) {
  const lines = [`${label}: ${verdict}${reason ? ` (${reason})` : ''}`]
  for (const [key, value] of Object.entries(measure)) lines.push(`  ${key.padEnd(13)} ${typeof value === 'object' && value !== null ? JSON.stringify(value) : value}`)
  for (const note of notes) lines.push(`  note          ${note}`)
  return lines.join('\n')
}

const registryFile = option('registry') ? resolve(process.cwd(), option('registry')) : REGISTRY_FILE
const srcDir = dirname(registryFile)

try {
  const registry = readRegistry(registryFile)
  if (command === 'next') {
    const paused = registry.meta.pausedUntil
    if (paused && Date.parse(paused) > Date.now()) {
      console.log(`paused until ${paused} (meta.pausedUntil) — nothing is handed out before then`)
    } else {
      const limit = option('limit') === null ? Infinity : Number(option('limit'))
      if (Number.isNaN(limit) || limit < 1) die('--limit needs a positive number')
      const only = option('only') === null ? null : option('only').split(',').map((id) => id.trim()).filter(Boolean)
      if (only !== null && only.length === 0) die('--only needs asset ids, comma-separated')
      const assets = nextAssets(registry, { limit, srcDir, only })
      console.log(flag('json') ? JSON.stringify(assets.map((asset) => describeNext(asset, registry, srcDir)), null, 2) : formatNext(assets, registry, srcDir))
    }
  } else if (command === 'status') {
    console.log(formatStatus(registry))
  } else if (command === 'approve') {
    const ids = positionals()
    if (!flag('batch') && ids.length === 0) die('approve needs ids or --batch')
    const changed = approve(registry, flag('batch') ? 'batch' : ids)
    writeRegistry(registryFile, registry)
    console.log(changed.length ? `approved ${changed.join(', ')}` : 'nothing was ok')
  } else if (command === 'reject') {
    const ids = positionals()
    if (ids.length === 0) die('reject needs ids')
    const changed = reject(registry, ids, { reason: option('reason', 'style') })
    writeRegistry(registryFile, registry)
    for (const id of changed) console.log(`${id} → ${registry.assets.find((asset) => asset.id === id).status}`)
  } else if (command === 'collect') {
    const [id] = positionals()
    if (!id) die('collect needs an asset id')
    const chat = option('chat')
    if (!chat) die('collect needs --chat <url> — the conversation the picture came from')
    const file = option('file')
    const result = collect(registry, id, {
      chat,
      downloads: option('downloads') ? resolve(process.cwd(), option('downloads')) : DEFAULT_DOWNLOADS,
      file: file ? resolve(process.cwd(), file) : null,
      srcDir,
    })
    writeRegistry(registryFile, registry)
    if (result.kept) console.log(`kept the previous picture as ${result.kept}`)
    console.log(`${id}: ${result.from} → ${result.to} (attempt ${result.attempt.n}, generated)`)
  } else if (command === 'verify') {
    const log = (line) => console.log(line)
    if (option('picture')) {
      // Dry mode: score one file against a spec, without the registry.
      const spec = option('as')
      if (!spec) die('verify --picture needs --as <spec>')
      const { kind, slot } = kindOfSpec(spec)
      const target = parseSpec(spec)
      // The owner whose picture is the default reference: an expression's base; a body face's or a hairstyle's body
      // (Plan 19); an item's --base; otherwise f01.
      const base = option('base') ?? (target.kind === 'expr' ? target.base : target.kind === 'bodyFace' || target.kind === 'hair' ? target.gender : 'f01')
      const ownPicture = GENDERS.includes(base) ? `body_${base}.png` : `${base}_candidate_1.png`
      const reference = option('reference') ?? (kind === 'aura' || kind === 'frame' ? null : kind === 'base' || kind === 'body' ? 'f01_candidate_1.png' : ownPicture)
      const words = ['hair', 'anchor', 'recolour-to'].flatMap((name) => (option(name) === null ? [] : [`--${name}`, option(name)]))
      const flags = [...(flag('hides-hair-front') ? ['--hides-hair-front'] : []), ...(flag('hides-hair-back') ? ['--hides-hair-back'] : []), ...(flag('white') ? ['--white'] : []), ...words]
      const result = await scorePicture({
        file: resolve(process.cwd(), option('picture')),
        kind,
        slot,
        referenceFile: reference === null ? null : resolve(srcDir, reference),
        ingest: { as: spec, base: option('base'), variant: option('variant'), flags },
        ...(option('transform-from') === null ? {} : { transformFrom: option('transform-from') }),
        keepTmp: flag('keep-tmp'),
        log,
      })
      console.log(formatScore(option('picture'), result))
      if (result.verdict !== 'ok') process.exitCode = 1
    } else {
      const results = await verifyAssets(registry, positionals(), { srcDir, keepTmp: flag('keep-tmp'), log })
      writeRegistry(registryFile, registry)
      if (results.length === 0) console.log('nothing is generated')
      for (const result of results) console.log(formatScore(result.id, result))
    }
  } else if (command === 'ingest') {
    const results = await ingestAssets(registry, positionals(), { srcDir, log: (line) => console.log(line) })
    writeRegistry(registryFile, registry)
    const done = results.filter((result) => result.done)
    console.log(done.length ? `ingested ${done.map((result) => result.id).join(', ')}` : 'nothing to ingest')
  } else {
    die(`unknown command ${command ?? '(none)'} — one of next, status, approve, reject, collect, verify, ingest`)
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}
