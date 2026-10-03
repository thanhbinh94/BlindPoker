import type { AvatarConfigDto, Gender, ItemDto } from '../../api.js'

/**
 * The draft after the Nữ | Nam switch (avatar v4, spec §6.2): the gender, and with it a hairstyle drawn for that
 * gender — the old one's `counterpart` when the player owns it, else the first owned hairstyle of that gender in
 * catalogue order. Everything else stays: the hair, skin and eye colours, the hat, the glasses, the aura, the frame,
 * the title and the badge. The outfit stays the same item too; its cut follows the gender on its own, since a figure
 * draws an item's layer through `layerFileFor(asset, gender)` (`../../avatar/chibi.js`).
 *
 * The switch is the only control that changes the gender, and the Kiểu tóc tab lists only the current gender's
 * hairstyles, so a draft never pairs a gender with the other gender's hairstyle — `chibiFromApi` would draw one, and
 * the server refuses one (`WRONG_GENDER`). When no hairstyle of the new gender is owned there is nothing to switch to,
 * and the draft comes back as it was, the very same object. So does a switch to the gender already chosen.
 */
export function swapGender(config: AvatarConfigDto, gender: Gender, items: ReadonlyMap<string, ItemDto>, owned: ReadonlySet<string>): AvatarConfigDto {
  if (config.gender === gender) return config
  const counterpart = items.get(config.hairStyle)?.counterpart
  const fits = (id: string | undefined): id is string =>
    id !== undefined && items.get(id)?.slot === 'hairStyle' && items.get(id)?.gender === gender && owned.has(id)
  const hairStyle = fits(counterpart) ? counterpart : [...items.values()].find((item) => fits(item.id))?.id
  return hairStyle === undefined ? config : { ...config, gender, hairStyle }
}
