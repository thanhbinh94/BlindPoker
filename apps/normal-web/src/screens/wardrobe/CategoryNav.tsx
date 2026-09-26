import { useRef, type KeyboardEvent, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { groupTabId, GROUPS, groupOf, panelId, subTabId, type OwnershipFilter, type TabId } from './categories.js'
import { Icon, type IconName } from './icons.js'
import s from './wardrobe.module.css'

export interface CategoryNavProps {
  tab: TabId
  /** Choosing a group selects its first tab (design §5.3 keeps the *tab* itself, not the group, as the
   * one piece of state this screen remembers — the group is always derived from it via `groupOf`). */
  onTab: (tab: TabId) => void
  counts: Partial<Record<TabId, { owned: number; total: number }>>
  filter: OwnershipFilter
  onFilter: (f: OwnershipFilter) => void
  /** `false` on `base` (design §3.1): a base is chosen, not owned, so "all/owned/locked" has nothing to
   * split on. */
  showFilter: boolean
}

const FILTERS: readonly OwnershipFilter[] = ['all', 'owned', 'locked']

/**
 * Roving-tabindex arrow keys for one `tablist` (WAI-ARIA's tabs pattern): ArrowRight/ArrowLeft pick the
 * neighbour — wrapping at either end — call `select` with it, and move DOM focus onto its own button.
 * Moving focus matters, not just cosmetically: the *next* key press reads its target tab off the
 * `index` closed over by whichever button is actually focused, so without an explicit `.focus()` here a
 * second press in the same direction re-fires the first button's handler and never advances past its
 * immediate neighbour (`head` → `face` → `face` …) instead of reaching `outfit`.
 */
function onArrowKey<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  items: readonly T[],
  refs: MutableRefObject<(HTMLButtonElement | null)[]>,
  select: (next: T, nextIndex: number) => void,
): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const nextIndex = (index + delta + items.length) % items.length
  select(items[nextIndex]!, nextIndex)
  refs.current[nextIndex]?.focus()
}

/**
 * The right column's header (design §3.1): the three groups, the active group's sub-tabs (each with its
 * "owned/total" count), and the ownership filter — everything above the card grid itself.
 *
 * Two nested `tablist`s rather than one flat one, matching the two-level structure the mockup draws: a
 * group's own label can legitimately repeat a sub-tab's (`wear`'s "Trang phục" names both the clothing
 * group and its `outfit` tab), so callers — and this component's own keyboard handling — always work
 * with ids, never with the rendered label. Both tablists share `onArrowKey` above.
 */
export function CategoryNav({ tab, onTab, counts, filter, onFilter, showFilter }: CategoryNavProps) {
  const { t } = useTranslation('normal')
  const activeGroup = groupOf(tab)
  const subTabs = GROUPS.find((group) => group.id === activeGroup)!.tabs
  const activeCount = counts[tab] ?? null

  const groupRefs = useRef<(HTMLButtonElement | null)[]>([])
  const subTabRefs = useRef<(HTMLButtonElement | null)[]>([])

  return (
    <div className={s.categoryNav}>
      <div className={s.groupTabs} role="tablist" aria-label={t('wardrobe.title')}>
        {GROUPS.map((group, index) => {
          const selected = group.id === activeGroup
          // A group tab has no panel of its own — choosing one jumps to its first sub-tab (`onTab` above)
          // — so its `aria-controls` names whichever panel is actually on screen for it: the active tab's,
          // while this is the active group, or the panel its own first tab would show otherwise.
          const controls = selected ? tab : group.tabs[0]!
          return (
            <button
              key={group.id}
              ref={(el) => {
                groupRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={groupTabId(group.id)}
              className={s.groupTab}
              aria-selected={selected}
              aria-controls={panelId(controls)}
              // Roving tabindex (WAI-ARIA's tabs pattern): only the selected tab sits in the page's own Tab
              // order; arrow keys (`onArrowKey` below) move both focus and this attribute together.
              tabIndex={selected ? 0 : -1}
              onClick={() => onTab(group.tabs[0]!)}
              onKeyDown={(event) => onArrowKey(event, index, GROUPS, groupRefs, (next) => onTab(next.tabs[0]!))}
            >
              <span aria-hidden="true" className={s.groupIcon}>
                <Icon name={GROUP_ICON[group.id]} />
              </span>
              {t(`wardrobe.groups.${group.id}`)}
            </button>
          )
        })}
      </div>

      <div className={s.subTabs} role="tablist" aria-label={t(`wardrobe.groups.${activeGroup}`)}>
        {subTabs.map((subTab, index) => {
          const count = counts[subTab]
          const selected = subTab === tab
          return (
            <button
              key={subTab}
              ref={(el) => {
                subTabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={subTabId(subTab)}
              className={s.subTab}
              aria-selected={selected}
              aria-controls={panelId(subTab)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTab(subTab)}
              onKeyDown={(event) => onArrowKey(event, index, subTabs, subTabRefs, (next) => onTab(next))}
            >
              {t(`wardrobe.tabs.${subTab}`)}
              {count === null || count === undefined ? null : (
                <span className={s.tabCount}>
                  {count.owned}/{count.total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {!showFilter ? null : (
        <div className={s.filterRow}>
          <div className={s.filterButtons}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={s.filterBtn} aria-pressed={filter === f} onClick={() => onFilter(f)}>
                {t(`wardrobe.filter.${f}`)}
              </button>
            ))}
          </div>
          {activeCount === null ? null : (
            <span className={s.ownedCountLabel}>{t('wardrobe.ownedCount', { owned: activeCount.owned, total: activeCount.total })}</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Small monochrome line icons (V2 fix, `./icons.js`), aria-hidden — the label already names the group. */
const GROUP_ICON: Record<(typeof GROUPS)[number]['id'], IconName> = {
  look: 'person',
  wear: 'shirt',
  decor: 'sparkle',
}
