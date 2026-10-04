/**
 * Reading an `avatar_config` that was written by an older version of this server (design §5.2, spec §4.5).
 *
 * Three shapes came before v4, and none of them is rewritten in the database: a jsonb `UPDATE` over every row
 * has to be right the first time, on data nobody can look at afterwards, so the stored value is left alone
 * and repaired on the way out. A player's config is only ever replaced by the player pressing Save.
 *
 * - **v1/v2 → v3** (Plan 11): `body` becomes a base, `hair`/`top`/`bottom`/`shoes`/`clothing` collapse into
 *   one required `outfit`, and `hat`/`accessory`/`jewelry` become `head`/`face`/`aura` — sometimes several old
 *   slots folding into one new one, since an `accessory` used to mean either a face piece or a hat.
 * - **v3 → v4** (Plan 19): the base splits into a gender, a hairstyle and a skin colour (`V3_BASES`, table
 *   4.5), and the eyes are corrected where the new body's differ from the old base's (the eye rule, below).
 *
 * So anything that is not a valid v4 is first repaired as a v3 (`repairV3`) — a v1/v2 lands there the way it
 * always did — and then moved to v4 (`v3ToV4`); a stored v4 that has gone stale is repaired as itself
 * (`repairV4`). Every candidate field is resolved the same way whichever shape it came from: `resolveItemId`
 * turns an old id into its current one (or leaves an id nobody renamed alone), and the *catalogue's own
 * slot* for the resolved id decides whether it may land in a slot — which is what lets one `accessory` value
 * become a `head` for `hat_crown` and a `face` for `accessory_glasses` without a second list here to keep in
 * step with `items.json`. What still means something is kept; everything else falls back to the default.
 *
 * Two things are new in the v3 repair compared with the one Plans 11–18 ran: the old `hairColor` and
 * `eyeColor` are kept (spec §4.5 — the repair used to drop them), and the base is read against `V3_BASES`
 * rather than the base registry, since what an old base *was* is now fixed history rather than data that can
 * change.
 *
 * Writes never come through here. `PUT /api/me/avatar` refuses anything but a valid config, so the only way
 * a repaired one becomes the stored one is the player saving it themselves. The same reader repairs a saved
 * outfit (`avatar_outfits.config`) when it is listed or applied (`outfits-service.ts`, R6).
 */
import { resolveItemId } from './aliases.js'
import type { AvatarConfigV4 } from './avatar.js'
import { AVATAR_CONFIG_VERSION, defaultAvatar, validateAvatarConfig } from './avatar.js'
import type { Bodies } from './bodies.js'
import { deltaE } from './colour.js'
import type { ItemCatalog } from './items.js'
import type { Gender, ItemSlot } from './slots.js'
import { DEFAULT_GENDER, DEFAULT_HAIR, HAIR_SLOT, isGender } from './slots.js'

/**
 * The configuration Plans 11–18 stored: a fixed base plus items. Read here as history — the wire refuses it
 * since Plan 19, so it is never written again.
 */
export interface AvatarConfigV3 {
  v: 3
  /** A `V3_BASES` key once repaired; as stored, any id the old base registry defined. */
  base: string
  outfit: string
  head?: string
  face?: string
  aura?: string
  frame?: string
  hairColor?: string
  eyeColor?: string
  /** An optional slot since Plan 19 (A3); the v4 read takes the skin from the base instead. */
  skinColor?: string
  title?: string
  badge?: string
}

/** What one old base becomes in v4 (table 4.5). */
interface V3Base {
  gender: Gender
  hairStyle: string
  /** Absent for f01, whose skin was the bodies' own "cream" tone. */
  skinColor?: string
  /** The iris colour the base was drawn with, measured from the committed art (ruling 6). */
  naturalEye: string
  /** A pick the controller pinned (ruling 6), used instead of the nearest free eye colour. */
  eyeColor?: string
  /** The bodies are drawn from f01 and m01, so their eyes *are* the bodies' eyes: never tinted (R25). */
  keepEyes?: true
}

