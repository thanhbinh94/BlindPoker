import { assetUrl, useAvatarAssetsBase, useTintedLayer, type LayerRef } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AssetRefDto, AvatarConfigDto, ItemDto, ItemSlot } from '../../api.js'
import { hintFor } from '../catalog.js'
import shared from '../normal.module.css'
import { ItemCard, WordCard } from './cards.js'
import { slotCards } from './categories.js'
import s from './wardrobe.module.css'

/** The slots that draw a picture; `title` and `badge` are words and preview as nothing. */
const PICTURED: ReadonlySet<ItemSlot> = new Set(['head', 'face', 'outfit', 'aura', 'frame'])

/** The `<img>`'s own intrinsic `width`/`height` (decoding hint, not layout): the files are 96 px (@1x) and
 * 192 px (@2x), so 64 only ever shrinks either density. The size it actually renders at on screen is CSS's
 * call, not this attribute's — `.tileIcon` (`wardrobe.module.css`) is a fixed 64 px (4rem) by itself, and a
 * larger, breakpoint-driven size inside the wardrobe's own `.cardThumb` (V-fix, 2026-09-27 — see that class's
 * own comment). */
const ICON_SIZE = 64

/**
 * The inventory icon the asset pipeline writes beside every item layer (docs/avatar-2d.md §4): the layer's
 * own name without its `_L<n>`, plus `_icon` — `item_head_tophat01_L80` → `item_head_tophat01_icon`. Derived
 * here rather than carried by the API, so the catalogue DTO did not have to change.
 */
function iconFile(layerFile: string): string {
  return `${layerFile.replace(/_L\d+$/, '')}_icon`
}

/** What `useTintedLayer` is asked for when there is no icon at all (`title`/`badge`): no tints, so it answers `null`
 * without painting anything — the hook is still called, every render, before `ItemPreview` returns nothing. */
const NO_ICON: LayerRef = { order: 0, file: '' }

/**
 * The icon as a layer for `useTintedLayer` (review 2026-09-29, No8a): a colour variant (`asset.tint`) is painted
 * exactly as `Chibi` paints it worn — the same `recolour` at the same `meanL` (`asset.tintMeanL`, the layer's own
 * `masks.tint.meanL`) — over the icon's own tint mask, `<icon>_tintmask`, which the pipeline cuts from the layer's
 * with the icon's fit (docs/avatar-2d.md §4.2). Anything else carries no tints and is drawn as it is.
 */
function iconLayer(asset: AssetRefDto, file: string): LayerRef {
  if (asset.tint === undefined || asset.tintMeanL === undefined) return { order: asset.layer, file }
  return { order: asset.layer, file, tints: [{ mask: `${file}_tintmask`, colour: asset.tint, meanL: asset.tintMeanL }] }
}

export interface ItemPreviewProps {
  item: ItemDto
  /** The wear of the base this tile is about — the wardrobe's draft base. An
   * item with a cut for it shows that cut's icon; everything else shows the shared one. */
  wear?: string
}

/**
 * The picture half of a tile: the item on its own, as the pipeline's icon — cut to the item and centred in a
 * square, so a hat reads as a hat whatever figure it will end up on — or nothing at all for `title`/`badge`,
 * which have no layer to draw. Seeing it *worn* is the big preview's job: picking a tile puts it there.
 *
 * Drawn by the wardrobe's item cards (`ItemCard`). Served from the same asset base as every `Chibi` layer, so it is
 * `img-src 'self'`.
 *
 * 2026-09-20: a gendered item has one icon per cut, because the tile has to show the skirt or the trousers
 * the figure on the stage beside it would actually be wearing. The icon is still derived from the layer's
 * name rather than carried by the API — only *which* layer is now a question.
 *
 * 2026-10-01 (No8a): a colour variant shows its own colour — the icon tinted on a canvas by the kit's own
 * `useTintedLayer`, as a `blob:` image with no `srcset` (the hook already picked the screen's density). Until the
 * tinted one is ready, and for good if the browser refuses it (`ChibiLayer`'s rule: a URL that failed is never
 * retried), the plain two-density icon is drawn instead.
 */
export function ItemPreview({ item, wear }: ItemPreviewProps) {
  const base = useAvatarAssetsBase()
  const asset = PICTURED.has(item.slot) ? item.asset : undefined
  const file = asset === undefined ? null : iconFile((wear === undefined ? undefined : asset.variants?.[wear]) ?? asset.file)
  const tinted = useTintedLayer(base, asset === undefined || file === null ? NO_ICON : iconLayer(asset, file))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (file === null) return null

  const common = {
    className: s.tileIcon,
    width: ICON_SIZE,
    height: ICON_SIZE,
    alt: '',
    loading: 'lazy' as const,
    decoding: 'async' as const,
    'data-item-icon': item.id,
  }
  if (tinted !== null && tinted !== failedUrl) return <img {...common} src={tinted} onError={() => setFailedUrl(tinted)} />
  return <img {...common} src={assetUrl(base, file, 1)} srcSet={`${assetUrl(base, file, 1)} 1x, ${assetUrl(base, file, 2)} 2x`} />
}

