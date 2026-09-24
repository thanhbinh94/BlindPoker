import type { BaseRef, ChibiConfig, Expression, WearRef } from '@bp/ui-kit'
import type { AvatarConfigDto, BaseDto, ItemDto } from '../api.js'

/**
 * Turns a server config plus the catalogue into the kit's `ChibiConfig` — the shape `Chibi` actually
 * draws (design §5.1, §7).
 *
 * Two things never throw, because a browser holding yesterday's bundle can meet ids the server has
 * added since:
 *
 * - **An unknown base** answers `null` for the whole chibi — there is no body to draw it on.
 * - **An unknown optional item id** (`head`/`face`/`aura`/`frame`) is simply omitted, the same way an
 *   unknown badge is dropped from a seat caption rather than printed as a raw key.
 *
 * `outfit` is the one exception: every base must wear something, so an unknown outfit id falls back to
 * the catalogue's default outfit (`isDefault`), and only if that is *also* missing does the whole
 * function give up and answer `null`.
 *
 * 2026-09-20: which *file* an equipped item draws depends on the base, because one item may carry a cut
 * per wear (`asset.variants`). The resolved base is threaded through `toWearRef` for that; everything
 * below it in the kit is unchanged, and `hashChibi` already folds the base id in, so two bases wearing
 * one item id still hash apart.
 */
export function chibiFromApi(
  config: AvatarConfigDto,
  items: ReadonlyMap<string, ItemDto>,
  bases: ReadonlyMap<string, BaseDto>,
): ChibiConfig | null {
  const baseDto = bases.get(config.base)
  const base = toBaseRef(baseDto)
  if (base === null || baseDto === undefined) return null

  const outfit = toWearRef(items.get(config.outfit), 'outfit', baseDto) ?? toDefaultOutfit(items, baseDto)
  if (outfit === null) return null

  const chibi: ChibiConfig = { kind: 'human', base, outfit }

  const head = toWearRef(items.get(config.head ?? ''), 'head', baseDto)
  if (head !== null) chibi.head = head
  const face = toWearRef(items.get(config.face ?? ''), 'face', baseDto)
  if (face !== null) chibi.face = face
  const aura = toWearRef(items.get(config.aura ?? ''), 'aura', baseDto)
  if (aura !== null) chibi.aura = aura
  const frame = toWearRef(items.get(config.frame ?? ''), 'frame', baseDto)
  if (frame !== null) chibi.frame = frame

  const hairColor = toColour(items.get(config.hairColor ?? ''), 'hairColor')
  if (hairColor !== undefined) chibi.hairColor = hairColor
  const eyeColor = toColour(items.get(config.eyeColor ?? ''), 'eyeColor')
  if (eyeColor !== undefined) chibi.eyeColor = eyeColor

  return chibi
}

/** The hex a `hairColor`/`eyeColor` id resolves to, or `undefined` for an id the catalogue has no row
 * for, one that belongs to the other colour slot, or one with no `colour` at all (design §5.2). */
function toColour(item: ItemDto | undefined, slot: ItemDto['slot']): string | undefined {
  if (item === undefined || item.slot !== slot) return undefined
  return item.colour
}

/** The layer an item draws on this base: its cut for the base's wear, or the one everybody shares. */
export function layerFileFor(asset: ItemDto['asset'], base: Pick<BaseDto, 'wear'> | undefined): string | undefined {
  if (asset === undefined) return undefined
  const variant = base === undefined ? undefined : asset.variants?.[base.wear]
  return variant ?? asset.file
}

function toBaseRef(base: BaseDto | undefined): BaseRef | null {
  if (base === undefined) return null
  const ref: BaseRef = {
    id: base.id,
    hairBack: base.layers.hairBack,
    body: base.layers.body,
    hairFront: base.layers.hairFront,
    // Trusted rather than re-validated: the server's `loadBases` already refused a bases file missing any
    // of the six expressions, and re-checking that here on every render would cost more than it catches.
    faces: base.faces as Record<Expression, string>,
  }
  if (base.tint !== undefined) ref.tint = base.tint
  return ref
}

/** `undefined` for an id the catalogue has no row for, or one that belongs to a different slot — both read
 * as "not equipped" rather than as an error. */
function toWearRef(item: ItemDto | undefined, slot: ItemDto['slot'], base: BaseDto): WearRef | null {
  if (item === undefined || item.slot !== slot || item.asset === undefined) return null
  const { layer: order, hidesHairFront, hidesHairBack, tint, tintMeanL } = item.asset
  const wear: WearRef = { id: item.id, order, file: layerFileFor(item.asset, base)! }
  if (hidesHairFront !== undefined) wear.hidesHairFront = hidesHairFront
  if (hidesHairBack !== undefined) wear.hidesHairBack = hidesHairBack
  // `tintMeanL` is always set alongside `tint` — the server's `parseAsset` refuses one without the
  // other — so it is trusted here the same way `faces` is trusted above.
  if (tint !== undefined) wear.tint = { colour: tint, meanL: tintMeanL! }
  return wear
}

function toDefaultOutfit(items: ReadonlyMap<string, ItemDto>, base: BaseDto): WearRef | null {
  for (const item of items.values()) {
    if (item.slot === 'outfit' && item.isDefault) return toWearRef(item, 'outfit', base)
  }
  return null
}
