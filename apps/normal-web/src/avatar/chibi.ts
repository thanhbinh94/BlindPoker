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
 */
export function chibiFromApi(
  config: AvatarConfigDto,
  items: ReadonlyMap<string, ItemDto>,
  bases: ReadonlyMap<string, BaseDto>,
): ChibiConfig | null {
  const base = toBaseRef(bases.get(config.base))
  if (base === null) return null

  const outfit = toWearRef(items.get(config.outfit), 'outfit') ?? toDefaultOutfit(items)
  if (outfit === null) return null

  const chibi: ChibiConfig = { kind: 'human', base, outfit }

  const head = toWearRef(items.get(config.head ?? ''), 'head')
  if (head !== null) chibi.head = head
  const face = toWearRef(items.get(config.face ?? ''), 'face')
  if (face !== null) chibi.face = face
  const aura = toWearRef(items.get(config.aura ?? ''), 'aura')
  if (aura !== null) chibi.aura = aura
  const frame = toWearRef(items.get(config.frame ?? ''), 'frame')
  if (frame !== null) chibi.frame = frame

  return chibi
}

function toBaseRef(base: BaseDto | undefined): BaseRef | null {
  if (base === undefined) return null
  return {
    id: base.id,
    hairBack: base.layers.hairBack,
    body: base.layers.body,
    hairFront: base.layers.hairFront,
    // Trusted rather than re-validated: the server's `loadBases` already refused a bases file missing any
    // of the six expressions, and re-checking that here on every render would cost more than it catches.
    faces: base.faces as Record<Expression, string>,
  }
}

/** `undefined` for an id the catalogue has no row for, or one that belongs to a different slot — both read
 * as "not equipped" rather than as an error. */
function toWearRef(item: ItemDto | undefined, slot: ItemDto['slot']): WearRef | null {
  if (item === undefined || item.slot !== slot || item.asset === undefined) return null
  const { layer: order, file, hidesHairFront, hidesHairBack } = item.asset
  const wear: WearRef = { id: item.id, order, file }
  if (hidesHairFront !== undefined) wear.hidesHairFront = hidesHairFront
  if (hidesHairBack !== undefined) wear.hidesHairBack = hidesHairBack
  return wear
}

function toDefaultOutfit(items: ReadonlyMap<string, ItemDto>): WearRef | null {
  for (const item of items.values()) {
    if (item.slot === 'outfit' && item.isDefault) return toWearRef(item, 'outfit')
  }
  return null
}
