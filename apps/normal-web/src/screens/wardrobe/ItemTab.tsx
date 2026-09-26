import { assetUrl, useAvatarAssetsBase } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, ItemDto, ItemSlot } from '../../api.js'
import { hintFor } from '../catalog.js'
import shared from '../normal.module.css'
import { ItemCard, WordCard } from './cards.js'
import { applyFilter, tabItems, tabOfSlot, type OwnershipFilter } from './categories.js'
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
  filter: OwnershipFilter
  onPick: (itemId: string) => void
}

/**
 * Every row of a slot's colour variants (design §4.1): items that share `asset.file` with another item
 * but carry their own `asset.tint` are not separate cards — they are dots under the item whose file
 * they share. The original the variants vary has no `tint` at all, which is exactly what tells a card
 * apart from a dot.
 */
function variantsByFile(rows: readonly ItemDto[]): Map<string, ItemDto[]> {
  const map = new Map<string, ItemDto[]>()
  for (const row of rows) {
    if (row.asset?.tint === undefined) continue
    const file = row.asset.file
    const list = map.get(file)
    if (list === undefined) map.set(file, [row])
    else list.push(row)
  }
  return map
}

/** The words tab's two sub-headings (design §4.4) — `title` and `badge` are the only slots this names. */
const WORD_HEADING: Partial<Record<ItemSlot, string>> = { title: 'wardrobe.words.titles', badge: 'wardrobe.words.badges' }

/**
 * One wardrobe slot's cards (design §4, §7): `tabItems` for the ordering and the colour-variant split,
 * `applyFilter` for the "all/owned/locked" filter, owned pieces clickable and the rest locked with a
 * reason. `outfit`'s cards are never locked-*and*-worn at once — every account starts with the default
 * outfit owned — but the lock logic here does not know that; it just asks `owned`.
 *
 * `title`/`badge` (the words tab, called once per slot from `WardrobeScreen`) draw as `WordCard` under
 * their own sub-heading instead of `ItemCard`; every other slot draws pictured `ItemCard`s, each with its
 * colour variants as a dot row (design §4.1) — a variant is never one of these cards itself.
 */
export function ItemTab({ slot, catalog, owned, achievements, draft, wear, filter, onPick }: ItemTabProps) {
  const { t } = useTranslation('normal')
  const rows = tabItems(tabOfSlot(slot), catalog).filter((item) => item.slot === slot)
  const variants = variantsByFile(catalog.filter((item) => item.slot === slot))
  const cards = applyFilter(rows, owned, filter)
  const heading = WORD_HEADING[slot]

  return (
    <>
      {heading === undefined ? null : <h3 className={shared.groupTitle}>{t(heading)}</h3>}
      <div className={s.cardGrid} role="tabpanel">
        {cards.map((item) => {
          const isOwned = owned.has(item.id)
          const wearing = draft[slot] === item.id
          const hint = isOwned ? '' : hintFor(item, achievements, t)

          if (heading !== undefined) {
            return <WordCard key={item.id} item={item} owned={isOwned} wearing={wearing} hint={hint} onPick={onPick} />
          }

          const dots = item.asset === undefined ? undefined : variants.get(item.asset.file)
          const variantProps =
            dots === undefined || dots.length === 0
              ? undefined
              : dots.map((variant) => ({ item: variant, owned: owned.has(variant.id), wearing: draft[slot] === variant.id }))

          return (
            <ItemCard key={item.id} item={item} wear={wear} owned={isOwned} wearing={wearing} hint={hint} variants={variantProps} onPick={onPick} />
          )
        })}
      </div>
    </>
  )
}
