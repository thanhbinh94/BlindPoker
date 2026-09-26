import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, BaseDto, ItemDto, ItemSlot, Rarity } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { tabOfSlot, type TabId } from './categories.js'
import s from './wardrobe.module.css'

export interface EquippedListProps {
  config: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  bases: ReadonlyMap<string, BaseDto>
  onRemove: (slot: ItemSlot) => void
  onJump: (tab: TabId) => void
}

/** The row order design §3.1 item 3 lists: base first, the two colours, the five drawn slots, then the
 * two word slots — `base` is not an `ItemSlot` (it is chosen, not owned), so it gets its own row kind. */
type RowId = 'base' | ItemSlot
const ROWS: readonly RowId[] = ['base', 'hairColor', 'eyeColor', 'head', 'face', 'outfit', 'aura', 'frame', 'title', 'badge']

const COLOUR_SLOTS: ReadonlySet<RowId> = new Set(['hairColor', 'eyeColor'])
/** Design §3.1 item 3: Thân and Trang phục never carry a "×" — one is chosen rather than worn, the other
 * is the one slot a figure can never go without. Every other row's "×" only shows once it holds something. */
const NEVER_REMOVABLE: ReadonlySet<RowId> = new Set(['base', 'outfit'])

/** Each row's label reuses an existing tab/group string (brief: no new per-row vocabulary) — `words` has
 * none of its own, so title/badge borrow the two sub-headings `ItemTab` already shows inside that tab. */
const ROW_LABEL_KEY: Record<RowId, string> = {
  base: 'wardrobe.tabs.base',
  hairColor: 'wardrobe.tabs.hairColor',
  eyeColor: 'wardrobe.tabs.eyeColor',
  head: 'wardrobe.tabs.head',
  face: 'wardrobe.tabs.face',
  outfit: 'wardrobe.tabs.outfit',
  aura: 'wardrobe.tabs.aura',
  frame: 'wardrobe.tabs.frame',
  title: 'wardrobe.words.titles',
  badge: 'wardrobe.words.badges',
}

/** Decorative row glyphs (aria-hidden — the row's own label already names the slot), one identifier per
 * row so no raw emoji sits in the JSX text (`react/jsx-no-literals`, matching `cards.tsx`'s convention). */
const ROW_ICON: Record<RowId, string> = {
  base: '\u{1F464}',
  hairColor: '\u{1F4A7}',
  eyeColor: '\u{1F441}\u{FE0F}',
  head: '\u{1F452}',
  face: '\u{1F453}',
  outfit: '\u{1F455}',
  aura: '\u{2728}',
  frame: '\u{1F5BC}\u{FE0F}',
  title: '\u{1F3F7}\u{FE0F}',
  badge: '\u{1F396}\u{FE0F}',
}
const REMOVE_GLYPH = '×'

interface RowContent {
  value: string
  rarity?: Rarity
  swatch?: string
  filled: boolean
}

function baseRow(config: AvatarConfigDto, bases: ReadonlyMap<string, BaseDto>, t: TFunction<'normal'>): RowContent {
  const base = bases.get(config.base)
  return { value: base === undefined ? t('wardrobe.equipped.none') : t(base.nameKey), filled: base !== undefined }
}

function colourRow(slot: 'hairColor' | 'eyeColor', config: AvatarConfigDto, items: ReadonlyMap<string, ItemDto>, t: TFunction<'normal'>): RowContent {
  const id = config[slot]
  const item = id === undefined ? undefined : items.get(id)
  if (item === undefined) return { value: t('wardrobe.natural'), filled: false }
  return { value: itemName(item.id, t), rarity: item.rarity, swatch: item.colour, filled: true }
}

function itemRow(
  slot: Exclude<ItemSlot, 'hairColor' | 'eyeColor'>,
  config: AvatarConfigDto,
  items: ReadonlyMap<string, ItemDto>,
  t: TFunction<'normal'>,
): RowContent {
  const id = config[slot]
  const item = id === undefined ? undefined : items.get(id)
  if (item === undefined) return { value: t('wardrobe.equipped.none'), filled: false }
  return { value: itemName(item.id, t), rarity: item.rarity, filled: true }
}

/**
 * The left column's "Đang mặc" list (design §3.1 item 3): one row per slot, in the fixed order the
 * design names, each naming its slot, what fills it (or "Không có"/"Tự nhiên" when it doesn't), and —
 * for an optional slot currently filled — a "×" to clear it. A row's main button jumps the right column
 * to that slot's group/tab (`tabOfSlot`); the "×" is a sibling button, not nested inside it, since a
 * button cannot contain another.
 */
export function EquippedList({ config, items, bases, onRemove, onJump }: EquippedListProps) {
  const { t } = useTranslation('normal')

  const contentFor = (row: RowId): RowContent => {
    if (row === 'base') return baseRow(config, bases, t)
    if (COLOUR_SLOTS.has(row)) return colourRow(row as 'hairColor' | 'eyeColor', config, items, t)
    return itemRow(row as Exclude<ItemSlot, 'hairColor' | 'eyeColor'>, config, items, t)
  }

  const jumpTarget = (row: RowId): TabId => (row === 'base' ? 'base' : tabOfSlot(row))

  return (
    <div className={s.equippedList}>
      <h2 className={s.equippedTitle}>{t('wardrobe.equipped.title')}</h2>
      <ul className={s.equippedRows}>
        {ROWS.map((row) => {
          const content = contentFor(row)
          const removable = !NEVER_REMOVABLE.has(row) && content.filled
          return (
            <li className={s.equippedRow} key={row}>
              <button type="button" className={s.equippedRowMain} onClick={() => onJump(jumpTarget(row))}>
                <span aria-hidden="true" className={s.equippedIcon}>
                  {ROW_ICON[row]}
                </span>
                <span className={s.equippedLabel}>{t(ROW_LABEL_KEY[row])}</span>
                <span className={s.equippedValue} data-rarity={content.rarity}>
                  {content.swatch === undefined ? null : (
                    <span className={s.equippedSwatch} style={{ background: content.swatch }} aria-hidden="true" />
                  )}
                  {content.value}
                </span>
              </button>
              {!removable ? null : (
                <button
                  type="button"
                  className={s.equippedRemove}
                  aria-label={t('wardrobe.equipped.remove', { item: content.value })}
                  onClick={() => onRemove(row as ItemSlot)}
                >
                  {REMOVE_GLYPH}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
