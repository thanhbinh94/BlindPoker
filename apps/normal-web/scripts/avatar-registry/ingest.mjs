/**
 * `ingest` (spec §6): every `ok` or `approved` asset not yet ingested goes into public/avatar/ through the
 * real pipeline (`ingest()` from `avatar-pipeline/extract.mjs`, with the asset's `--as`, `--base`,
 * `--variant` and flags), and is marked `ingested: true`.
 *
 * Around the pipeline it does one thing more: an item's per-wear cut gains its one line in `items.json` —
 * `asset.variants.<wear>` — when it is not there yet (docs/avatar-2d.md §3.1), written into the file's own formatting.
 * (Until the switch-over, D1, it also printed what a new flat base still lacked by hand — `baseGaps`; the bases are
 * retired, and so is that.)
 *
 * An aura, a frame and a bot go through like everything else (2026-09-24, Plan 12): `item:aura:<code>`,
 * `item:frame:<code>`, `bot:<n>` and `bot:<n>:happy` are the pipeline's own targets, passed straight through,
 * and a bot is cut on the transform at the root of its references (`transformSource` in registry.mjs): its body's.
 *
 * Plan 19 (v4): a body (`body:<g>`, on its own stored transform or F01's), a body's face (`face:<g>:<expr>`) and a
 * hairstyle (`hair:<code>`) are the pipeline's targets too, and an item drawn on a body names it with `ingest.base`
 * `f`/`m`. The flags `--hair`, `--anchor head` and `--recolour-to` reach `ingest()` as its `hair`, `anchor` and
 * `recolourTo` (`parseFlags`). The picture itself goes in as drawn: whatever is registered — a hairstyle, an outfit on a
 * v4 body, a bot's happy face — the pipeline registers (Plan 19 final review), so this ingest and a command-line one of
 * the same picture cut the same layers.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ingest } from '../avatar-pipeline/extract.mjs'
import { MANIFEST_NAME, PACKAGE_ROOT, PUBLIC_DIR, SERVER_MANIFEST, SLOT_LAYER, itemFile } from '../avatar-pipeline/manifest.mjs'
import { SRC_DIR, parseFlags, parseSpec, referencePath, refuseSuperseded, requireAsset, transformSource } from './registry.mjs'
import { ownerOf, pipelineInput } from './verify.mjs'

export const ITEMS_FILE = resolve(PACKAGE_ROOT, '../normal-server/data/items.json')

/**
 * `items.json`'s text with `asset.variants.<wear> = layer` added to the item `catalogId`, in place and in
 * the file's own one-item-per-two-lines style. A wear already present is left as it is (same text back).
 */
export function addVariant(text, catalogId, wear, layer) {
  const idAt = text.indexOf(`"id": "${catalogId}"`)
  if (idAt < 0) throw new Error(`no item ${catalogId} in items.json`)
  const nextId = text.indexOf('"id": "', idAt + 1)
  const segment = text.slice(idAt, nextId < 0 ? text.length : nextId)
  const open = '"variants": {'
  const variantsAt = segment.indexOf(open)
  let out
  if (variantsAt >= 0) {
    const inside = segment.slice(variantsAt, segment.indexOf('}', variantsAt))
    if (inside.includes(`"${wear}":`)) return text
    const at = idAt + variantsAt + open.length
    out = `${text.slice(0, at)} "${wear}": "${layer}",${text.slice(at)}`
  } else {
    const file = /"file": "[^"]*"/.exec(segment)
    if (!file) throw new Error(`item ${catalogId} has no asset.file in items.json`)
    const at = idAt + file.index + file[0].length
    out = `${text.slice(0, at)}, "variants": { "${wear}": "${layer}" }${text.slice(at)}`
  }
  const item = JSON.parse(out).find((entry) => entry.id === catalogId)
  if (item?.asset?.variants?.[wear] !== layer) throw new Error(`adding variants.${wear} to ${catalogId} did not take`)
  return out
}

/**
 * Ingest every `ok`/`approved` asset with `ingested !== true` — or only the named ones — into `publicDir`.
 * Returns one `{ id, done, name? }` per asset considered.
 *
 * Every asset it would cut is checked **before anything is cut** (Plan 19 final review, as `verifyAssets` checks): a
 * retired flat base or expression (Plan 19 D1) is refused by `parseSpec`, and a superseded Plan 12 entry (`superseded`)
 * by `refuseSuperseded` — drawn and cut on the retired f01, its picture would overwrite the v4 art. A named asset is
 * checked even when it would then be skipped as already ingested.
 *
 * A picture on its reference's canvas goes to the pipeline as it is: a hairstyle, an outfit on a v4 body and a bot's
 * happy face are registered by the pipeline itself (`registerWide`), as a command-line ingest of the same picture is.
 *
 * @param {any} registry
 * @param {string[]} [ids]
 * @param {{ srcDir?: string, publicDir?: string, targets?: string[], itemsFile?: string, log?: (line: string) => void }} [options]
 */
export async function ingestAssets(registry, ids = [], { srcDir = SRC_DIR, publicDir = PUBLIC_DIR, targets, itemsFile = ITEMS_FILE, log = () => {} } = {}) {
  const manifests = targets ?? (publicDir === PUBLIC_DIR ? [join(PUBLIC_DIR, MANIFEST_NAME), SERVER_MANIFEST] : [join(publicDir, MANIFEST_NAME)])
  const wanted = (asset) => (asset.status === 'ok' || asset.status === 'approved') && asset.ingested !== true
  const candidates = ids.length ? ids.map((id) => requireAsset(registry, id)) : registry.assets.filter(wanted)
  for (const asset of candidates) {
    refuseSuperseded(asset, 'ingest')
    try {
      parseSpec(asset.ingest.as)
    } catch (error) {
      throw new Error(`asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const results = []
  for (const asset of candidates) {
    if (!wanted(asset)) {
      log(`${asset.id}: ${asset.ingested ? 'already ingested' : `is ${asset.status}, not ok or approved`} — skipped`)
      results.push({ id: asset.id, done: false })
      continue
    }
    const target = parseSpec(asset.ingest.as)
    const owner = ownerOf(target, asset.ingest)
    const variant = asset.ingest.variant ?? null
    const flags = parseFlags(asset.ingest.flags)
    const tmp = mkdtempSync(join(tmpdir(), 'avatar-ingest-'))
    let name
    try {
      const input = await pipelineInput({ file: join(srcDir, asset.file), kind: asset.kind, slot: asset.slot, referenceFile: referencePath(asset, registry, srcDir), tmp })
      if (input.aligned) log(`${asset.id}: aligned onto the reference canvas before the cut`)
      ;({ name } = await ingest({
        file: input.file, target, dir: publicDir, targets: manifests, baseId: owner, variant,
        tolerance: flags.tolerance, white: flags.white, lockScale: flags.lockScale ?? null, transformFrom: transformSource(asset, registry), hides: flags.hides, diff: flags.diff,
        hair: flags.hair ?? null, anchor: flags.anchor ?? null, recolourTo: flags.recolourTo ?? null, log,
      }))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    const result = { id: asset.id, done: true, name }
    if (target.kind === 'item' && variant !== null) {
      const layer = itemFile(target.slot, target.code, SLOT_LAYER[target.slot], variant)
      const before = readFileSync(itemsFile, 'utf8')
      const after = addVariant(before, asset.catalog, variant, layer)
      if (after !== before) {
        writeFileSync(itemsFile, after)
        log(`${asset.id}: items.json ${asset.catalog} gains variants.${variant} = ${layer}`)
      }
    }
    asset.ingested = true
    results.push(result)
  }
  return results
}
