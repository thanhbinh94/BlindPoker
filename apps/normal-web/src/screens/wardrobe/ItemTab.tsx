import { assetUrl, useAvatarAssetsBase } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, ItemDto, ItemSlot } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { hintFor } from '../catalog.js'
import s from './wardrobe.module.css'

/** The slots that draw a picture; `title` and `badge` are words and preview as nothing. */
const PICTURED: ReadonlySet<ItemSlot> = new Set(['head', 'face', 'outfit', 'aura', 'frame'])

/** The icon's size on screen, in CSS pixels. The files are 96 px (@1x) and 192 px (@2x), so both only ever shrink. */
const ICON_SIZE = 64

/**
 * The inventory icon the asset pipeline writes beside every item layer (docs/avatar-2d.md §4): the layer's
 * own name without its `_L<n>`, plus `_icon` — `item_head_tophat01_L80` → `item_head_tophat01_icon`. Derived
 * here rather than carried by the API, so the catalogue DTO did not have to change.
 */
function iconFile(layerFile: string): string {
  return `${layerFile.replace(/_L\d+$/, '')}_icon`
}

export interface ItemPreviewProps {
  item: ItemDto
  /** The wear of the base this tile is about — the wardrobe's draft base, the inventory's saved one. An
   * item with a cut for it shows that cut's icon; everything else shows the shared one. */
  wear?: string
}

/**
 * The picture half of a tile: the item on its own, as the pipeline's icon — cut to the item and centred in a
 * square, so a hat reads as a hat whatever figure it will end up on — or nothing at all for `title`/`badge`,
 * which have no layer to draw. Seeing it *worn* is the big preview's job: picking a tile puts it there.
 *
 * Shared between the wardrobe's own tiles (`ItemTab` below) and the inventory's read-only cards: one picture,
 * two chrome styles around it. Served from the same asset base as every `Chibi` layer, so it is `img-src 'self'`.
 *
 * 2026-09-20: a gendered item has one icon per cut, because the tile has to show the skirt or the trousers
 * the figure on the stage beside it would actually be wearing. The icon is still derived from the layer's
 * name rather than carried by the API — only *which* layer is now a question.
 */
export function ItemPreview({ item, wear }: ItemPreviewProps) {
  const base = useAvatarAssetsBase()
  if (!PICTURED.has(item.slot) || item.asset === undefined) return null
  const layer = (wear === undefined ? undefined : item.asset.variants?.[wear]) ?? item.asset.file
  const file = iconFile(layer)
  return (
    <img
      className={s.tileIcon}
      src={assetUrl(base, file, 1)}
      srcSet={`${assetUrl(base, file, 1)} 1x, ${assetUrl(base, file, 2)} 2x`}
      width={ICON_SIZE}
      height={ICON_SIZE}
      alt=""
      loading="lazy"
      decoding="async"
      data-item-icon={item.id}
    />
  )
}

export interface ItemTabProps {
  slot: ItemSlot
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  /** The draft base's wear, so a gendered item's tile shows the cut the preview is wearing. */
  wear?: string
  onPick: (itemId: string) => void
}

/**
 * One wardrobe slot's tiles (design §7): everything the catalogue lists for this slot, owned pieces
 * clickable and the rest locked with a reason. `outfit`'s tiles are never locked-*and*-equipped at once —
 * every account starts with the default outfit owned — but the lock logic here does not know that; it just
 * asks `owned`.
 */
export function ItemTab({ slot, catalog, owned, achievements, draft, wear, onPick }: ItemTabProps) {
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
            <ItemPreview item={item} wear={wear} />
            <span className={s.tileName}>{itemName(item.id, t)}</span>
            {isOwned ? null : <span className={s.tileHint}>{hintFor(item, achievements, t)}</span>}
          </button>
        )
      })}
    </div>
  )
}