/**
 * Table 4.5: every old base, and the gender, hairstyle and skin colour it becomes.
 *
 * Each hairstyle's natural colour is that base's own hair, measured (`items.json`'s `naturalColour`), so a
 * player keeps their look without a hair colour item. `naturalEye` is each base's iris as drawn; whether it is
 * far enough from the new body's own eyes to need correcting is the eye rule's question, not this table's.
 * f03's iris measures nearer amber than green by ΔE76 (39.7 against 40.5), but reads as green on screen, so
 * the controller pinned green (ruling 6, R15).
 */
export const V3_BASES = {
  f01: { gender: 'f', hairStyle: 'hair_f_bob01', naturalEye: '#2e6a9b', keepEyes: true },
  f02: { gender: 'f', hairStyle: 'hair_f_hime01', skinColor: 'skin_porcelain01', naturalEye: '#6b5771' },
  f03: { gender: 'f', hairStyle: 'hair_f_wavy01', skinColor: 'skin_tan01', naturalEye: '#a9a564', eyeColor: 'eyecolor_green01' },
  m01: { gender: 'm', hairStyle: 'hair_m_tousled01', skinColor: 'skin_lighttan01', naturalEye: '#cc924c', keepEyes: true },
  m02: { gender: 'm', hairStyle: 'hair_m_neat01', skinColor: 'skin_fair01', naturalEye: '#998c91' },
  m03: { gender: 'm', hairStyle: 'hair_m_curly01', skinColor: 'skin_deep01', naturalEye: '#ad6f4a' },
} as const satisfies Record<string, { gender: Gender; hairStyle: string; skinColor?: string; naturalEye: string; eyeColor?: string; keepEyes?: true }>

/**
 * How far (ΔE76) an old base's eyes may be from the new body's before the eye rule gives them a colour item.
 * Below it the two read as the same colour, and an account is better left on the body's own eyes than
 * handed an item it never chose.
 */
export const EYE_KEEP_DELTA_E = 12

/** The base a v1 config (which named no body) and an unknown id fall back to: the default figure's. */
const FALLBACK_V3_BASE = 'f01'

/** `V3_BASES[id]`, read through the widest row shape; undefined for anything that is not one of its own keys. */
function v3BaseOf(id: unknown): V3Base | undefined {
  return typeof id === 'string' && Object.hasOwn(V3_BASES, id) ? (V3_BASES as Readonly<Record<string, V3Base>>)[id] : undefined
}

/** `raw[key]`, resolved through the alias map, if it names a catalogue item that belongs in `slot`. */
function candidateFor(raw: unknown, slot: ItemSlot, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const id = resolveItemId(raw, aliases)
  const def = catalog.get(id)
  return def !== undefined && def.slot === slot ? id : undefined
}

/** The first of `candidates` that resolves to a wearable item of `slot`. */
function pick(slot: ItemSlot, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>, ...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const id = candidateFor(candidate, slot, catalog, aliases)
    if (id !== undefined) return id
  }
  return undefined
}

/** The slots both repairs fill the same way: everything but the base, the gender, the hairstyle and the skin. */
type Wardrobe = Pick<AvatarConfigV4, 'outfit' | 'head' | 'face' | 'aura' | 'frame' | 'hairColor' | 'eyeColor' | 'title' | 'badge'>

/**
 * The wardrobe of a stored config, whatever shape it is in.
 *
 * `outfit` tries, in order: the config's own `outfit` (a config invalidated by something else), the v2
 * `top`, and the v1 `clothing` — each resolved through the alias map, so `clothing_suit` lands on
 * `outfit_tuxedo01` and a plain `top_tee` finds nothing and falls through to the default. `head` and `face`
 * both try the v2 `accessory` in addition to their own field and (for `head`) the v2 `hat`, because that one
 * old field used to mean either. A v3 or v4 config carries none of the old fields, so for it each slot is
 * simply its own field, kept if the catalogue still has it in that slot.
 */
