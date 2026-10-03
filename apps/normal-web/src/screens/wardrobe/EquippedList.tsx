import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, ItemDto, ItemSlot, Rarity } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { tabOfSlot, type TabId } from './categories.js'
import { Icon, type IconName } from './icons.js'
import s from './wardrobe.module.css'

export interface EquippedListProps {
  config: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  onRemove: (slot: ItemSlot) => void
  onJump: (tab: TabId) => void
}

/** The row order design §3.1 item 3 lists: the gender first, the two colours, the five drawn slots, then the
 * two word slots — `gender` is not an `ItemSlot` (it is chosen, not owned), so it gets its own row kind.
 *
 * Plan 19 (avatar v4): the gender row replaces the base's. `RowId` already spans every slot, `hairStyle` and
 * `skinColor` included, but their rows join the list with the look group's Kiểu tóc and Màu da tabs (A6). */
type RowId = 'gender' | ItemSlot
const ROWS: readonly RowId[] = ['gender', 'hairColor', 'eyeColor', 'head', 'face', 'outfit', 'aura', 'frame', 'title', 'badge']

const COLOUR_SLOTS: ReadonlySet<RowId> = new Set(['hairColor', 'eyeColor', 'skinColor'])
/** Design §3.1 item 3: Giới tính, Kiểu tóc and Trang phục never carry a "×" — the first is chosen rather than
 * worn, the other two are slots a figure can never go without. Every other row's "×" only shows once it holds
 * something. */
const NEVER_REMOVABLE: ReadonlySet<RowId> = new Set(['gender', 'hairStyle', 'outfit'])

/** Each row's label reuses an existing tab/group string (brief: no new per-row vocabulary) — `words` has
 * none of its own, so title/badge borrow the two sub-headings `ItemTab` already shows inside that tab. */
const ROW_LABEL_KEY: Record<RowId, string> = {
  gender: 'wardrobe.gender.legend',
  hairStyle: 'wardrobe.tabs.hairStyle',
  hairColor: 'wardrobe.tabs.hairColor',
  eyeColor: 'wardrobe.tabs.eyeColor',
  skinColor: 'wardrobe.tabs.skinColor',
  head: 'wardrobe.tabs.head',
  face: 'wardrobe.tabs.face',
  outfit: 'wardrobe.tabs.outfit',
  aura: 'wardrobe.tabs.aura',
  frame: 'wardrobe.tabs.frame',
  title: 'wardrobe.words.titles',
  badge: 'wardrobe.words.badges',
}

/** Small monochrome line icons (V2 fix, `./icons.js`) — aria-hidden, the row's own label already names
 * the slot. */
const ROW_ICON: Record<RowId, IconName> = {
  gender: 'person',
  // Stand-ins until A6 draws these two rows with icons of their own (`hair`, `palm`).
  hairStyle: 'person',
  hairColor: 'drop',
  eyeColor: 'eye',
  skinColor: 'drop',
  head: 'hat',
  face: 'glasses',
  outfit: 'shirt',
  aura: 'sparkle',
  frame: 'frame',
  title: 'tag',
  badge: 'medal',
}
const REMOVE_GLYPH = '×'

interface RowContent {
  value: string
  rarity?: Rarity
  swatch?: string
  filled: boolean
}

/** The gender row: always filled — every figure is drawn on one body or the other — and named "Nữ"/"Nam". */
function genderRow(config: AvatarConfigDto, t: TFunction<'normal'>): RowContent {
  return { value: t(`wardrobe.gender.${config.gender}`), filled: true }
}

function colourRow(slot: 'hairColor' | 'eyeColor' | 'skinColor', config: AvatarConfigDto, items: ReadonlyMap<string, ItemDto>, t: TFunction<'normal'>): RowContent {
  const id = config[slot]
  const item = id === undefined ? undefined : items.get(id)
  if (item === undefined) return { value: t('wardrobe.natural'), filled: false }
  return { value: itemName(item.id, t), rarity: item.rarity, swatch: item.colour, filled: true }
}

function itemRow(
  slot: Exclude<ItemSlot, 'hairColor' | 'eyeColor' | 'skinColor'>,
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
export function EquippedList({ config, items, onRemove, onJump }: EquippedListProps) {
  const { t } = useTranslation('normal')

  const contentFor = (row: RowId): RowContent => {
    if (row === 'gender') return genderRow(config, t)
    if (COLOUR_SLOTS.has(row)) return colourRow(row as 'hairColor' | 'eyeColor' | 'skinColor', config, items, t)
    return itemRow(row as Exclude<ItemSlot, 'hairColor' | 'eyeColor' | 'skinColor'>, config, items, t)
  }

  // The gender has no tab of its own: until the switch heads the look group (A6), its row opens that group's first tab.
  const jumpTarget = (row: RowId): TabId => (row === 'gender' ? 'hairColor' : tabOfSlot(row))

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
                  <Icon name={ROW_ICON[row]} />
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
