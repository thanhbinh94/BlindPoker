/**
 * The two closed colour palettes, read from `data/palettes.json` (avatar-3d design §3.1, §6).
 *
 * They are data rather than a pair of literals in `avatar.ts` for one reason: the **client** has to
 * paint the same eight swatches the server will accept, and a second copy of the hexes in
 * `normal-web` is a copy that drifts — silently, because a tone the wardrobe offers and the server
 * refuses is an `INVALID_COLOR` on save and nothing at all before it. `normal-web` may not import
 * this server's *code*, but its tests already read this package's `data/` directory (that is how the
 * item names are held to the catalogue), so a JSON file here is a shape both sides can be measured
 * against. `apps/normal-web/src/avatar3d/palettes.test.ts` is the other half.
 *
 * Loaded the same way `items.json` is — `readFileSync` off `packageRoot()` at start-up, refused
 * loudly rather than degraded. A palette that failed to load cannot be defaulted: every stored
 * configuration names a colour out of it, so an empty palette would make every avatar on the server
 * invalid at once, which is a far worse morning than a container that will not boot.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'

export interface Palettes {
  /** Eight tones, light to deep. */
  skin: readonly string[]
  /** Six eye colours: dark brown, brown, amber, green, blue, grey. */
  eyes: readonly string[]
}

/** How many entries each palette must have. The wardrobe's layout is built for exactly these counts. */
export const SKIN_TONE_COUNT = 8
export const EYE_COLOR_COUNT = 6

const HEX = /^#[0-9a-f]{6}$/

/** Where the palettes live, resolved from the package root so the working directory is irrelevant. */
export function palettesPath(): string {
  return join(packageRoot(), 'data', 'palettes.json')
}

function readPalette(raw: unknown, name: string, expected: number): string[] {
  if (!Array.isArray(raw)) throw new Error(`palettes.json: "${name}" must be an array of ${expected} colours`)
  if (raw.length !== expected) throw new Error(`palettes.json: "${name}" has ${raw.length} colours, expected ${expected}`)
  const seen = new Set<string>()
  return raw.map((entry, at) => {
    // Lower case and nothing else: `paletteEntry` folds an incoming value and compares it against
    // these, so a capital letter here would make a stored `#C8323C` unmatchable by its own palette.
    if (typeof entry !== 'string' || !HEX.test(entry)) {
      throw new Error(`palettes.json: "${name}"[${at}] is ${JSON.stringify(entry)}, expected a lower-case #rrggbb`)
    }
    if (seen.has(entry)) throw new Error(`palettes.json: "${name}" lists ${entry} twice`)
    seen.add(entry)
    return entry
  })
}

/** Checks a parsed `palettes.json` and returns the two palettes, or throws saying what is wrong. */
export function parsePalettes(input: unknown): Palettes {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('palettes.json: expected an object')
  const raw = input as Record<string, unknown>
  return {
    skin: readPalette(raw['skin'], 'skin', SKIN_TONE_COUNT),
    eyes: readPalette(raw['eyes'], 'eyes', EYE_COLOR_COUNT),
  }
}

function load(): Palettes {
  const path = palettesPath()
  try {
    return parsePalettes(JSON.parse(readFileSync(path, 'utf8')))
  } catch (cause) {
    throw new Error(`could not load ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Read once, at import. Nothing writes a palette at run time; a change is a JSON edit and a restart. */
export const PALETTES: Palettes = load()
