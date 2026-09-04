import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { applyTheme } from '../theme/index.js'
import { Badge } from './Badge.js'
import { Button } from './Button.js'
import { Field } from './Field.js'
import { Modal } from './Modal.js'
import { Panel } from './Panel.js'
import { Select } from './Select.js'

// react/jsx-no-literals also covers {'string'} expressions, so JSX text comes from constants.
const GO = 'Go'
const FOLD = 'Fold'
const BODY = 'body'
const X = 'x'
const INNER = 'inner'

describe('Button', () => {
  it('renders an accessible button and fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>{GO}</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('is disabled while loading', () => {
    render(<Button loading>{GO}</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })
  it('carries variant and size classes', () => {
    render(
      <Button variant="danger" size="lg">
        {FOLD}
      </Button>,
    )
    expect(screen.getByRole('button').className).toMatch(/danger/)
    expect(screen.getByRole('button').className).toMatch(/lg/)
  })
})

describe('Field + Select', () => {
  it('associates label, hint and error with the control', () => {
    render(
      <Field label="Mode" hint="Pick one" error="Required" id="mode">
        <Select
          id="mode"
          value="a"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={() => {}}
        />
      </Field>,
    )
    const select = screen.getByLabelText('Mode')
    expect(select).toHaveAccessibleDescription(expect.stringContaining('Pick one'))
    expect(select).toHaveAccessibleDescription(expect.stringContaining('Required'))
    expect(select).toHaveAttribute('aria-invalid', 'true')
  })
  it('labels a control that has no id of its own', () => {
    render(
      <Field label="Room name">
        <input />
      </Field>,
    )
    expect(screen.getByLabelText('Room name')).toBeInTheDocument()
  })
  it('Select reports typed values', async () => {
    const onChange = vi.fn()
    render(
      <Select
        value={1}
        options={[
          { value: 1, label: 'One' },
          { value: 2, label: 'Two' },
        ]}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByRole('combobox'), '2')
    expect(onChange).toHaveBeenCalledWith(2)
  })
})

describe('Modal', () => {
  it('renders a dialog when open, closes on Escape and backdrop, and not at all when closed', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal open title="Hi" onClose={onClose} closeLabel="Close">
        {BODY}
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Hi' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
    rerender(
      <Modal open={false} title="Hi" onClose={onClose} closeLabel="Close">
        {BODY}
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('focuses a control inside the dialog on open and exposes a labelled close button', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="Settings" onClose={onClose} closeLabel="Close">
        {BODY}
      </Modal>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })
  it('does not close when the dialog surface itself is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="Hi" onClose={onClose} closeLabel="Close">
        {BODY}
      </Modal>,
    )
    await userEvent.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Panel / Badge / theme', () => {
  it('renders tone classes and applies theme attribute', () => {
    render(<Badge tone="gold">{X}</Badge>)
    expect(screen.getByText('x').className).toMatch(/gold/)
    applyTheme(document.documentElement, 'light')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme(document.documentElement, 'dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('Panel exposes its title as a heading and keeps extra class names', () => {
    render(
      <Panel title="Seats" tone="felt" className="wide">
        {INNER}
      </Panel>,
    )
    expect(screen.getByRole('heading', { name: 'Seats' })).toBeInTheDocument()
    expect(screen.getByText('inner').closest('section')?.className).toMatch(/wide/)
  })
})
