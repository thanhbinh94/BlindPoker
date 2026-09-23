#!/usr/bin/env node
/**
 * The avatar asset registry and its generation loop (Plan 12, spec
 * `docs/superpowers/specs/2026-09-24-avatar-asset-registry-design.md`; procedure in `docs/avatar-2d.md`,
 * "Sổ tài sản và vòng lặp sinh ảnh").
 *
 *   node scripts/avatar-registry.mjs next [--limit n] [--json]
 *       The assets ready to generate, in priority order: id, file, the reference picture's absolute path
 *       (or "none"), the attempt number, and the rendered prompt in a fenced block.
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
 *       Score every generated asset (or the named ones) against spec §5 and record ok / ng / blocked. The
 *       second form scores one file without touching the registry. Never writes into public/avatar/.
 *
 *   node scripts/avatar-registry.mjs ingest [<id…>]
 *       Put every ok or approved asset not yet ingested into public/avatar/ with the real pipeline, and
 *       report what a new base still needs by hand.
 *
 * Every command takes `--registry <file>` (default assets/avatar-src/registry.json). The work is in
 * `scripts/avatar-registry/`; this file only reads the command line.
 */
import { dirname, resolve } from 'node:path'
import { approve, describeNext, formatNext, formatStatus, nextAssets, reject } from './avatar-registry/queue.mjs'
import { REGISTRY_FILE, readRegistry, writeRegistry } from './avatar-registry/registry.mjs'

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
      const assets = nextAssets(registry, { limit, srcDir })
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
  } else {
    die(`unknown command ${command ?? '(none)'} — one of next, status, approve, reject, collect, verify, ingest`)
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}
