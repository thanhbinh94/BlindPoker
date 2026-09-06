/**
 * The catalogue against the assets that were actually built.
 *
 * `data/items.json` names a node per body (`<slot>/<itemId>/<body>`) and the asset pipeline
 * (`normal-web/scripts/avatar-assets.mjs`, Plan 8 task 1) writes a manifest of every node it
 * emitted. Nothing at run time compares the two: the server never reads the manifest — it is a
 * client asset, and the container that runs this server does not necessarily ship it — so a
 * mismatch would first appear as an invisible item on somebody's profile. This is where it appears
 * instead.
 *
 * The manifest is a *build output*, so it may legitimately be absent — a fresh clone, a CI job that
 * did not run the asset build. Missing means skipped with a warning rather than red: a suite that
 * failed on it would fail for everyone who has not downloaded the source meshes, and the catalogue
 * would still be checked against its own conventions by `src/inventory/items.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { packageRoot } from '../src/db/migrate.js'
import { loadItemCatalog } from '../src/inventory/items.js'
import { BODIES } from '../src/inventory/slots.js'

const MANIFEST = join(packageRoot(), '..', 'normal-web', 'public', 'avatar3d', 'manifest.json')

interface Manifest {
  files?: Record<string, { bytes?: number; hash?: string }>
  nodes?: Record<string, { file?: string; bytes?: number }>
}

const present = existsSync(MANIFEST)
if (!present) {
  console.warn(`skipping the catalogue/manifest check: ${MANIFEST} has not been built`)
}
// Read out here, not inside the suite: `describe.skipIf` still evaluates its callback to collect
// the tests it is about to skip, so a `readFileSync` in there would throw before the skip applied.
const manifest: Manifest = present ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : {}

describe.skipIf(!present)('the catalogue against the built avatar manifest', () => {
  const catalog = loadItemCatalog()
  const nodes = manifest.nodes ?? {}
  const files = manifest.files ?? {}

  it('names, for every item variant, a node the asset build emitted', () => {
    const missing: string[] = []
    for (const def of catalog.all()) {
      for (const body of BODIES) {
        const ref = def.variants?.[body]
        if (ref === undefined) continue
        if (nodes[ref.node] === undefined) missing.push(`${def.id}: ${ref.node}`)
      }
    }
    // Listed rather than asserted one at a time: after an asset rebuild the interesting answer is
    // *which* items lost their geometry, not the first one alphabetically.
    expect(missing).toEqual([])
  })

  it('puts every variant in the file the manifest says holds it', () => {
    for (const def of catalog.all()) {
      for (const body of BODIES) {
        const ref = def.variants?.[body]
        if (ref === undefined) continue
        const node = nodes[ref.node]
        if (node?.file === undefined) continue
        expect(ref.file, `${def.id}/${body}`).toBe(node.file)
        expect(Object.keys(files), ref.file).toContain(ref.file)
      }
    }
  })
})