function pickWardrobe(raw: Record<string, unknown>, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): Wardrobe {
  const outfit = pick('outfit', catalog, aliases, raw['outfit'], raw['top'], raw['clothing']) ?? defaultAvatar(catalog).outfit
  const wardrobe: Wardrobe = { outfit }

  const head = pick('head', catalog, aliases, raw['head'], raw['hat'], raw['accessory'])
  if (head !== undefined) wardrobe.head = head
  const face = pick('face', catalog, aliases, raw['face'], raw['accessory'])
  if (face !== undefined) wardrobe.face = face
  const aura = pick('aura', catalog, aliases, raw['aura'], raw['jewelry'])
  if (aura !== undefined) wardrobe.aura = aura
  const frame = pick('frame', catalog, aliases, raw['frame'])
  if (frame !== undefined) wardrobe.frame = frame
  // v1/v2 stored these two as free-text hexes, which resolve to no item and are dropped; a v3 or v4 id is kept.
  const hairColor = pick('hairColor', catalog, aliases, raw['hairColor'])
  if (hairColor !== undefined) wardrobe.hairColor = hairColor
  const eyeColor = pick('eyeColor', catalog, aliases, raw['eyeColor'])
  if (eyeColor !== undefined) wardrobe.eyeColor = eyeColor
  const title = pick('title', catalog, aliases, raw['title'])
  if (title !== undefined) wardrobe.title = title
  const badge = pick('badge', catalog, aliases, raw['badge'])
  if (badge !== undefined) wardrobe.badge = badge

  return wardrobe
}

/** The old base a stored config names: a `V3_BASES` key, else v1/v2's `body` (the two bases Plan 11 shipped), else f01. */
function v3BaseIdOf(raw: Record<string, unknown>): string {
  const base = raw['base']
  if (typeof base === 'string' && v3BaseOf(base) !== undefined) return base
  if (raw['body'] === 'female') return 'f01'
  if (raw['body'] === 'male') return 'm01'
  return FALLBACK_V3_BASE
}

/**
 * The closest v3 configuration to whatever is stored — the pre-v4 repair, plus the two colours it used to drop.
 * Every slot it fills names a catalogue item of that slot, so the v4 validator is the only check it needs, and
 * `v3ToV4` runs it.
 */
function repairV3(raw: Record<string, unknown>, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): AvatarConfigV3 {
  return { v: 3, base: v3BaseIdOf(raw), ...pickWardrobe(raw, catalog, aliases) }
}

/** The free eye colour nearest `hex` in Lab (ΔE76), ties to the earlier catalogue row; undefined when there is none. */
export function nearestFreeEyeColour(hex: string, catalog: ItemCatalog): string | undefined {
  let nearest: { id: string; distance: number } | undefined
  for (const def of catalog.all()) {
    if (def.slot !== 'eyeColor' || def.free !== true || def.colour === undefined) continue
    const distance = deltaE(hex, def.colour)
    if (nearest === undefined || distance < nearest.distance) nearest = { id: def.id, distance }
  }
  return nearest?.id
}

/** The wardrobe slots a v3 config hands to v4 unchanged. */
const CARRIED_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge'] as const

/**
 * The eye colour the eye rule hands an old base, or undefined to leave the body's own eyes (spec §4.5, Plan 19 final
 * review). The rule exists to keep a look, not to move it, so the pick — the row's pinned one (f03's green) or else the
 * nearest free eye colour — is handed out only when two things hold: the body's own eyes are more than
 * `EYE_KEEP_DELTA_E` from the old base's (they read as another colour), and the pick is closer (ΔE76) to the old base's
 * eyes than the body's own are. A pick further from the old eyes than the body's would move the look, not keep it: m03's
 * iris (#ad6f4a) is 12.7 from the m body's (#945e26) and 22.9 from brown01, so m03 keeps the body's eyes.
 */
export function eyeRuleColour(row: { naturalEye: string; eyeColor?: string }, bodyEye: string, catalog: ItemCatalog): string | undefined {
  const bodyDistance = deltaE(row.naturalEye, bodyEye)
  if (bodyDistance <= EYE_KEEP_DELTA_E) return undefined
  const pick = row.eyeColor ?? nearestFreeEyeColour(row.naturalEye, catalog)
  const colour = pick === undefined ? undefined : catalog.get(pick)?.colour
  return colour !== undefined && deltaE(row.naturalEye, colour) < bodyDistance ? pick : undefined
}

