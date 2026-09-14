import { Chibi } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, BaseDto, ItemDto, ItemSlot } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import { itemName } from '../../catalog-i18n.js'
import { hintFor } from '../catalog.js'
import s from './wardrobe.module.css'

/** The slots that draw a picture; `title` and `badge` are words and preview as nothing. */
const PICTURED: ReadonlySet<ItemSlot> = new Set(['head', 'face', 'outfit', 'aura', 'frame'])

export interface ItemPreviewProps {
  item: ItemDto
  /** The configuration the item is previewed *on* — usually the current draft with this item's slot set to
   * `item.id`, so a hat is shown on the figure that would actually wear it. */
  config: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  bases: ReadonlyMap<string, BaseDto>
}

/**
 * The picture half of a tile: the item, drawn on the figure that would wear it, cropped the way the design
 * calls for per slot — head-and-shoulders for `head`/`face`/`frame`, full body for `outfit`/`aura` — or
 * nothing at all for `title`/`badge`, which have no layer to draw.
 *
 * Shared between the wardrobe's own tiles (`ItemTab` below) and the inventory's read-only cards, the same
 * way `PartPortrait` once was: one picture, two chrome styles around it.
 */
export function ItemPreview({ item, config, items, bases }: ItemPreviewProps) {
  if (!PICTURED.has(item.slot)) return null
  const subject = chibiFromApi({ ...config, [item.slot]: item.id }, items, bases)
  if (subject === null) return null
  return item.slot === 'outfit' || item.slot === 'aura' ? (
    <Chibi subject={subject} frame="full" size={72} />
  ) : (
    <Chibi subject={subject} frame="head" size={64} />
  )
}

export interface ItemTabProps {
  slot: ItemSlot
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  bases: ReadonlyMap<string, BaseDto>
  onPick: (itemId: string) => void
}

/**
 * One wardrobe slot's tiles (design §7): everything the catalogue lists for this slot, owned pieces
 * clickable and the rest locked with a reason. `outfit`'s tiles are never locked-*and*-equipped at once —
 * every account starts with the default outfit owned — but the lock logic here does not know that; it just
 * asks `owned`.
 */
export function ItemTab({ slot, catalog, owned, achievements, draft, items, bases, onPick }: ItemTabProps) {
  const { t } = useTranslation('normal')
  const rows = catalog.filter((item) => item.slot === slot)

  return (
    <div className={s.tileGrid} role="tabpanel">
      {rows.map((item) => {
        const isOwned = owned.has(item.id)
        const equipped = draft[slot] === item.id
        return (
          <button
            key={item.id}
            type="button"
            className={s.tile}
            data-rarity={item.rarity}
            aria-pressed={equipped}
            aria-disabled={!isOwned}
            onClick={() => {
              if (isOwned) onPick(item.id)
            }}
          >
            <ItemPreview item={item} config={draft} items={items} bases={bases} />
            <span className={s.tileName}>{itemName(item.id, t)}</span>
            {isOwned ? null : <span className={s.tileHint}>{hintFor(item, achievements, t)}</span>}
          </button>
        )
      })}
    </div>
  )
}
