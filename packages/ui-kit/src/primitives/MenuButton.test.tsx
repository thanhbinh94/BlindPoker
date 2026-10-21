import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MenuButton, type MenuItem } from './MenuButton.js'

const items = (overrides: Partial<Record<string, Partial<MenuItem>>> = {}): MenuItem[] => [
  { id: 'stand', label: 'Đứng dậy', onSelect: vi.fn(), ...overrides.stand },
  { id: 'sit', label: 'Tạm nghỉ', onSelect: vi.fn(), checked: false, ...overrides.sit },
  { id: 'manage', label: 'Quản lý bàn', onSelect: vi.fn(), ...overrides.manage },
]

describe('MenuButton', () => {
  it('opens on a click and lists its items by text, with the roles a menu has', async () => {
    render(<MenuButton label="Thêm" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'Thêm' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Thêm' })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Đứng dậy' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Quản lý bàn' })).toBeInTheDocument()
    // the first item takes the focus, as a menu button's menu does
    expect(screen.getByRole('menuitem', { name: 'Đứng dậy' })).toHaveFocus()
  })

  it('renders an item with `checked` as a menuitemcheckbox carrying aria-checked', async () => {
    render(<MenuButton label="Thêm" items={items({ sit: { checked: true } })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    const sit = screen.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ' })
    expect(sit).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('menuitem', { name: 'Tạm nghỉ' })).toBeNull()
  })

  it('closes on Escape and gives the focus back to the trigger', async () => {
    render(<MenuButton label="Thêm" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'Thêm' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('calls the item and closes once one is picked', async () => {
    const list = items()
    render(<MenuButton label="Thêm" items={list} />)
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Quản lý bàn' }))
    expect(list[2]!.onSelect).toHaveBeenCalledTimes(1)
    expect(list[0]!.onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Thêm' })).toHaveFocus()
  })

  it('closes on a press outside it, and leaves a disabled item uncallable', async () => {
    const list = items({ sit: { disabled: true } })
    render(
      <div>
        <p>outside</p>
        <MenuButton label="Thêm" items={list} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Tạm nghỉ' })).toBeDisabled()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves the focus between the enabled items with the arrow keys', async () => {
    render(<MenuButton label="Thêm" items={items({ sit: { disabled: true } })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Quản lý bàn' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Đứng dậy' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Quản lý bàn' })).toHaveFocus()
  })
})
