import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { groupTabId, panelId, subTabId } from './categories.js'
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
    showLocked: false,
    onShowLocked: vi.fn(),
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

  it('shows no count on a sub-tab the counts leave out', () => {
    // COUNTS has none for the look group's tabs.
    renderNav({ tab: 'hairColor' })

    const { subList } = navLists()
    const hairColor = within(subList).getByRole('tab', { name: viNormal.wardrobe.tabs.hairColor })
    expect(hairColor).not.toHaveTextContent('/')
  })

  it('clicking a sub-tab calls onTab with its id', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    await user.click(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.outfit}`) }))

    expect(onTab).toHaveBeenCalledWith('outfit')
  })

  it('moves through the sub-tabs on repeated ArrowRight, moving DOM focus each time so the second press advances again', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) }).focus()

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')

    expect(onTab).toHaveBeenNthCalledWith(1, 'face')
    expect(onTab).toHaveBeenNthCalledWith(2, 'outfit')
    const outfit = within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.outfit}`) })
    expect(outfit).toHaveFocus()
  })

  it('moves to the previous sub-tab on ArrowLeft, wrapping to the last one from the first, and focuses it', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { subList } = navLists()
    within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) }).focus()
    await user.keyboard('{ArrowLeft}')

    expect(onTab).toHaveBeenCalledWith('outfit')
    const outfit = within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.outfit}`) })
    expect(outfit).toHaveFocus()
  })

  it("moves through the groups on repeated ArrowRight, moving DOM focus and selecting each group's first tab", async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { groupList } = navLists()
    within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look }).focus()

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')

    // look -> wear (first tab `head`) -> decor (first tab `aura`), per categories.ts GROUPS.
    expect(onTab).toHaveBeenNthCalledWith(1, 'head')
    expect(onTab).toHaveBeenNthCalledWith(2, 'aura')
    const decor = within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })
    expect(decor).toHaveFocus()
  })

  it('wraps ArrowLeft from the first group to the last, focuses it, and selects its first tab', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderNav({ tab: 'head', onTab })

    const { groupList } = navLists()
    within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look }).focus()

    await user.keyboard('{ArrowLeft}')

    expect(onTab).toHaveBeenCalledWith('aura')
    const decor = within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })
    expect(decor).toHaveFocus()
  })

  // No11a (design §3.1 item 3): one native checkbox in its label replaced the three filter buttons, beside the count.
  it('shows the "show items you don\'t own yet" box unticked, beside the "n/m đã có" count, and no filter buttons', () => {
    renderNav({ tab: 'head', showLocked: false })

    const box = screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked })
    expect(box).not.toBeChecked()
    expect(box.tagName).toBe('INPUT')
    expect(box.closest('label')).not.toBeNull()
    expect(screen.getByText(viNormal.wardrobe.ownedCount.replace('{{owned}}', '5').replace('{{total}}', '8'))).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the box ticked when showLocked is true', () => {
    renderNav({ showLocked: true })

    expect(screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked })).toBeChecked()
  })

  it('ticking the box calls onShowLocked(true)', async () => {
    const user = userEvent.setup()
    const onShowLocked = vi.fn()
    renderNav({ showLocked: false, onShowLocked })

    await user.click(screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked }))
    expect(onShowLocked).toHaveBeenLastCalledWith(true)
  })

  it('unticking the box calls onShowLocked(false)', async () => {
    const user = userEvent.setup()
    const onShowLocked = vi.fn()
    renderNav({ showLocked: true, onShowLocked })

    await user.click(screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked }))
    expect(onShowLocked).toHaveBeenLastCalledWith(false)
  })

  it('hides the box entirely when showFilter is false', () => {
    renderNav({ tab: 'hairColor', showFilter: false })

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(viNormal.wardrobe.showLocked)).toBeNull()
  })

  it("gives every tab an id and an aria-controls naming its panel's own id (design §7)", () => {
    renderNav({ tab: 'head' })

    const { groupList, subList } = navLists()
    const wearGroup = within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.wear })
    expect(wearGroup).toHaveAttribute('id', groupTabId('wear'))
    // The active group's own tab is what it controls; "wear"'s first tab is `head` (categories.ts GROUPS).
    expect(wearGroup).toHaveAttribute('aria-controls', panelId('head'))

    const lookGroup = within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look })
    // Not the active group: it controls the panel its own first tab would show, `hairColor` (GROUPS again).
    expect(lookGroup).toHaveAttribute('aria-controls', panelId('hairColor'))

    const headTab = within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })
    expect(headTab).toHaveAttribute('id', subTabId('head'))
    expect(headTab).toHaveAttribute('aria-controls', panelId('head'))
  })

  it('gives only the selected tab a tabindex of 0 in each tablist — every other tab is -1 (roving tabindex)', () => {
    renderNav({ tab: 'head' })

    const { groupList, subList } = navLists()
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.wear })).toHaveAttribute('tabindex', '0')
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look })).toHaveAttribute('tabindex', '-1')
    expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })).toHaveAttribute('tabindex', '-1')

    expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('tabindex', '0')
    expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.face}`) })).toHaveAttribute('tabindex', '-1')
  })
})
