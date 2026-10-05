/**
 * The "Tự nhiên" swatch on Màu da (Plan 19 final review): `NATURAL_SKIN` is the body's own skin, measured on the committed
 * art — not a colour anyone picked. The bodies' layer names come from the server's `avatar-bodies.json`, and the skin from
 * the committed layer under its own skin mask, as `avatar-pipeline.mjs colours body_f_L30` prints it (`describeColours`).
 * A redrawn body fails here until the constant follows it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MANIFEST_NAME, PUBLIC_DIR, readManifest } from '../scripts/avatar-pipeline/manifest.mjs'
import { describeColours } from '../scripts/avatar-pipeline/masks.mjs'
import { NATURAL_SKIN } from '../src/screens/wardrobe/natural-skin.js'

const BODIES_FILE = fileURLToPath(new URL('../../normal-server/data/avatar-bodies.json', import.meta.url))

describe('NATURAL_SKIN', () => {
  it('is body f’s skin as the committed art measures it, and body m’s is the near-identical one the comment names', async () => {
    const bodies = JSON.parse(readFileSync(BODIES_FILE, 'utf8')) as Record<'f' | 'm', { body: string }>
    expect([bodies.f.body, bodies.m.body]).toEqual(['body_f_L30', 'body_m_L30'])
    const manifest = readManifest(join(PUBLIC_DIR, MANIFEST_NAME))
    const lines = await describeColours({ dir: PUBLIC_DIR, manifest, names: [bodies.f.body, bodies.m.body] })
    // The skin lines only: each body also prints its line art's colour (`skinLine`, 2026-10-05), not a swatch.
    expect(lines.filter((line) => line.split(' ')[1] === 'skin')).toEqual([`body_f_L30 skin ${NATURAL_SKIN}`, 'body_m_L30 skin #fbe0c7'])
    expect(NATURAL_SKIN).toBe('#fbe0ca')
  }, 60_000)
})
