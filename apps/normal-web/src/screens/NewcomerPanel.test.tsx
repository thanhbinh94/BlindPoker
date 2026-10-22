import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NewcomerStatusDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { NewcomerPanel } from './NewcomerPanel.js'

const renderPanel = (newcomer: NewcomerStatusDto | undefined) => renderWithI18n(<NewcomerPanel newcomer={newcomer} lang="vi" />, makeI18n('vi'))

const cells = () => within(screen.getByRole('list', { name: viNormal.daily.newcomer.title })).getAllByRole('listitem')
const marks = (mark: 'claimed' | 'today' | 'locked') => cells().filter((cell) => cell.getAttribute('data-mark') === mark)

describe('NewcomerPanel', () => {
  it('marks day 2 as today’s, the welcome day as taken and the five after as still locked', () => {
    renderPanel({ day: 2, claimedDays: [1], finished: false })

    expect(screen.getByRole('heading', { name: viNormal.daily.newcomer.title })).toBeInTheDocument()
    expect(cells()).toHaveLength(7)
    expect(marks('claimed')).toHaveLength(1)
    expect(marks('today')).toHaveLength(1)
    expect(marks('locked')).toHaveLength(5)
    expect(marks('claimed')[0]).toHaveTextContent('✓')
    expect(marks('today')[0]).toHaveTextContent('★')
    expect(marks('today')[0]).toHaveTextContent(viNormal.daily.newcomer.today)
    expect(marks('today')[0]).toHaveAttribute('aria-current', 'date')
    for (const cell of marks('locked')) expect(cell).toHaveTextContent('🔒')
  })

  it('names the gifts of days 3 and 7 in their own cells', () => {
    renderPanel({ day: 2, claimedDays: [1], finished: false })

    const [, , third, , , , seventh] = cells()
    expect(third).toHaveTextContent(viNormal.daily.newcomer.common)
    expect(seventh).toHaveTextContent(viNormal.daily.newcomer.rare.replace('{{amount}}', '200'))
  })

  it('shows the welcome day alone as taken, with no star, while today’s check-in is already counted', () => {
    renderPanel({ day: 1, claimedDays: [1], finished: false })

    expect(marks('claimed')).toHaveLength(1)
    expect(marks('today')).toHaveLength(0)
    expect(marks('locked')).toHaveLength(6)
  })

  it.each([
    ['missing', undefined],
    ['finished', { day: 7, claimedDays: [1, 2, 3, 4, 5, 6, 7], finished: true }],
  ])('renders nothing when the calendar is %s', (_label, newcomer) => {
    const { container } = renderPanel(newcomer)
    expect(container).toBeEmptyDOMElement()
  })
})
