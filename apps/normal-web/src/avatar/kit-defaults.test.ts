import { DEFAULT_HAIR, DEFAULT_OUTFIT_FILE, hairRefOf } from '@bp/ui-kit'
import { describe, expect, it } from 'vitest'
// The catalogue the server actually loads, read straight from its data directory — the way `locales.test.ts` reads
// it, and for the same reason: data rather than code, in a test, so it never reaches the bundle.
import itemDefs from '../../../normal-server/data/items.json'
import type { ItemDto } from '../api.js'

/**
 * R14 (Plan 19): the kit draws a default chibi — Lite's every player, a Normal seat before its avatar has loaded —
 * from three names it cannot look up (`DEFAULT_HAIR`, `hairRefOf`'s naming rule, `DEFAULT_OUTFIT_FILE`), because the
 * kit has no catalogue. This holds those names to the catalogue the server serves, so a hairstyle renamed or a male
 * cut of the starter tee added there fails here instead of drawing a hole.
 */

// The JSON's rows are a union TypeScript cannot index by `back`/`variants`: read them as the DTO the API serves.
const defs = itemDefs as unknown as ItemDto[]

describe('the kit’s defaults', () => {
  it('the kit’s default hairs and default outfit files are what the catalogue says', () => {
    for (const g of ['f', 'm'] as const) {
      const hair = defs.find((i) => i.id === DEFAULT_HAIR[g])
      expect(hair, g).toMatchObject({ slot: 'hairStyle', gender: g })
      expect(hairRefOf(DEFAULT_HAIR[g])).toMatchObject({ back: hair!.asset!.back, front: hair!.asset!.file })
      const casual = defs.find((i) => i.id === 'outfit_casual01')!
      expect(DEFAULT_OUTFIT_FILE[g]).toBe(casual.asset!.variants?.[g] ?? casual.asset!.file)
    }
  })
})
