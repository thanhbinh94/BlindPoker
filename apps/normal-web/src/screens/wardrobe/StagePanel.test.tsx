import type { ChibiConfig } from '@bp/ui-kit'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('renders one segmented row of six expression buttons, aria-pressed on the current one', () => {
    render(<StagePanel subject={SUBJECT} expression="happy" onExpression={vi.fn()} portrait={false} />)

    const group = screen.getByRole('group', { name: viNormal.wardrobe.expression.legend })
    const buttons = group.querySelectorAll('button')
    expect(buttons).toHaveLength(6)
    expect(screen.getByRole('button', { name: viNormal.wardrobe.expression.happy })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: viNormal.wardrobe.expression.neutral })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onExpression with the clicked expression', async () => {
    const user = userEvent.setup()
    const onExpression = vi.fn()
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={onExpression} portrait={false} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.expression.sad }))

    expect(onExpression).toHaveBeenCalledWith('sad')
  })

  it('marks the stage compact when asked', () => {
    render(<StagePanel subject={SUBJECT} expression="neutral" onExpression={vi.fn()} portrait={false} compact />)

    expect(document.querySelector('[data-compact="true"]')).not.toBeNull()
  })
})
