import type { TFunction } from 'i18next'
import { GEOMETRIC_SLOTS, type AvatarConfigDto } from '../api.js'
import { itemName } from '../catalog-i18n.js'
import { EYE_COLORS, SKIN_TONES } from './config.js'

/**
 * The figure, in words (avatar-3d design §6: "`aria-label` mô tả cấu hình bằng chữ").
 *
 * A stage is a canvas, and a canvas is nothing at all to a screen reader — so the whole of what the
 * player built has to be said in one sentence, and that sentence is the element's accessible name. It
 * is also the fallback portrait's name, which is what makes the two interchangeable: a machine with no
 * WebGL shows a letter on a disc and reads out exactly the same description.
 *
 * Its own module because both lazy screens need it — the wardrobe and the profile header — and neither
 * may import the other's chunk for a function.
 */

/** The name of a closed-palette colour, by position, or the hex itself for a value off the palette. */
function toneName(palette: readonly string[], key: 'skinTone' | 'eyeColor', value: string, t: TFunction): string {
  const at = palette.indexOf(value.toLowerCase())
  return at === -1 ? value : t(`wardrobe.${key}.${at}`)
}

/**
 * "A female figure, ivory skin, brown eyes. Wearing: hair a bun, top an áo dài, …".
 *
 * Only the slots that are filled are listed, and a figure wearing nothing at all (which the server does
 * not allow, but a half-loaded draft can be) gets the shorter sentence rather than a dangling colon.
 */
export function figureDescription(config: AvatarConfigDto, t: TFunction): string {
  const common = {
    body: t(`wardrobe.bodyWord.${config.body}`),
    skin: toneName(SKIN_TONES, 'skinTone', config.skin, t),
    eyes: toneName(EYE_COLORS, 'eyeColor', config.eyes, t),
  }

  const worn = GEOMETRIC_SLOTS.filter((slot) => {
    const itemId = config[slot]
    return itemId !== undefined && itemId !== ''
  }).map((slot) => t('wardrobe.figurePiece', { slot: t(`avatar.slot.${slot}`), item: itemName(config[slot] as string, t) }))

  return worn.length === 0 ? t('wardrobe.figureBare', common) : t('wardrobe.figure', { ...common, items: worn.join(', ') })
}
