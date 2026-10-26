/**
 * The chaos cards (Poker hỗn loạn, spec 2026-10-26 §6.1) as data: `data/chaos-cards.json`, read once at boot and checked by
 * `@bp/core`'s `parseChaosCatalogue`. A bad file stops the boot with the file and the problem in the message — the same
 * contract as the item and gift catalogues. The GM's per-card rules (on/off, weight, a date window) live in the database
 * and are read by `chaos-service.ts`; the file is what a card does and whether it is on by default.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChaosCatalogue, type ChaosCardDef } from '@bp/core'
import { packageRoot } from '../db/migrate.js'

export function defaultChaosCardsPath(): string {
  return join(packageRoot(), 'data', 'chaos-cards.json')
}

/** Reads and checks the catalogue. Throws, naming the file, when it cannot be read or `parseChaosCatalogue` refuses it. */
export function loadChaosCatalogue(path: string = defaultChaosCardsPath()): ChaosCardDef[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read chaos catalogue ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    return parseChaosCatalogue(parsed)
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
