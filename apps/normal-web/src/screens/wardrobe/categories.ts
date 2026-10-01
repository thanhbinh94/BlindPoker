import type { ItemDto, ItemSlot, Rarity } from '../../api.js'

/**
 * The right column's vocabulary (design §3.1, §5.4, §5.5): three groups of tabs, a fixed card order
 * inside each tab, colour-variant families, and the "owned only, or everything" box. Kept apart from
 * `ItemTab`/`ColourTab`/`BaseTab` themselves so the ordering, family and counting rules have one place
 * to be tested — the tab components below just ask this module what to draw.
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

/** Phone is anything under the tablet floor (design §3.1–§3.3, Global Constraints) — the one breakpoint
 * both `WardrobeScreen` (the two-column-vs-one-column switch) and `BaseTab` (the base portrait's own
 * smaller size) need, so it lives here once rather than as two copies of the same literal string. */
export const PHONE_QUERY = '(max-width: 767px)'

/** Stable DOM ids linking `CategoryNav`'s two `tablist`s to the panels they control (design §7): a tab's
 * `id` is what its panel's `aria-labelledby` names, and `panelId` is what the tab's own `aria-controls`
 * names. Kept here, not in `CategoryNav` or `WardrobeScreen`, because both ends of every relationship —
 * the tab that points at a panel and the panel that points back — have to agree on the same string. */
export const groupTabId = (group: GroupId): string => `wardrobe-grouptab-${group}`
export const subTabId = (tab: TabId): string => `wardrobe-subtab-${tab}`
export const panelId = (tab: TabId): string => `wardrobe-panel-${tab}`

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
 * `asset.tint` hangs off its original as a dot instead (`variantsByFile` below) — ordered rarity
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

/**
 * Every row of a slot's colour variants, keyed by the file they share with their original (design §4.1): items that
 * share `asset.file` with another item but carry their own `asset.tint` are not separate cards — they are dots under
 * the item whose file they share. The original the variants vary has no `tint` at all, which is exactly what tells a
 * card apart from a dot, so an original is never a key's member. Catalogue order within each list.
 */
export function variantsByFile(rows: readonly ItemDto[]): Map<string, ItemDto[]> {
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

/**
 * One card of a tab (design §4.1, §5.5): a family — an original and the colour variants that share its file — as the
 * player sees it. A row with no variants (a colour swatch, a word, most items) is a family of one.
 */
export interface FamilyCard {
  /** The family's untinted original: the card's identity, and the name its dot row carries. */
  original: ItemDto
  /**
   * The member the card itself draws, names and picks: the original — unless the box is unticked and the player owns
   * no original but some variant, when it is the first owned variant in catalogue order (No11a, pre-flight amendment
   * 5). Plan 18 Task 4 extends the choice (the worn member first).
   */
  shown: ItemDto
  /** The dot row: the family's colour variants in catalogue order — only the owned ones while the box is unticked. */
  dots: ItemDto[]
}

const NO_VARIANTS: ReadonlyMap<string, readonly ItemDto[]> = new Map()

/**
 * What a tab lists (design §3.1 item 3, §5.5; review 2026-09-29, No11a): with the box unticked — the default — only
 * the families the player owns a member of, each card showing an owned member and only the owned dots; with "Hiện cả
 * món chưa có" ticked, every card as its original and every dot, owned or not, exactly as before No11a. `items` are a
 * tab's cards (`tabItems`); `variants` is the slot's `variantsByFile`, left out for a slot that has none.
 */
export function applyFilter(
  items: readonly ItemDto[],
  owned: ReadonlySet<string>,
  showLocked: boolean,
  variants: ReadonlyMap<string, readonly ItemDto[]> = NO_VARIANTS,
): FamilyCard[] {
  const cards: FamilyCard[] = []
  for (const original of items) {
    const family = original.asset === undefined ? [] : (variants.get(original.asset.file) ?? [])
    if (showLocked) {
      cards.push({ original, shown: original, dots: [...family] })
      continue
    }
    const ownedDots = family.filter((variant) => owned.has(variant.id))
    const shown = owned.has(original.id) ? original : ownedDots[0]
    if (shown !== undefined) cards.push({ original, shown, dots: ownedDots })
  }
  return cards
}

/**
 * One slot's cards, ready to draw: `tabItems` for the order and the variant split, `variantsByFile` for the families,
 * `applyFilter` for the box. The words tab calls it once per slot (`title`, `badge`), which is how `WardrobeScreen`
 * knows both of its headings would be empty before either `ItemTab` draws.
 */
export function slotCards(slot: ItemSlot, catalog: readonly ItemDto[], owned: ReadonlySet<string>, showLocked: boolean): FamilyCard[] {
  const rows = tabItems(tabOfSlot(slot), catalog).filter((item) => item.slot === slot)
  const variants = variantsByFile(catalog.filter((item) => item.slot === slot))
  return applyFilter(rows, owned, showLocked, variants)
}
