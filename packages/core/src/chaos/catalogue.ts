import {
  CHAOS_DEBUFF_EFFECTS, CHAOS_EFFECT_KINDS, CHAOS_MODES, CHAOS_TIERS, CHAOS_TIMINGS,
  type ChaosCardDef, type ChaosEffectKind, type ChaosMode, type ChaosTier, type ChaosTiming,
} from './types.js'

/** Spec §6.2: every tier keeps at least this many enabled cards for each kind of table. */
export const MIN_CARDS_PER_TIER = 3

const fail = (why: string): never => {
  throw new Error(`invalid chaos catalogue: ${why}`)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function oneOf<T extends string>(where: string, field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(`${where} has an unknown ${field} ${JSON.stringify(value)}`)
  return value as T
}

function parseCard(raw: unknown, index: number): ChaosCardDef {
  if (!isRecord(raw)) return fail(`card #${index} is not an object`)
  const where = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `card #${index}`
  if (typeof raw.id !== 'string' || raw.id === '') fail(`${where} needs a non-empty id`)
  if (typeof raw.family !== 'string' || raw.family === '') fail(`${where} needs a family`)
  const tier = oneOf<ChaosTier>(where, 'tier', raw.tier, CHAOS_TIERS)
  const effect = oneOf<ChaosEffectKind>(where, 'effect', raw.effect, CHAOS_EFFECT_KINDS)
  const timing = oneOf<ChaosTiming>(where, 'timing', raw.timing, CHAOS_TIMINGS)

  if (!isRecord(raw.params)) return fail(`${where} needs params as an object`)
  const params: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw.params)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${where} params.${key} must be an integer`)
    params[key] = value as number
  }

  if (!Array.isArray(raw.modes) || raw.modes.length === 0) return fail(`${where} needs at least one of the modes`)
  const modes = raw.modes.map((m) => oneOf<ChaosMode>(where, 'modes', m, CHAOS_MODES))
  if (new Set(modes).size !== modes.length) fail(`${where} repeats one of its modes`)

  if (typeof raw.debuff !== 'boolean') fail(`${where} needs debuff as a boolean`)
  if (raw.debuff !== CHAOS_DEBUFF_EFFECTS.has(effect)) fail(`${where} debuff must be ${CHAOS_DEBUFF_EFFECTS.has(effect)} for ${effect}`)
  if (typeof raw.enabled !== 'boolean') fail(`${where} needs enabled as a boolean`)

  return { id: raw.id as string, tier, family: raw.family as string, effect, params, timing, modes, debuff: raw.debuff as boolean, enabled: raw.enabled as boolean }
}

/**
 * Reads a catalogue (spec §6.1: an array of `{ id, tier, family, effect, params, timing, modes, debuff, enabled }`) and
 * throws `invalid chaos catalogue: <why>` on anything the engine could not run.
 */
export function parseChaosCatalogue(raw: unknown): ChaosCardDef[] {
  if (!Array.isArray(raw)) return fail('expected an array of cards')
  const cards = raw.map(parseCard)
  const seen = new Set<string>()
  for (const c of cards) {
    if (seen.has(c.id)) fail(`duplicate id ${c.id}`)
    seen.add(c.id)
  }
  for (const tier of CHAOS_TIERS) {
    for (const mode of CHAOS_MODES) {
      const n = cards.filter((c) => c.enabled && c.tier === tier && c.modes.includes(mode)).length
      if (n < MIN_CARDS_PER_TIER) fail(`${tier} has ${n} enabled cards for mode ${mode}, needs ${MIN_CARDS_PER_TIER}`)
    }
  }
  return cards
}
