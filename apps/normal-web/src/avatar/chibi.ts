import type { BodyRef, ChibiConfig, Expression, HairRef, WearRef } from '@bp/ui-kit'
import type { AvatarConfigDto, BodyDto, ItemDto } from '../api.js'

/**
 * Turns a server config plus the catalogue into the kit's `ChibiConfig` — the shape `Chibi` actually
 * draws (design §5.1, §7; avatar v4, spec `2026-10-03-avatar-v4-design.md` §6.3).
 *
 * A v4 figure is a body per gender, a hairstyle of two layers, an outfit and whatever else is equipped,
 * recoloured by up to three colours. `bodies` is `/api/catalog/avatar`'s `bodies`, keyed by `gender`.
 *
 * Nothing here throws, because a browser holding yesterday's bundle can meet ids the server has added
 * since:
 *
 * - **An unknown gender** (or one whose body was not served) answers `null` for the whole chibi — there
 *   is no body to draw it on.
 * - **An unknown hairstyle** — an id with no `hairStyle` row behind it — wears the first hairstyle of
 *   that gender in catalogue order instead: a bald stand-in body is not a look anybody chose. Only a
 *   catalogue with no hairstyle of that gender at all gives up and answers `null`.
 * - **An unknown outfit** falls back to the catalogue's default outfit (`isDefault`), and only if that
 *   is *also* missing does the whole function answer `null`: every figure must wear something.
 * - **An unknown optional item id** (`head`/`face`/`aura`/`frame`, or a colour) is simply omitted, the
 *   same way an unknown badge is dropped from a seat caption rather than printed as a raw key.
 *
 * Which *file* an equipped item draws depends on the gender, because one item may carry a cut per
 * gender (`asset.variants`, 2026-09-20 — keyed by a base's `wear` until v4). `hashChibi` folds the
 * gender in, so the two genders wearing one item id still hash apart.
 */
export function chibiFromApi(
  config: AvatarConfigDto,
  items: ReadonlyMap<string, ItemDto>,
  bodies: ReadonlyMap<string, BodyDto>,
): ChibiConfig | null {
  const bodyDto = bodies.get(config.gender)
  if (bodyDto === undefined) return null
  const gender = bodyDto.gender

  const hair = toHairRef(items.get(config.hairStyle)) ?? toFirstHairOf(items, gender)
  if (hair === null) return null

  const outfit = toWearRef(items.get(config.outfit), 'outfit', gender) ?? toDefaultOutfit(items, gender)
  if (outfit === null) return null

  const chibi: ChibiConfig = { kind: 'human', body: toBodyRef(bodyDto), hair, outfit }

  const head = toWearRef(items.get(config.head ?? ''), 'head', gender)
  if (head !== null) chibi.head = head
  const face = toWearRef(items.get(config.face ?? ''), 'face', gender)
  if (face !== null) chibi.face = face
  const aura = toWearRef(items.get(config.aura ?? ''), 'aura', gender)
  if (aura !== null) chibi.aura = aura
  const frame = toWearRef(items.get(config.frame ?? ''), 'frame', gender)
  if (frame !== null) chibi.frame = frame

  const hairColor = toColour(items.get(config.hairColor ?? ''), 'hairColor')
  if (hairColor !== undefined) chibi.hairColor = hairColor
  const eyeColor = toColour(items.get(config.eyeColor ?? ''), 'eyeColor')
  if (eyeColor !== undefined) chibi.eyeColor = eyeColor
  const skinColor = toColour(items.get(config.skinColor ?? ''), 'skinColor')
  if (skinColor !== undefined) chibi.skinColor = skinColor

  return chibi
}

/** The hex a colour id resolves to, or `undefined` for an id the catalogue has no row for, one that belongs to
 * another colour slot, or one with no `colour` at all (design §5.2). */
function toColour(item: ItemDto | undefined, slot: ItemDto['slot']): string | undefined {
  if (item === undefined || item.slot !== slot) return undefined
  return item.colour
}

/** The layer an item draws on a body of this gender: its cut for that gender, or the one everybody shares. */
export function layerFileFor(asset: ItemDto['asset'], gender: string | undefined): string | undefined {
  if (asset === undefined) return undefined
  const variant = gender === undefined ? undefined : asset.variants?.[gender]
  return variant ?? asset.file
}

function toBodyRef(body: BodyDto): BodyRef {
  const ref: BodyRef = {
    gender: body.gender,
    body: body.body,
    // Trusted rather than re-validated: the server's `loadBodies` already refused a bodies file missing any of the
    // six expressions, and re-checking that here on every render would cost more than it catches.
    faces: body.faces as Record<Expression, string>,
  }
  if (body.tint !== undefined) ref.tint = body.tint
  return ref
}

/** A hairstyle row the kit can draw — its front half is `asset.file`, its back half `asset.back` — or `null` for an
 * id the catalogue has no such row for. */
function toHairRef(item: ItemDto | undefined): HairRef | null {
  if (item === undefined || item.slot !== 'hairStyle' || item.asset?.back === undefined) return null
  const ref: HairRef = { id: item.id, back: item.asset.back, front: item.asset.file }
  if (item.asset.hairTint !== undefined) ref.tint = item.asset.hairTint
  return ref
}

/** The first hairstyle of `gender` in catalogue order — what a figure wears when its own hairstyle is unknown. */
function toFirstHairOf(items: ReadonlyMap<string, ItemDto>, gender: string): HairRef | null {
  for (const item of items.values()) {
    if (item.slot !== 'hairStyle' || item.gender !== gender) continue
    const hair = toHairRef(item)
    if (hair !== null) return hair
  }
  return null
}

/** `null` for an id the catalogue has no row for, or one that belongs to a different slot — both read as "not
 * equipped" rather than as an error. */
function toWearRef(item: ItemDto | undefined, slot: ItemDto['slot'], gender: string): WearRef | null {
  if (item === undefined || item.slot !== slot || item.asset === undefined) return null
  const { layer: order, hidesHairFront, hidesHairBack, clipsHair, tint, tintMeanL } = item.asset
  const wear: WearRef = { id: item.id, order, file: layerFileFor(item.asset, gender)! }
  if (hidesHairFront !== undefined) wear.hidesHairFront = hidesHairFront
  if (hidesHairBack !== undefined) wear.hidesHairBack = hidesHairBack
  if (clipsHair === true) wear.clipsHair = true
  // `tintMeanL` is always set alongside `tint` — the server's `parseAsset` refuses one without the
  // other — so it is trusted here the same way `faces` is trusted above.
  if (tint !== undefined) wear.tint = { colour: tint, meanL: tintMeanL! }
  return wear
}

function toDefaultOutfit(items: ReadonlyMap<string, ItemDto>, gender: string): WearRef | null {
  for (const item of items.values()) {
    if (item.slot === 'outfit' && item.isDefault) return toWearRef(item, 'outfit', gender)
  }
  return null
}
