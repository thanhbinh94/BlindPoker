import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { GROUPS, groupOf, type OwnershipFilter, type TabId } from './categories.js'
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
 * The right column's header (design §3.1): the three groups, the active group's sub-tabs (each with its
 * "owned/total" count), and the ownership filter — everything above the card grid itself.
 *
 * Two nested `tablist`s rather than one flat one, matching the two-level structure the mockup draws: a
 * group's own label can legitimately repeat a sub-tab's (`wear`'s "Trang phục" names both the clothing
 * group and its `outfit` tab), so callers — and this component's own keyboard handling — always work
 * with ids, never with the rendered label.
 */
export function CategoryNav({ tab, onTab, counts, filter, onFilter, showFilter }: CategoryNavProps) {
  const { t } = useTranslation('normal')
  const activeGroup = groupOf(tab)
  const subTabs = GROUPS.find((group) => group.id === activeGroup)!.tabs
  const activeCount = counts[tab] ?? null

  const onSubTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = subTabs[(index + delta + subTabs.length) % subTabs.length]!
    onTab(next)
  }

  return (
    <div className={s.categoryNav}>
      <div className={s.groupTabs} role="tablist" aria-label={t('wardrobe.title')}>
        {GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            className={s.groupTab}
            aria-selected={group.id === activeGroup}
            onClick={() => onTab(group.tabs[0]!)}
          >
            <span aria-hidden="true" className={s.groupIcon}>
              {GROUP_ICON[group.id]}
            </span>
            {t(`wardrobe.groups.${group.id}`)}
          </button>
        ))}
      </div>

      <div className={s.subTabs} role="tablist" aria-label={t(`wardrobe.groups.${activeGroup}`)}>
        {subTabs.map((subTab, index) => {
          const count = counts[subTab]
          return (
            <button
              key={subTab}
              type="button"
              role="tab"
              className={s.subTab}
              aria-selected={subTab === tab}
              onClick={() => onTab(subTab)}
              onKeyDown={(event) => onSubTabKeyDown(event, index)}
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

/** Decorative glyphs (aria-hidden — the label already names the group), matching the mockup's icon set
 * with the codebase's existing convention of plain characters rather than an icon library (`TableChrome`'s
 * badge glyphs). */
const GROUP_ICON: Record<(typeof GROUPS)[number]['id'], string> = {
  look: '\u{1F464}',
  wear: '\u{1F455}',
  decor: '✦',
}
