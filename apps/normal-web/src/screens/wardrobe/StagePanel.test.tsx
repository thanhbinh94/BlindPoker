import type { ChibiConfig, Expression } from '@bp/ui-kit'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { StagePanel, type StagePanelProps } from './StagePanel.js'

const FACES = {
  neutral: 'body_f_face_neutral_L50',
  happy: 'body_f_face_happy_L50',
  sad: 'body_f_face_sad_L50',
  surprised: 'body_f_face_surprised_L50',
  closed: 'body_f_face_closed_L50',
  sleep: 'body_f_face_sleep_L50',
}

const SUBJECT: ChibiConfig = {
  kind: 'human',
  body: { gender: 'f', body: 'body_f_L30', faces: FACES },
  hair: { id: 'hair_f_bob01', back: 'item_hair_f_bob01_L20', front: 'item_hair_f_bob01_L60' },
  outfit: { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' },
}

const render = (ui: React.ReactElement) => renderWithI18n(ui, makeI18n('vi'))

/** The kit's own words (`avatar.turn`, `avatar.greet` in ui-kit's `game.json`), on the live figure's two controls. */
const TURN = 'Xoay'
const GREET = 'Nhân vật của bạn, bấm để chào'

const BASE: StagePanelProps = { subject: SUBJECT, expression: 'neutral', onExpression: () => {}, portrait: false }

/** Renders the stage, and hands back a way to render it again with other props inside the same i18n provider:
 * testing-library's own `rerender` drops the provider `renderWithI18n` wrapped it in, and that remounts the tree. */
function renderStage(props: Partial<StagePanelProps> = {}): (next: Partial<StagePanelProps>) => void {
  const view = render(<StagePanel {...BASE} {...props} />)
  return (next) =>
    view.rerender(
      <I18nextProvider i18n={view.i18n}>
        <StagePanel {...BASE} {...props} {...next} />
      </I18nextProvider>,
    )
}

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

  it('announces the name politely when it changes', async () => {
    const user = userEvent.setup()
    render(<Stateful initial="neutral" />)

    const output = screen.getByRole('status')
    expect(output.tagName).toBe('OUTPUT')
    expect(output).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.next }))
    // The same live region, its text changed in place: that change is what a screen reader announces.
    expect(screen.getByRole('status')).toBe(output)
    expect(output).toHaveTextContent(viNormal.wardrobe.expression.happy)
  })

  // Final fix wave (B5): focusing either button reads the face it would step from.
  it('describes both buttons by the current face, and keeps the description current', async () => {
    const user = userEvent.setup()
    render(<Stateful initial="happy" />)

    const prev = screen.getByRole('button', { name: viNormal.wardrobe.expression.prev })
    const next = screen.getByRole('button', { name: viNormal.wardrobe.expression.next })
    expect(prev).toHaveAccessibleDescription(viNormal.wardrobe.expression.happy)
    expect(next).toHaveAccessibleDescription(viNormal.wardrobe.expression.happy)

    await user.click(next)
    expect(prev).toHaveAccessibleDescription(viNormal.wardrobe.expression.sad)
    expect(next).toHaveAccessibleDescription(viNormal.wardrobe.expression.sad)
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

    // Left past the first face wraps to the last…
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.sleep)
    // …and right past the last wraps to the first.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(viNormal.wardrobe.expression.neutral)
    expect(onExpression.mock.calls.map(([expression]) => expression)).toEqual(['happy', 'neutral', 'sleep', 'neutral'])
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

  // BP-30 (spec K6 §3.2): the stage's figure lives, and keeps the name three e2e suites find it by (R6).
  it('renders the figure live with a Xoay button and keeps the name "Phòng thay đồ"', () => {
    const update = renderStage()

    const figure = screen.getByRole('img', { name: 'Phòng thay đồ' })
    expect(viNormal.wardrobe.title).toBe('Phòng thay đồ')
    expect(figure).toHaveAttribute('data-live', 'idle')
    expect(screen.getByRole('button', { name: TURN })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: GREET })).toBeInTheDocument()

    // The Khung tab's head portrait is the same live figure, with its own Xoay.
    update({ portrait: true })
    const head = screen.getByRole('img', { name: 'Phòng thay đồ' })
    expect(head).toHaveAttribute('data-frame', 'head')
    expect(head).toHaveAttribute('data-live', 'idle')
    expect(screen.getByRole('button', { name: TURN })).toBeInTheDocument()
  })

  it('the expression group still has exactly [prev, next]', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} />)

    const group = screen.getByRole('group', { name: viNormal.wardrobe.expression.legend })
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      viNormal.wardrobe.expression.prev,
      viNormal.wardrobe.expression.next,
    ])
    // Xoay sits beside the group, not in it: ArrowLeft/ArrowRight there step the faces, not the turn.
    expect(group.contains(screen.getByRole('button', { name: TURN }))).toBe(false)
  })

  it('Xoay toggles data-facing on the figure', async () => {
    const user = userEvent.setup()
    const update = renderStage()
    const turn = screen.getByRole('button', { name: TURN })
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).toHaveAttribute('data-facing', 'right')
    expect(turn).toHaveAttribute('aria-pressed', 'false')

    await user.click(turn)
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).toHaveAttribute('data-facing', 'left')
    expect(turn).toHaveAttribute('aria-pressed', 'true')

    // The facing survives the Khung swap: one figure, its frame changed, not a second figure mounted.
    const full = screen.getByRole('img', { name: 'Phòng thay đồ' })
    update({ portrait: true })
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).toBe(full)
    expect(full).toHaveAttribute('data-frame', 'head')
    expect(full).toHaveAttribute('data-facing', 'left')

    await user.click(screen.getByRole('button', { name: TURN }))
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).toHaveAttribute('data-facing', 'right')
  })

  it('plays the reaction the screen hands it', () => {
    const update = renderStage({ react: null })
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).not.toHaveAttribute('data-reacting')

    update({ react: { kind: 'cheer', key: 1 } })
    expect(screen.getByRole('img', { name: 'Phòng thay đồ' })).toHaveAttribute('data-reacting', 'cheer')
  })

  it('marks the stage compact when asked', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} compact />)

    expect(document.querySelector('[data-compact="true"]')).not.toBeNull()
  })
})
