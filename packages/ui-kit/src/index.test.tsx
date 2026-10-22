import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as kit from './index.js'
import { UI_KIT_VERSION } from './index.js'

describe('ui-kit test setup', () => {
  it('renders JSX under jsdom', () => {
    render(<span data-testid="v">{UI_KIT_VERSION}</span>)
    expect(screen.getByTestId('v')).toHaveTextContent('0.1.0')
  })

  it('exports the live chibi’s pieces (BP-30)', () => {
    expect(kit.CHIBI_LIFE.spinMs).toBe(500)
    expect(typeof kit.useChibiLife).toBe('function')
    expect(typeof kit.useOnScreen).toBe('function')
    expect(typeof kit.useTintedLayerState).toBe('function')
    expect(typeof kit.LiveFigure).toBe('function')
    expect(typeof kit.TurnButton).toBe('function')
    expect(kit.flipFacing('right')).toBe('left')
    expect(kit.nextReaction(null, 'cheer')).toEqual({ kind: 'cheer', key: 1 })
  })
})