/**
 * A repaired v3 configuration as v4 (table 4.5).
 *
 * The gender, hairstyle and skin colour come from the old base's row; every wardrobe slot is carried across
 * as it was, the colours included. An id that is not a `V3_BASES` key — unreachable from `repairV3`, which
 * falls back to f01 — becomes the default figure, with no skin and no eye rule.
 *
 * **The eye rule** (spec §4.5). The body's face layers carry their own eyes, so a player whose base had
 * different ones would wake up with someone else's. When the player chose no eye colour, they are given the one
 * `eyeRuleColour` names — the row's pinned pick (f03's green) or the nearest free eye colour, and only when that is
 * nearer the old base's iris than the body's own eyes are — or none. A chosen eye colour always wins, and f01 and m01
 * never get one (`keepEyes`): the bodies are drawn from them, so their eyes are the bodies' own.
 */
function v3ToV4(v3: AvatarConfigV3, catalog: ItemCatalog, bodies: Bodies): AvatarConfigV4 {
  const row = v3BaseOf(v3.base)
  const gender = row?.gender ?? DEFAULT_GENDER
  const config: AvatarConfigV4 = { v: AVATAR_CONFIG_VERSION, gender, hairStyle: row?.hairStyle ?? DEFAULT_HAIR[gender], outfit: v3.outfit }
  if (row?.skinColor !== undefined) config.skinColor = row.skinColor
  for (const slot of CARRIED_SLOTS) {
    const id = v3[slot]
    if (id !== undefined) config[slot] = id
  }

  if (row !== undefined && row.keepEyes !== true && config.eyeColor === undefined) {
    const eyeColor = eyeRuleColour(row, bodies[row.gender].naturalEyeColour, catalog)
    if (eyeColor !== undefined) config.eyeColor = eyeColor
  }

  // The last word belongs to the validator, not to the repair. Nothing above should be able to produce an
  // invalid figure — but this module's whole job is to be the thing that never hands the client something it
  // cannot draw, and one check is cheaper than that promise is to keep.
  const checked = validateAvatarConfig(config, catalog)
  return checked.ok ? checked.value : defaultAvatar(catalog)
}

/**
 * A stored v4 that no longer validates — an item the catalogue has since withdrawn, or a hairstyle that is not
 * drawn for the stored gender — repaired as itself, with no eye rule (a v4 never had a base's eyes).
 *
 * The gender is kept if it is one, else f; the hairstyle is kept if it is drawn for that gender, else that
 * gender's `DEFAULT_HAIR`; every other slot is kept if the catalogue still has it in that slot.
 */
function repairV4(raw: Record<string, unknown>, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): AvatarConfigV4 {
  const gender = isGender(raw['gender']) ? raw['gender'] : DEFAULT_GENDER
  const hair = pick(HAIR_SLOT, catalog, aliases, raw[HAIR_SLOT])
  const hairStyle = hair !== undefined && catalog.get(hair)?.gender === gender ? hair : DEFAULT_HAIR[gender]
  const config: AvatarConfigV4 = { v: AVATAR_CONFIG_VERSION, gender, hairStyle, ...pickWardrobe(raw, catalog, aliases) }
  const skinColor = pick('skinColor', catalog, aliases, raw['skinColor'])
  if (skinColor !== undefined) config.skinColor = skinColor

  const checked = validateAvatarConfig(config, catalog)
  return checked.ok ? checked.value : defaultAvatar(catalog)
}

/**
 * Reads a stored `avatar_config` back as a v4 configuration, whatever shape it was written in.
 *
 * The column is `jsonb` with a `{}` default, so "an account that predates avatars", "an account written by
 * v1, v2 or v3" and "an account wearing an item the catalogue withdrew" all have to render as *something*.
 * Answering with a repaired figure is better than answering with a partial one the client would draw with
 * holes. A valid v4 is returned as it is, without the eye rule or any other change.
 *
 * `aliases` and `bodies` are parameters rather than hidden defaults so a caller never pays for a second parse
 * of `item-aliases.json` or `avatar-bodies.json`: `app.ts` loads both once, alongside the catalogue, and
 * passes the same map and the same bodies everywhere a config is read.
 */
export function readAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>, bodies: Bodies): AvatarConfigV4 {
  const checked = validateAvatarConfig(stored ?? {}, catalog)
  if (checked.ok) return checked.value
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return defaultAvatar(catalog)
  if (stored['v'] === AVATAR_CONFIG_VERSION) return repairV4(stored, catalog, aliases)
  return v3ToV4(repairV3(stored, catalog, aliases), catalog, bodies)
}
