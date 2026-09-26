import type { ItemDto, ItemSlot, Rarity } from '../../api.js'

/**
 * The right column's vocabulary (design §3.1, §5.4, §5.5): three groups of tabs, a fixed card order
 * inside each tab, and the "all / owned / locked" filter. Kept apart from `ItemTab`/`ColourTab`/
 * `BaseTab` themselves so the ordering and counting rules have one place to be tested — the tab
 * components below just ask this module what to draw.
 */

export type GroupId = 'look' | 'wear' | 'decor'

/** Every tab the wardrobe offers, `base` included even though it is not an owned slot — it still needs
 * a place in `GROUPS` and a `tabpanel` of its own. */
export type TabId = 'base' | 'hairColor' | 'eyeColor' | 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'words'

/** The three groups, in design §3.1's order, each listing its tabs in the order they render. */
export const GROUPS: readonly { id: GroupId; tabs: readonly TabId[] }[] = [
  { id: 'look', tabs: ['base', 'hairColor', 'eyeColor'] },
  { id: 'wear', tabs: ['head', 'face', 'outfit'] },
  { id: 'decor', tabs: ['aura', 'frame', 'words'] },
]

/** Which group owns a tab — every `TabId` is listed in exactly one `GROUPS` entry, so this never falls
 * through in practice; the exception exists only to keep the return type `GroupId` rather than
 * `GroupId | undefined`. */
export function groupOf(tab: TabId): GroupId {
  const found = GROUPS.find((group) => (group.tabs as readonly TabId[]).includes(tab))
  if (found === undefined) throw new Error(`no group lists tab "${tab}"`)
  return found.id
}

/** A slot's tab: itself, except the two word slots — which have no tab of their own — fold into `words`. */
export function tabOfSlot(slot: ItemSlot): TabId {
  if (slot === 'title' || slot === 'badge') return 'words'
  return slot
}

export type OwnershipFilter = 'all' | 'owned' | 'locked'

/** The slot(s) a tab's cards come from — every drawn/coloured tab is one slot; `words` is two, `base`
 * is none (a base is chosen, not a catalogue row). */
function slotsOf(tab: TabId): readonly ItemSlot[] {
  if (tab === 'base') return []
  if (tab === 'words') return ['title', 'badge']
  return [tab]
}

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2 }

/** Design §5.4's fixed order: rarity first, then catalogue order — `Array#sort` is stable, so items that
 * tie on rarity keep whatever order the catalogue already listed them in. */
function byRarityThenCatalogue(items: readonly ItemDto[]): ItemDto[] {
  return [...items].sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity])
}

/** Every catalogue row for a tab's slot(s), colour variants included — used by `counts`, which cares
 * about every ownable row, not just the ones that get their own card. */
function rowsForTab(tab: TabId, catalog: readonly ItemDto[]): ItemDto[] {
  const slots = slotsOf(tab)
  if (slots.length === 0) return []
  return catalog.filter((item) => slots.includes(item.slot))
}

/**
 * The items a tab lists as cards (design §5.4): its slot(s), minus colour variants — a row with its own
 * `asset.tint` hangs off its original as a dot instead (`ItemTab`'s `variantsByFile`) — ordered rarity
 * first, then catalogue order.
 */
export function tabItems(tab: TabId, catalog: readonly ItemDto[]): ItemDto[] {
  const rows = rowsForTab(tab, catalog).filter((item) => item.asset?.tint === undefined)
  return byRarityThenCatalogue(rows)
}

/**
 * "n/m đã có" for a tab (design §3.1): every catalogue row for the tab's slot(s) counts toward the
 * total, colour variants included, because each one is its own ownable row — a card that is locked but
 * whose variant a player owns (Plan 13's beret case) should still move `owned` up by one. `null` for
 * `base`, which is chosen rather than owned and so has no "n/m" to show.
 */
export function counts(tab: TabId, catalog: readonly ItemDto[], owned: ReadonlySet<string>): { owned: number; total: number } | null {
  if (tab === 'base') return null
  const rows = rowsForTab(tab, catalog)
  return { owned: rows.filter((item) => owned.has(item.id)).length, total: rows.length }
}

/** The ownership filter (design §3.1, §5.5): "all" keeps everything, the other two split on `owned`. */
export function applyFilter(items: readonly ItemDto[], owned: ReadonlySet<string>, filter: OwnershipFilter): ItemDto[] {
  if (filter === 'all') return [...items]
  if (filter === 'owned') return items.filter((item) => owned.has(item.id))
  return items.filter((item) => !owned.has(item.id))
}
