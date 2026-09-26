import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { CategoryNav, type CategoryNavProps } from './CategoryNav.js'

const COUNTS: CategoryNavProps['counts'] = {
  head: { owned: 5, total: 8 },
  face: { owned: 2, total: 4 },
  outfit: { owned: 3, total: 6 },
}

function renderNav(overrides: Partial<CategoryNavProps> = {}) {
  const props: CategoryNavProps = {
    tab: 'head',
    onTab: vi.fn(),
    counts: COUNTS,
    filter: 'all',
    onFilter: vi.fn(),
    showFilter: true,
    ...overrides,
  }
  renderWithI18n(<CategoryNav {...props} />, makeI18n('vi'))
  return props
}

/** The group tablist and the active group's sub-tab tablist — in that DOM order — so a test can scope its
 * queries and never trip over "Trang phục" naming both the `wear` group and its `outfit` sub-tab. */
function navLists(): { groupList: HTMLElement; subList: HTMLElement } {
  const [groupList, subList] = screen.getAllByRole('tablist')
  return { groupList: groupList!, subList: subList! }
}

describe('CategoryNav', () => {
  it('lists the three groups as a tablist, the group of the active tab selected', () => {
    renderNav({ tab: 'head' })

    const { groupList } = navLists()
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look })).toHaveAttribute('aria-selected', 'false')
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.wear })).toHaveAttribute('aria-selected', 'true')
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })).toHaveAttribute('aria-selected', 'false')
  })

  it("choosing a group selects its first tab", async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { groupList } = navLists()
    await user.click(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor }))

    // decor's first tab is `aura` (categories.ts GROUPS)
    expect(onTab).toHaveBeenCalledWith('aura')
  })

  it('lists the active group\'s sub-tabs, each with an "owned/total" count, and selects the active one', () => {
    renderNav({ tab: 'head' })

    const { subList } = navLists()
    const head = within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })
    expect(head).toHaveAttribute('aria-selected', 'true')
    expect(head).toHaveTextContent('5/8')

    const face = within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.face}`) })
    expect(face).toHaveTextContent('2/4')
  })

  it('shows no count on the base tab', () => {
    renderNav({ tab: 'base' })

    const { subList } = navLists()
    const base = within(subList).getByRole('tab', { name: viNormal.wardrobe.tabs.base })
    expect(base).not.toHaveTextContent('/')
  })

  it('clicking a sub-tab calls onTab with its id', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    await user.click(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.outfit}`) }))

    expect(onTab).toHaveBeenCalledWith('outfit')
  })

  it('moves to the next sub-tab on ArrowRight and calls onTab', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onTab).toHaveBeenCalledWith('face')
  })

  it('moves to the previous sub-tab on ArrowLeft, wrapping to the last one from the first', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) }).focus()
    await user.keyboard('{ArrowLeft}')

    expect(onTab).toHaveBeenCalledWith('outfit')
  })

  it('shows the three ownership filters as aria-pressed buttons, the active one pressed', () => {
    renderNav({ filter: 'owned' })

    expect(screen.getByRole('button', { name: viNormal.wardrobe.filter.all })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: viNormal.wardrobe.filter.owned })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: viNormal.wardrobe.filter.locked })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a filter button calls onFilter', async () => {
    const user = userEvent.setup()
    const onFilter = vi.fn()
    renderNav({ filter: 'all', onFilter })

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.filter.locked }))

    expect(onFilter).toHaveBeenCalledWith('locked')
  })

  it('hides the filter entirely when showFilter is false', () => {
    renderNav({ tab: 'base', showFilter: false })

    expect(screen.queryByRole('button', { name: viNormal.wardrobe.filter.all })).toBeNull()
    expect(screen.queryByRole('button', { name: viNormal.wardrobe.filter.owned })).toBeNull()
    expect(screen.queryByRole('button', { name: viNormal.wardrobe.filter.locked })).toBeNull()
  })
})