export interface ItemTabProps {
  slot: ItemSlot
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  /** The draft base's wear, so a gendered item's tile shows the cut the preview is wearing. */
  wear?: string
  /** "Hiện cả món chưa có" (No11a): unticked, only the families the player owns a member of. */
  showLocked: boolean
  onPick: (itemId: string) => void
  /** This tab's own panel id and the tab that labels it (design §7) — omitted for `title`/`badge`, whose
   * two calls share one `words` panel rendered one level up instead (`WardrobeScreen`): a `role="tabpanel"`
   * has to appear exactly once per tab, and `words` is the one tab two `ItemTab` calls draw between them. */
  panelId?: string
  labelledBy?: string
}

/** The words tab's two sub-headings (design §4.4) — `title` and `badge` are the only slots this names. */
const WORD_HEADING: Partial<Record<ItemSlot, string>> = { title: 'wardrobe.words.titles', badge: 'wardrobe.words.badges' }

/**
 * One wardrobe slot's cards (design §4, §7): `slotCards` (`./categories.js`) for the ordering, the colour-variant
 * families and the "Hiện cả món chưa có" box, owned pieces clickable and the rest locked with a reason. `outfit`'s
 * cards are never locked-*and*-worn at once — every account starts with the default outfit owned — but the lock logic
 * here does not know that; it just asks `owned`.
 *
 * `title`/`badge` (the words tab, called once per slot from `WardrobeScreen`) draw as `WordCard` under
 * their own sub-heading instead of `ItemCard`; every other slot draws pictured `ItemCard`s, each with its
 * family as a dot row (design §4.1) — a variant is never one of these cards itself. A family's card is the member
 * worn in the slot, when it is one of them (No8a): its picture, its name, its "Đang dùng", its click.
 *
 * Nothing to list (No11a — the box unticked and nothing owned here): a slot that is its own tab keeps its `tabpanel`
 * and says so in one line in place of the grid; a word slot draws nothing at all, heading included, and the words
 * panel says it once when both are empty (`WardrobeScreen`).
 */
export function ItemTab({ slot, catalog, owned, achievements, draft, wear, showLocked, onPick, panelId, labelledBy }: ItemTabProps) {
  const { t } = useTranslation('normal')
  // A family card is the member worn in this slot, when it is one of the family (No8a).
  const cards = slotCards(slot, catalog, owned, showLocked, draft[slot])
  const heading = WORD_HEADING[slot]
  // A card with no colour dots keeps the dot row's height when another card shown has some (No8b), so every
  // card in the grid ends its lock hint on the same line — counted on the dots actually drawn, not the catalogue's.
  const reserveDots = cards.some((card) => card.dots.length > 0)
  // `title`/`badge` render inside the caller's own shared `tabpanel` (see `panelId`'s own comment above),
  // so this `<div>` carries no panel role of its own then; every other slot is its own tab and carries the
  // role itself, exactly as before.
  const isOwnPanel = heading === undefined
  const empty = cards.length === 0
  if (empty && !isOwnPanel) return null

  return (
    <>
      {heading === undefined ? null : <h3 className={`${shared.groupTitle} ${s.wordHeading}`}>{t(heading)}</h3>}
      {/* Empty, the panel stays the same element (same `id`, same `aria-labelledby`) and only the grid goes. */}
      <div
        className={empty ? undefined : s.cardGrid}
        role={isOwnPanel ? 'tabpanel' : undefined}
        id={isOwnPanel ? panelId : undefined}
        aria-labelledby={isOwnPanel ? labelledBy : undefined}
      >
        {empty ? <p className={s.emptyOwned}>{t('wardrobe.emptyOwned')}</p> : null}
        {cards.map(({ original, shown, dots }) => {
          const isOwned = owned.has(shown.id)
          const wearing = draft[slot] === shown.id
          const hint = isOwned ? '' : hintFor(shown, achievements, t)

          if (heading !== undefined) {
            return <WordCard key={original.id} item={shown} owned={isOwned} wearing={wearing} hint={hint} onPick={onPick} />
          }

          // The original's dot included (No8a): `dots` is the family, original first, as `slotCards` filtered it.
          const variantProps =
            dots.length === 0 ? undefined : dots.map((member) => ({ item: member, owned: owned.has(member.id), wearing: draft[slot] === member.id }))

          return (
            <ItemCard
              key={original.id}
              item={shown}
              family={original}
              wear={wear}
              owned={isOwned}
              wearing={wearing}
              hint={hint}
              variants={variantProps}
              reserveDots={reserveDots}
              onPick={onPick}
            />
          )
        })}
      </div>
    </>
  )
}
