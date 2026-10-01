import type { ChibiConfig, Expression } from '@bp/ui-kit'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { StagePanel } from './StagePanel.js'

const FACES = {
  neutral: 'base_f01_face_neutral_L50',
  happy: 'base_f01_face_happy_L50',
  sad: 'base_f01_face_sad_L50',
  surprised: 'base_f01_face_surprised_L50',
  closed: 'base_f01_face_closed_L50',
  sleep: 'base_f01_face_sleep_L50',
}

const SUBJECT: ChibiConfig = {
  kind: 'human',
  base: { id: 'f01', hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60', faces: FACES },
  outfit: { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' },
}

const render = (ui: React.ReactElement) => renderWithI18n(ui, makeI18n('vi'))

/** `StagePanel` is controlled — the screen owns the expression — so a test that steps through the faces needs
 * something to hold it. `onExpression` is still called for every step, so a test can read what the screen would get. */
function Stateful({ initial, onExpression, portrait = false }: { initial: Expression; onExpression?: (expression: Expression) => void; portrait?: boolean }) {
  const [expression, setExpression] = useState<Expression>(initial)
  return (
    <StagePanel
      subject={SUBJECT}
      expression={expression}
      onExpression={(next) => {
        setExpression(next)
        onExpression?.(next)
      }}
      portrait={portrait}
    />
  )
}

describe('StagePanel', () => {
  it('shows the full-body figure, labelled, when not on the frame tab', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} />)

    const chibi = screen.getByRole('img', { name: viNormal.wardrobe.title })
    expect(chibi).toHaveAttribute('data-frame', 'full')
  })

  it('swaps to the framed head portrait when portrait is true, and drops the full figure', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait />)

    const chibis = document.querySelectorAll('[data-chibi-hash]')
    expect(chibis).toHaveLength(1)
    expect(chibis[0]).toHaveAttribute('data-frame', 'head')
  })

  it('is one labelled group of two buttons, previous and next, around the current expression (Plan 18, No10)', () => {
    render(<StagePanel subject={SUBJECT} expression="happy" onExpression={vi.fn()} portrait={false} />)

    const group = screen.getByRole('group', { name: viNormal.wardrobe.expression.legend })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      viNormal.wardrobe.expression.prev,
      viNormal.wardrobe.expression.next,
    ])
    // No six-chip row any more, so nothing is left to be `aria-pressed`.
    expect(group.querySelector('[aria-pressed]')).toBeNull()
    expect(within(group).getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.happy)
  })

  it('shows the current expression by name', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} />)

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.neutral)
    // The name sits between the two buttons: previous, name, next.
    const group = screen.getByRole('group', { name: viNormal.wardrobe.expression.legend })
    const order = [...group.children].map((child) => child.tagName)
    expect(order).toEqual(['BUTTON', 'OUTPUT', 'BUTTON'])
  })

  it('announces the name politely when it changes', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} />)

    const output = screen.getByRole('status')
    expect(output.tagName).toBe('OUTPUT')
    expect(output).toHaveAttribute('aria-live', 'polite')
  })

  it('next steps to the following expression and calls onExpression with it', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="neutral" onExpression={onExpression} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.next }))

    expect(onExpression).toHaveBeenCalledTimes(1)
    expect(onExpression).toHaveBeenCalledWith('happy')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.happy)
  })

  it('walks through all six faces in order and wraps back to the first', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="neutral" onExpression={onExpression} />)

    const next = screen.getByRole('button', { name: viNormal.wardrobe.expression.next })
    for (let i = 0; i < 6; i += 1) await user.click(next)

    expect(onExpression.mock.calls.map(([expression]) => expression)).toEqual(['happy', 'sad', 'surprised', 'closed', 'sleep', 'neutral'])
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.neutral)
  })

  it('previous from the first expression wraps to the last', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="neutral" onExpression={onExpression} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.prev }))

    expect(onExpression).toHaveBeenCalledWith('sleep')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.sleep)
  })

  it('previous steps back one face from the middle of the list', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="surprised" onExpression={onExpression} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.prev }))

    expect(onExpression).toHaveBeenCalledWith('sad')
  })

  it('ArrowRight and ArrowLeft on the group step too, wrapping at both ends', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="neutral" onExpression={onExpression} />)

    // Focus is on a button inside the group (the key bubbles up to the group).
    screen.getByRole('button', { name: viNormal.wardrobe.expression.next }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.happy)

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.sleep)
    expect(onExpression.mock.calls.map(([expression]) => expression)).toEqual(['happy', 'neutral', 'sleep'])
  })

  it('the full-body figure wears the face the row names', async () => {
    const user = userEvent.setup()
    render(<Stateful initial="neutral" />)
    expect(document.querySelector('[data-chibi-hash]')).toHaveAttribute('data-expression', 'neutral')

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.next }))

    const figure = document.querySelector('[data-chibi-hash]')
    expect(figure).toHaveAttribute('data-frame', 'full')
    expect(figure).toHaveAttribute('data-expression', 'happy')
  })

  it('the framed head portrait follows the stepper too', async () => {
    const user = userEvent.setup()
    render(<Stateful initial="sad" portrait />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.prev }))

    const portrait = document.querySelector('[data-chibi-hash]')
    expect(portrait).toHaveAttribute('data-frame', 'head')
    expect(portrait).toHaveAttribute('data-expression', 'happy')
  })

  it('leaves the browser shortcuts alone: Alt+ArrowLeft does not step', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<Stateful initial="neutral" onExpression={onExpression} />)

    screen.getByRole('button', { name: viNormal.wardrobe.expression.prev }).focus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')

    expect(onExpression).not.toHaveBeenCalled()
  })

  it('marks the stage compact when asked', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} compact />)

    expect(document.querySelector('[data-compact="true"]')).not.toBeNull()
  })
})
